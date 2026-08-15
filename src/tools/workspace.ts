import { z } from "zod";
import { type ToolDef, withWorkspace } from "../registry.js";

const id = (what: string) => z.string().describe(`The ${what}'s ID.`);
const page = {
  page: z.number().min(1).optional().describe("Page number, 1-based."),
  pageSize: z.number().min(1).max(5000).optional().describe("Items per page."),
};

/** Clients. */
export const clientTools: ToolDef[] = [
  {
    name: "get-clockify-client",
    description: "Retrieves one client by ID, including their address and currency.",
    path: "/workspaces/{workspaceId}/clients/{clientId}",
    input: withWorkspace({ clientId: id("client") }),
  },
  {
    name: "create-clockify-client",
    description: "Adds a client to a workspace. Clients are who invoices are raised against.",
    method: "POST",
    path: "/workspaces/{workspaceId}/clients",
    body: ["name", "email", "address", "note", "currencyId"],
    input: withWorkspace({
      name: z.string().describe("The client's name."),
      email: z.string().optional().describe("Billing email."),
      address: z.string().optional().describe("Billing address, newlines allowed."),
      note: z.string().optional().describe("Internal note."),
      currencyId: z.string().optional().describe("Currency ID for their invoices."),
    }),
  },
  {
    name: "update-clockify-client",
    description: "Changes a client's details, or archives them.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/clients/{clientId}",
    body: ["name", "email", "address", "note", "archived", "currencyId"],
    input: withWorkspace({
      clientId: id("client"),
      name: z.string().describe("The client's name. Clockify requires it on update."),
      email: z.string().optional().describe("Billing email."),
      address: z.string().optional().describe("Billing address."),
      note: z.string().optional().describe("Internal note."),
      archived: z.boolean().optional().describe("Archive or restore them."),
      currencyId: z.string().optional().describe("Currency ID."),
    }),
  },
  {
    name: "delete-clockify-client",
    description: "Permanently deletes a client. Archiving is usually safer.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/clients/{clientId}",
    input: withWorkspace({ clientId: id("client") }),
  },
];

/** Projects. */
export const projectTools: ToolDef[] = [
  {
    name: "get-clockify-project",
    description: "Retrieves one project, including its rate, estimate and memberships.",
    path: "/workspaces/{workspaceId}/projects/{projectId}",
    input: withWorkspace({ projectId: id("project") }),
  },
  {
    name: "create-clockify-project",
    description: "Adds a project to a workspace.",
    method: "POST",
    path: "/workspaces/{workspaceId}/projects",
    body: ["name", "clientId", "isPublic", "billable", "color", "note", "estimate"],
    input: withWorkspace({
      name: z.string().describe("Project name."),
      clientId: z.string().optional().describe("Client it belongs to."),
      isPublic: z.boolean().optional().describe("Visible to the whole workspace."),
      billable: z.boolean().optional().describe("Whether time on it is billable."),
      color: z.string().optional().describe("Hex colour, e.g. #16a34a."),
      note: z.string().optional().describe("Project note."),
    }),
  },
  {
    name: "update-clockify-project",
    description: "Changes a project's name, client, colour, billability or archived state.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/projects/{projectId}",
    body: ["name", "clientId", "isPublic", "billable", "color", "note", "archived"],
    input: withWorkspace({
      projectId: id("project"),
      name: z.string().optional().describe("New name."),
      clientId: z.string().optional().describe("New client."),
      isPublic: z.boolean().optional().describe("Visibility."),
      billable: z.boolean().optional().describe("Billability."),
      color: z.string().optional().describe("Hex colour."),
      note: z.string().optional().describe("Project note."),
      archived: z.boolean().optional().describe("Archive or restore."),
    }),
  },
  {
    name: "delete-clockify-project",
    description: "Permanently deletes a project. It must be archived first.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/projects/{projectId}",
    input: withWorkspace({ projectId: id("project") }),
  },
  {
    name: "update-clockify-project-estimate",
    description: "Sets a project's time or budget estimate.",
    method: "PATCH",
    path: "/workspaces/{workspaceId}/projects/{projectId}/estimate",
    body: ["timeEstimate", "budgetEstimate"],
    input: withWorkspace({
      projectId: id("project"),
      timeEstimate: z
        .object({
          estimate: z.string().describe("ISO 8601 duration, e.g. PT40H."),
          type: z.enum(["AUTO", "MANUAL"]).optional(),
          active: z.boolean().optional(),
        })
        .optional()
        .describe("Time estimate."),
      budgetEstimate: z
        .object({
          estimate: z.number().describe("Budget in minor units."),
          type: z.enum(["AUTO", "MANUAL"]).optional(),
          active: z.boolean().optional(),
        })
        .optional()
        .describe("Budget estimate."),
    }),
  },
  {
    name: "update-clockify-project-memberships",
    description: "Assigns users to a project or removes them from it.",
    method: "POST",
    path: "/workspaces/{workspaceId}/projects/{projectId}/memberships",
    body: ["userIds", "userGroupIds"],
    input: withWorkspace({
      projectId: id("project"),
      userIds: z.array(z.string()).optional().describe("Users to assign."),
      userGroupIds: z.array(z.string()).optional().describe("Groups to assign."),
    }),
  },
  {
    name: "set-clockify-project-user-rate",
    description: "Sets a user's billable hourly rate on a project. Amount is in minor units.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/projects/{projectId}/users/{userId}/hourly-rate",
    body: ["amount", "since"],
    input: withWorkspace({
      projectId: id("project"),
      userId: id("user"),
      amount: z.number().describe("Rate in minor units — 2000 is 20.00 an hour."),
      since: z.string().optional().describe("Effective from, ISO 8601."),
    }),
  },
  {
    name: "set-clockify-project-user-cost-rate",
    description: "Sets a user's internal cost rate on a project. Amount is in minor units.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/projects/{projectId}/users/{userId}/cost-rate",
    body: ["amount", "since"],
    input: withWorkspace({
      projectId: id("project"),
      userId: id("user"),
      amount: z.number().describe("Cost rate in minor units."),
      since: z.string().optional().describe("Effective from, ISO 8601."),
    }),
  },
];

