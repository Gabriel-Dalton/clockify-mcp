import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClockifyClient, buildPath } from "../clockify.js";
import { guard, ok } from "../response.js";
import { toClockifyDate } from "../time.js";
import { writeFile } from "node:fs/promises";

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
        "actually emailed it, or VOID to write it off. This only records the " +
        "status in Clockify; it does not send anything to the client. To mark " +
        "an invoice paid, use record-clockify-invoice-payment instead: Clockify " +
        "refuses a direct move to PAID.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to update."),
        status: z
          .enum(["UNSENT", "SENT", "VOID"])
          .describe("The new status. PAID is set by recording a payment."),
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

  server.registerTool(
    "add-clockify-invoice-item",
    {
      description:
        "Adds a line item to a draft invoice. Amounts are in normal units — " +
        "unitPrice 25 means 25.00.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to add to."),
        description: z.string().describe("The line's description."),
        quantity: z
          .number()
          .positive()
          .default(1)
          .describe("How many units. 1 for a flat fee, or the number of hours."),
        unitPrice: z.number().describe("Price per unit, e.g. 25 for 25.00."),
        itemType: z
          .enum(["Service", "Product"])
          .default("Service")
          .describe(
            "Clockify's item type. Case-sensitive — 'Service' works, 'SERVICE' " +
              "is rejected as not found.",
          ),
        applyTaxes: z
          .enum(["TAX1", "TAX2", "TAX1TAX2", "NONE"])
          .default("NONE")
          .describe("Which of the invoice's taxes apply to this line."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/items`,
          {
            method: "POST",
            body: {
              description: input.description,
              // Quantity is in hundredths and money in minor units.
              quantity: Math.round(input.quantity * 100),
              unitPrice: Math.round(input.unitPrice * 100),
              itemType: input.itemType,
              applyTaxes: input.applyTaxes,
            },
          },
        );
        return ok({ added: input.description, ...summariseInvoice(invoice) });
      }),
  );

  server.registerTool(
    "import-clockify-invoice-time",
    {
      description:
        "Bills tracked time onto a draft invoice — the proper way to invoice " +
        "hours rather than retyping a total. It works by date range and " +
        "project, not by picking individual entries: it imports the billable " +
        "time between `from` and `to`, the way the Clockify UI does. Only time " +
        "on projects belonging to the invoice's own client is imported; a " +
        "mismatch succeeds but silently brings in nothing.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The draft invoice to import into."),
        from: z.string().describe("Start of the period to bill, e.g. 2026-08-01."),
        to: z.string().describe("End of the period to bill, e.g. 2026-08-31."),
        projectIds: z
          .array(z.string())
          .optional()
          .describe("Restrict to these projects. Omit to include all of them."),
        groupType: z
          .enum(["SINGLE_ITEM", "GROUPED", "DETAILED"])
          .optional()
          .default("GROUPED")
          .describe(
            "SINGLE_ITEM puts the whole period on one line; GROUPED gives a " +
              "line per grouping; DETAILED lists every entry.",
          ),
        groupBy: z
          .enum(["USER", "PROJECT", "DATE"])
          .optional()
          .default("PROJECT")
          .describe("How to group the lines when groupType is GROUPED."),
        importExpenses: z
          .boolean()
          .optional()
          .default(false)
          .describe("Also bring in billable expenses for the period."),
        roundDurations: z
          .boolean()
          .optional()
          .default(false)
          .describe("Apply the workspace's rounding rules to the durations."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/items/import`,
          {
            method: "POST",
            body: {
              from: toClockifyDate("from", input.from),
              to: toClockifyDate("to", input.to),
              // Required by the endpoint even when it selects everything.
              projectFilter: {
                contains: "CONTAINS",
                ids: input.projectIds ?? [],
                status: "ACTIVE",
              },
              timeEntryGroupType: input.groupType,
              timeEntryPrimaryGroupBy: input.groupBy,
              importExpenses: input.importExpenses,
              roundTimeEntryDuration: input.roundDurations,
            },
          },
        );
        return ok({
          importedFrom: `${input.from} to ${input.to}`,
          ...summariseInvoice(invoice),
          items: (invoice.items ?? []).map((item: any) => ({
            description: item.description,
            quantity:
              typeof item.quantity === "number" ? item.quantity / 100 : item.quantity,
            amount: formatMoney(item.amount, invoice.currency),
            importType: item.importType,
            linkedEntries: (item.timeEntryIds ?? []).length,
          })),
        });
      }),
  );

  server.registerTool(
    "delete-clockify-invoice-item",
    {
      description:
        "Removes a line item from a draft invoice, addressed by its order number " +
        "(the `order` field on the item, not its position in a list).",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice."),
        order: z.number().describe("The item's order number."),
      },
    },
    (input) =>
      guard(async () => {
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/items/${String(input.order)}`,
          { method: "DELETE" },
        );
        return ok({ removed: input.order, invoiceId: input.invoiceId });
      }),
  );

  server.registerTool(
    "list-clockify-invoice-payments",
    {
      description: "Lists the payments recorded against an invoice.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice."),
      },
    },
    (input) =>
      guard(async () => {
        const payments = await client.request<any[]>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/payments`,
        );
        return ok(
          (payments ?? []).map((p) => ({
            id: p.id,
            amountMinorUnits: p.amount,
            amount: formatMoney(p.amount),
            date: p.date,
            note: p.note,
            author: p.author,
          })),
        );
      }),
  );

  server.registerTool(
    "delete-clockify-invoice-payment",
    {
      description:
        "Removes a payment from an invoice, which will move it back out of PAID.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice."),
        paymentId: z.string().describe("The payment to remove."),
      },
    },
    (input) =>
      guard(async () => {
        await client.request(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/payments/${input.paymentId}`,
          { method: "DELETE" },
        );
        return ok({ removed: input.paymentId, invoiceId: input.invoiceId });
      }),
  );

  server.registerTool(
    "get-clockify-invoice-settings",
    {
      description:
        "Retrieves the workspace's invoice defaults — labels, tax rates, the " +
        "next number and the standard note.",
      inputSchema: { workspaceId },
    },
    (input) =>
      guard(async () => {
        const settings = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/settings`,
        );
        return ok(settings);
      }),
  );

  server.registerTool(
    "duplicate-clockify-invoice",
    {
      description:
        "Copies an existing invoice, line items included, as a new draft — the " +
        "reliable way to raise this month's copy of a recurring invoice. The " +
        "copy keeps the original's dates, so set them with update-clockify-invoice.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to copy."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/duplicate`,
          { method: "POST" },
        );
        return ok({ duplicatedFrom: input.invoiceId, ...summariseInvoice(invoice) });
      }),
  );

  server.registerTool(
    "update-clockify-invoice",
    {
      description:
        "Changes an invoice's number, dates or client. Only the fields you pass " +
        "are changed; line items are left alone.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to change."),
        number: z.string().optional().describe("New invoice number."),
        issueDate: z.string().optional().describe("New issue date, e.g. 2026-09-08."),
        dueDate: z.string().optional().describe("New due date, e.g. 2026-09-18."),
        clientId: z.string().optional().describe("Move it to another client."),
        note: z.string().optional().describe("New note on the invoice."),
      },
    },
    (input) =>
      guard(async () => {
        const path = buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}`;
        const current = await client.request<any>(path);

        const invoice = await client.request<any>(path, {
          method: "PUT",
          body: {
            number: input.number ?? current.number,
            issuedDate: input.issueDate
              ? toClockifyDate("issueDate", input.issueDate)
              : current.issuedDate,
            dueDate: input.dueDate
              ? toClockifyDate("dueDate", input.dueDate)
              : current.dueDate,
            clientId: input.clientId ?? current.clientId,
            currency: current.currency,
            note: input.note ?? current.note,
          },
        });
        return ok(summariseInvoice(invoice));
      }),
  );

  server.registerTool(
    "export-clockify-invoice",
    {
      description:
        "Exports an invoice as a PDF and writes it to a file, so it can be " +
        "attached to an email. Returns the path and size.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice to export."),
        filePath: z
          .string()
          .describe("Where to write the PDF, e.g. C:/invoices/INV23.pdf."),
        locale: z
          .string()
          .optional()
          .default("en-US")
          .describe("Locale for formatting. Clockify requires one."),
      },
    },
    (input) =>
      guard(async () => {
        const pdf = await client.requestBinary(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/export`,
          { query: { userLocale: input.locale } },
        );
        await writeFile(input.filePath, pdf);
        return ok({
          path: input.filePath,
          bytes: pdf.byteLength,
          isPdf: pdf.subarray(0, 4).toString("ascii") === "%PDF",
        });
      }),
  );

  server.registerTool(
    "record-clockify-invoice-payment",
    {
      description:
        "Records a payment against an invoice. This is how an invoice becomes " +
        "PAID — setting the status directly is refused. A payment for the full " +
        "balance marks it PAID; a smaller one marks it PARTIALLY_PAID.",
      inputSchema: {
        workspaceId,
        invoiceId: z.string().describe("The invoice that was paid."),
        amount: z
          .number()
          .positive()
          .describe(
            "Amount in the invoice's currency, in major units — 1200 means " +
              "1,200.00, not twelve dollars.",
          ),
        paymentDate: z
          .string()
          .describe("When it was paid, e.g. 2026-08-13."),
        note: z.string().optional().describe("Optional note on the payment."),
      },
    },
    (input) =>
      guard(async () => {
        const invoice = await client.request<any>(
          buildPath`/workspaces/${input.workspaceId}/invoices/${input.invoiceId}/payments`,
          {
            method: "POST",
            body: {
              // Clockify holds money in minor units.
              amount: Math.round(input.amount * 100),
              // The field is `paymentDate` on the way in and `date` on the way
              // out; sending `date` is rejected as a missing paymentDate.
              paymentDate: toClockifyDate("paymentDate", input.paymentDate),
              note: input.note ?? "",
            },
          },
        );
        return ok({
          recorded: formatMoney(Math.round(input.amount * 100), invoice.currency),
          ...summariseInvoice(invoice),
          paid: formatMoney(invoice.paid, invoice.currency),
          balance: formatMoney(invoice.balance, invoice.currency),
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
