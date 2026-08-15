# Clockify MCP

A Model Context Protocol server for [Clockify](https://clockify.me). It lets an
AI assistant read and write your time tracking: log work, start and stop running
timers, browse projects, clients and tasks, and build invoices out of billable
hours.

Forked from [aslamanver/mcp_clockify](https://github.com/aslamanver/mcp_clockify),
which is where this started and where the tool naming comes from. See
[NOTICE](./NOTICE) for attribution and the current licensing position.

## What it does that the original didn't

- **Running timers.** Start a timer and leave it running, stop it, ask what's
  running now. The original could only log a block of work that had already
  finished.
- **Invoicing.** Create a draft invoice for a client, add billable time to it as
  line items, and track its status.
- **Clients.** List the clients in a workspace, so invoices have somewhere to go.
- **Partial updates.** Editing a time entry now changes only the fields you name.
  Previously every field was mandatory, so a small correction meant restating the
  whole entry.
- **Complete lists.** Task and project lists page through to the end and tell you
  if they hit the cap, rather than silently returning the first page.
- **Correct URLs.** Query values are encoded, so a project called `R&D` or a
  timestamp with a `+02:00` offset no longer quietly returns the wrong data.
- **Errors you can act on.** A 401 says the key is wrong, a 403 says the plan
  doesn't cover it, a 404 says the ID doesn't exist — instead of one opaque
  string. Failures are flagged as errors to the client rather than returned as
  ordinary text.
- **Tests.** 25 of them, running against the built output with a stubbed
  Clockify, so no API key or network is needed to verify a change.

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
| `set-clockify-invoice-status` | Record an invoice as sent, paid or void |
| `delete-clockify-invoice` | Remove a draft invoice entirely |

### What invoicing can and can't do

Everything below was established against the live API, not read off the docs.

**It needs a paid Clockify plan.** Invoicing isn't on the free tier. Without it
the API answers 403 and these tools say so.

**Nothing here emails a client.** Clockify's API has no send endpoint. Setting an
invoice to `SENT` records that it went out; it does not deliver anything, which
is why these tools return `"delivered": false` rather than implying the client
has it.

**Line items cannot be created through the public API.** `POST /invoices/{id}/items`
demands an `itemType` that resolves against a workspace lookup, and every value
tried comes back `Invoice item type with name … not found` — while line items
created in the UI carry `itemType: ""`, which that same endpoint rejects as
empty. There is therefore no tool here for adding line items; one would fail
every time. Duplicating an existing invoice is the working alternative, since a
duplicate carries its line items across intact.

**Currency and number are both required.** Clockify does not default either.
If you omit `currency` it is taken from the client; if you omit `number` the
next value in the workspace's existing series is worked out and used.

**Amounts are in minor units.** A CAD 400.00 invoice comes back as `40000`, and
quantities are in hundredths — `100` means one unit. Every amount is returned
both raw as `amountMinorUnits` and formatted as `amount`, because reported raw
a model will tell you an invoice is worth four hundred thousand dollars.

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

Issues and pull requests welcome. Fixes that also apply to the original are
worth sending [upstream](https://github.com/aslamanver/mcp_clockify/issues) too.

---

Unofficial. Not affiliated with Clockify or CAKE.com.
