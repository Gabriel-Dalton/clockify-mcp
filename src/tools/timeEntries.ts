import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { guard, ok } from "../response.js";
import {
  assertRangeOrder,
  toClockifyInstant,
  toOptionalClockifyInstant,
} from "../time.js";

const workspaceId = z
  .string()
  .describe("Workspace ID, from list-clockify-workspaces.");

/** Trims a Clockify time entry down to the fields worth putting in context. */
export function summariseEntry(entry: any) {
  return {
    id: entry.id,
    description: entry.description,
    start: entry.timeInterval?.start,
    end: entry.timeInterval?.end ?? null,
    duration: entry.timeInterval?.duration ?? null,
    running: !entry.timeInterval?.end,
    billable: entry.billable,
    projectId: entry.projectId,
    taskId: entry.taskId,
  };
}

export function registerTimeEntryTools(
  server: McpServer,
  client: ClockifyClient,
) {
  server.registerTool(
    "list-clockify-time-entries",
    {
      description:
        "Retrieves a user's time entries within a date range. Omit userId to " +
        "use the API key's own user.",
      inputSchema: {
        workspaceId,
        userId: z
          .string()
          .optional()
          .describe("User ID, from get-clockify-user. Defaults to the current user."),
        start: z.string().describe("Range start, e.g. 2026-08-01T00:00:00Z."),
        end: z.string().describe("Range end, e.g. 2026-08-31T23:59:59Z."),
        page: z.number().min(1).default(1).describe("Page number, 1-based."),
        pageSize: z.number().min(1).max(5000).default(100).describe("Entries per page."),
      },
    },
    (input) =>
      guard(async () => {
        const userId =
          input.userId ?? (await client.request<any>("/user")).id;
        const entries = await client.request<any[]>(
          buildPath`/workspaces/${input.workspaceId}/user/${userId}/time-entries`,
          {
            query: {
              start: toClockifyInstant("start", input.start),
              end: toClockifyInstant("end", input.end),
              page: input.page,
              "page-size": input.pageSize,
            },
          },
        );
        return ok({
          count: entries.length,
          entries: entries.map(summariseEntry),
        });
      }),
  );

  server.registerTool(
    "create-clockify-time-entry",
    {
      description:
        "Logs a completed block of work. To start a timer that is still " +
        "running, use start-clockify-timer instead.",
      inputSchema: {
        workspaceId,
        description: z.string().describe("What the work was."),
        start: z.string().describe("Start time, e.g. 2026-08-14T09:00:00."),
        end: z.string().describe("End time, e.g. 2026-08-14T17:00:00."),
        projectId: z
          .string()
          .optional()
          .describe("Project ID, from list-clockify-projects."),
        taskId: z.string().optional().describe("Task ID, from list-clockify-tasks."),
        billable: z.boolean().optional().default(true).describe("Is it billable."),
      },
    },
    (input) =>
      guard(async () => {
        const start = toClockifyInstant("start", input.start);
        const end = toClockifyInstant("end", input.end);
        assertRangeOrder(start, end);

        const entry = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/time-entries`,
          {
            method: "POST",
            body: {
              start,
              end,
              description: input.description,
              billable: input.billable,
              projectId: input.projectId,
              taskId: input.taskId,
            },
          },
        );
        return ok(summariseEntry(entry));
      }),
  );

  server.registerTool(
    "update-clockify-time-entry",
    {
      description:
        "Changes an existing time entry. Only the fields you pass are changed; " +
        "the rest are carried over from the entry as it stands. Omitting `end` " +
        "on a running entry leaves it running.",
      inputSchema: {
        workspaceId,
        timeEntryId: z.string().describe("The time entry to change."),
        description: z.string().optional().describe("New description."),
        start: z.string().optional().describe("New start time."),
        end: z.string().optional().describe("New end time."),
        projectId: z.string().optional().describe("New project."),
        taskId: z.string().optional().describe("New task."),
        billable: z.boolean().optional().describe("New billable flag."),
      },
    },
    (input) =>
      guard(async () => {
        const path = buildPath`/workspaces/${input.workspaceId}/time-entries/${input.timeEntryId}`;

        // Clockify's PUT replaces the entry, so a partial update has to be
        // merged onto the current state or unmentioned fields are wiped.
        const current = await client.request<any>(path);

        const start =
          toOptionalClockifyInstant("start", input.start) ??
          current.timeInterval?.start;
        const end =
          toOptionalClockifyInstant("end", input.end) ??
          current.timeInterval?.end ??
          undefined;
        assertRangeOrder(start, end);

        const entry = await client.request<any>(path, {
          method: "PUT",
          body: {
            start,
            end,
            description: input.description ?? current.description,
            billable: input.billable ?? current.billable,
            projectId: input.projectId ?? current.projectId,
            taskId: input.taskId ?? current.taskId,
          },
        });
        return ok(summariseEntry(entry));
      }),
  );

  server.registerTool(
    "delete-clockify-time-entry",
    {
      description: "Permanently deletes a time entry. This cannot be undone.",
      inputSchema: {
        workspaceId,
        timeEntryId: z.string().describe("The time entry to delete."),
      },
    },
    (input) =>
      guard(async () => {
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/time-entries/${input.timeEntryId}`,
          { method: "DELETE" },
        );
        return ok({ deleted: true, timeEntryId: input.timeEntryId });
      }),
  );
}
