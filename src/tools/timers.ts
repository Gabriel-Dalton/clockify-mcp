import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { fail, guard, ok } from "../response.js";
import { toClockifyInstant } from "../time.js";
import { summariseEntry } from "./timeEntries.js";

const workspaceId = z
  .string()
  .describe("Workspace ID, from list-clockify-workspaces.");

/**
 * The running-timer half of the API: start one by POSTing an entry with no
 * `end`, stop it with the workspace/user PATCH endpoint.
 */
export function registerTimerTools(server: McpServer, client: ClockifyClient) {
  server.registerTool(
    "start-clockify-timer",
    {
      description:
        "Starts a running timer now (or at a given start time) and leaves it " +
        "running. Use stop-clockify-timer to end it.",
      inputSchema: {
        workspaceId,
        description: z.string().describe("What you are working on."),
        projectId: z
          .string()
          .optional()
          .describe("Project ID, from list-clockify-projects."),
        taskId: z.string().optional().describe("Task ID, from list-clockify-tasks."),
        billable: z.boolean().optional().default(true).describe("Is it billable."),
        start: z
          .string()
          .optional()
          .describe("When the work began. Defaults to now."),
      },
    },
    (input) =>
      guard(async () => {
        const start = input.start
          ? toClockifyInstant("start", input.start)
          : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

        const entry = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/time-entries`,
          {
            method: "POST",
            body: {
              start,
              description: input.description,
              billable: input.billable,
              projectId: input.projectId,
              taskId: input.taskId,
            },
          },
        );
        return ok({ started: true, ...summariseEntry(entry) });
      }),
  );

  server.registerTool(
    "stop-clockify-timer",
    {
      description:
        "Stops the timer that is currently running for a user. Fails clearly " +
        "if nothing is running.",
      inputSchema: {
        workspaceId,
        userId: z
          .string()
          .optional()
          .describe("User ID. Defaults to the current user."),
        end: z.string().optional().describe("When to stop it. Defaults to now."),
      },
    },
    (input) =>
      guard(async () => {
        const userId = input.userId ?? (await client.request<any>("/user")).id;
        const end = input.end
          ? toClockifyInstant("end", input.end)
          : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

        try {
          const entry = await client.request<any>(
            buildPath`/workspaces/${input.workspaceId}/user/${userId}/time-entries`,
            { method: "PATCH", body: { end } },
          );
          return ok({ stopped: true, ...summariseEntry(entry) });
        } catch (error: any) {
          // Clockify answers 404 when there is no timer to stop, which reads
          // as "the endpoint is missing" unless it is translated.
          if (error?.status === 404) {
            return fail(
              "No timer is currently running for this user, so there was nothing to stop.",
            );
          }
          throw error;
        }
      }),
  );

  server.registerTool(
    "get-clockify-running-timer",
    {
      description:
        "Shows the timer currently running for a user, if any, and how long it " +
        "has been going.",
      inputSchema: {
        workspaceId,
        userId: z
          .string()
          .optional()
          .describe("User ID. Defaults to the current user."),
      },
    },
    (input) =>
      guard(async () => {
        const userId = input.userId ?? (await client.request<any>("/user")).id;
        const entries = await client.request<any[]>(
          buildPath`/workspaces/${input.workspaceId}/user/${userId}/time-entries`,
          { query: { "in-progress": true } },
        );

        const running = entries?.[0];
        if (!running) return ok({ running: false });

        const startedAt = new Date(running.timeInterval.start).getTime();
        const elapsedMinutes = Math.round((Date.now() - startedAt) / 60000);
        return ok({ ...summariseEntry(running), running: true, elapsedMinutes });
      }),
  );
}
