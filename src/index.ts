#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClockifyClient } from "./clockify.js";
import { registerDefs } from "./registry.js";
import { registerCoreTools } from "./tools/core.js";
import { registerTimeEntryTools } from "./tools/timeEntries.js";
import { registerTimerTools } from "./tools/timers.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerCatalogTools } from "./tools/catalog.js";
import {
  clientTools,
  memberTools,
  projectTools,
  tagTools,
  taskTools,
} from "./tools/workspace.js";
import {
  approvalTools,
  customFieldTools,
  expenseTools,
  reportTools,
  schedulingTools,
  timeOffTools,
  webhookTools,
} from "./tools/extras.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MCP_NAME = "clockify-mcp";

// Read from package.json rather than hardcoding, so `npm version` cannot leave
// the reported version and the published version disagreeing.
const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/**
 * Tools are grouped into modules so a large surface stays manageable.
 *
 * Everything is on by default — a capability you have and never use costs
 * nothing, while a missing one costs a whole session. But every tool
 * definition sits in the model's context for the entire conversation, so
 * anyone who wants a leaner server can name the modules they need:
 *
 *   CLOCKIFY_MCP_MODULES=core,time,invoices
 *
 * `core` is always loaded, since the other modules need workspace and user IDs
 * that only it can supply.
 */
export const MODULES = [
  "core",
  "time",
  "invoices",
  "projects",
  "clients",
  "tasks",
  "tags",
  "members",
  "expenses",
  "reports",
  "webhooks",
  "customfields",
  "approvals",
  "timeoff",
  "scheduling",
  "catalog",
] as const;

export type Module = (typeof MODULES)[number];

export function resolveModules(setting?: string): Set<Module> {
  if (!setting || setting.trim().toLowerCase() === "all") {
    return new Set(MODULES);
  }
  const wanted = setting
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean) as Module[];

  const unknown = wanted.filter((m) => !MODULES.includes(m));
  if (unknown.length) {
    throw new Error(
      `Unknown CLOCKIFY_MCP_MODULES value(s): ${unknown.join(", ")}. ` +
        `Valid modules are: ${MODULES.join(", ")}.`,
    );
  }
  // Nothing else works without the workspace and user lookups in core.
  return new Set<Module>(["core", ...wanted]);
}

export function createServer(
  client: ClockifyClient,
  modules: Set<Module> = new Set(MODULES),
): McpServer {
  const server = new McpServer(
    { name: MCP_NAME, version: VERSION },
    { capabilities: { tools: {} } },
  );

  const on = (m: Module) => modules.has(m);

  if (on("core")) registerCoreTools(server, client);
  if (on("time")) {
    registerTimeEntryTools(server, client);
    registerTimerTools(server, client);
  }
  if (on("invoices")) registerInvoiceTools(server, client);
  if (on("clients")) registerDefs(server, client, clientTools);
  if (on("projects")) registerDefs(server, client, projectTools);
  if (on("tasks")) registerDefs(server, client, taskTools);
  if (on("tags")) registerDefs(server, client, tagTools);
  if (on("members")) registerDefs(server, client, memberTools);
  if (on("expenses")) registerDefs(server, client, expenseTools);
  if (on("reports")) registerDefs(server, client, reportTools);
  if (on("webhooks")) registerDefs(server, client, webhookTools);
  if (on("customfields")) registerDefs(server, client, customFieldTools);
  if (on("approvals")) registerDefs(server, client, approvalTools);
  if (on("timeoff")) registerDefs(server, client, timeOffTools);
  if (on("scheduling")) registerDefs(server, client, schedulingTools);
  if (on("catalog")) registerCatalogTools(server, client);

  return server;
}

async function main() {
  const client = new ClockifyClient({
    apiKey: process.env.CLOCKIFY_API_KEY,
    userAgent: `${MCP_NAME}/${VERSION}`,
  });

  const server = createServer(
    client,
    resolveModules(process.env.CLOCKIFY_MCP_MODULES),
  );
  await server.connect(new StdioServerTransport());
}

// Only start a transport when run as the entry point, so that importing this
// module (from tests, or another server) does not seize stdio.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    // stdout is the MCP transport, so diagnostics must go to stderr.
    console.error(`${MCP_NAME} failed to start:`, error);
    process.exit(1);
  });
}
