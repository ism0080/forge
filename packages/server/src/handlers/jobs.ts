import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import {
  JobConflictError,
  JobInvalidInputError,
  JobNotFoundError,
  JobsService,
} from "../services/jobs/service.js";

const isExpected = (error: unknown): boolean =>
  error instanceof JobNotFoundError ||
  error instanceof JobConflictError ||
  error instanceof JobInvalidInputError;

const mapJobError = (error: unknown): { error: string } => {
  if (error instanceof JobNotFoundError) {
    return { error: "job not found" };
  }
  if (error instanceof JobConflictError) {
    return { error: "version conflict" };
  }
  if (error instanceof JobInvalidInputError) {
    return { error: error.message };
  }
  return { error: "internal error" };
};

const tapUnexpected = (error: unknown): Effect.Effect<void> =>
  isExpected(error) ? Effect.void : Effect.logError("Unexpected jobs error", error);

export const JobsHandler = HttpApiBuilder.group(Api, "server.jobs", (handlers) =>
  handlers
    .handle("jobs.list", ({ query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs
          .listJobs(query.siteId)
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapJobError),
            Effect.map((list) => ({ jobs: [...list] })),
          );
      }),
    )
    .handle("jobs.get", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.getJob(query.siteId, params.id).pipe(
          Effect.tapError(tapUnexpected),
          Effect.mapError(mapJobError),
          Effect.map((job) => ({ job })),
        );
      }),
    )
    .handle("jobs.create", ({ payload }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs
          .createJob(payload.siteId, {
            name: payload.name,
            schedule: payload.schedule,
            ...(payload.payload !== undefined ? { payload: payload.payload } : {}),
            ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
          })
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapJobError),
            Effect.map((job) => ({ job })),
          );
      }),
    )
    .handle("jobs.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs
          .updateJob(payload.siteId, params.id, {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.schedule !== undefined ? { schedule: payload.schedule } : {}),
            ...(payload.payload !== undefined ? { payload: payload.payload } : {}),
            ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
            ...(payload.expectedVersion !== undefined
              ? { expectedVersion: payload.expectedVersion }
              : {}),
          })
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapJobError),
            Effect.map((job) => ({ job })),
          );
      }),
    )
    .handle("jobs.delete", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs
          .deleteJob(query.siteId, params.id, query.expectedVersion)
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapJobError),
            Effect.map(() => ({ ok: true as const })),
          );
      }),
    )
    .handle("jobs.run", ({ params, query }) =>
      Effect.gen(function* () {
        const jobs = yield* JobsService;
        return yield* jobs.runJob(query.siteId, params.id).pipe(
          Effect.tapError(tapUnexpected),
          Effect.mapError(mapJobError),
          Effect.map((job) => ({ job })),
        );
      }),
    ),
);
