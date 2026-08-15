import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { guard, ok } from "../response.js";

const workspaceId = z
  .string()
  .describe("Workspace ID, from list-clockify-workspaces.");

export function registerCoreTools(server: McpServer, client: ClockifyClient) {
  server.registerTool(
    "get-clockify-user",
    {
      description:
        "Retrieves the current Clockify user's profile, including their user ID " +
        "and active workspace. Call this first — most other tools need those IDs.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const user = await client.request<any>("/user");
        return ok({
          id: user.id,
          email: user.email,
          name: user.name,
          activeWorkspace: user.activeWorkspace,
          defaultWorkspace: user.defaultWorkspace,
          timeZone: user.settings?.timeZone,
        });
      }),
  );

  server.registerTool(
    "list-clockify-workspaces",
    {
      description: "Retrieves every workspace the API key can see.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const workspaces = await client.request<any[]>("/workspaces");
        return ok(
          workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            currency: w.workspaceSettings?.currency,
          })),
        );
      }),
  );

  server.registerTool(
    "list-clockify-projects",
    {
      description:
        "Retrieves projects in a workspace, optionally filtered by name. " +
        "Archived projects are excluded unless includeArchived is set.",
      inputSchema: {
        workspaceId,
        name: z
          .string()
          .optional()
          .describe("Optional name filter. Matches on substring."),
        includeArchived: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include archived projects."),
      },
    },
    (input) =>
      guard(async () => {
        const { items, truncated } = await client.paginate<any>(
          buildPath`/workspaces/${input.workspaceId}/projects`,
          {
            query: {
              archived: input.includeArchived ? undefined : false,
              name: input.name,
            },
          },
        );
        return ok({
          truncated,
          projects: items.map((p) => ({
            id: p.id,
            name: p.name,
            clientId: p.clientId,
            clientName: p.clientName,
            billable: p.billable,
            archived: p.archived,
          })),
        });
      }),
  );

  server.registerTool(
    "list-clockify-tasks",
    {
      description: "Retrieves every task on a project, across all pages.",
      inputSchema: {
        workspaceId,
        projectId: z
          .string()
          .describe("Project ID, from list-clockify-projects."),
      },
    },
    (input) =>
      guard(async () => {
        const { items, truncated } = await client.paginate<any>(
          buildPath`/workspaces/${input.workspaceId}/projects/${input.projectId}/tasks`,
        );
        return ok({
          truncated,
          tasks: items.map((t) => ({
            id: t.id,
            name: t.name,
            projectId: t.projectId,
            status: t.status,
          })),
        });
      }),
  );

  server.registerTool(
    "list-clockify-clients",
    {
      description:
        "Retrieves the clients in a workspace. Client IDs are needed to raise " +
        "an invoice and to tell which projects bill to whom.",
      inputSchema: {
        workspaceId,
        name: z.string().optional().describe("Optional name filter."),
      },
    },
    (input) =>
      guard(async () => {
        const { items, truncated } = await client.paginate<any>(
          buildPath`/workspaces/${input.workspaceId}/clients`,
          { query: { name: input.name } },
        );
        return ok({
          truncated,
          clients: items.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            address: c.address,
            archived: c.archived,
            currency: c.currencyCode,
          })),
        });
      }),
  );
}
