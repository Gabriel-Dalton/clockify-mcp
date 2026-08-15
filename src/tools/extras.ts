import { z } from "zod";
import { type ToolDef, withWorkspace } from "../registry.js";

const id = (what: string) => z.string().describe(`The ${what}'s ID.`);
const page = {
  page: z.number().min(1).optional().describe("Page number, 1-based."),
  pageSize: z.number().min(1).max(5000).optional().describe("Items per page."),
};

/**
 * Several of these areas are paid features. On a plan without them Clockify
 * answers 403, which is reported as a plan problem rather than a bug — the
 * tools are here so the capability exists the day the plan changes.
 */

/** Expenses. Paid feature. */
export const expenseTools: ToolDef[] = [
  {
    name: "list-clockify-expenses",
    description:
      "Lists expenses in a workspace. Paid feature — answers 403 on plans without it.",
    path: "/workspaces/{workspaceId}/expenses",
    query: ["userId", "page", "pageSize"],
    input: withWorkspace({
      userId: z.string().optional().describe("Filter to one user."),
      ...page,
    }),
  },
  {
    name: "get-clockify-expense",
    description: "Retrieves one expense.",
    path: "/workspaces/{workspaceId}/expenses/{expenseId}",
    input: withWorkspace({ expenseId: id("expense") }),
  },
  {
    name: "create-clockify-expense",
    description: "Records an expense against a project. Amount is in minor units.",
    method: "POST",
    path: "/workspaces/{workspaceId}/expenses",
    body: ["userId", "date", "projectId", "categoryId", "notes", "amount", "billable"],
    input: withWorkspace({
      userId: id("user"),
      date: z.string().describe("When it was incurred, ISO 8601."),
      projectId: z.string().optional().describe("Project to bill it to."),
      categoryId: z.string().optional().describe("Expense category."),
      notes: z.string().optional().describe("What it was for."),
      amount: z.number().describe("Amount in minor units — 2500 is 25.00."),
      billable: z.boolean().optional().describe("Whether to bill it on."),
    }),
  },
  {
    name: "update-clockify-expense",
    description: "Changes an expense.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/expenses/{expenseId}",
    body: ["userId", "date", "projectId", "categoryId", "notes", "amount", "billable"],
    input: withWorkspace({
      expenseId: id("expense"),
      userId: z.string().optional().describe("Whose expense it is."),
      date: z.string().optional().describe("Date, ISO 8601."),
      projectId: z.string().optional().describe("Project."),
      categoryId: z.string().optional().describe("Category."),
      notes: z.string().optional().describe("Notes."),
      amount: z.number().optional().describe("Amount in minor units."),
      billable: z.boolean().optional().describe("Billable."),
    }),
  },
  {
    name: "delete-clockify-expense",
    description: "Deletes an expense.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/expenses/{expenseId}",
    input: withWorkspace({ expenseId: id("expense") }),
  },
  {
    name: "list-clockify-expense-categories",
    description: "Lists the expense categories in a workspace.",
    path: "/workspaces/{workspaceId}/expenses/categories",
    query: ["page", "pageSize"],
    input: withWorkspace(page),
  },
  {
    name: "create-clockify-expense-category",
    description: "Adds an expense category.",
    method: "POST",
    path: "/workspaces/{workspaceId}/expenses/categories",
    body: ["name", "priceInCents", "unit"],
    input: withWorkspace({
      name: z.string().describe("Category name."),
      priceInCents: z.number().optional().describe("Default price in minor units."),
      unit: z.string().optional().describe("Unit, e.g. km."),
    }),
  },
  {
    name: "archive-clockify-expense-category",
    description: "Archives or restores an expense category.",
    method: "PATCH",
    path: "/workspaces/{workspaceId}/expenses/categories/{categoryId}/status",
    body: ["archived"],
    input: withWorkspace({
      categoryId: id("category"),
      archived: z.boolean().describe("True to archive, false to restore."),
    }),
  },
];

