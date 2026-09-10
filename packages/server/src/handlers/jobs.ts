import { Effect } from "effect";
import type { Mutable } from "effect/Types";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { JobsService } from "../services/jobs/service.js";
import type { JobCreateInput, JobUpdateInput } from "../services/jobs/service.js";
import { toInternalError } from "./errors.js";

export const JobsHandler = HttpApiBuilder.group(Api, "server.jobs", (handlers) =>
  handlers
    .handle("jobs.list", ({ query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.listJobs(query.siteId).pipe(
          Effect.catchTag("DbOperationError", toInternalError("jobs")),
          Effect.map((list) => ({ jobs: [...list] })),
        );
      }),
    )
    .handle("jobs.get", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.getJob(query.siteId, params.id).pipe(
          Effect.catchTag("DbOperationError", toInternalError("jobs")),
          Effect.map((job) => ({ job })),
        );
      }),
    )
    .handle("jobs.create", ({ payload }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const input: Mutable<JobCreateInput> = {
          name: payload.name,
          schedule: payload.schedule,
        };
        if (payload.payload !== undefined) input.payload = payload.payload;
        if (payload.enabled !== undefined) input.enabled = payload.enabled;
        return yield* jobs
          .createJob(payload.siteId, input)
          .pipe(
            Effect.catchTag("DbOperationError", toInternalError("jobs")),
            Effect.map((job) => ({ job })),
          );
      }),
    )
    .handle("jobs.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        const input: Mutable<JobUpdateInput> = {};
        if (payload.name !== undefined) input.name = payload.name;
        if (payload.schedule !== undefined) input.schedule = payload.schedule;
        if (payload.payload !== undefined) input.payload = payload.payload;
        if (payload.enabled !== undefined) input.enabled = payload.enabled;
        if (payload.expectedVersion !== undefined) {
          input.expectedVersion = payload.expectedVersion;
        }
        return yield* jobs
          .updateJob(payload.siteId, params.id, input)
          .pipe(
            Effect.catchTag("DbOperationError", toInternalError("jobs")),
            Effect.map((job) => ({ job })),
          );
      }),
    )
    .handle("jobs.delete", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.deleteJob(query.siteId, params.id, query.expectedVersion).pipe(
          Effect.catchTag("DbOperationError", toInternalError("jobs")),
          Effect.map(() => ({ ok: true as const })),
        );
      }),
    )
    .handle("jobs.run", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.runJob(query.siteId, params.id).pipe(
          Effect.catchTag("DbOperationError", toInternalError("jobs")),
          Effect.map((job) => ({ job })),
        );
      }),
    ),
);
