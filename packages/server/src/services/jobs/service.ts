import { Config, Context, Effect, Layer, Schema, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  DbOperationError,
  DocumentId,
  JobConflictError,
  JobDefinitionSchema,
  JobInvalidInputError,
  JobNotFoundError,
  SiteId,
} from "@ism0080/forge-core";
import type { JobDefinition } from "@ism0080/forge-core";
import { DbClockLayer, DbClockService, randomId, siteStorageKey } from "../db/shared.js";
import { prepareStatement, SiteConnectionsService } from "../db/sqlite-connection.js";
import type { SiteDb } from "../db/sqlite-connection.js";
import { JobForwarderService } from "./forwarder.js";
import { nextCronRunFromExpression } from "./cron.js";

type JobPayload = Schema.Schema.Type<typeof Schema.Json>;

const JobPayloadFromJson = Schema.fromJsonString(Schema.Json);

export { JobConflictError, JobInvalidInputError, JobNotFoundError };

export type JobError = JobNotFoundError | JobConflictError | JobInvalidInputError | DbOperationError;

export interface JobCreateInput {
  readonly name: string;
  readonly schedule: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
}

export interface JobUpdateInput {
  readonly name?: string;
  readonly schedule?: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

export interface JobsApi {
  readonly listJobs: (siteId: SiteId) => Effect.Effect<ReadonlyArray<JobDefinition>, DbOperationError>;
  readonly getJob: (
    siteId: SiteId,
    id: DocumentId,
  ) => Effect.Effect<JobDefinition, JobNotFoundError | DbOperationError>;
  readonly createJob: (
    siteId: SiteId,
    input: JobCreateInput,
  ) => Effect.Effect<JobDefinition, JobInvalidInputError | DbOperationError>;
  readonly updateJob: (
    siteId: SiteId,
    id: DocumentId,
    input: JobUpdateInput,
  ) => Effect.Effect<JobDefinition, JobError>;
  readonly deleteJob: (
    siteId: SiteId,
    id: DocumentId,
    expectedVersion?: number,
  ) => Effect.Effect<void, JobError>;
  readonly runJob: (
    siteId: SiteId,
    id: DocumentId,
  ) => Effect.Effect<JobDefinition, JobError>;
  readonly runDue: (nowMs: number) => Effect.Effect<number, DbOperationError>;
}

export class JobsService extends Context.Service<JobsService, JobsApi>()("forge/JobsService") {}

interface JobsConfig {
  readonly storageRoot: string;
}

class JobsConfigService extends Context.Service<JobsConfigService, JobsConfig>()(
  "forge/JobsConfigService",
) {}

const JobsConfigLayer = Layer.effect(
  JobsConfigService,
  Effect.gen(function* () {
    const storageRoot = yield* Config.string("DATABASE_ROOT").pipe(Config.withDefault("./data/db"));
    return { storageRoot };
  }),
);

interface JobRow {
  readonly id: string;
  readonly site_id: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: string | null;
  readonly enabled: number;
  readonly next_run_at: number;
  readonly last_run_at: number | null;
  readonly last_status: string | null;
  readonly last_error: string | null;
  readonly run_count: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const CREATE_JOBS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _forge_jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  payload TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT`;

const CREATE_JOBS_NAME_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_jobs_site_name ON _forge_jobs (site_id, name)";

const CREATE_JOBS_DUE_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_forge_jobs_due ON _forge_jobs (enabled, next_run_at)";

const SELECT_JOB_SQL = "SELECT * FROM _forge_jobs WHERE id = ? AND site_id = ?";
const SELECT_JOB_BY_NAME_SQL = "SELECT id FROM _forge_jobs WHERE site_id = ? AND name = ?";
const SELECT_JOBS_SQL = "SELECT * FROM _forge_jobs WHERE site_id = ? ORDER BY name ASC";
const SELECT_DUE_JOBS_SQL =
  "SELECT * FROM _forge_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC";

const make = Effect.gen(function* () {
  const config = yield* JobsConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const connections = yield* SiteConnectionsService;
  const clock = yield* DbClockService;
  const forwarder = yield* JobForwarderService;

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  const initJobs = (site: SiteDb): void => {
    site.db.exec(CREATE_JOBS_TABLE_SQL);
    site.db.exec(CREATE_JOBS_NAME_INDEX_SQL);
    site.db.exec(CREATE_JOBS_DUE_INDEX_SQL);
  };

  const openSite = (siteId: SiteId): Effect.Effect<SiteDb, DbOperationError, Scope.Scope> => {
    const storageKey = siteStorageKey(siteId);
    return connections.open(path.join(config.storageRoot, `${storageKey}.sqlite`), initJobs);
  };

  const runSync = <A>(operation: string, f: () => A): Effect.Effect<A, DbOperationError> =>
    Effect.try({
      try: f,
      catch: (cause) => new DbOperationError({ operation, cause }),
    });

  const parseJob = (row: JobRow): Effect.Effect<JobDefinition, DbOperationError> =>
    Effect.gen(function* () {
      const payload =
        row.payload === null
          ? undefined
          : yield* Effect.try({
              try: () => Schema.decodeUnknownSync(JobPayloadFromJson)(row.payload),
              catch: (cause) => new DbOperationError({ operation: "parseJobPayload", cause }),
            });
      return yield* Schema.decodeUnknownEffect(JobDefinitionSchema)({
        id: row.id,
        siteId: row.site_id,
        name: row.name,
        schedule: row.schedule,
        ...(payload === undefined ? {} : { payload }),
        enabled: row.enabled === 1,
        nextRunAt: new Date(row.next_run_at).toISOString(),
        ...(row.last_run_at === null
          ? {}
          : { lastRunAt: new Date(row.last_run_at).toISOString() }),
        ...(row.last_status === null ? {} : { lastStatus: row.last_status }),
        ...(row.last_error === null ? {} : { lastError: row.last_error }),
        runCount: row.run_count,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }).pipe(Effect.mapError((cause) => new DbOperationError({ operation: "parseJob", cause })));
    });

  const readJobRow = (
    site: SiteDb,
    siteId: SiteId,
    id: DocumentId,
  ): Effect.Effect<JobRow | undefined, DbOperationError> =>
    runSync(
      "getJob",
      () => prepareStatement(site, SELECT_JOB_SQL).get(id, siteId) as JobRow | undefined,
    );

  const encodePayload = (payload: JobPayload): string =>
    Schema.encodeSync(JobPayloadFromJson)(payload);

  const reschedule = (expression: string, nowMs: number): Effect.Effect<number, JobInvalidInputError> =>
    nextCronRunFromExpression(expression, nowMs).pipe(
      Effect.mapError((error) => new JobInvalidInputError({ message: error.message })),
    );

  const listJobs = Effect.fn("Jobs.listJobs")(
    (siteId: SiteId): Effect.Effect<ReadonlyArray<JobDefinition>, DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const rows = yield* runSync(
          "listJobs",
          () => prepareStatement(site, SELECT_JOBS_SQL).all(siteId) as unknown as JobRow[],
        );
        return yield* Effect.forEach(rows, parseJob);
      }).pipe(Effect.scoped),
  );

  const getJob = Effect.fn("Jobs.getJob")(
    (
      siteId: SiteId,
      id: DocumentId,
    ): Effect.Effect<JobDefinition, JobNotFoundError | DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const row = yield* readJobRow(site, siteId, id);
        if (row === undefined) {
          return yield* new JobNotFoundError({ siteId, id });
        }
        return yield* parseJob(row);
      }).pipe(Effect.scoped),
  );

  const createJob = Effect.fn("Jobs.createJob")(
    (
      siteId: SiteId,
      input: JobCreateInput,
    ): Effect.Effect<JobDefinition, JobInvalidInputError | DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const existing = yield* runSync(
          "findJobByName",
          () =>
            prepareStatement(site, SELECT_JOB_BY_NAME_SQL).get(siteId, input.name) as
              | { id: string }
              | undefined,
        );
        if (existing !== undefined) {
          return yield* new JobInvalidInputError({
            message: `job name "${input.name}" already exists`,
          });
        }
        const nowMs = yield* clock.currentTimeMs;
        const nextRunAt = yield* reschedule(input.schedule, nowMs);
        const id = DocumentId.make(yield* randomId);
        const createdAt = new Date(nowMs).toISOString();
        const enabled = input.enabled ?? true;
        yield* runSync("createJob", () =>
          prepareStatement(
            site,
            `INSERT INTO _forge_jobs
               (id, site_id, name, schedule, payload, enabled, next_run_at, run_count, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
          ).run(
            id,
            siteId,
            input.name,
            input.schedule,
            input.payload === undefined ? null : encodePayload(input.payload),
            enabled ? 1 : 0,
            nextRunAt,
            createdAt,
            createdAt,
          ),
        );
        const row = yield* readJobRow(site, siteId, id);
        if (row === undefined) {
          return yield* new DbOperationError({ operation: "createJob", cause: "job missing" });
        }
        return yield* parseJob(row);
      }).pipe(Effect.scoped),
  );

  const resolveUpdate = (
    site: SiteDb,
    siteId: SiteId,
    existing: JobRow,
    input: JobUpdateInput,
    nowMs: number,
  ): Effect.Effect<
    {
      readonly name: string;
      readonly schedule: string;
      readonly payload: string | null;
      readonly enabled: number;
      readonly nextRunAt: number;
    },
    JobInvalidInputError | DbOperationError
  > =>
    Effect.gen(function* () {
      const name = input.name ?? existing.name;
      const schedule = input.schedule ?? existing.schedule;
      const enabled = input.enabled ?? existing.enabled === 1;

      if (input.name !== undefined && input.name !== existing.name) {
        const nextName = input.name;
        const clash = yield* runSync(
          "findJobByName",
          () =>
            prepareStatement(site, SELECT_JOB_BY_NAME_SQL).get(siteId, nextName) as
              | { id: string }
              | undefined,
        );
        if (clash !== undefined) {
          return yield* new JobInvalidInputError({
            message: `job name "${nextName}" already exists`,
          });
        }
      }

      let nextRunAt = existing.next_run_at;
      if (input.schedule !== undefined || (input.enabled === true && existing.enabled === 0)) {
        nextRunAt = yield* reschedule(schedule, nowMs);
      }

      return {
        name,
        schedule,
        payload: input.payload === undefined ? existing.payload : encodePayload(input.payload),
        enabled: enabled ? 1 : 0,
        nextRunAt,
      };
    });

  const updateJob = Effect.fn("Jobs.updateJob")(
    (
      siteId: SiteId,
      id: DocumentId,
      input: JobUpdateInput,
    ): Effect.Effect<JobDefinition, JobError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const existing = yield* readJobRow(site, siteId, id);
        if (existing === undefined) {
          return yield* new JobNotFoundError({ siteId, id });
        }
        if (
          typeof input.expectedVersion === "number" &&
          existing.version !== input.expectedVersion
        ) {
          return yield* new JobConflictError({
            id,
            expectedVersion: input.expectedVersion,
            actualVersion: existing.version,
          });
        }
        const nowMs = yield* clock.currentTimeMs;
        const resolved = yield* resolveUpdate(site, siteId, existing, input, nowMs);
        const updatedAt = new Date(nowMs).toISOString();
        yield* runSync("updateJob", () =>
          prepareStatement(
            site,
            `UPDATE _forge_jobs
               SET name = ?, schedule = ?, payload = ?, enabled = ?, next_run_at = ?,
                   version = version + 1, updated_at = ?
             WHERE id = ? AND site_id = ?`,
          ).run(
            resolved.name,
            resolved.schedule,
            resolved.payload,
            resolved.enabled,
            resolved.nextRunAt,
            updatedAt,
            id,
            siteId,
          ),
        );
        const row = yield* readJobRow(site, siteId, id);
        if (row === undefined) {
          return yield* new DbOperationError({ operation: "updateJob", cause: "job missing" });
        }
        return yield* parseJob(row);
      }).pipe(Effect.scoped),
  );

  const deleteJob = Effect.fn("Jobs.deleteJob")(
    (
      siteId: SiteId,
      id: DocumentId,
      expectedVersion?: number,
    ): Effect.Effect<void, JobError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const existing = yield* readJobRow(site, siteId, id);
        if (existing === undefined) {
          return yield* new JobNotFoundError({ siteId, id });
        }
        if (typeof expectedVersion === "number" && existing.version !== expectedVersion) {
          return yield* new JobConflictError({
            id,
            expectedVersion,
            actualVersion: existing.version,
          });
        }
        yield* runSync("deleteJob", () =>
          prepareStatement(site, "DELETE FROM _forge_jobs WHERE id = ? AND site_id = ?").run(
            id,
            siteId,
          ),
        );
      }).pipe(Effect.scoped),
  );

  const executeRow = (site: SiteDb, row: JobRow, nowMs: number): Effect.Effect<boolean, DbOperationError> =>
    Effect.gen(function* () {
      const job = yield* parseJob(row);
      const outcome = yield* forwarder.forward(job);
      const nextRunAt = yield* reschedule(job.schedule, nowMs).pipe(
        Effect.mapError(
          (error) => new DbOperationError({ operation: "rescheduleJob", cause: error }),
        ),
      );
      const at = new Date(nowMs).toISOString();
      yield* runSync("recordJobRun", () =>
        prepareStatement(
          site,
          `UPDATE _forge_jobs
             SET last_run_at = ?, last_status = ?, last_error = ?, run_count = run_count + 1,
                 next_run_at = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        ).run(nowMs, outcome.ok ? "success" : "error", outcome.error ?? null, nextRunAt, at, row.id),
      );
      return outcome.ok;
    });

  const runJob = Effect.fn("Jobs.runJob")(
    (siteId: SiteId, id: DocumentId): Effect.Effect<JobDefinition, JobError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const existing = yield* readJobRow(site, siteId, id);
        if (existing === undefined) {
          return yield* new JobNotFoundError({ siteId, id });
        }
        const nowMs = yield* clock.currentTimeMs;
        yield* executeRow(site, existing, nowMs);
        const row = yield* readJobRow(site, siteId, id);
        if (row === undefined) {
          return yield* new JobNotFoundError({ siteId, id });
        }
        return yield* parseJob(row);
      }).pipe(Effect.scoped),
  );

  const runSiteDue = (entry: string, nowMs: number): Effect.Effect<number, DbOperationError> =>
    Effect.gen(function* () {
      const file = path.join(config.storageRoot, entry);
      const site = yield* connections.open(file, initJobs);
      const rows = yield* runSync(
        "listDueJobs",
        () => prepareStatement(site, SELECT_DUE_JOBS_SQL).all(nowMs) as unknown as JobRow[],
      );
      let processed = 0;
      for (const row of rows) {
        yield* executeRow(site, row, nowMs);
        processed += 1;
      }
      return processed;
    }).pipe(Effect.scoped);

  const runDue = Effect.fn("Jobs.runDue")(
    (nowMs: number): Effect.Effect<number, DbOperationError> =>
      Effect.gen(function* () {
        const entries = yield* fs
          .readDirectory(config.storageRoot)
          .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
        let processed = 0;
        for (const entry of entries) {
          if (!entry.endsWith(".sqlite")) {
            continue;
          }
          const siteProcessed = yield* runSiteDue(entry, nowMs).pipe(
            Effect.catchCause((cause) =>
              Effect.logError(`job runner skipped site '${entry}'`, cause).pipe(Effect.as(0)),
            ),
          );
          processed += siteProcessed;
        }
        return processed;
      }),
  );

  return {
    listJobs,
    getJob,
    createJob,
    updateJob,
    deleteJob,
    runJob,
    runDue,
  } satisfies JobsApi;
});

export const JobsServiceLayer = Layer.effect(JobsService, make).pipe(
  Layer.provide([JobsConfigLayer, DbClockLayer]),
);
