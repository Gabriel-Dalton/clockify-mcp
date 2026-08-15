import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { guard, ok } from "../response.js";

const workspaceId = z
  .string()
  .describe("Workspace ID, from list-clockify-workspaces.");

/**
 * Invoicing.
 *
 * Two things are worth knowing about this surface, and both are repeated in
 * the tool descriptions so a model reads them before acting:
 *
 * 1. Invoicing is a paid Clockify feature. On a plan without it the API
 *    answers 403, which ClockifyError reports as such.
 * 2. There is no endpoint that emails an invoice to a client. Marking an
 *    invoice SENT records that it went out; it does not deliver anything.
 *    Delivery is a separate step, outside Clockify.
 */
export function registerInvoiceTools(server: McpServer, client: ClockifyClient) {
  server.registerTool(
    "list-clockify-invoices",
    {
      description:
        "Lists invoices in a workspace, newest first. Requires a Clockify plan " +
        "that includes invoicing.",
      inputSchema: {
        workspaceId,
        statuses: z
          .array(z.enum(["UNSENT", "SENT", "PAID", "VOID", "OVERDUE", "PARTIALLY_PAID"]))
          .optional()
          .describe("Optional status filter."),
        page: z.number().min(1).default(1).describe("Page number, 1-based."),
        pageSize: z.number().min(1).max(200).default(50).describe("Invoices per page."),
      },
    },
    (input) =>
      guard(async () => {
        const result = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices`,
          {
            query: {
              statuses: input.statuses?.join(","),
              page: input.page,
              "page-size": input.pageSize,
            },
          },
        );
        const invoices = Array.isArray(result) ? result : (result.invoices ?? []);
        return ok({
          count: invoices.length,
          invoices: invoices.map(summariseInvoice),
        });
      }),
  );

  server.registerTool(
    "get-clockify-invoice",
    {
      description: "Retrieves one invoice in full, including its line items.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("Invoice ID, from list-clockify-invoices."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}`,
        );
        return ok({
          ...summariseInvoice(invoice),
          items: (invoice.items ?? []).map((item: any) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
          })),
          note: invoice.note,
        });
      }),
  );

  server.registerTool(
    "create-clockify-invoice",
    {
      description:
        "Creates a draft invoice for a client. It is created UNSENT and is not " +
        "delivered to anyone — use add-clockify-invoice-items to put billable " +
        "time on it, then set-clockify-invoice-status when it has actually been " +
        "sent. Requires a Clockify plan that includes invoicing.",
      inputSchema: {
        workspaceId,
        clientId: z.string().describe("Client ID, from list-clockify-clients."),
        issueDate: z.string().describe("Issue date, e.g. 2026-08-14."),
        dueDate: z.string().describe("Due date, e.g. 2026-09-13."),
        currency: z
          .string()
          .optional()
          .describe("Currency code, e.g. USD. Defaults to the workspace currency."),
        number: z
          .string()
          .optional()
          .describe("Invoice number. Clockify assigns the next one if omitted."),
        note: z.string().optional().describe("Note shown on the invoice."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices`,
          {
            method: "POST",
            body: {
              clientId: input.clientId,
              issuedDate: input.issueDate,
              dueDate: input.dueDate,
              currency: input.currency,
              number: input.number,
              note: input.note,
            },
          },
        );
        return ok({ created: true, ...summariseInvoice(invoice) });
      }),
  );

  server.registerTool(
    "add-clockify-invoice-items",
    {
      description:
        "Adds billable time entries to a draft invoice, turning tracked hours " +
        "into line items.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to add to."),
        timeEntryIds: z
          .array(z.string())
          .min(1)
          .describe("Time entry IDs, from list-clockify-time-entries."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/items`,
          { method: "POST", body: { timeEntryIds: input.timeEntryIds } },
        );
        return ok({ added: input.timeEntryIds.length, ...summariseInvoice(invoice) });
      }),
  );

  server.registerTool(
    "set-clockify-invoice-status",
    {
      description:
        "Changes an invoice's status — for example to SENT once you have " +
        "actually emailed it, or PAID when the money lands. This only records " +
        "the status in Clockify; it does not send anything to the client.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to update."),
        status: z
          .enum(["UNSENT", "SENT", "PAID", "VOID", "PARTIALLY_PAID"])
          .describe("The new status."),
      },
    },
    (input) =>
      guard(async () => {
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}`,
          { method: "PATCH", body: { invoiceStatus: input.status } },
        );
        return ok({
          invoiceId: input.invoiceId,
          status: input.status,
          delivered: false,
          note: "Status recorded in Clockify. Nothing was emailed to the client.",
        });
      }),
  );
}

function summariseInvoice(invoice: any) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status ?? invoice.invoiceStatus,
    clientId: invoice.clientId,
    clientName: invoice.clientName,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    amount: invoice.amount ?? invoice.total,
  };
}
