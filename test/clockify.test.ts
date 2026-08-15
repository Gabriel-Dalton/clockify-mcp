import test from "node:test";
import assert from "node:assert/strict";
import {
  ClockifyClient,
  ClockifyError,
  buildPath,
  buildQuery,
} from "../build/clockify.js";

/** Records the URLs a client requests and replies with canned responses. */
function stubFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let i = 0;
  const impl = (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    const next = responses[Math.min(i++, responses.length - 1)];
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        next.body === undefined ? "" : JSON.stringify(next.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("buildQuery encodes values and drops empty ones", () => {
  assert.equal(buildQuery({ name: "R&D" }), "?name=R%26D");
  assert.equal(buildQuery({ name: "", page: 1 }), "?page=1");
  assert.equal(buildQuery({}), "");
  assert.equal(
    buildQuery({ start: "2026-08-14T10:00:00+02:00" }),
    "?start=2026-08-14T10%3A00%3A00%2B02%3A00",
  );
});

test("buildPath encodes path segments", () => {
  const id = "a/b?c";
  assert.equal(buildPath`/workspaces/${id}/projects`, "/workspaces/a%2Fb%3Fc/projects");
});

test("a project name containing & does not corrupt the query", async () => {
  const { impl, calls } = stubFetch([{ body: [] }]);
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });

  await client.request("/workspaces/w/projects", { query: { name: "Sales & Marketing" } });

  assert.match(calls[0].url, /name=Sales\+%26\+Marketing/);
  assert.doesNotMatch(calls[0].url, /&\s?Marketing=/);
});

test("a missing API key explains where to set it", async () => {
  const client = new ClockifyClient({ fetchImpl: stubFetch([{}]).impl });
  await assert.rejects(() => client.request("/user"), /CLOCKIFY_API_KEY/);
});

test("HTTP failures carry the status and a plain-language message", async () => {
  const { impl } = stubFetch([{ status: 403, body: { message: "no" } }]);
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });

  await assert.rejects(
    () => client.request("/workspaces/w/invoices"),
    (error: ClockifyError) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /plan does not include this feature/);
      return true;
    },
  );
});

test("401 points at the key rather than the endpoint", async () => {
  const { impl } = stubFetch([{ status: 401 }]);
  const client = new ClockifyClient({ apiKey: "bad", fetchImpl: impl });
  await assert.rejects(() => client.request("/user"), /rejected the API key/);
});

test("204 responses do not blow up on empty bodies", async () => {
  const { impl } = stubFetch([{ status: 204 }]);
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });
  assert.deepEqual(await client.request("/x", { method: "DELETE" }), {});
});

test("paginate walks every page until a short one arrives", async () => {
  const full = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}` }));
  const { impl, calls } = stubFetch([
    { body: full },
    { body: [{ id: "last" }] },
  ]);
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });

  const { items, truncated } = await client.paginate<{ id: string }>("/tasks");

  assert.equal(items.length, 201);
  assert.equal(truncated, false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /page=1&page-size=200/);
  assert.match(calls[1].url, /page=2&page-size=200/);
});

test("paginate stops at maxPages and says it truncated", async () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }));
  const { impl, calls } = stubFetch([{ body: full }]);
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });

  const { items, truncated } = await client.paginate("/tasks", {
    pageSize: 10,
    maxPages: 3,
  });

  assert.equal(items.length, 30);
  assert.equal(truncated, true);
  assert.equal(calls.length, 3);
});

test("network failures name the call that failed", async () => {
  const impl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const client = new ClockifyClient({ apiKey: "k", fetchImpl: impl });
  await assert.rejects(() => client.request("/user"), /Could not reach Clockify/);
});
