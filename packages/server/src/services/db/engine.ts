import { Config, Effect, Layer } from "effect";
import { LocalFileDatabaseLayer } from "./local-file.js";
import { SqliteDatabaseLayer } from "./sqlite.js";

export const DatabaseEngineLayer = Layer.unwrap(
  Effect.map(
    Config.literals(["file", "sqlite"], "DB_ENGINE").pipe(Config.withDefault("file")),
    (engine) => (engine === "sqlite" ? SqliteDatabaseLayer : LocalFileDatabaseLayer),
  ),
);
