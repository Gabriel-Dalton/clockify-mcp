import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ClockifyClient } from "../build/clockify.js";
import { createServer, resolveModules, MODULES } from "../build/index.js";
import { OPERATIONS } from "../build/operations.js";

async function harness(route = () => ({}), modules?: Set<any>) {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const fetchImpl = (async (url: string, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(route() ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const server = createServer(new ClockifyClient({ apiKey: "k", fetchImpl }), modules);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, calls };
}

test("modules default to everything", () => {
  assert.equal(resolveModules(undefined).size, MODULES.length);
  assert.equal(resolveModules("all").size, MODULES.length);
});

test("a named subset always keeps core, which supplies the IDs", () => {
  const chosen = resolveModules("invoices");
  assert.ok(chosen.has("invoices"));
  assert.ok(chosen.has("core"), "core is required by everything else");
  assert.ok(!chosen.has("scheduling"));
});

test("an unknown module name fails loudly rather than silently loading nothing", () => {
  assert.throws(() => resolveModules("invoces"), /Unknown CLOCKIFY_MCP_MODULES/);
});

test("disabling modules actually removes their tools", async () => {
  const { client } = await harness(() => ({}), resolveModules("invoices"));
  const names = (await client.listTools()).tools.map((t) => t.name);

  assert.ok(names.includes("create-clockify-invoice"));
  assert.ok(names.includes("get-clockify-user"), "core stays");
  assert.ok(!names.some((n) => n.includes("time-off")));
  assert.ok(!names.includes("call-clockify-api"));
});

test("declarative tools encode path IDs", async () => {
  const { client, calls } = await harness();

  await client.callTool({
    name: "get-clockify-client",
    arguments: { workspaceId: "w/1", clientId: "c 2" },
  });

  assert.match(calls[0].url, /\/workspaces\/w%2F1\/clients\/c%202$/);
});

test("camelCase inputs become the kebab-case parameters Clockify expects", async () => {
  const { client, calls } = await harness();

  await client.callTool({
    name: "list-clockify-tags",
    arguments: { workspaceId: "w1", pageSize: 25, page: 2 },
  });

  // Sending pageSize verbatim is ignored by the API and quietly returns a
  // default page, so the rename matters.
  assert.match(calls[0].url, /page-size=25/);
  assert.doesNotMatch(calls[0].url, /pageSize/);
});

test("a missing path ID is refused before any request goes out", async () => {
  const { client, calls } = await harness();

  const result: any = await client.callTool({
    name: "get-clockify-task",
    arguments: { workspaceId: "w1", projectId: "p1", taskId: "" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Missing `taskId`/);
  assert.equal(calls.length, 0);
});

test("report tools go to the reports host, not the main API", async () => {
  const { client, calls } = await harness();

  await client.callTool({
    name: "clockify-summary-report",
    arguments: {
      workspaceId: "w1",
      dateRangeStart: "2026-08-01T00:00:00Z",
      dateRangeEnd: "2026-08-31T23:59:59Z",
    },
  });

  assert.match(calls[0].url, /^https:\/\/reports\.api\.clockify\.me\/v1\//);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.dateRangeStart, "2026-08-01T00:00:00Z");
});

test("the catalogue covers the whole published API", () => {
  assert.equal(OPERATIONS.length, 175);
  assert.ok(OPERATIONS.every((o) => o.path.startsWith("/")));
});

test("searching the API finds operations no dedicated tool wraps", async () => {
  const { client } = await harness();

  const result: any = await client.callTool({
    name: "search-clockify-api",
    arguments: { query: "kiosk balance assignment" },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.ok(payload.matched > 0);
  assert.equal(payload.totalOperations, 175);
});

test("the generic caller rejects a full URL rather than building a broken one", async () => {
  const { client, calls } = await harness();

  const result: any = await client.callTool({
    name: "call-clockify-api",
    arguments: { path: "https://api.clockify.me/api/v1/user" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /must start with a slash/);
  assert.equal(calls.length, 0);
});

test("the generic caller passes method, query and body through", async () => {
  const { client, calls } = await harness();

  await client.callTool({
    name: "call-clockify-api",
    arguments: {
      path: "/workspaces/w1/holidays",
      method: "POST",
      query: { page: 1 },
      body: { name: "Canada Day" },
    },
  });

  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/workspaces\/w1\/holidays\?page=1$/);
  assert.equal(calls[0].body.name, "Canada Day");
});
