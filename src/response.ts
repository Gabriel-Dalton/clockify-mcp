import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Renders a tool result as JSON text content. */
export function ok(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Renders a failure. `isError` is set so MCP clients can tell a failed call
 * from a call that succeeded and happened to return the word "Error" — the
 * upstream server returned both as plain text.
 */
export function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** Runs a tool body, turning thrown errors into a proper error result. */
export async function guard(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error: any) {
    return fail(error?.message ?? String(error));
  }
}
