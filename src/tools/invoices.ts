import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { guard, ok } from "../response.js";
import { toClockifyDate } from "../time.js";

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
            order: item.order,
            description: item.description,
            // Quantity is in hundredths: 100 means one unit.
            quantity:
              typeof item.quantity === "number" ? item.quantity / 100 : item.quantity,
            unitPrice: formatMoney(item.unitPrice, invoice.currency),
            amount: formatMoney(item.amount, invoice.currency),
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
          .describe(
            "Currency code, e.g. CAD. Clockify requires one; if omitted it is " +
              "taken from the client's own currency.",
          ),
        number: z
          .string()
          .optional()
          .describe(
            "Invoice number. Clockify requires one and does not assign it; if " +
              "omitted, the next number in the workspace's existing series is used.",
          ),
        note: z.string().optional().describe("Note shown on the invoice."),
      },
    },
    (input) =>
      guard(async () => {
        // Clockify rejects the create with "Currency is required" rather than
        // falling back to the workspace default, so resolve it from the client.
        let currency = input.currency;
        if (!currency) {
          const clientRecord = await client.request<any>(
            buildPath`/workspaces/${input.workspaceId}/clients/${input.clientId}`,
          );
          currency = clientRecord?.currencyCode;
          if (!currency) {
            throw new Error(
              "Clockify requires a currency on an invoice, and this client has " +
                "none set. Pass `currency` explicitly, e.g. CAD.",
            );
          }
        }

        // Clockify requires a number too, and does not generate one.
        const number =
          input.number ??
          (await nextInvoiceNumber(client, input.workspaceId));

        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices`,
          {
            method: "POST",
            body: {
              clientId: input.clientId,
              issuedDate: toClockifyDate("issueDate", input.issueDate),
              dueDate: toClockifyDate("dueDate", input.dueDate),
              currency,
              number,
              note: input.note,
            },
          },
        );
        return ok({
          ...summariseInvoice(invoice),
          created: true,
          currency: invoice.currency ?? currency,
        });
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
        // The status lives on its own sub-resource; PATCHing the invoice
        // itself answers 405.
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/status`,
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

  registerDelete(server, client);
}

/**
 * Works out the next number in a workspace's invoice series.
 *
 * Numbers are free text in Clockify, so this reads the existing ones, takes
 * the highest trailing integer, and reuses that entry's prefix — turning
 * INV11 into INV12 rather than starting a second series alongside it.
 */
export function nextNumberFrom(numbers: string[]): string {
  let best: { prefix: string; value: number } | null = null;

  for (const raw of numbers) {
    const match = /^(.*?)(\d+)$/.exec(String(raw ?? "").trim());
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (!best || value > best.value) best = { prefix: match[1], value };
  }

  if (!best) return "INV1";
  return `${best.prefix}${best.value + 1}`;
}

async function nextInvoiceNumber(
  client: ClockifyClient,
  workspaceId: string,
): Promise<string> {
  const result = await client.request<any>(
    buildPath`/workspaces/${workspaceId}/invoices`,
    { query: { page: 1, "page-size": 200 } },
  );
  const invoices = Array.isArray(result) ? result : (result?.invoices ?? []);
  return nextNumberFrom(invoices.map((i: any) => i.number));
}

/**
 * Clockify returns money in minor units — a CAD 400.00 invoice comes back as
 * 40000. Reported raw, a model will tell you an invoice is worth four hundred
 * thousand dollars, so every amount is paired with a formatted figure.
 */
export function formatMoney(minorUnits: unknown, currency?: string): string | null {
  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return null;
  const major = (minorUnits / 100).toFixed(2);
  return currency ? `${currency} ${major}` : major;
}

/** Registered last so it reads as the end of the invoice lifecycle. */
function registerDelete(server: McpServer, client: ClockifyClient) {
  server.registerTool(
    "delete-clockify-invoice",
    {
      description:
        "Permanently deletes an invoice. Clockify only allows this while it is " +
        "still a draft — once sent, void it with set-clockify-invoice-status " +
        "instead, which keeps the number in the series.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to delete."),
      },
    },
    (input) =>
      guard(async () => {
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}`,
          { method: "DELETE" },
        );
        return ok({ deleted: true, invoiceId: input.invoiceId });
      }),
  );
}

function summariseInvoice(invoice: any) {
  const amount = invoice.amount ?? invoice.total;
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status ?? invoice.invoiceStatus,
    clientId: invoice.clientId,
    clientName: invoice.clientName,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    amountMinorUnits: amount,
    amount: formatMoney(amount, invoice.currency),
  };
}
