/**
 * Thin, typed wrapper around the Clockify v1 REST API.
 *
 * Everything that talks to Clockify goes through here so that URL encoding,
 * pagination and error reporting behave the same way for every tool.
 */

export const CLOCKIFY_API_BASE = "https://api.clockify.me/api/v1";

/** Reports live on their own host, not under the main API base. */
export const CLOCKIFY_REPORTS_BASE = "https://reports.api.clockify.me/v1";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Send to the reports host instead of the main API. */
  reports?: boolean;
}

/**
 * An error carrying the HTTP status, so callers can distinguish "your key is
 * wrong" (401) from "your plan doesn't include this" (403) from "no such
 * workspace" (404). The upstream server collapsed all of these into one
 * opaque string.
 */
export class ClockifyError extends Error {
  readonly status: number;
  readonly path: string;
  readonly responseBody: string;

  constructor(status: number, path: string, responseBody: string) {
    super(ClockifyError.describe(status, path, responseBody));
    this.name = "ClockifyError";
    this.status = status;
    this.path = path;
    this.responseBody = responseBody;
  }

  private static describe(status: number, path: string, body: string): string {
    const detail = body.trim().slice(0, 500);
    switch (status) {
      case 401:
        return "Clockify rejected the API key (401). Check CLOCKIFY_API_KEY in your MCP client config.";
      case 403:
        return `Clockify refused this request (403). The key is valid but lacks permission, or the workspace plan does not include this feature. Path: ${path}. ${detail}`;
      case 404:
        return `Clockify has no such resource (404): ${path}. Check the IDs came from a list tool and belong to this workspace.`;
      case 429:
        return "Clockify rate limit hit (429). Wait a moment and retry.";
      default:
        return `Clockify request failed (${status}) for ${path}. ${detail}`;
    }
  }
}

/** Builds a path with every segment encoded, so IDs cannot break out of it. */
export function buildPath(
  strings: TemplateStringsArray,
  ...values: string[]
): string {
  return strings.reduce(
    (acc, part, i) =>
      acc + part + (i < values.length ? encodeURIComponent(values[i]) : ""),
    "",
  );
}

/** Encodes a query object, dropping empty values rather than sending `name=`. */
export function buildQuery(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export interface ClockifyClientOptions {
  apiKey?: string;
  baseUrl?: string;
  reportsUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export class ClockifyClient {
  private readonly baseUrl: string;
  private readonly reportsUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey?: string;

  constructor(options: ClockifyClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? CLOCKIFY_API_BASE;
    this.reportsUrl = options.reportsUrl ?? CLOCKIFY_REPORTS_BASE;
    this.userAgent = options.userAgent ?? "clockify-mcp";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        "Missing Clockify API key. Set CLOCKIFY_API_KEY in your MCP client config " +
          "(Clockify → Profile Settings → API → generate).",
      );
    }

    const base = options.reports ? this.reportsUrl : this.baseUrl;
    const url = base + path + buildQuery(options.query);
    const method = options.method ?? "GET";

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "User-Agent": this.userAgent,
          Accept: "application/json",
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error: any) {
      throw new Error(
        `Could not reach Clockify (${method} ${path}): ${error?.message ?? error}`,
      );
    }

    if (!response.ok) {
      throw new ClockifyError(response.status, path, await response.text());
    }

    if (response.status === 204) return {} as T;

    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  /** Fetches a binary body, such as an invoice PDF export. */
  async requestBinary(path: string, options: RequestOptions = {}): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error(
        "Missing Clockify API key. Set CLOCKIFY_API_KEY in your MCP client config.",
      );
    }

    const url = this.baseUrl + path + buildQuery(options.query);
    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": this.userAgent,
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new ClockifyError(response.status, path, await response.text());
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Walks every page of a paginated collection.
   *
   * Clockify pages silently — a caller that ignores pagination gets a
   * confidently incomplete list, which is the worst possible answer to give a
   * model. `maxPages` bounds the walk so a huge workspace cannot hang a tool.
   */
  async paginate<T>(
    path: string,
    options: RequestOptions & { pageSize?: number; maxPages?: number } = {},
  ): Promise<{ items: T[]; truncated: boolean }> {
    const pageSize = options.pageSize ?? 200;
    const maxPages = options.maxPages ?? 25;
    const items: T[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.request<T[]>(path, {
        ...options,
        query: { ...options.query, page, "page-size": pageSize },
      });
      if (!Array.isArray(batch)) break;
      items.push(...batch);
      if (batch.length < pageSize) {
        return { items, truncated: false };
      }
    }

    return { items, truncated: true };
  }
}
