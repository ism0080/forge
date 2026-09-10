import {
  DocumentId,
  InternalError,
  JobConflictError,
  JobCreateRequestSchema,
  JobDeleteResponseSchema,
  JobInvalidInputError,
  JobListResponseSchema,
  JobNotFoundError,
  JobResponseSchema,
  JobUpdateRequestSchema,
  SiteId,
} from "../index.js";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const JobErrors = [JobNotFoundError, JobConflictError, JobInvalidInputError, InternalError];

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
