import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { Cause, Config, Context, Duration, Effect, Exit, Layer, RcMap, Scope } from "effect";
import { DbOperationError } from "@ism0080/forge-core";

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
  return Exit.match(Effect.runSyncExit(Effect.sync(f)), {
    onSuccess: (result) => {
      site.db.exec("COMMIT");
      return result;
    },
    onFailure: (cause) => {
      site.db.exec("ROLLBACK");
      throw Cause.squash(cause);
    },
  });
};

export interface SiteConnections {
  readonly open: (
    file: string,
    init?: (site: SiteDb) => void,
  ) => Effect.Effect<SiteDb, DbOperationError, Scope.Scope>;
}

export class SiteConnectionsService extends Context.Service<
  SiteConnectionsService,
  SiteConnections
>()("forge/SiteConnectionsService") {}

const DEFAULT_IDLE_TTL_MS = 300_000;

export const SiteConnectionsLayer = Layer.effect(
  SiteConnectionsService,
  Effect.gen(function* () {
    const idleTimeToLiveMs = yield* Config.Number("SITE_DB_IDLE_TTL_MS").pipe(
      Config.withDefault(DEFAULT_IDLE_TTL_MS),
    );

    const sites = yield* RcMap.make({
      lookup: (file: string) =>
        Effect.acquireRelease(
          Effect.try({
            try: () => openConnection(file),
            catch: (cause) => new DbOperationError({ operation: "openDatabase", cause }),
          }),
          (site) => Effect.sync(() => site.db.close()),
        ),
      idleTimeToLive: Duration.millis(Math.max(0, idleTimeToLiveMs)),
    });

    const open: SiteConnections["open"] = (file, init) =>
      Effect.gen(function* () {
        const site = yield* RcMap.get(sites, file);
        if (init !== undefined) {
          // inits are idempotent DDL (CREATE ... IF NOT EXISTS) and run on every
          // open so each consumer's tables exist on the shared connection
          // regardless of which layer opened it first
          yield* Effect.try({
            try: () => init(site),
            catch: (cause) => new DbOperationError({ operation: "initDatabase", cause }),
          });
        }
        return site;
      });

    return { open } satisfies SiteConnections;
  }),
);