/** Reports. These go to the reports host. */
export const reportTools: ToolDef[] = [
  {
    name: "clockify-summary-report",
    description:
      "Totals tracked time and earnings over a date range, grouped how you ask — " +
      "the report to use for 'how many billable hours this month'.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/reports/summary",
    body: ["dateRangeStart", "dateRangeEnd", "summaryFilter", "amountShown", "users", "projects", "clients", "billable"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
      summaryFilter: z
        .object({
          groups: z
            .array(z.enum(["PROJECT", "CLIENT", "TASK", "USER", "DATE", "TAG"]))
            .describe("How to group the totals, outermost first."),
        })
        .optional()
        .describe("Grouping. Defaults to by project."),
      amountShown: z
        .enum(["EARNED", "COST", "PROFIT", "HIDE_AMOUNT"])
        .optional()
        .describe("Which money figure to include."),
      billable: z.boolean().optional().describe("Restrict to billable time."),
    }),
  },
  {
    name: "clockify-detailed-report",
    description: "Lists individual time entries over a range, with their amounts.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/reports/detailed",
    body: ["dateRangeStart", "dateRangeEnd", "detailedFilter", "amountShown", "billable"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
      detailedFilter: z
        .object({
          page: z.number().optional(),
          pageSize: z.number().optional(),
        })
        .optional()
        .describe("Paging for the entry list."),
      amountShown: z
        .enum(["EARNED", "COST", "PROFIT", "HIDE_AMOUNT"])
        .optional()
        .describe("Which money figure to include."),
      billable: z.boolean().optional().describe("Restrict to billable time."),
    }),
  },
  {
    name: "clockify-weekly-report",
    description: "Time totalled by day across a week, per user or project.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/reports/weekly",
    body: ["dateRangeStart", "dateRangeEnd", "weeklyFilter", "amountShown"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
      weeklyFilter: z
        .object({
          group: z.enum(["PROJECT", "USER"]).optional(),
          subgroup: z.enum(["TIME", "EARNED", "COST", "PROFIT"]).optional(),
        })
        .optional()
        .describe("Grouping."),
      amountShown: z.enum(["EARNED", "COST", "PROFIT", "HIDE_AMOUNT"]).optional(),
    }),
  },
  {
    name: "clockify-attendance-report",
    description: "Attendance and capacity across the team for a range. Paid feature.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/reports/attendance",
    body: ["dateRangeStart", "dateRangeEnd", "attendanceFilter"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
      attendanceFilter: z
        .object({ page: z.number().optional(), pageSize: z.number().optional() })
        .optional(),
    }),
  },
  {
    name: "clockify-expense-report",
    description: "Expenses over a range. Paid feature.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/reports/expenses/detailed",
    body: ["dateRangeStart", "dateRangeEnd", "exportType"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
    }),
  },
  {
    name: "clockify-audit-log-report",
    description: "Who changed what and when. Enterprise feature.",
    method: "POST",
    reports: true,
    path: "/workspaces/{workspaceId}/audit-log",
    body: ["dateRangeStart", "dateRangeEnd", "page", "pageSize"],
    input: withWorkspace({
      dateRangeStart: z.string().describe("Range start, ISO 8601."),
      dateRangeEnd: z.string().describe("Range end, ISO 8601."),
      ...page,
    }),
  },
  {
    name: "list-clockify-shared-reports",
    description: "Lists saved reports shared from this workspace.",
    reports: true,
    path: "/workspaces/{workspaceId}/shared-reports",
    query: ["page", "pageSize"],
    input: withWorkspace(page),
  },
  {
    name: "delete-clockify-shared-report",
    description: "Deletes a shared report.",
    method: "DELETE",
    reports: true,
    path: "/workspaces/{workspaceId}/shared-reports/{sharedReportId}",
    input: withWorkspace({ sharedReportId: id("shared report") }),
  },
];

/** Webhooks — the way to trigger automation from Clockify events. */
export const webhookTools: ToolDef[] = [
  {
    name: "list-clockify-webhooks",
    description: "Lists the webhooks on a workspace.",
    path: "/workspaces/{workspaceId}/webhooks",
    input: withWorkspace(),
  },
  {
    name: "create-clockify-webhook",
    description:
      "Creates a webhook so Clockify calls a URL when something happens — for " +
      "example NEW_INVOICE or TIME_ENTRY_UPDATED. Returns a signing token; keep it.",
    method: "POST",
    path: "/workspaces/{workspaceId}/webhooks",
    body: ["name", "url", "triggerSource", "triggerSourceType", "webhookEvent"],
    input: withWorkspace({
      name: z.string().describe("A name for the webhook."),
      url: z.string().describe("The URL Clockify should call."),
      webhookEvent: z
        .string()
        .describe(
          "Event name, e.g. NEW_TIME_ENTRY, TIME_ENTRY_UPDATED, NEW_INVOICE, " +
            "NEW_PROJECT, USER_JOINED_WORKSPACE.",
        ),
      triggerSourceType: z
        .string()
        .optional()
        .describe("What scopes it, e.g. WORKSPACE_ID, PROJECT_ID, USER_ID."),
      triggerSource: z
        .array(z.string())
        .optional()
        .describe("IDs matching the trigger source type."),
    }),
  },
  {
    name: "delete-clockify-webhook",
    description: "Deletes a webhook.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/webhooks/{webhookId}",
    input: withWorkspace({ webhookId: id("webhook") }),
  },
  {
    name: "get-clockify-webhook-statuses",
    description: "Shows recent delivery statuses for a webhook — use when one seems dead.",
    path: "/workspaces/{workspaceId}/webhooks/{webhookId}/statuses",
    input: withWorkspace({ webhookId: id("webhook") }),
  },
  {
    name: "regenerate-clockify-webhook-token",
    description: "Issues a new signing token for a webhook, invalidating the old one.",
    method: "PATCH",
    path: "/workspaces/{workspaceId}/webhooks/{webhookId}/token",
    input: withWorkspace({ webhookId: id("webhook") }),
  },
];

