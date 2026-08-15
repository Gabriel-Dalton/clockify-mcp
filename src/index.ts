#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClockifyClient } from "./clockify.js";
import { registerCoreTools } from "./tools/core.js";
import { registerTimeEntryTools } from "./tools/timeEntries.js";
import { registerTimerTools } from "./tools/timers.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MCP_NAME = "clockify-mcp";

// Read from package.json rather than hardcoding, so `npm version` cannot leave
// the reported version and the published version disagreeing.
const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function createServer(client: ClockifyClient): McpServer {
  const server = new McpServer(
    { name: MCP_NAME, version: VERSION },
    { capabilities: { tools: {} } },
  );

  registerCoreTools(server, client);
  registerTimeEntryTools(server, client);
  registerTimerTools(server, client);
  registerInvoiceTools(server, client);

  return server;
}

async function main() {
  const client = new ClockifyClient({
    apiKey: process.env.CLOCKIFY_API_KEY,
    userAgent: `${MCP_NAME}/${VERSION}`,
  });

  const server = createServer(client);
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
