import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ClockifyClient } from "../build/clockify.js";
import { createServer } from "../build/index.js";

interface Recorded {
  url: string;
  method: string;
  body?: any;
}

/**
 * Stands up the real MCP server against a scripted Clockify, and returns a
 * connected client plus the request log — so tests assert on what actually
 * went over the wire, not on internal helpers.
 */
async function harness(route: (url: string, method: string) => unknown) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init: any = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      url: String(url),
      method,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const body = route(String(url), method);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const server = createServer(new ClockifyClient({ apiKey: "k", fetchImpl }));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, calls };
}

const RUNNING_ENTRY = {
  id: "e1",
  description: "Writing docs",
  billable: true,
  projectId: "p1",
  timeInterval: { start: "2026-08-14T09:00:00Z", end: null },
};

test("every tool is registered and uniquely named", async () => {
  const { client } = await harness(() => ({}));
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);

  assert.equal(new Set(names).size, names.length);
  for (const expected of [
    "get-clockify-user",
    "list-clockify-workspaces",
    "list-clockify-projects",
    "list-clockify-tasks",
    "list-clockify-clients",
    "list-clockify-time-entries",
    "create-clockify-time-entry",
    "update-clockify-time-entry",
    "delete-clockify-time-entry",
    "start-clockify-timer",
    "stop-clockify-timer",
    "get-clockify-running-timer",
    "list-clockify-invoices",
    "get-clockify-invoice",
    "create-clockify-invoice",
    "set-clockify-invoice-status",
    "record-clockify-invoice-payment",
    "delete-clockify-invoice",
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("start-clockify-timer posts no end, leaving the timer running", async () => {
  const { client, calls } = await harness(() => RUNNING_ENTRY);

  const result: any = await client.callTool({
    name: "start-clockify-timer",
    arguments: { workspaceId: "w1", description: "Writing docs", projectId: "p1" },
  });

  const post = calls.find((c) => c.method === "POST")!;
  assert.ok(!("end" in post.body), "end must be absent to start a running timer");
  assert.equal(post.body.description, "Writing docs");
  assert.match(result.content[0].text, /"running": true/);
});

test("stop-clockify-timer patches the user endpoint and defaults the user", async () => {
  const { client, calls } = await harness((url, method) => {
    if (url.endsWith("/user")) return { id: "u1" };
    if (method === "PATCH") {
      return { ...RUNNING_ENTRY, timeInterval: { ...RUNNING_ENTRY.timeInterval, end: "2026-08-14T11:00:00Z" } };
    }
    return {};
  });

  const result: any = await client.callTool({
    name: "stop-clockify-timer",
    arguments: { workspaceId: "w1", end: "2026-08-14T11:00:00Z" },
  });

  const patch = calls.find((c) => c.method === "PATCH")!;
  assert.match(patch.url, /\/workspaces\/w1\/user\/u1\/time-entries$/);
  assert.equal(patch.body.end, "2026-08-14T11:00:00Z");
  assert.match(result.content[0].text, /"stopped": true/);
});

test("update-clockify-time-entry merges onto the current entry", async () => {
  const { client, calls } = await harness((_url, method) =>
    method === "GET"
      ? { ...RUNNING_ENTRY, timeInterval: { start: "2026-08-14T09:00:00Z", end: "2026-08-14T10:00:00Z" } }
      : RUNNING_ENTRY,
  );

  await client.callTool({
    name: "update-clockify-time-entry",
    arguments: { workspaceId: "w1", timeEntryId: "e1", description: "Renamed" },
  });

  const put = calls.find((c) => c.method === "PUT")!;
  assert.equal(put.body.description, "Renamed");
  // Fields the caller did not mention must survive the replace.
  assert.equal(put.body.projectId, "p1");
  assert.equal(put.body.billable, true);
  assert.equal(put.body.start, "2026-08-14T09:00:00Z");
});

test("list-clockify-tasks pages through instead of taking page one", async () => {
  const page = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, name: `Task ${i}` }));
  let served = 0;
  const { client, calls } = await harness(() => (served++ === 0 ? page : [{ id: "tail", name: "Tail" }]));

  const result: any = await client.callTool({
    name: "list-clockify-tasks",
    arguments: { workspaceId: "w1", projectId: "p1" },
  });

  assert.equal(calls.length, 2);
  assert.match(result.content[0].text, /"truncated": false/);
  assert.match(result.content[0].text, /"id": "tail"/);
});