/** Tasks. */
export const taskTools: ToolDef[] = [
  {
    name: "get-clockify-task",
    description: "Retrieves one task on a project.",
    path: "/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}",
    input: withWorkspace({ projectId: id("project"), taskId: id("task") }),
  },
  {
    name: "create-clockify-task",
    description: "Adds a task to a project.",
    method: "POST",
    path: "/workspaces/{workspaceId}/projects/{projectId}/tasks",
    body: ["name", "assigneeIds", "estimate", "status", "billable"],
    input: withWorkspace({
      projectId: id("project"),
      name: z.string().describe("Task name."),
      assigneeIds: z.array(z.string()).optional().describe("Users assigned to it."),
      estimate: z.string().optional().describe("ISO 8601 duration, e.g. PT4H."),
      status: z.enum(["ACTIVE", "DONE"]).optional().describe("Task status."),
      billable: z.boolean().optional().describe("Whether time on it is billable."),
    }),
  },
  {
    name: "update-clockify-task",
    description: "Changes a task's name, assignees, estimate or status.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}",
    body: ["name", "assigneeIds", "estimate", "status", "billable"],
    input: withWorkspace({
      projectId: id("project"),
      taskId: id("task"),
      name: z.string().describe("Task name. Clockify requires it on update."),
      assigneeIds: z.array(z.string()).optional().describe("Users assigned."),
      estimate: z.string().optional().describe("ISO 8601 duration."),
      status: z.enum(["ACTIVE", "DONE"]).optional().describe("Task status."),
      billable: z.boolean().optional().describe("Billability."),
    }),
  },
  {
    name: "delete-clockify-task",
    description: "Deletes a task from a project.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}",
    input: withWorkspace({ projectId: id("project"), taskId: id("task") }),
  },
];

