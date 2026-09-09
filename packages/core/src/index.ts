import { Schema } from "effect";

export const SiteId = Schema.String.pipe(Schema.brand("SiteId"));
export type SiteId = Schema.Schema.Type<typeof SiteId>;

export const CollectionId = Schema.String.pipe(Schema.brand("CollectionId"));
export type CollectionId = Schema.Schema.Type<typeof CollectionId>;

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"));
export type DocumentId = Schema.Schema.Type<typeof DocumentId>;

export const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
);
export type Port = Schema.Schema.Type<typeof Port>;

export const ForgeConfigSchema = Schema.Struct({
  siteId: SiteId,
  entry: Schema.String,
  apiBaseUrl: Schema.String,
  spa: Schema.optional(Schema.Boolean),
  database: Schema.optional(
    Schema.Struct({
      migrations: Schema.String,
    }),
  ),
});
export type ForgeConfig = Schema.Schema.Type<typeof ForgeConfigSchema>;
export const ForgeConfigFromJson = Schema.fromJsonString(ForgeConfigSchema);

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
  siteId: SiteId,
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
  id: DocumentId,
  siteId: SiteId,
  collection: CollectionId,
  data: DbDocumentDataSchema,
  version: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type DbDocument = Schema.Schema.Type<typeof DbDocumentSchema>;
export const DbDocumentFromJson = Schema.fromJsonString(DbDocumentSchema);

export const DbCreateInputSchema = Schema.Struct({
  data: DbDocumentDataSchema,
  id: Schema.optional(DocumentId),
});
export type DbCreateInput = Schema.Schema.Type<typeof DbCreateInputSchema>;

export const DbCreateRequestSchema = Schema.Struct({
  siteId: SiteId,
  data: DbDocumentDataSchema,
  id: Schema.optional(DocumentId),
});
export type DbCreateRequest = Schema.Schema.Type<typeof DbCreateRequestSchema>;

export const DbUpdateInputSchema = Schema.Struct({
  data: DbDocumentDataSchema,
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbUpdateInput = Schema.Schema.Type<typeof DbUpdateInputSchema>;

export const DbUpdateRequestSchema = Schema.Struct({
  siteId: SiteId,
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
  siteId: SiteId,
  expectedVersion: Schema.optional(Schema.Number),
});
export type DbDeleteRequest = Schema.Schema.Type<typeof DbDeleteRequestSchema>;

export const DbListQuerySchema = Schema.Struct({
  siteId: SiteId,
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
  siteId: SiteId,
  collection: CollectionId,
  id: DocumentId,
  document: Schema.optional(DbDocumentSchema),
  at: Schema.String,
});
export type DbChangeEvent = Schema.Schema.Type<typeof DbChangeEventSchema>;

export const SchemaRowChangeEventSchema = Schema.Struct({
  type: DbChangeTypeSchema,
  siteId: SiteId,
  table: Schema.String,
  id: DocumentId,
  row: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  at: Schema.String,
});
export type SchemaRowChangeEvent = Schema.Schema.Type<typeof SchemaRowChangeEventSchema>;

export const SchemaListQuerySchema = Schema.Struct({
  siteId: SiteId,
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.String),
  sortDir: Schema.optional(DbSortDirSchema),
});
export type SchemaListQuery = Omit<Schema.Schema.Type<typeof SchemaListQuerySchema>, "siteId">;

export const SchemaListResponseSchema = Schema.Struct({
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  nextCursor: Schema.optional(Schema.String),
});
export type SchemaListResponse = Schema.Schema.Type<typeof SchemaListResponseSchema>;

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

export class DocumentNotFoundError extends Schema.TaggedErrorClass<DocumentNotFoundError>()(
  "DocumentNotFoundError",
  {
    siteId: SiteId,
    collection: CollectionId,
    id: DocumentId,
  },
) {}

export class VersionConflictError extends Schema.TaggedErrorClass<VersionConflictError>()(
  "VersionConflictError",
  {
    id: DocumentId,
    expectedVersion: Schema.Number,
    actualVersion: Schema.Number,
  },
) {}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("StorageError", {
  operation: Schema.String,
  bucket: Schema.String,
  key: Schema.String,
  cause: Schema.Defect(),
}) {}

export class DbOperationError extends Schema.TaggedErrorClass<DbOperationError>()(
  "DbOperationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const DbError = Schema.Union([
  DocumentNotFoundError,
  VersionConflictError,
  DbOperationError,
]);
export type DbError = Schema.Schema.Type<typeof DbError>;

export class CliError extends Schema.TaggedErrorClass<CliError>()("CliError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override toString(): string {
    return this.message;
  }
}

export const DEFAULT_CONFIG: ForgeConfig = {
  siteId: SiteId.make("my-site"),
  entry: ".",
  apiBaseUrl: "https://media-svr.stingray-goby.ts.net:1234",
  spa: true,
};