test("a bad date is refused before any request is made", async () => {
  const { client, calls } = await harness(() => ({}));

  const result: any = await client.callTool({
    name: "create-clockify-time-entry",
    arguments: {
      workspaceId: "w1",
      description: "x",
      start: "whenever",
      end: "2026-08-14T17:00:00Z",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Could not read "whenever"/);
  assert.equal(calls.length, 0, "no request should reach Clockify");
});

test("creating an invoice takes the currency from the client when omitted", async () => {
  // Clockify answers "Currency is required" rather than defaulting, so the
  // tool has to resolve one before posting.
  const { client, calls } = await harness((url) =>
    url.includes("/clients/") ? { id: "c1", currencyCode: "CAD" } : { id: "i1" },
  );

  await client.callTool({
    name: "create-clockify-invoice",
    arguments: {
      workspaceId: "w1",
      clientId: "c1",
      issueDate: "2026-08-15",
      dueDate: "2026-09-14",
    },
  });

  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.body.currency, "CAD");
});

test("an explicit currency skips the client lookup", async () => {
  const { client, calls } = await harness(() => ({ id: "i1" }));

  await client.callTool({
    name: "create-clockify-invoice",
    arguments: {
      workspaceId: "w1",
      clientId: "c1",
      issueDate: "2026-08-15",
      dueDate: "2026-09-14",
      currency: "USD",
    },
  });

  assert.ok(
    !calls.some((c) => c.url.includes("/clients/")),
    "should not fetch the client when the currency is given",
  );
  assert.equal(calls.find((c) => c.method === "POST")!.body.currency, "USD");
});

test("a client with no currency asks for one instead of failing at Clockify", async () => {
  const { client } = await harness((url) =>
    url.includes("/clients/") ? { id: "c1" } : { id: "i1" },
  );

  const result: any = await client.callTool({
    name: "create-clockify-invoice",
    arguments: {
      workspaceId: "w1",
      clientId: "c1",
      issueDate: "2026-08-15",
      dueDate: "2026-09-14",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Pass `currency` explicitly/);
});

test("invoice status changes state plainly that nothing was emailed", async () => {
  const { client, calls } = await harness(() => ({}));

  const result: any = await client.callTool({
    name: "set-clockify-invoice-status",
    arguments: { workspaceId: "w1", invoiceId: "i1", status: "SENT" },
  });

  // The status is its own sub-resource; PATCHing the invoice itself is a 405.
  assert.match(calls[0].url, /\/invoices\/i1\/status$/);
  assert.match(result.content[0].text, /"delivered": false/);
  assert.match(result.content[0].text, /Nothing was emailed/);
});

test("a payment converts to minor units and uses the paymentDate field", async () => {
  const { client, calls } = await harness(() => ({
    id: "i1",
    currency: "CAD",
    status: "PAID",
    paid: 120000,
    balance: 0,
  }));

  const result: any = await client.callTool({
    name: "record-clockify-invoice-payment",
    arguments: {
      workspaceId: "w1",
      invoiceId: "i1",
      amount: 1200,
      paymentDate: "2026-08-13",
    },
  });

  const post = calls.find((c) => c.method === "POST")!;
  assert.match(post.url, /\/invoices\/i1\/payments$/);
  assert.equal(post.body.amount, 120000, "1200.00 must be sent as 120000");
  // Sending `date` instead is rejected as a missing paymentDate.
  assert.equal(post.body.paymentDate, "2026-08-13T12:00:00Z");
  assert.match(result.content[0].text, /"balance": "CAD 0\.00"/);
});

test("invoice amounts are reported in major units, not raw cents", async () => {
  const { client } = await harness(() => [
    { id: "i1", number: "INV10", currency: "CAD", amount: 40000 },
  ]);

  const result: any = await client.callTool({
    name: "list-clockify-invoices",
    arguments: { workspaceId: "w1" },
  });

  // 40000 is CAD 400.00. Reported raw, this reads as four hundred thousand.
  assert.match(result.content[0].text, /"amount": "CAD 400\.00"/);
  assert.match(result.content[0].text, /"amountMinorUnits": 40000/);
});