/** Tags. */
export const tagTools: ToolDef[] = [
  {
    name: "list-clockify-tags",
    description: "Lists the tags in a workspace.",
    path: "/workspaces/{workspaceId}/tags",
    query: ["name", "archived", "page", "pageSize"],
    input: withWorkspace({
      name: z.string().optional().describe("Filter by name."),
      archived: z.boolean().optional().describe("Include archived tags."),
      ...page,
    }),
  },
  {
    name: "create-clockify-tag",
    description: "Adds a tag to a workspace.",
    method: "POST",
    path: "/workspaces/{workspaceId}/tags",
    body: ["name"],
    input: withWorkspace({ name: z.string().describe("Tag name.") }),
  },
  {
    name: "update-clockify-tag",
    description: "Renames a tag or archives it.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/tags/{tagId}",
    body: ["name", "archived"],
    input: withWorkspace({
      tagId: id("tag"),
      name: z.string().describe("Tag name."),
      archived: z.boolean().optional().describe("Archive or restore."),
    }),
  },
  {
    name: "delete-clockify-tag",
    description: "Deletes a tag from a workspace.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/tags/{tagId}",
    input: withWorkspace({ tagId: id("tag") }),
  },
];

/** Workspace, its members and groups. */
export const memberTools: ToolDef[] = [
  {
    name: "get-clockify-workspace",
    description: "Retrieves a workspace's settings, including its currency and rounding rules.",
    path: "/workspaces/{workspaceId}",
    input: withWorkspace(),
  },
  {
    name: "list-clockify-workspace-users",
    description: "Lists the people in a workspace, with their status and roles.",
    path: "/workspaces/{workspaceId}/users",
    query: ["name", "email", "status", "page", "pageSize"],
    input: withWorkspace({
      name: z.string().optional().describe("Filter by name."),
      email: z.string().optional().describe("Filter by email."),
      status: z
        .enum(["PENDING", "ACTIVE", "DECLINED", "INACTIVE"])
        .optional()
        .describe("Filter by membership status."),
      ...page,
    }),
  },
  {
    name: "invite-clockify-user",
    description: "Invites someone to a workspace by email.",
    method: "POST",
    path: "/workspaces/{workspaceId}/users",
    body: ["email"],
    input: withWorkspace({ email: z.string().describe("Their email address.") }),
  },
  {
    name: "set-clockify-user-status",
    description: "Activates or deactivates a workspace member.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/users/{userId}",
    body: ["membershipStatus"],
    input: withWorkspace({
      userId: id("user"),
      membershipStatus: z
        .enum(["ACTIVE", "INACTIVE"])
        .describe("Their new membership status."),
    }),
  },
  {
    name: "set-clockify-user-rate",
    description: "Sets a member's workspace-wide billable rate, in minor units.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/users/{userId}/hourly-rate",
    body: ["amount", "since"],
    input: withWorkspace({
      userId: id("user"),
      amount: z.number().describe("Rate in minor units — 2000 is 20.00 an hour."),
      since: z.string().optional().describe("Effective from, ISO 8601."),
    }),
  },
  {
    name: "get-clockify-member-profile",
    description: "Retrieves a member's profile, including their working hours and rates.",
    path: "/workspaces/{workspaceId}/member-profile/{userId}",
    input: withWorkspace({ userId: id("user") }),
  },
  {
    name: "list-clockify-user-groups",
    description: "Lists the user groups in a workspace.",
    path: "/workspaces/{workspaceId}/user-groups",
    query: ["name", "page", "pageSize"],
    input: withWorkspace({
      name: z.string().optional().describe("Filter by name."),
      ...page,
    }),
  },
  {
    name: "create-clockify-user-group",
    description: "Creates a user group.",
    method: "POST",
    path: "/workspaces/{workspaceId}/user-groups",
    body: ["name"],
    input: withWorkspace({ name: z.string().describe("Group name.") }),
  },
  {
    name: "add-clockify-user-to-group",
    description: "Adds a user to a group.",
    method: "POST",
    path: "/workspaces/{workspaceId}/user-groups/{userGroupId}/users",
    body: ["userId"],
    input: withWorkspace({
      userGroupId: id("group"),
      userId: id("user"),
    }),
  },
  {
    name: "remove-clockify-user-from-group",
    description: "Removes a user from a group.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/user-groups/{userGroupId}/users/{userId}",
    input: withWorkspace({ userGroupId: id("group"), userId: id("user") }),
  },
  {
    name: "delete-clockify-user-group",
    description: "Deletes a user group.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/user-groups/{userGroupId}",
    input: withWorkspace({ userGroupId: id("group") }),
  },
];