/** Custom fields. Paid feature. */
export const customFieldTools: ToolDef[] = [
  {
    name: "list-clockify-custom-fields",
    description: "Lists a workspace's custom fields. Paid feature.",
    path: "/workspaces/{workspaceId}/custom-fields",
    query: ["page", "pageSize"],
    input: withWorkspace(page),
  },
  {
    name: "list-clockify-project-custom-fields",
    description: "Lists the custom fields configured on a project.",
    path: "/workspaces/{workspaceId}/projects/{projectId}/custom-fields",
    query: ["page", "pageSize"],
    input: withWorkspace({ projectId: id("project"), ...page }),
  },
  {
    name: "set-clockify-user-custom-field",
    description: "Sets a custom field's value on a workspace member.",
    method: "PUT",
    path: "/workspaces/{workspaceId}/users/{userId}/custom-field/{customFieldId}/value",
    body: ["value"],
    input: withWorkspace({
      userId: id("user"),
      customFieldId: id("custom field"),
      value: z.string().describe("The value to store."),
    }),
  },
];

/** Approvals. Paid feature. */
export const approvalTools: ToolDef[] = [
  {
    name: "list-clockify-approval-requests",
    description: "Lists timesheet approval requests. Paid feature.",
    path: "/workspaces/{workspaceId}/approval-requests",
    query: ["status", "page", "pageSize"],
    input: withWorkspace({
      status: z
        .enum(["PENDING", "APPROVED", "WITHDRAWN_SUBMISSION", "WITHDRAWN_APPROVAL", "REJECTED"])
        .optional()
        .describe("Filter by status."),
      ...page,
    }),
  },
  {
    name: "submit-clockify-approval",
    description: "Submits the current period for approval.",
    method: "POST",
    path: "/workspaces/{workspaceId}/approval-requests/{type}",
    body: ["start"],
    input: withWorkspace({
      type: z.enum(["WEEKLY", "MONTHLY", "SEMI_MONTHLY"]).describe("Approval period type."),
      start: z.string().optional().describe("Start of the period, ISO 8601."),
    }),
  },
  {
    name: "decide-clockify-approval",
    description: "Approves, rejects or withdraws an approval request.",
    method: "PATCH",
    path: "/workspaces/{workspaceId}/approval-requests/{approvalRequestId}",
    body: ["state", "note"],
    input: withWorkspace({
      approvalRequestId: id("approval request"),
      state: z
        .enum(["APPROVED", "REJECTED", "WITHDRAWN_SUBMISSION", "WITHDRAWN_APPROVAL"])
        .describe("The decision."),
      note: z.string().optional().describe("Reason, shown to the submitter."),
    }),
  },
];

