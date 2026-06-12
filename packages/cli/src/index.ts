#!/usr/bin/env node

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_CONFIG, type ForgeConfig } from "@forge/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Argument from "effect/unstable/cli/Argument";

const cwd = process.cwd();
const configPath = `${cwd}/forge.json`;

const readConfig = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(configPath)
      .pipe(Effect.mapError((error) => new Error(`Unable to read forge.json: ${String(error)}`)));
    return JSON.parse(raw) as ForgeConfig;
  });

const writeDefaultSite = (siteId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = path.join(cwd, "index.html");
    const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${siteId}</title>
  </head>
  <body>
    <h1>${siteId}</h1>
    <p>Powered by forge.</p>
  </body>
</html>
`;
    yield* fs
      .writeFileString(indexPath, content)
      .pipe(Effect.mapError((error) => new Error(`Unable to write index.html: ${String(error)}`)));
  });

const apiBaseFromEnv = (): string => process.env.FORGE_API_BASE_URL ?? DEFAULT_CONFIG.apiBaseUrl;

const collectFiles = (
  root: string,
): Effect.Effect<Array<string>, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const out: Array<string> = [];
    const entries = yield* fs
      .readDirectory(root)
      .pipe(Effect.mapError((error) => new Error(`Unable to collect files: ${String(error)}`)));
    for (const entry of entries) {
      const name = path.basename(entry);
      if (name === "node_modules" || name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(root, entry);
      const stat = yield* fs
        .stat(fullPath)
        .pipe(
          Effect.mapError(
            (error) => new Error(`Unable to stat path ${fullPath}: ${String(error)}`),
          ),
        );
      if (stat.type === "Directory") {
        const nested = yield* collectFiles(fullPath);
        out.push(...nested);
      } else if (stat.type === "File") {
        out.push(fullPath);
      }
    }
    return out;
  });

const uploadFile = (config: ForgeConfig, filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const data = yield* fs
      .readFile(filePath)
      .pipe(
        Effect.mapError((error) => new Error(`Unable to read file ${filePath}: ${String(error)}`)),
      );
    const relative = path.relative(path.join(cwd, config.entry), filePath).replaceAll("\\", "/");
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${config.apiBaseUrl}/api/upload`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: config.siteId,
            path: relative,
            contentBase64: Buffer.from(data).toString("base64"),
          }),
        }),
      catch: (error) => new Error(String(error)),
    });
    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => new Error(String(error)),
      });
      return yield* Effect.fail(
        new Error(`Upload failed for ${relative}: ${response.status} ${body}`),
      );
    }
  });

const init = Command.make(
  "init",
  {
    siteId: Argument.string("site-id").pipe(Argument.optional),
  },
  Effect.fn(function* ({ siteId }) {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const resolvedSiteId = Option.getOrElse(siteId, () => path.basename(cwd));
    const config: ForgeConfig = {
      siteId: resolvedSiteId,
      entry: ".",
      apiBaseUrl: apiBaseFromEnv(),
      spa: true,
    };

    yield* fs
      .writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`)
      .pipe(Effect.mapError((error) => new Error(`Unable to write forge.json: ${String(error)}`)));

    const hasIndex = yield* Effect.matchEffect(fs.exists(path.join(cwd, "index.html")), {
      onFailure: () => Effect.succeed(false),
      onSuccess: (exists) => Effect.succeed(exists),
    });

    if (!hasIndex) {
      yield* writeDefaultSite(resolvedSiteId);
    }

    yield* Effect.log(`Initialized forge site '${resolvedSiteId}' with ${configPath}`);
  }),
).pipe(Command.withDescription("Initialize a forge site in this folder"));

const deploy = Command.make(
  "deploy",
  {
    folder: Argument.string("folder").pipe(Argument.optional),
    siteId: Argument.string("site-id").pipe(Argument.optional),
  },
  Effect.fn(function* ({ folder, siteId }) {
    const path = yield* Path.Path;
    const folderArg = Option.getOrUndefined(folder);
    const siteIdArg = Option.getOrUndefined(siteId);
    const config: ForgeConfig =
      folderArg || siteIdArg
        ? {
            siteId: siteIdArg ?? path.basename(folderArg ?? cwd),
            entry: folderArg ?? ".",
            apiBaseUrl: apiBaseFromEnv(),
            spa: true,
          }
        : yield* readConfig();
    const root = path.join(cwd, config.entry);
    const files = yield* collectFiles(root);

    for (const filePath of files) {
      yield* uploadFile(config, filePath);
      const rel = path.relative(root, filePath).replaceAll("\\", "/");
      yield* Effect.log(`uploaded ${rel}`);
    }

    yield* Effect.log(`Deploy complete for site '${config.siteId}'`);
  }),
).pipe(Command.withDescription("Deploy local files to the forge API"));

const whoami = Command.make(
  "whoami",
  {},
  Effect.fn(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${apiBaseFromEnv()}/api/whoami`),
      catch: (error) => new Error(`whoami failed: ${String(error)}`),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      });
      return yield* Effect.fail(new Error(`whoami failed: ${response.status} ${body}`));
    }

    const profile = (yield* Effect.tryPromise({
      try: () => response.json() as Promise<Record<string, string>>,
      catch: (error) => new Error(`Invalid whoami payload: ${String(error)}`),
    })) as Record<string, string>;

    yield* Effect.log(`${profile.name} <${profile.email}> (${profile.team})`);
  }),
).pipe(Command.withDescription("Show current forge identity"));

const pluginsList = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${apiBaseFromEnv()}/api/plugins`),
      catch: (error) => new Error(`plugins failed: ${String(error)}`),
    });

    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      });
      return yield* Effect.fail(new Error(`plugins failed: ${response.status} ${body}`));
    }

    const payload = (yield* Effect.tryPromise({
      try: () =>
        response.json() as Promise<{
          plugins: Array<{ id: string; capabilities: Array<{ id: string }> }>;
        }>,
      catch: (error) => new Error(`Invalid plugins payload: ${String(error)}`),
    })) as {
      plugins: Array<{ id: string; capabilities: Array<{ id: string }> }>;
    };

    for (const plugin of payload.plugins) {
      const caps = plugin.capabilities.map((capability) => capability.id).join(", ");
      yield* Effect.log(`${plugin.id}: ${caps}`);
    }
  }),
).pipe(Command.withDescription("List plugin capabilities"));

const plugins = Command.make("plugins").pipe(
  Command.withDescription("Plugin commands"),
  Command.withSubcommands([pluginsList]),
);

const dev = Command.make(
  "dev",
  {},
  Effect.fn(function* () {
    const output = yield* Effect.flatMap(ChildProcessSpawner, (spawner) =>
      spawner.string(
        ChildProcess.make("docker", ["compose", "up", "--build"], {
          cwd,
          shell: true,
          stdout: "inherit",
          stderr: "inherit",
        }),
        { includeStderr: true },
      ),
    ).pipe(Effect.mapError((error) => new Error(`docker compose failed: ${String(error)}`)));
    if (output.length > 0) {
      yield* Effect.log(output);
    }
  }),
).pipe(Command.withDescription("Run local development stack"));

const cli = Command.make("forge").pipe(
  Command.withDescription("Forge CLI"),
  Command.withSubcommands([init, deploy, whoami, plugins, dev]),
);

Command.run(cli, { version: "0.1.0" }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
