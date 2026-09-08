import { StorageError } from "@ism0080/forge-core";
import { Context, Effect } from "effect";

export interface StorageApi {
  readonly putObject: (
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ) => Effect.Effect<void, StorageError>;
  readonly getObject: (bucket: string, key: string) => Effect.Effect<Uint8Array, StorageError>;
  readonly listKeys: (
    bucket: string,
    prefix: string,
  ) => Effect.Effect<ReadonlyArray<string>, StorageError>;
}

export class StorageService extends Context.Service<StorageService, StorageApi>()(
  "forge/StorageService",
) {}
