/**
 * Thin Graph API client for the Meta Marketing API.
 *
 * Uses fetch (not facebook-nodejs-business-sdk) so the API version is
 * centralised, errors are mapped in one place, and tests can inject responses.
 */

export const DEFAULT_GRAPH_API_VERSION = "v26.0";

export function graphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
}

export function graphApiBase(): string {
  return `https://graph.facebook.com/${graphApiVersion()}`;
}

export type GraphFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ClientState = {
  fetchImpl: GraphFetch;
  accessToken?: string;
};

const state: ClientState = {
  fetchImpl: globalThis.fetch.bind(globalThis),
};

/** Test hook. Production code never needs to call this. */
export function configureMetaGraph(opts: { fetch?: GraphFetch; accessToken?: string | undefined }): void {
  if (opts.fetch) state.fetchImpl = opts.fetch;
  if ("accessToken" in opts) state.accessToken = opts.accessToken;
}

/** Test hook. Restores the real fetch and clears an injected token. */
export function resetMetaGraph(): void {
  state.fetchImpl = globalThis.fetch.bind(globalThis);
  state.accessToken = undefined;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill in Meta Ads credentials - ` +
        `see README.md for the System User token setup.`,
    );
  }
  return value;
}

export function getAccessToken(): string {
  return state.accessToken ?? requiredEnv("META_ACCESS_TOKEN");
}

/**
 * Numeric ad account id with the `act_` prefix Graph expects.
 * Accepts `act_123` or `123`; defaults to META_AD_ACCOUNT_ID.
 */
export function getAdAccountId(accountId?: string): string {
  const raw = (accountId ?? requiredEnv("META_AD_ACCOUNT_ID")).trim();
  const numeric = raw.replace(/^act_/, "");
  if (!/^\d+$/.test(numeric)) {
    throw new Error(`Invalid Meta ad account id "${raw}". Use the numeric id, with or without an act_ prefix.`);
  }
  return `act_${numeric}`;
}

export function accountPath(accountId?: string, suffix = ""): string {
  const base = getAdAccountId(accountId);
  return suffix ? `${base}/${suffix}` : base;
}

export class MetaGraphError extends Error {
  readonly code: number;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;
  readonly type?: string;
  readonly userTitle?: string;
  readonly userMessage?: string;
  readonly raw: unknown;

  constructor(message: string, fields: {
    code: number;
    errorSubcode?: number;
    fbtraceId?: string;
    type?: string;
    userTitle?: string;
    userMessage?: string;
    raw: unknown;
  }) {
    super(message);
    this.name = "MetaGraphError";
    this.code = fields.code;
    this.errorSubcode = fields.errorSubcode;
    this.fbtraceId = fields.fbtraceId;
    this.type = fields.type;
    this.userTitle = fields.userTitle;
    this.userMessage = fields.userMessage;
    this.raw = fields.raw;
  }
}

export type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
};

/**
 * Turn a Graph API error payload into a message an assistant can act on.
 * Handles the common token / checkpoint / permission / policy cases.
 */
export function formatGraphError(body: GraphErrorBody, httpStatus?: number): string {
  const err = body.error ?? {};
  const code = err.code ?? httpStatus ?? 0;
  const sub = err.error_subcode;
  const title = err.error_user_title;
  const userMsg = err.error_user_msg;
  const apiMsg = err.message ?? "Unknown Graph API error";

  const lines: string[] = [];
  if (title) lines.push(`${title}.`);
  if (userMsg) lines.push(userMsg);
  if (!userMsg) lines.push(apiMsg);
  lines.push(`Graph error code ${code}${sub != null ? `, subcode ${sub}` : ""}${err.type ? ` (${err.type})` : ""}.`);

  const checkpoint = code === 459 || sub === 459;
  const expired = code === 190 || code === 102 || sub === 463 || sub === 467;

  if (checkpoint) {
    lines.push(
      "Action: the person (or user-token) behind this call is checkpointed. Log in at facebook.com or m.facebook.com and complete the security prompt, then generate a new token.",
      "Prefer a Business Manager System User token so personal login checkpoints do not break API access. See README.md (System User setup).",
    );
  } else if (expired) {
    lines.push(
      "Action: META_ACCESS_TOKEN is expired, revoked, or invalid. In Business Settings > Users > System Users, generate a new token with ads_management, ads_read, and business_management (plus pages_show_list, pages_read_engagement, pages_manage_ads for creatives).",
    );
  } else if (code === 10 || (code >= 200 && code < 300)) {
    lines.push(
      "Action: the token is missing a permission, or the System User is not assigned this asset. Assign the ad account, Page, and pixel to the System User in Business Settings.",
      "ads_management / pages_* Advanced Access needs App Review when the app is Live or when you manage other businesses' accounts. Own-business System Users often work in Development mode without review.",
    );
  } else if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80000 || code === 80004) {
    lines.push("Action: rate limited. Wait and retry; reduce concurrent writes.");
  } else if (code === 368) {
    lines.push("Action: Meta temporarily blocked this actor for a policy reason. Check Business Support Home and the account Quality tab before retrying.");
  } else if (code === 100 || title || userMsg) {
    lines.push(
      "Action: the request was rejected (invalid parameter or ads policy). Read error_user_title / error_user_msg above, fix the field or creative, and retry. Policy rejections cannot be overridden via the API.",
    );
  }

  if (err.fbtrace_id) lines.push(`fbtrace_id: ${err.fbtrace_id}`);
  return lines.filter(Boolean).join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Graph wants nested objects/arrays as JSON strings in form or query params. */
export function encodeGraphValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function appendParams(params: URLSearchParams, query?: Record<string, unknown>): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, encodeGraphValue(value));
  }
}

export async function graphRequest<T = unknown>(options: {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  form?: FormData;
}): Promise<T> {
  const method = options.method ?? "GET";
  const token = getAccessToken();

  const absolute = options.path.startsWith("http://") || options.path.startsWith("https://");
  const url = absolute
    ? new URL(options.path)
    : new URL(`${graphApiBase()}/${options.path.replace(/^\//, "")}`);

  appendParams(url.searchParams, options.query);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);

  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.form) {
    if (!options.form.has("access_token")) options.form.append("access_token", token);
    body = options.form;
  } else if (options.body && method !== "GET") {
    const params = new URLSearchParams();
    appendParams(params, options.body);
    body = params;
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  let response: Response;
  try {
    response = await state.fetchImpl(url, { method, headers, body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Meta Graph API request failed to reach ${url.origin}: ${message}`);
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Meta Graph API returned non-JSON (${response.status}): ${text.slice(0, 400)}`);
    }
  }

  if (!response.ok || (isPlainObject(parsed) && parsed.error)) {
    const graphBody = (isPlainObject(parsed) ? parsed : { error: { message: text } }) as GraphErrorBody;
    throw new MetaGraphError(formatGraphError(graphBody, response.status), {
      code: graphBody.error?.code ?? response.status,
      errorSubcode: graphBody.error?.error_subcode,
      fbtraceId: graphBody.error?.fbtrace_id,
      type: graphBody.error?.type,
      userTitle: graphBody.error?.error_user_title,
      userMessage: graphBody.error?.error_user_msg,
      raw: parsed,
    });
  }

  return parsed as T;
}

type GraphPage<T> = {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
};

export async function graphGetAll<T = Record<string, unknown>>(
  path: string,
  query: Record<string, unknown> = {},
  max = 100,
): Promise<T[]> {
  const items: T[] = [];
  let nextPath: string | null = path;
  let nextQuery: Record<string, unknown> | undefined = {
    ...query,
    limit: Math.min(Number(query.limit ?? 50), max, 200),
  };

  while (nextPath && items.length < max) {
    const page: GraphPage<T> = await graphRequest<GraphPage<T>>({
      path: nextPath,
      query: nextQuery,
    });
    items.push(...(page.data ?? []));
    if (page.paging?.next && items.length < max) {
      nextPath = page.paging.next;
      nextQuery = undefined;
    } else {
      nextPath = null;
    }
  }

  return items.slice(0, max);
}

/** Account currency major units -> Graph integer (cents for GBP/USD/EUR). */
export function toMinorUnits(amount: number): string {
  return String(Math.round(amount * 100));
}

export function fromMinorUnits(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}
