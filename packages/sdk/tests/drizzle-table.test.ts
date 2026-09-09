import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Effect memoizes FetchHttpClient.layer per process, so the fetch reference is
// captured on the first createClient call. Stub a single persistent mock and
// swap implementations per test instead of re-stubbing the global.
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("Drizzle table client", () => {
  it("maps Drizzle properties and values across the HTTP boundary", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

  it("decodes Drizzle rows from a list response", async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = _input instanceof Request ? _input : new Request(_input, init);
      expect(request.method).toBe("GET");
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/tables/messages");
      expect(url.searchParams.get("siteId")).toBe("demo");
      expect(url.searchParams.get("sortDir")).toBe("desc");
      return Response.json({
        rows: [
          {
            id: "message-1",
            version: 1,
            created_at: 2,
            updated_at: 2,
            body: "Hello",
            pinned: 1,
            meta: '{"tags":["intro"]}',
          },
        ],
        nextCursor: "2",
      });
    });

    const client = await createClient({ baseUrl: "https://forge.test", siteId: "demo" });
    const result = await client.db.table(messages).list({ sortDir: "desc" });

    expect(result.nextCursor).toBe("2");
    expect(result.rows).toEqual([
      {
        id: "message-1",
        version: 1,
        createdAt: 2,
        updatedAt: 2,
        body: "Hello",
        pinned: true,
        meta: { tags: ["intro"] },
      },
    ]);
  });
});
