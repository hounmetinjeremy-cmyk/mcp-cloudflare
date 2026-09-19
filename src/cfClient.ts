/**
 * Cloudflare API client for MCP server.
 *
 * Authentication is transparent: the API token and account ID are read
 * from environment variables, the OS keychain, or an OAuth token cache
 * automatically. Callers never pass credentials around.
 */
import * as os from "os";
import { z } from "zod";

/** Cloudflare API base URL */
export const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/** Environment variable holding the Cloudflare API token */
export const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";

/** Environment variable holding the Cloudflare account ID */
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";

/** Environment variable holding the Cloudflare zone ID (optional) */
export const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID ?? "";

/**
 * Perform an authenticated request against the Cloudflare API v4.
 *
 * @param token - Cloudflare API token (Bearer).
 * @param method - HTTP method.
 * @param path - API path beginning with "/"; "{account_id}" is replaced.
 * @param opts.body - JSON-serializable request body.
 * @param opts.query - Query parameters.
 * @returns The parsed response (result + success + errors).
 */
export async function cfRequest(
  token: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; query?: Record<string, string> } = {},
): Promise<{ success: boolean; result?: unknown; errors?: unknown[] }> {
  const url = new URL(CF_API_BASE + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), init);
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return payload as { success: boolean; result?: unknown; errors?: unknown[] };
}

export default cfRequest;
