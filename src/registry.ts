import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockifyClient, QueryValue } from "./clockify.js";
import { guard, ok } from "./response.js";

/**
 * Declarative tool definitions.
 *
 * Most of the Clockify surface is plain CRUD: substitute some IDs into a path,
 * pass some values as query or body, return the JSON. Writing a hundred of
 * those out by hand invites copy-paste bugs — particularly around encoding,
 * which is the defect this project exists to fix. So they are described as
 * data and registered by one shared code path that always encodes correctly.
 *
 * Tools with real behaviour — timers, invoices, anything that transforms
 * money or dates — stay hand-written in src/tools/.
 */
export interface ToolDef {
  name: string;
  description: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path template using {placeholders} matching input keys. Each is encoded. */
  path: string;
  /** Input keys sent as query parameters. */
  query?: string[];
  /** Input keys sent in the JSON body. */
  body?: string[];
  /** Zod shape for the tool's inputs. */
  input: Record<string, z.ZodTypeAny>;
  /** Send the whole body as a bare array under this key's value. */
  bodyIsArray?: string;
  /** Hit the reports host instead of the main API. */
  reports?: boolean;
  /** Shape the response before returning it. */
  transform?: (data: any) => unknown;
}

const WORKSPACE = z
  .string()
  .describe("Workspace ID, from list-clockify-workspaces.");

/** Shorthand for the near-universal workspaceId input. */
export const withWorkspace = (
  rest: Record<string, z.ZodTypeAny> = {},
): Record<string, z.ZodTypeAny> => ({ workspaceId: WORKSPACE, ...rest });

function fillPath(template: string, input: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing \`${key}\`, which the endpoint path requires.`);
    }
    return encodeURIComponent(String(value));
  });
}

export function registerDefs(
  server: McpServer,
  client: ClockifyClient,
  defs: ToolDef[],
): void {
  for (const def of defs) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.input },
      (input: Record<string, any>) =>
        guard(async () => {
          const query: Record<string, QueryValue> = {};
          for (const key of def.query ?? []) {
            const value = input[key];
            if (value === undefined) continue;
            query[toApiKey(key)] = Array.isArray(value) ? value.join(",") : value;
          }

          let body: unknown;
          if (def.bodyIsArray) {
            body = input[def.bodyIsArray];
          } else if (def.body?.length) {
            const obj: Record<string, unknown> = {};
            for (const key of def.body) {
              if (input[key] !== undefined) obj[key] = input[key];
            }
            body = Object.keys(obj).length ? obj : undefined;
          }

          const data = await client.request<any>(fillPath(def.path, input), {
            method: def.method ?? "GET",
            query,
            body,
            reports: def.reports,
          });

          return ok(def.transform ? def.transform(data) : data);
        }),
    );
  }
}

/**
 * Clockify's query parameters are kebab-case while tool inputs are camelCase,
 * so `pageSize` has to go out as `page-size`. Getting this wrong fails
 * silently — the API ignores the unknown parameter and returns a default page.
 */
function toApiKey(key: string): string {
  const known: Record<string, string> = {
    pageSize: "page-size",
    inProgress: "in-progress",
    userLocale: "userLocale",
    projectRequired: "project-required",
    taskRequired: "task-required",
    isActive: "is-active",
    sortColumn: "sort-column",
    sortOrder: "sort-order",
    clientIds: "clients",
    strictNameSearch: "strict-name-search",
  };
  return known[key] ?? key;
}
