#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import {
  CliError,
  DEFAULT_CONFIG,
  ForgeConfigFromJson,
  SiteId,
  type ForgeConfig,
} from "@ism0080/forge-core";
import { createClient } from "@ism0080/forge-sdk";
import { getTemplate, templates } from "@ism0080/forge-templates";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Config from "effect/Config";
import * as Command from "effect/unstable/cli/Command";
import * as Argument from "effect/unstable/cli/Argument";
import * as Flag from "effect/unstable/cli/Flag";

const cwd = process.cwd();
const configPath = `${cwd}/forge.json`;

const { version: CLI_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const cliError =
  (message: string) =>
  (error: unknown): CliError =>
    new CliError({ message, cause: error });

const readConfig = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(configPath)
      .pipe(Effect.mapError(cliError("Unable to read forge.json")));
    return yield* Schema.decodeUnknownEffect(ForgeConfigFromJson)(raw).pipe(
      Effect.mapError(cliError("Invalid forge.json")),
    );
  });

const scaffoldTemplate = (siteId: string, templateId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const template = getTemplate(templateId);

    if (!template) {
      const available = templates.map((t) => t.id).join(", ");
      return yield* new CliError({
        message: `Unknown template '${templateId}'. Available: ${available}`,
      });
    }

    for (const file of template.files) {
      const filePath = path.join(cwd, file.path);
      const directory = path.dirname(filePath);
      const exists = yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.mapError(cliError(`Unable to create directory ${directory}`)));
      }
      const content = file.content.replace(/\{\{siteId\}\}/g, siteId);
      yield* fs
        .writeFileString(filePath, content)
        .pipe(Effect.mapError(cliError(`Unable to write ${file.path}`)));
    }
  });

const apiBaseUrlConfig = Config.string("FORGE_API_BASE_URL").pipe(
  Config.withDefault(DEFAULT_CONFIG.apiBaseUrl),
);

const makeClient = (options: { apiBaseUrl: string; siteId?: string }) =>
  Effect.tryPromise({
    try: () =>
      createClient({
        baseUrl: options.apiBaseUrl,
        ...(options.siteId ? { siteId: options.siteId } : {}),
      }),
    catch: cliError("Unable to create forge client"),
  });

const collectFiles = (
  root: string,
): Effect.Effect<Array<string>, CliError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const out: Array<string> = [];
    const entries = yield* fs
      .readDirectory(root)
      .pipe(Effect.mapError(cliError("Unable to collect files")));
    for (const entry of entries) {
      const name = path.basename(entry);
      if (name === "node_modules" || name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(root, entry);
      const stat = yield* fs
        .stat(fullPath)
        .pipe(Effect.mapError(cliError(`Unable to stat path ${fullPath}`)));
      if (stat.type === "Directory") {
        const nested = yield* collectFiles(fullPath);
        out.push(...nested);
      } else if (stat.type === "File") {
        out.push(fullPath);
      }
    }
    return out;
  });

const readMigrations = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = (yield* collectFiles(directory))
      .filter((file) => path.basename(file) === "migration.sql" || file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    return yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const sql = yield* fs
          .readFileString(file)
          .pipe(Effect.mapError(cliError(`Unable to read migration ${file}`)));
        const relative = path.relative(directory, file).replaceAll("\\", "/");
        const id = relative.endsWith("/migration.sql")
          ? relative.slice(0, -"/migration.sql".length)
          : relative;
        return {
          id,
          sql,
        };
      }),
    );
  });

const applyConfiguredMigrations = (
  config: ForgeConfig,
  client: Awaited<ReturnType<typeof createClient>>,
) =>
  Effect.gen(function* () {
    if (config.database === undefined) {
      return;
    }
    const path = yield* Path.Path;
    const directory = path.join(cwd, config.database.migrations);
    const migrations = yield* readMigrations(directory);
    const result = yield* Effect.tryPromise({
      try: () => client.db.applyMigrations(randomUUID(), migrations),
      catch: cliError("Database migration failed"),
    });
    for (const id of result.applied) {
      yield* Effect.log(`applied migration ${id}`);
    }
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
    const apiBaseUrl = yield* apiBaseUrlConfig;
    const config: ForgeConfig = {
      siteId: SiteId.make(resolvedSiteId),
      entry: ".",
      apiBaseUrl,
      spa: true,
    };

    yield* fs
      .writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`)
      .pipe(Effect.mapError(cliError("Unable to write forge.json")));

    const hasIndex = yield* fs
      .exists(path.join(cwd, "index.html"))
      .pipe(Effect.orElseSucceed(() => false));

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
    const apiBaseUrl = yield* apiBaseUrlConfig;
    const config: ForgeConfig =
      folderArg || siteIdArg
        ? {
            siteId: SiteId.make(siteIdArg ?? path.basename(folderArg ?? cwd)),
            entry: folderArg ?? ".",
            apiBaseUrl,
            spa: true,
          }
        : yield* readConfig();
    const client = yield* makeClient(config);
    yield* applyConfiguredMigrations(config, client);
    const root = path.join(cwd, config.entry);
    const files = yield* collectFiles(root);

    for (const filePath of files) {
      const data = yield* fs
        .readFile(filePath)
        .pipe(Effect.mapError(cliError(`Unable to read file ${filePath}`)));
      const rel = path.relative(root, filePath).replaceAll("\\", "/");
      yield* Effect.tryPromise({
        try: () =>
          client.upload({ path: rel, contentBase64: Buffer.from(data).toString("base64") }),
        catch: cliError(`Upload failed for ${rel}`),
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
    const apiBaseUrl = yield* apiBaseUrlConfig;
    const client = yield* makeClient({ apiBaseUrl });
    const payload = yield* Effect.tryPromise({
      try: () => client.plugins.list(),
      catch: cliError("plugins failed"),
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
    ).pipe(Effect.mapError(cliError("docker compose failed")));
    if (output.length > 0) {
      yield* Effect.log(output);
    }
  }),
).pipe(Command.withDescription("Run local development stack"));

const dbPush = Command.make(
  "push",
  {
    directory: Argument.string("directory").pipe(Argument.optional),
  },
  Effect.fn(function* ({ directory }) {
    const path = yield* Path.Path;
    const config = yield* readConfig();
    const configuredDirectory = Option.getOrUndefined(directory) ?? config.database?.migrations;
    if (configuredDirectory === undefined) {
      return yield* new CliError({
        message: "Migration directory required; pass it or set database.migrations in forge.json",
      });
    }
    const migrations = yield* readMigrations(path.join(cwd, configuredDirectory));
    const client = yield* makeClient(config);
    const result = yield* Effect.tryPromise({
      try: () => client.db.applyMigrations(randomUUID(), migrations),
      catch: cliError("Database migration failed"),
    });
    yield* Effect.log(
      result.applied.length === 0
        ? `Database is up to date for site '${config.siteId}'`
        : `Applied ${result.applied.length} migration(s) for site '${config.siteId}'`,
    );
  }),
).pipe(Command.withDescription("Apply Drizzle SQL migrations to the site database"));

const db = Command.make("db").pipe(
  Command.withDescription("Database commands"),
  Command.withSubcommands([dbPush]),
);

const cli = Command.make("forge").pipe(
  Command.withDescription("Forge CLI"),
  Command.withSubcommands([init, deploy, db, plugins, dev]),
);

Command.run(cli, { version: CLI_VERSION }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.runPromise,
);
