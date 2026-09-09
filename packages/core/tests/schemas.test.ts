import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  DbDocumentFromJson,
  DbDocumentSchema,
  DocumentId,
  ForgeConfigFromJson,
  ForgeConfigSchema,
  SiteId,
} from "../src/index.js";

describe("ForgeConfigSchema", () => {
  it("decodes a valid config", () => {
    const config = Schema.decodeUnknownSync(ForgeConfigSchema)({
      siteId: "demo",
      entry: ".",
      apiBaseUrl: "https://example.com",
      spa: true,
    });

    expect(config.siteId).toBe("demo");
    expect(config.spa).toBe(true);
  });

  it("brands siteId as SiteId", () => {
    const config = Schema.decodeUnknownSync(ForgeConfigSchema)({
      siteId: "demo",
      entry: ".",
      apiBaseUrl: "https://example.com",
    });

    expect(config.siteId).toBeTypeOf("string");
  });

  it("decodes an optional Drizzle migration directory", () => {
    const config = Schema.decodeUnknownSync(ForgeConfigSchema)({
      siteId: "demo",
      entry: "dist",
      apiBaseUrl: "https://example.com",
      database: { migrations: "drizzle" },
    });

    expect(config.database?.migrations).toBe("drizzle");
  });

  it("rejects config missing apiBaseUrl", () => {
    expect(() =>
      Schema.decodeUnknownSync(ForgeConfigSchema)({
        siteId: "demo",
        entry: ".",
      }),
    ).toThrow();
  });
});

describe("ForgeConfigFromJson", () => {
  it("decodes a JSON string in one step", () => {
    const json = JSON.stringify({
      siteId: "demo",
      entry: ".",
      apiBaseUrl: "https://example.com",
      spa: false,
    });

    const config = Schema.decodeUnknownSync(ForgeConfigFromJson)(json);

    expect(config.siteId).toBe("demo");
    expect(config.spa).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(() => Schema.decodeUnknownSync(ForgeConfigFromJson)("not json")).toThrow();
  });
});

describe("DbDocumentSchema", () => {
  const valid = {
    id: "doc-1",
    siteId: "site-a",
    collection: "posts",
    data: { title: "Hello" },
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("decodes a valid document", () => {
    const document = Schema.decodeUnknownSync(DbDocumentSchema)(valid);
    expect(document.id).toBe("doc-1");
    expect(document.data).toEqual({ title: "Hello" });
  });

  it("round-trips through JSON", () => {
    const document = Schema.decodeUnknownSync(DbDocumentFromJson)(JSON.stringify(valid));
    expect(document.siteId).toBe("site-a");
  });

  it("brands document ids", () => {
    const document = Schema.decodeUnknownSync(DbDocumentSchema)(valid);
    const id: DocumentId = document.id;
    expect(id).toBe("doc-1");
  });
});

describe("DbDocument decode effect", () => {
  it("decodes via an Effect", () =>
    Effect.gen(function* () {
      const document = yield* Schema.decodeUnknownEffect(DbDocumentSchema)({
        id: DocumentId.make("doc-1"),
        siteId: SiteId.make("site-a"),
        collection: "posts",
        data: {},
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(document.id).toBe("doc-1");
    }));
});