/** Time off, policies, balances and holidays. Paid feature. */
export const timeOffTools: ToolDef[] = [
  {
    name: "list-clockify-time-off-policies",
    description: "Lists time off policies. Paid feature.",
    path: "/workspaces/{workspaceId}/time-off/policies",
    query: ["page", "pageSize"],
    input: withWorkspace(page),
  },
  {
    name: "create-clockify-time-off-policy",
    description: "Creates a time off policy.",
    method: "POST",
    path: "/workspaces/{workspaceId}/time-off/policies",
    body: ["name", "allowNegativeBalance", "archived", "automaticAccrual", "timeUnit", "everyoneIncludingNew"],
    input: withWorkspace({
      name: z.string().describe("Policy name, e.g. Annual leave."),
      timeUnit: z.enum(["DAYS", "HOURS"]).optional().describe("How it is counted."),
      allowNegativeBalance: z.boolean().optional().describe("Allow going below zero."),
      everyoneIncludingNew: z.boolean().optional().describe("Apply to all members."),
    }),
  },
  {
    name: "list-clockify-time-off-requests",
    description: "Lists time off requests across the workspace.",
    method: "POST",
    path: "/workspaces/{workspaceId}/time-off/requests",
    body: ["start", "end", "statuses", "users", "page", "pageSize"],
    input: withWorkspace({
      start: z.string().optional().describe("Range start, ISO 8601."),
      end: z.string().optional().describe("Range end, ISO 8601."),
      statuses: z
        .array(z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]))
        .optional()
        .describe("Filter by status."),
      ...page,
    }),
  },
  {
    name: "create-clockify-time-off-request",
    description: "Requests time off under a policy.",
    method: "POST",
    path: "/workspaces/{workspaceId}/time-off/policies/{policyId}/requests",
    body: ["timeOffPeriod", "note"],
    input: withWorkspace({
      policyId: id("policy"),
      timeOffPeriod: z
        .object({
          period: z.object({
            start: z.string().describe("Start, ISO 8601."),
            end: z.string().describe("End, ISO 8601."),
          }),
        })
        .describe("The period being requested."),
      note: z.string().optional().describe("Reason."),
    }),
  },
  {
    name: "decide-clockify-time-off-request",
    description: "Approves or rejects a time off request.",
    method: "PATCH",
    path: "/workspaces/{workspaceId}/time-off/policies/{policyId}/requests/{requestId}",
    body: ["status", "note"],
    input: withWorkspace({
      policyId: id("policy"),
      requestId: id("request"),
      status: z.enum(["APPROVED", "REJECTED"]).describe("The decision."),
      note: z.string().optional().describe("Reason."),
    }),
  },
  {
    name: "get-clockify-time-off-balance",
    description: "Shows a user's remaining time off balance.",
    path: "/workspaces/{workspaceId}/time-off/balance/user/{userId}",
    query: ["page", "pageSize"],
    input: withWorkspace({ userId: id("user"), ...page }),
  },
  {
    name: "list-clockify-holidays",
    description: "Lists the workspace's holidays.",
    path: "/workspaces/{workspaceId}/holidays",
    query: ["page", "pageSize"],
    input: withWorkspace(page),
  },
  {
    name: "create-clockify-holiday",
    description: "Adds a holiday to the workspace calendar.",
    method: "POST",
    path: "/workspaces/{workspaceId}/holidays",
    body: ["name", "datePeriod", "everyoneIncludingNew"],
    input: withWorkspace({
      name: z.string().describe("Holiday name."),
      datePeriod: z
        .object({
          startDate: z.string().describe("First day, YYYY-MM-DD."),
          endDate: z.string().describe("Last day, YYYY-MM-DD."),
        })
        .describe("The dates it covers."),
      everyoneIncludingNew: z.boolean().optional().describe("Applies to all members."),
    }),
  },
  {
    name: "delete-clockify-holiday",
    description: "Removes a holiday.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/holidays/{holidayId}",
    input: withWorkspace({ holidayId: id("holiday") }),
  },
];

/** Scheduling. Paid feature. */
export const schedulingTools: ToolDef[] = [
  {
    name: "list-clockify-assignments",
    description: "Lists scheduled assignments across the workspace. Paid feature.",
    path: "/workspaces/{workspaceId}/scheduling/assignments/all",
    query: ["start", "end", "page", "pageSize"],
    input: withWorkspace({
      start: z.string().describe("Range start, ISO 8601."),
      end: z.string().describe("Range end, ISO 8601."),
      ...page,
    }),
  },
  {
    name: "create-clockify-assignment",
    description: "Schedules work for someone on a project.",
    method: "POST",
    path: "/workspaces/{workspaceId}/scheduling/assignments/recurring",
    body: ["userId", "projectId", "startDate", "endDate", "hoursPerDay", "note", "billable"],
    input: withWorkspace({
      userId: id("user"),
      projectId: id("project"),
      startDate: z.string().describe("First day, ISO 8601."),
      endDate: z.string().describe("Last day, ISO 8601."),
      hoursPerDay: z.number().optional().describe("Hours a day to book."),
      note: z.string().optional().describe("Note on the assignment."),
      billable: z.boolean().optional().describe("Whether it is billable."),
    }),
  },
  {
    name: "delete-clockify-assignment",
    description: "Deletes a scheduled assignment.",
    method: "DELETE",
    path: "/workspaces/{workspaceId}/scheduling/assignments/recurring/{assignmentId}",
    input: withWorkspace({ assignmentId: id("assignment") }),
  },
  {
    name: "get-clockify-user-capacity",
    description: "Shows how much a user is booked over a period.",
    path: "/workspaces/{workspaceId}/scheduling/assignments/users/{userId}/totals",
    query: ["start", "end"],
    input: withWorkspace({
      userId: id("user"),
      start: z.string().describe("Range start, ISO 8601."),
      end: z.string().describe("Range end, ISO 8601."),
    }),
  },
];
