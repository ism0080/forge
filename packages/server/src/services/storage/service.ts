import { Context, Effect } from "effect";

export interface StorageApi {
  readonly putObject: (
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ) => Effect.Effect<void, Error>;
  readonly getObject: (bucket: string, key: string) => Effect.Effect<Uint8Array, Error>;
  readonly listKeys: (
    bucket: string,
    prefix: string,
  ) => Effect.Effect<ReadonlyArray<string>, Error>;
}

export class StorageService extends Context.Service<StorageService, StorageApi>()(
  "forge/StorageService",
) {}
