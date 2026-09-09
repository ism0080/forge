import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { Context, Effect, Layer } from "effect";

export interface SiteDb {
  readonly db: DatabaseSync;
  readonly statements: Map<string, StatementSync>;
}

export const openConnection = (file: string): SiteDb => {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return { db, statements: new Map() };
};

export const prepareStatement = (site: SiteDb, sql: string): StatementSync => {
  const cached = site.statements.get(sql);
  if (cached !== undefined) {
    return cached;
  }
  const prepared = site.db.prepare(sql);
  site.statements.set(sql, prepared);
  return prepared;
};

export const runInTransaction = <A>(site: SiteDb, f: () => A): A => {
  site.db.exec("BEGIN IMMEDIATE");
  try {
    const result = f();
    site.db.exec("COMMIT");
    return result;
  } catch (error) {
    site.db.exec("ROLLBACK");
    throw error;
  }
};

export interface SiteConnections {
  readonly open: (key: string, file: string, init?: (site: SiteDb) => void) => SiteDb;
  readonly closeAll: () => void;
}

export const makeSiteConnections = (): SiteConnections => {
  const sites = new Map<string, SiteDb>();
  return {
    open: (key, file, init) => {
      const existing = sites.get(key);
      if (existing !== undefined) {
        // inits are idempotent DDL (CREATE ... IF NOT EXISTS); running them on
        // every open guarantees each consumer's tables exist on the shared
        // connection regardless of which layer opened it first
        init?.(existing);
        return existing;
      }
      const site = openConnection(file);
      if (init !== undefined) {
        try {
          init(site);
        } catch (error) {
          site.db.close();
          throw error;
        }
      }
      sites.set(key, site);
      return site;
    },
    closeAll: () => {
      for (const site of sites.values()) {
        site.db.close();
      }
      sites.clear();
    },
  };
};

export class SiteConnectionsService extends Context.Service<
  SiteConnectionsService,
  SiteConnections
>()("forge/SiteConnectionsService") {}

export const SiteConnectionsLayer = Layer.effect(
  SiteConnectionsService,
  Effect.gen(function* () {
    const connections = makeSiteConnections();
    yield* Effect.addFinalizer(() => Effect.sync(() => connections.closeAll()));
    return connections;
  }),
);
