#!/usr/bin/env node

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_CONFIG, type ForgeConfig } from "@ism0080/forge-core";
import { createClient } from "@ism0080/forge-sdk";
import { getTemplate, templates } from "@ism0080/forge-templates";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Argument from "effect/unstable/cli/Argument";
import * as Flag from "effect/unstable/cli/Flag";

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

const scaffoldTemplate = (siteId: string, templateId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const template = getTemplate(templateId);

    if (!template) {
      const available = templates.map((t) => t.id).join(", ");
      return yield* Effect.fail(
        new Error(`Unknown template '${templateId}'. Available: ${available}`),
      );
    }

    for (const file of template.files) {
      const filePath = path.join(cwd, file.path);
      const directory = path.dirname(filePath);
      const exists = yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(
          Effect.mapError((error) => new Error(`Unable to create directory ${directory}: ${String(error)}`)),
        );
      }
      const content = file.content.replace(/\{\{siteId\}\}/g, siteId);
      yield* fs
        .writeFileString(filePath, content)
        .pipe(Effect.mapError((error) => new Error(`Unable to write ${file.path}: ${String(error)}`)));
    }
  });

const apiBaseFromEnv = (): string => process.env.FORGE_API_BASE_URL ?? DEFAULT_CONFIG.apiBaseUrl;

const makeClient = (options: { apiBaseUrl: string; siteId?: string }) =>
  Effect.tryPromise({
    try: () =>
      createClient({
        baseUrl: options.apiBaseUrl,
        ...(options.siteId ? { siteId: options.siteId } : {}),
      }),
    catch: (error) => new Error(`Unable to create forge client: ${String(error)}`),
  });

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

const init = Command.make(
  "init",
  {
    siteId: Argument.string("site-id").pipe(Argument.optional),
    template: Flag.string("template").pipe(Flag.withDefault("default")),
  },
  Effect.fn(function* ({ siteId, template }) {
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

    const hasIndex = yield* fs.exists(path.join(cwd, "index.html")).pipe(
      Effect.orElseSucceed(() => false),
    );

    if (!hasIndex) {
      yield* scaffoldTemplate(resolvedSiteId, template);
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
    const fs = yield* FileSystem.FileSystem;
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
    const client = yield* makeClient(config);
    const root = path.join(cwd, config.entry);
    const files = yield* collectFiles(root);

    for (const filePath of files) {
      const data = yield* fs
        .readFile(filePath)
        .pipe(
          Effect.mapError((error) => new Error(`Unable to read file ${filePath}: ${String(error)}`)),
        );
      const rel = path.relative(root, filePath).replaceAll("\\", "/");
      yield* Effect.tryPromise({
        try: () =>
          client.upload({ path: rel, contentBase64: Buffer.from(data).toString("base64") }),
        catch: (error) => new Error(`Upload failed for ${rel}: ${String(error)}`),
      });
      yield* Effect.log(`uploaded ${rel}`);
    }

    yield* Effect.log(`Deploy complete for site '${config.siteId}'`);
  }),
).pipe(Command.withDescription("Deploy local files to the forge API"));

const pluginsList = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const client = yield* makeClient({ apiBaseUrl: apiBaseFromEnv() });
    const payload = yield* Effect.tryPromise({
      try: () => client.plugins.list(),
      catch: (error) => new Error(`plugins failed: ${String(error)}`),
    });

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
  Command.withSubcommands([init, deploy, plugins, dev]),
);

Command.run(cli, { version: "0.1.0" }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
