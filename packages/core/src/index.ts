import { Schema } from "effect";

export interface ForgeConfig {
  readonly siteId: string;
  readonly entry: string;
  readonly apiBaseUrl: string;
  readonly spa?: boolean;
}

export interface Identity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly team: string;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly description: string;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly capabilities: ReadonlyArray<CapabilityDescriptor>;
}

export interface S3ObjectRef {
  readonly bucket: string;
  readonly key: string;
}

export interface PutObjectInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType?: string;
}

export type DbValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<DbValue>
  | { readonly [key: string]: DbValue };

export type DbDocumentData = { readonly [key: string]: DbValue };

export interface DbDocument {
  readonly id: string;
  readonly siteId: string;
  readonly collection: string;
  readonly data: DbDocumentData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DbCreateRequest extends DbCreateInput {
  readonly siteId: string;
}

export interface DbUpdateInput {
  readonly data: DbDocumentData;
  readonly expectedVersion?: number;
}

export interface DbUpdateRequest extends DbUpdateInput {
  readonly siteId: string;
}

export interface DbCreateResponse {
  readonly document: DbDocument;
}

export interface DbGetResponse {
  readonly document: DbDocument;
}

export interface DbUpdateResponse {
  readonly document: DbDocument;
}

export interface DbDeleteResponse {
  readonly ok: true;
}

export interface DbDeleteInput {
  readonly expectedVersion?: number;
}

export type DbSortBy = "createdAt" | "updatedAt" | "id";

export type DbSortDir = "asc" | "desc";

export const DbListQuerySchema = Schema.Struct({
  siteId: Schema.String,
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.String),
  whereField: Schema.optional(Schema.String),
  whereValue: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.Literals(["createdAt", "updatedAt", "id"])),
  sortDir: Schema.optional(Schema.Literals(["asc", "desc"])),
});
export type DbListQuery = Omit<Schema.Schema.Type<typeof DbListQuerySchema>, "siteId">;

export type DbChangeType = "created" | "updated" | "deleted";

export interface DbChangeEvent {
  readonly type: DbChangeType;
  readonly siteId: string;
  readonly collection: string;
  readonly id: string;
  readonly document?: DbDocument;
  readonly at: string;
}

export interface DbListResponse {
  readonly documents: ReadonlyArray<DbDocument>;
  readonly nextCursor?: string;
}

export const DbDocumentDataSchema = Schema.Unknown;

export const DbDocumentSchema = Schema.Struct({
  id: Schema.String,
  siteId: Schema.String,
  collection: Schema.String,
  data: DbDocumentDataSchema,
  version: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const DbCreateRequestSchema = Schema.Struct({
  siteId: Schema.String,
  data: DbDocumentDataSchema,
  id: Schema.optional(Schema.String),
});
export type DbCreateInput = Omit<Schema.Schema.Type<typeof DbCreateRequestSchema>, "siteId">;

export const DbUpdateInputSchema = Schema.Struct({
  data: DbDocumentDataSchema,
  expectedVersion: Schema.optional(Schema.Number),
});

export const DbUpdateRequestSchema = Schema.Struct({
  siteId: Schema.String,
  data: DbDocumentDataSchema,
  expectedVersion: Schema.optional(Schema.Number),
});

export const DbCreateResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});

export const DbGetResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});

export const DbUpdateResponseSchema = Schema.Struct({
  document: DbDocumentSchema,
});

export const DbDeleteResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
});

export const DbChangeEventSchema = Schema.Struct({
  type: Schema.String,
  siteId: Schema.String,
  collection: Schema.String,
  id: Schema.String,
  document: Schema.optional(DbDocumentSchema),
  at: Schema.String,
});

export const DbListResponseSchema = Schema.Struct({
  documents: Schema.Array(DbDocumentSchema),
  nextCursor: Schema.optional(Schema.String),
});

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
