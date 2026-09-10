import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, FileSystem, Layer, Ref } from "effect";
import * as Result from "effect/Result";
import { SiteId } from "@ism0080/forge-core";
import { SiteConnectionsLayer } from "../src/services/db/sqlite-connection.js";
import {
  JobConflictError,
  JobInvalidInputError,
  JobNotFoundError,
  JobsService,
  JobsServiceLayer,
} from "../src/services/jobs/service.js";
import { JobForwarderService } from "../src/services/jobs/forwarder.js";
import type { JobRunOutcome } from "../src/services/jobs/forwarder.js";

const siteId = SiteId.make("jobs-site");

interface WithJobsOptions {
  readonly outcome?: JobRunOutcome;
  readonly setup?: (storageRoot: string) => Effect.Effect<void, never, FileSystem.FileSystem>;
}

const withJobs = <A, E, R>(
  effect: Effect.Effect<A, E, JobsService | R>,
  options: WithJobsOptions = {},
) =>
  Effect.gen(function* () {
    const fs = yield* Effect.service(FileSystem.FileSystem);
    const storageRoot = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    if (options.setup !== undefined) {
      yield* options.setup(storageRoot);
    }
    const names = yield* Ref.make<ReadonlyArray<string>>([]);

    const forwarder = Layer.succeed(JobForwarderService, {
      forward: (job) =>
        Ref.update(names, (list) => [...list, job.name]).pipe(
          Effect.as(options.outcome ?? { ok: true }),
        ),
    });

    const layer = JobsServiceLayer.pipe(
      Layer.provide([
        forwarder,
        ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_ROOT: storageRoot })),
        SiteConnectionsLayer,
      ]),
    );

    return yield* effect.pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer));

describe("JobsService", () => {
  it.effect("creates, lists, and gets jobs", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const created = yield* jobs.createJob(siteId, {
          name: "cleanup",
          schedule: "*/5 * * * *",
          payload: { kind: "cleanup" },
        });
        expect(created.name).toBe("cleanup");
        expect(created.enabled).toBe(true);
        expect(created.nextRunAt).toBeTypeOf("string");

        const listed = yield* jobs.listJobs(siteId);
        expect(listed.map((job) => job.name)).toEqual(["cleanup"]);

        const fetched = yield* jobs.getJob(siteId, created.id);
        expect(fetched.payload).toEqual({ kind: "cleanup" });
      }),
    ),
  );

  it.effect("runs due jobs and records success", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const created = yield* jobs.createJob(siteId, {
          name: "cleanup",
          schedule: "*/5 * * * *",
        });

        const processed = yield* jobs.runDue(Date.UTC(2030, 0, 1, 0, 0, 30));
        expect(processed).toBe(1);

        const after = yield* jobs.getJob(siteId, created.id);
        expect(after.lastStatus).toBe("success");
        expect(after.runCount).toBe(1);
        expect(new Date(after.nextRunAt).getTime()).toBe(Date.UTC(2030, 0, 1, 0, 5, 0));
      }),
    ),
  );

  it.effect("records forwarder failures", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const created = yield* jobs.createJob(siteId, {
          name: "flaky",
          schedule: "* * * * *",
        });

        yield* jobs.runDue(Date.UTC(2030, 0, 1, 0, 0, 30));

        const after = yield* jobs.getJob(siteId, created.id);
        expect(after.lastStatus).toBe("error");
        expect(after.lastError).toBe("boom");
      }),
      { outcome: { ok: false, error: "boom" } },
    ),
  );

  it.effect("skips a corrupt site database and still runs the others", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const created = yield* jobs.createJob(siteId, {
          name: "cleanup",
          schedule: "*/5 * * * *",
        });

        const processed = yield* jobs.runDue(Date.UTC(2030, 0, 1, 0, 0, 30));
        expect(processed).toBe(1);

        const after = yield* jobs.getJob(siteId, created.id);
        expect(after.lastStatus).toBe("success");
        expect(after.runCount).toBe(1);
      }),
      {
        setup: (storageRoot) =>
          Effect.gen(function* () {
            const fs = yield* Effect.service(FileSystem.FileSystem);
            yield* fs.writeFileString(`${storageRoot}/corrupt.sqlite`, "not a database");
          }).pipe(Effect.orDie),
      },
    ),
  );

  it.effect("rejects invalid schedules and duplicate names", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const invalid = yield* Effect.result(
          jobs.createJob(siteId, { name: "broken", schedule: "not a cron" }),
        );
        expect(Result.isFailure(invalid)).toBe(true);
        if (Result.isFailure(invalid)) {
          expect(invalid.failure).toBeInstanceOf(JobInvalidInputError);
        }

        yield* jobs.createJob(siteId, { name: "dup", schedule: "* * * * *" });
        const duplicate = yield* Effect.result(
          jobs.createJob(siteId, { name: "dup", schedule: "* * * * *" }),
        );
        expect(Result.isFailure(duplicate)).toBe(true);
        if (Result.isFailure(duplicate)) {
          expect(duplicate.failure).toBeInstanceOf(JobInvalidInputError);
        }
      }),
    ),
  );

  it.effect("updates and deletes with optimistic concurrency", () =>
    withJobs(
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const created = yield* jobs.createJob(siteId, { name: "job", schedule: "0 3 * * *" });

        const conflict = yield* Effect.result(
          jobs.updateJob(siteId, created.id, { enabled: false, expectedVersion: 99 }),
        );
        expect(Result.isFailure(conflict)).toBe(true);
        if (Result.isFailure(conflict)) {
          expect(conflict.failure).toBeInstanceOf(JobConflictError);
        }

        const updated = yield* jobs.updateJob(siteId, created.id, {
          schedule: "0 4 * * *",
          expectedVersion: created.version,
        });
        expect(updated.schedule).toBe("0 4 * * *");
        expect(updated.version).toBe(created.version + 1);

        const staleDelete = yield* Effect.result(jobs.deleteJob(siteId, created.id, created.version));
        expect(Result.isFailure(staleDelete)).toBe(true);

        yield* jobs.deleteJob(siteId, created.id, updated.version);
        const missing = yield* Effect.result(jobs.getJob(siteId, created.id));
        expect(Result.isFailure(missing)).toBe(true);
        if (Result.isFailure(missing)) {
          expect(missing.failure).toBeInstanceOf(JobNotFoundError);
        }
      }),
    ),
  );
});
