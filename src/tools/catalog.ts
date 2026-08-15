import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildQuery } from "../clockify.js";
import { guard, ok } from "../response.js";
import { OPERATIONS } from "../operations.js";

/**
 * The completeness guarantee.
 *
 * The typed tools cover what people actually do with Clockify. These two cover
 * everything else: the catalogue makes the whole API discoverable, and the
 * caller can reach any endpoint in it — including ones Clockify adds after
 * this was written. Without them, "the tool doesn't support that" would be a
 * dead end rather than one extra step.
 */
export function registerCatalogTools(server: McpServer, client: ClockifyClient) {
  server.registerTool(
    "search-clockify-api",
    {
      description:
        "Searches every operation in the Clockify API by keyword, returning the " +
        "method, path and summary. Use this when no dedicated tool covers what " +
        "you need — then call it with call-clockify-api.",
      inputSchema: {
        query: z
          .string()
          .describe("Keywords, e.g. 'invoice payment', 'time off balance', 'webhook'."),
        limit: z.number().min(1).max(60).optional().default(20).describe("Max results."),
      },
    },
    (input) =>
      guard(async () => {
        const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = OPERATIONS.map((op) => {
          const haystack = `${op.method} ${op.path} ${op.summary}`.toLowerCase();
          const score = terms.filter((t) => haystack.includes(t)).length;
          return { op, score };
        })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score || a.op.path.length - b.op.path.length)
          .slice(0, input.limit ?? 20);

        return ok({
          matched: scored.length,
          totalOperations: OPERATIONS.length,
          operations: scored.map((r) => r.op),
        });
      }),
  );

  server.registerTool(
    "call-clockify-api",
    {
      description:
        "Calls any Clockify endpoint directly. The escape hatch for anything the " +
        "dedicated tools do not cover — find the path with search-clockify-api " +
        "first. Paths are relative, e.g. /workspaces/{id}/holidays. Remember " +
        "Clockify stores money in minor units.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Path after the API base, starting with a slash. Substitute IDs " +
              "yourself, e.g. /workspaces/abc123/tags.",
          ),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .default("GET")
          .describe("HTTP method."),
        query: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters. Encoded for you."),
        body: z.any().optional().describe("JSON body for POST, PUT or PATCH."),
        reports: z
          .boolean()
          .optional()
          .default(false)
          .describe("Set for report endpoints, which live on a separate host."),
      },
    },
    (input) =>
      guard(async () => {
        if (!input.path.startsWith("/")) {
          throw new Error(
            `Path must start with a slash and exclude the host — got "${input.path}".`,
          );
        }
        const data = await client.request<any>(input.path, {
          method: input.method ?? "GET",
          query: input.query,
          body: input.body,
          reports: input.reports,
        });
        return ok(data);
      }),
  );
}

/** Exported for tests. */
export { buildQuery };
