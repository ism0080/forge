import {
  DocumentId,
  JobCreateRequestSchema,
  JobDeleteResponseSchema,
  JobListResponseSchema,
  JobResponseSchema,
  JobUpdateRequestSchema,
  SiteId,
} from "../index.js";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const JobNotFoundError = Schema.Struct({
  error: Schema.Literal("job not found"),
}).pipe(HttpApiSchema.status("NotFound"));

const JobConflictError = Schema.Struct({
  error: Schema.Literal("version conflict"),
}).pipe(HttpApiSchema.status("Conflict"));

const JobBadRequestError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("BadRequest"));

const JobInternalError = Schema.Struct({
  error: Schema.Literal("internal error"),
}).pipe(HttpApiSchema.status("InternalServerError"));

const JobErrors = [JobNotFoundError, JobConflictError, JobInternalError, JobBadRequestError];

export const JobsGroup = HttpApiGroup.make("server.jobs").add(
  HttpApiEndpoint.get("jobs.list", "/api/jobs", {
    success: JobListResponseSchema,
    error: JobErrors,
    query: Schema.Struct({ siteId: SiteId }),
  }),
  HttpApiEndpoint.get("jobs.get", "/api/jobs/:id", {
    success: JobResponseSchema,
    error: JobErrors,
    params: Schema.Struct({ id: DocumentId }),
    query: Schema.Struct({ siteId: SiteId }),
  }),
  HttpApiEndpoint.post("jobs.create", "/api/jobs", {
    success: JobResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: JobErrors,
    payload: JobCreateRequestSchema,
  }),
  HttpApiEndpoint.put("jobs.update", "/api/jobs/:id", {
    success: JobResponseSchema,
    error: JobErrors,
    params: Schema.Struct({ id: DocumentId }),
    payload: JobUpdateRequestSchema,
  }),
  HttpApiEndpoint.delete("jobs.delete", "/api/jobs/:id", {
    success: JobDeleteResponseSchema,
    error: JobErrors,
    params: Schema.Struct({ id: DocumentId }),
    query: Schema.Struct({
      siteId: SiteId,
      expectedVersion: Schema.optional(Schema.Number),
    }),
  }),
  HttpApiEndpoint.post("jobs.run", "/api/jobs/:id/run", {
    success: JobResponseSchema,
    error: JobErrors,
    params: Schema.Struct({ id: DocumentId }),
    query: Schema.Struct({ siteId: SiteId }),
  }),
);
