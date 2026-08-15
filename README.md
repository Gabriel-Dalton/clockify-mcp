# Clockify MCP

A Model Context Protocol server for [Clockify](https://clockify.me). It lets an
AI assistant read and write your time tracking: log work, start and stop running
timers, browse projects, clients and tasks, and build invoices out of billable
hours.

Built on the fork by [aslamanver](https://github.com/aslamanver). See
[NOTICE](./NOTICE) for attribution and the current licensing position.

## What it does

- **Running timers.** Start a timer and leave it running, stop it, ask what's
  running now.
- **Invoicing.** Draft an invoice for a client, put line items or imported time
  on it, export the PDF, record payments, track status.
- **Time entries.** Log, edit, duplicate, bulk edit and delete work, with
  partial updates that change only the fields you name.
- **The rest of the workspace.** Clients, projects, tasks, tags, expenses,
  reports, webhooks, custom fields, approvals, time off and scheduling.
- **Complete lists.** Paged endpoints are walked to the end and say so if they
  hit the cap, rather than silently returning the first page.
- **Correct URLs.** Query values are encoded, so a project called `R&D` or a
  timestamp with a `+02:00` offset can't quietly return the wrong data.
- **Errors you can act on.** A 401 says the key is wrong, a 403 says the plan
  doesn't cover it, a 404 says the ID doesn't exist — instead of one opaque
  string. Failures are flagged as errors rather than returned as ordinary text.
- **Tests** against the built output with a stubbed Clockify, so no API key or
  network is needed to verify a change.

## Tools

**Getting oriented**

| Tool | What it's for |
| --- | --- |
| `get-clockify-user` | Your profile, user ID, active workspace and timezone |
| `list-clockify-workspaces` | Every workspace the key can see |
| `list-clockify-projects` | Projects, optionally filtered by name |
| `list-clockify-tasks` | Every task on a project |
| `list-clockify-clients` | Clients in a workspace |

**Time**

| Tool | What it's for |
| --- | --- |
| `list-clockify-time-entries` | Entries in a date range |
| `create-clockify-time-entry` | Log a block of work that has finished |
| `update-clockify-time-entry` | Change one field without restating the rest |
| `delete-clockify-time-entry` | Remove an entry permanently |

**Timers**

| Tool | What it's for |
| --- | --- |
| `start-clockify-timer` | Start tracking now and leave it running |
| `stop-clockify-timer` | Stop the timer that's running |
| `get-clockify-running-timer` | What's running, and for how long |

**Invoicing**

| Tool | What it's for |
| --- | --- |
| `list-clockify-invoices` | Invoices, optionally filtered by status |
| `get-clockify-invoice` | One invoice with its line items |
| `create-clockify-invoice` | A draft invoice for a client |
| `set-clockify-invoice-status` | Record an invoice as sent or void |
| `record-clockify-invoice-payment` | Log a payment, which is what marks it paid |
| `delete-clockify-invoice` | Remove a draft invoice entirely |

### What invoicing can and can't do

Everything below was established against the live API, not read off the docs.

**It needs a paid Clockify plan.** Invoicing isn't on the free tier. Without it
the API answers 403 and these tools say so.

**Nothing here emails a client.** Clockify's API has no send endpoint. Setting an
invoice to `SENT` records that it went out; it does not deliver anything, which
is why these tools return `"delivered": false` rather than implying the client
has it.

**`itemType` is case-sensitive.** Line items take `Service` or `Product`.
`SERVICE` comes back as `Invoice item type with name SERVICE not found`, which
reads like a broken endpoint rather than a capitalisation problem.

**Importing time works by date range, not by entry.** `import-clockify-invoice-time`
bills a period, filtered by project, the way the UI does — you cannot hand it a
list of entry IDs. It also only imports time on projects belonging to **that
invoice's client**. Point it at another client's project and it succeeds while
importing nothing, which is the most confusing possible outcome.

**Duplicating is how you do recurring invoices.** A duplicate carries its line
items, note and client across intact. It inherits Clockify's last-used *number*,
which drifts, so set the number explicitly afterwards.

**PAID is not a status you can set.** Clockify answers *"Add payments to invoice
to change its status to paid"*. Record a payment instead and the status follows
on its own — full balance becomes PAID, less becomes PARTIALLY_PAID. Note the
field asymmetry: a payment is posted as `paymentDate` and read back as `date`.

**Currency and number are both required.** Clockify does not default either.
If you omit `currency` it is taken from the client; if you omit `number` the
next value in the workspace's existing series is worked out and used.

**Amounts are in minor units.** A CAD 400.00 invoice comes back as `40000`, and
quantities are in hundredths — `100` means one unit. Every amount is returned
both raw as `amountMinorUnits` and formatted as `amount`, because reported raw
a model will tell you an invoice is worth four hundred thousand dollars.

## Coverage

100 tools, covering the Clockify API end to end: time entries and timers,
invoicing and payments, projects, tasks, clients, tags, expenses, reports,
webhooks, custom fields, approvals, time off, holidays and scheduling.

Several of those areas are paid features. On a plan without them Clockify
answers 403 and the tool says so plainly — they are here so the capability
exists the day a plan changes, rather than being discovered missing at the
moment it is needed.

Anything not wrapped in a dedicated tool is still reachable:
`search-clockify-api` searches all 175 published operations by keyword, and
`call-clockify-api` calls any of them. That includes endpoints added after this
was written.

### Loading fewer tools

Every tool definition occupies context for a whole conversation. All modules
load by default; name the ones you want to trim that down:

```json
"env": {
  "CLOCKIFY_API_KEY": "your-key-here",
  "CLOCKIFY_MCP_MODULES": "core,time,invoices"
}
```

Modules: `core`, `time`, `invoices`, `projects`, `clients`, `tasks`, `tags`,
`members`, `expenses`, `reports`, `webhooks`, `customfields`, `approvals`,
`timeoff`, `scheduling`, `catalog`. `core` always loads, since everything else
needs the workspace and user IDs it supplies. An unrecognised name fails at
startup rather than quietly loading nothing.

## Setup

You need a Clockify API key: **Profile Settings → API → generate**.

The key can read and write everything in every workspace it can see, including
deleting time entries. Treat it like a password.

```json
{
  "mcpServers": {
    "clockify": {
      "command": "npx",
      "args": ["-y", "@gabriel-dalton/clockify-mcp"],
      "env": {
        "CLOCKIFY_API_KEY": "your-key-here"
      }
    }
  }
}
```

That block goes in your MCP client's config — `claude_desktop_config.json` for
Claude Desktop, `.mcp.json` for Claude Code, `mcp.json` for VS Code (which uses
`"servers"` rather than `"mcpServers"`), `~/.gemini/settings.json` for Gemini CLI.

### From source

```bash
git clone https://github.com/Gabriel-Dalton/clockify-mcp.git
cd clockify-mcp
npm install
npm run build
```

Then point your client at `node /path/to/clockify-mcp/build/index.js`.

## Development

```bash
npm run build      # compile to build/
npm test           # build, then run the suite
npm run typecheck  # types only, no output
npm run inspect    # MCP inspector against the built server
```

Tests stub `fetch` and assert on the requests that would have gone to Clockify,
so they need neither a key nor a network. Anything that talks to Clockify goes
through `src/clockify.ts`, which is where encoding, pagination and error
translation live — new tools should not call `fetch` directly.

## Contributing

Issues and pull requests welcome.

---

Unofficial. Not affiliated with Clockify or CAKE.com.
