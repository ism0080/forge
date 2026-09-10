#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = process.env.FORGE_VERSION_ROOT
  ? resolve(process.env.FORGE_VERSION_ROOT)
  : resolve(scriptDir, "..");

const fail = (message) => {
  console.error(`versions: ${message}`);
  process.exit(1);
};

const git = (args, { allowFailure = false } = {}) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return undefined;
    }
    throw error;
  }
};

const discoverPackages = () => {
  const packagePaths = [];
  for (const group of ["packages", "packages/tools"]) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) {
      continue;
    }
    for (const entry of readdirSync(groupDir)) {
      const packagePath = join(groupDir, entry, "package.json");
      if (existsSync(packagePath)) {
        packagePaths.push(packagePath);
      }
    }
  }

  return packagePaths.map((packagePath) => {
    const json = JSON.parse(readFileSync(packagePath, "utf8"));
    return { packagePath, json };
  });
};

const publishablePackages = () =>
  discoverPackages().filter((entry) => entry.json.private !== true);

const alignedVersion = () => {
  const packages = publishablePackages();
  if (packages.length === 0) {
    fail("no publishable packages found");
  }

  const versions = new Set(packages.map((entry) => entry.json.version));
  if (versions.size > 1) {
    const detail = packages.map((entry) => `  ${entry.json.name}@${entry.json.version}`).join("\n");
    fail(`package versions are out of sync:\n${detail}\nRun \`pnpm version:all\` to align them.`);
  }

  return { version: [...versions][0], packages };
};

const latestTag = () => {
  const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], {
    allowFailure: true,
  });
  return tag && tag.length > 0 ? tag : undefined;
};

const changedSince = (tag) => {
  const output = git(["diff", "--name-only", `${tag}..HEAD`, "--", "packages"], {
    allowFailure: true,
  });
  return (output ?? "").split("\n").filter((line) => line.length > 0);
};

const parseVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`unsupported version "${version}" (expected x.y.z)`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const compareVersions = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
};

const check = () => {
  const { version } = alignedVersion();
  const tag = latestTag();

  if (tag !== undefined) {
    const tagVersion = tag.replace(/^v/, "");
    const changed = changedSince(tag);
    if (changed.length > 0 && compareVersions(version, tagVersion) <= 0) {
      fail(
        `packages changed since ${tag} but the shared version is still ${version}.\n` +
          "Bump every package together before committing: `pnpm version:all` (or `pnpm version:all minor`).",
      );
    }
  }

  console.log(`versions: aligned at ${version}${tag ? ` (last release ${tag})` : ""}`);
};

const nextVersion = (current, requested) => {
  if (/^\d+\.\d+\.\d+$/.test(requested)) {
    return requested;
  }
  const { major, minor, patch } = parseVersion(current);
  if (requested === "major") return `${major + 1}.0.0`;
  if (requested === "minor") return `${major}.${minor + 1}.0`;
  if (requested === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`unknown bump "${requested}" (use major, minor, patch, or an explicit x.y.z)`);
};

const bump = () => {
  const requested = process.argv[3] ?? "patch";
  const { version, packages } = alignedVersion();
  const next = nextVersion(version, requested);

  for (const entry of packages) {
    const updated = { ...entry.json, version: next };
    writeFileSync(entry.packagePath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`versions: bumped ${packages.length} packages ${version} -> ${next}`);
};

const tag = () => {
  const { version } = alignedVersion();
  const tagName = `v${version}`;
  const existing = git(["rev-parse", "-q", `refs/tags/${tagName}`], { allowFailure: true });
  if (existing !== undefined && existing.length > 0) {
    console.log(`versions: tag ${tagName} already exists`);
    return;
  }
  execFileSync("git", ["tag", tagName], { cwd: repoRoot, stdio: "inherit" });
  console.log(`versions: tagged ${tagName}`);
};

const command = process.argv[2];
if (command === "check") {
  check();
} else if (command === "bump") {
  bump();
} else if (command === "tag") {
  tag();
} else {
  fail("usage: versions.mjs <check|bump [major|minor|patch|x.y.z]|tag>");
}
