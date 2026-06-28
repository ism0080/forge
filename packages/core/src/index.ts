import { Schema } from "effect";

export const ForgeConfigSchema = Schema.Struct({
  siteId: Schema.String,
  entry: Schema.String,
  apiBaseUrl: Schema.String,
  spa: Schema.optional(Schema.Boolean),
});
export type ForgeConfig = Schema.Schema.Type<typeof ForgeConfigSchema>;

export const CapabilityDescriptorSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
});
export type CapabilityDescriptor = Schema.Schema.Type<typeof CapabilityDescriptorSchema>;

export const PluginDescriptorSchema = Schema.Struct({
  id: Schema.String,
  capabilities: Schema.Array(CapabilityDescriptorSchema),
});
export type PluginDescriptor = Schema.Schema.Type<typeof PluginDescriptorSchema>;

export const PluginsListResponseSchema = Schema.Struct({
  plugins: Schema.Array(PluginDescriptorSchema),
});
export type PluginsListResponse = Schema.Schema.Type<typeof PluginsListResponseSchema>;

export const S3ObjectRefSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
});
export type S3ObjectRef = Schema.Schema.Type<typeof S3ObjectRefSchema>;

export const PutObjectInputSchema = Schema.Struct({
  bucket: Schema.String,
  key: Schema.String,
  body: Schema.Uint8Array,
  contentType: Schema.optional(Schema.String),
});
export type PutObjectInput = Schema.Schema.Type<typeof PutObjectInputSchema>;

export const UploadInputSchema = Schema.Struct({
  path: Schema.String,
  contentBase64: Schema.String,
  contentType: Schema.optional(Schema.String),
});
export type UploadInput = Schema.Schema.Type<typeof UploadInputSchema>;

export const UploadRequestSchema = Schema.Struct({
  siteId: Schema.String,
  path: Schema.String,
  contentBase64: Schema.String,
  contentType: Schema.optional(Schema.String),
});
export type UploadRequest = Schema.Schema.Type<typeof UploadRequestSchema>;

export const UploadResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  key: Schema.String,
});
export type UploadResponse = Schema.Schema.Type<typeof UploadResponseSchema>;

export const DbDocumentDataSchema = Schema.Record(Schema.String, Schema.Unknown);
export type DbDocumentData = Schema.Schema.Type<typeof DbDocumentDataSchema>;

export const DbDocumentSchema = Schema.Struct({
  id: Schema.String,
  siteId: Schema.String,
  collection: Schema.String,
  data: DbDocumentDataSchema,
  version: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type DbDocument = Schema.Schema.Type<typeof DbDocumentSchema>;

export const DbCreateInputSchema = Schema.Struct({
  data: DbDocumentDataSchema,
  id: Schema.optional(Schema.String),
});
export type DbCreateInput = Schema.Schema.Type<typeof DbCreateInputSchema>;

export const DbCreateRequestSchema = Schema.Struct({
  siteId: Schema.String,
  data: DbDocumentDataSchema,
  id: Schema.optional(Schema.String),
});
export type DbCreateRequest = Schema.Schema.Type<typeof DbCreateRequestSchema>;

export const DbUpdateInputSchema = Schema.Struct({
  data: DbDocumentDataSchema,
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbUpdateInput = Schema.Schema.Type<typeof DbUpdateInputSchema>;

export const DbUpdateRequestSchema = Schema.Struct({
  siteId: Schema.String,
  data: DbDocumentDataSchema,
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbUpdateRequest = Schema.Schema.Type<typeof DbUpdateRequestSchema>;

export const DbCreateResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});
export type DbCreateResponse = Schema.Schema.Type<typeof DbCreateResponseSchema>;

export const DbGetResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});
export type DbGetResponse = Schema.Schema.Type<typeof DbGetResponseSchema>;

export const DbUpdateResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});
export type DbUpdateResponse = Schema.Schema.Type<typeof DbUpdateResponseSchema>;

export const DbDeleteResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
});
export type DbDeleteResponse = Schema.Schema.Type<typeof DbDeleteResponseSchema>;

export const DbDeleteInputSchema = Schema.Struct({
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbDeleteInput = Schema.Schema.Type<typeof DbDeleteInputSchema>;

export const DbSortBySchema = Schema.Literals(["createdAt", "updatedAt", "id"]);
export type DbSortBy = Schema.Schema.Type<typeof DbSortBySchema>;

export const DbSortDirSchema = Schema.Literals(["asc", "desc"]);
export type DbSortDir = Schema.Schema.Type<typeof DbSortDirSchema>;

export const DbDeleteRequestSchema = Schema.Struct({
  siteId: Schema.String,
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbDeleteRequest = Schema.Schema.Type<typeof DbDeleteRequestSchema>;

export const DbListQuerySchema = Schema.Struct({
  siteId: Schema.String,
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.String),
  whereField: Schema.optional(Schema.String),
  whereValue: Schema.optional(Schema.String),
  sortBy: Schema.optional(DbSortBySchema),
  sortDir: Schema.optional(DbSortDirSchema),
});
export type DbListQuery = Omit<Schema.Schema.Type<typeof DbListQuerySchema>, "siteId">;

export const DbChangeTypeSchema = Schema.Literals(["created", "updated", "deleted"]);
export type DbChangeType = Schema.Schema.Type<typeof DbChangeTypeSchema>;

export const DbChangeEventSchema = Schema.Struct({
  type: DbChangeTypeSchema,
  siteId: Schema.String,
  collection: Schema.String,
  id: Schema.String,
  document: Schema.optional(DbDocumentSchema),
  at: Schema.String,
});
export type DbChangeEvent = Schema.Schema.Type<typeof DbChangeEventSchema>;

export const DbListResponseSchema = Schema.Struct({
  documents: Schema.Array(DbDocumentSchema),
  nextCursor: Schema.optional(Schema.String),
});
export type DbListResponse = Schema.Schema.Type<typeof DbListResponseSchema>;

export const WebhookSendInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  payload: Schema.optional(Schema.Unknown),
});
export type WebhookSendInput = Schema.Schema.Type<typeof WebhookSendInputSchema>;

export const WebhookSendSuccessResponseSchema = Schema.Struct({
  forwarded: Schema.Literal(true),
  externalStatus: Schema.Number,
  externalBody: Schema.Json,
});
export type WebhookSendSuccessResponse = Schema.Schema.Type<
  typeof WebhookSendSuccessResponseSchema
>;

export const WebhookSendErrorResponseSchema = Schema.Struct({
  forwarded: Schema.Literal(false),
  error: Schema.Json,
});
export type WebhookSendErrorResponse = Schema.Schema.Type<typeof WebhookSendErrorResponseSchema>;

export class ForgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}

export const DEFAULT_CONFIG: ForgeConfig = {
  siteId: "my-site",
  entry: ".",
  apiBaseUrl: "https://media-svr.stingray-goby.ts.net:1234",
  spa: true,
};
