import { afterEach, describe, expect, it, vi } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createClient } from "../src/index.js";

const messages = sqliteTable("messages", {
  id: text().primaryKey(),
  version: integer().notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  body: text().notNull(),
  pinned: integer({ mode: "boolean" }).notNull().default(false),
  meta: text({ mode: "json" }).$type<{ tags: string[] }>(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Drizzle table client", () => {
  it("maps Drizzle properties and values across the HTTP boundary", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = _input instanceof Request ? _input : new Request(_input, init);
      expect(await request.json()).toEqual({
        siteId: "demo",
        data: {
          body: "Hello",
          pinned: 1,
          meta: '{"tags":["intro"]}',
        },
      });
      return Response.json(
        {
          row: {
            id: "message-1",
            version: 1,
            created_at: 1,
            updated_at: 1,
            body: "Hello",
            pinned: 1,
            meta: '{"tags":["intro"]}',
          },
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetch);

    const client = await createClient({ baseUrl: "https://forge.test", siteId: "demo" });
    const result = await client.db.table(messages).insert({
      body: "Hello",
      pinned: true,
      meta: { tags: ["intro"] },
    });

    expect(result.row).toEqual({
      id: "message-1",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      body: "Hello",
      pinned: true,
      meta: { tags: ["intro"] },
    });
  });
});
