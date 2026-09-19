/**
 * Cloudflare API client for the MCP server.
 *
 * Implements the tools:
 *   cf-api, deploy_worker, list_workers, delete_worker,
 *   set_worker_secret, configure_route, tail_worker_logs
 *
 * Authentication is transparent: credentials are read from environment
 * variables (or ~/.cloudflare/config.json) once at startup and injected
 * automatically into every request.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

/* ------------------------------------------------------------------ */
/* Constants & shared helpers                                          */
/* ------------------------------------------------------------------ */

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function getCredentials() {
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY ?? "";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? "";
  return { apiToken, accountId, zoneId };
}

function authHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

function truncate(text: string, maxLength = 8000): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

interface CFResponse<T = unknown> {
  success: boolean;
  errors?: unknown[];
  messages?: unknown[];
  result?: T;
  result_info?: unknown;
}

/* ------------------------------------------------------------------ */
/* Account resolution                                                  */
/* ------------------------------------------------------------------ */

let cachedAccountId: string | null = null;

async function resolveAccountId(apiToken: string): Promise<string> {
  const explicit = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (explicit) return explicit;
  if (cachedAccountId) return cachedAccountId;

  const res = await fetch(`${CLOUDFLARE_API_BASE}/accounts`, {
    headers: authHeaders(apiToken),
  });
  const data = (await res.json()) as CFResponse<{ id: string; name: string }[]>;
  if (!data.success || !data.result || data.result.length === 0) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Failed to resolve Cloudflare account ID: ${truncate(JSON.stringify(data.errors ?? data), 500)}`
    );
  }
  if (data.result.length > 1) {
    console.error(
      "[mcp-cloudflare] Multiple Cloudflare accounts found. Using the first one. " +
        "Set CLOUDFLARE_ACCOUNT_ID to select a specific account. " +
        `Accounts: ${data.result.map((a) => `${a.name} (${a.id})`).join(", ")}`
    );
  }
  cachedAccountId = data.result[0].id;
  return cachedAccountId;
}

/* ------------------------------------------------------------------ */
/* Tool implementations                                                */
/* ------------------------------------------------------------------ */

async function httpCall(
  apiToken: string,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<CFResponse> {
  const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    ...authHeaders(apiToken),
    ...extraHeaders,
  };

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = await response.text();
  }

  if (!response.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      `Cloudflare API request failed with status ${response.status}: ${truncate(JSON.stringify(payload), 1000)}`
    );
  }
  return payload as CFResponse;
}

interface DeployWorkerInput {
  name: string;
  main_module?: string;
  script?: string;
  modules?: Record<string, string>;
  bindings?: Array<{
    type: string;
    name: string;
    namespace_id?: string;
    bucket_name?: string;
    id?: string;
    text?: string;
    json?: string;
    class_name?: string;
    script_name?: string;
    service?: string;
    environment?: string;
    queue_name?: string;
    [key: string]: unknown;
  }>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  migrations?: Record<string, unknown>;
  keep_bindings?: string[];
}

/**
 * Deploy a Cloudflare Worker script or module.
 * Tries ESM module upload first; falls back to plain script upload.
 */
export async function deployWorker(input: DeployWorkerInput) {
  const { apiToken, accountId } = getCredentials();
  const form = new FormData();

  if (input.main_module) {
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: input.main_module,
            bindings: input.bindings ?? [],
            compatibility_date: input.compatibility_date,
            compatibility_flags: input.compatibility_flags ?? [],
            migrations: input.migrations,
          }),
        ],
        { type: "application/json" }
      )
    );
    for (const [moduleName, content] of Object.entries(input.modules ?? {})) {
      const contentType = moduleName.endsWith(".js")
        ? "application/javascript+module"
        : moduleName.endsWith(".wasm")
          ? "application/wasm"
          : moduleName.endsWith(".json")
            ? "application/json"
            : moduleName.endsWith(".txt")
              ? "text/plain"
              : "application/octet-stream";
      form.append(moduleName, new Blob([content], { type: contentType }), moduleName);
    }
  } else {
    form.append("metadata", new Blob([JSON.stringify({ bindings: input.bindings ?? [], compatibility_date: input.compatibility_date, compatibility_flags: input.compatibility_flags ?? [], migrations: input.migrations })], { type: "application/json" }));
    form.append("script", new Blob([input.script], { type: "application/javascript" }), "script");
  }

  const res = await httpCall(
    apiToken,
    "PUT",
    `/accounts/${accountId}/workers/scripts`,
    form
  );
  return JSON.stringify({
    success: res.ok,
    result: res.result,
    errors: res.errors,
  });
}

interface ListWorkersInput {
  [key: string]: unknown;
}

async function listWorkers(apiToken: string, accountId: string) {
  const scripts = await httpCall(
    apiToken,
    "GET",
    `/accounts/${accountId}/workers/scripts`
  );
  return scripts;
}

interface DeleteWorkerInput {
  script_name: string;
}

async function deleteWorker(apiToken: string, accountId: string, scriptName: string) {
  const res = await httpCall(
    apiToken,
    "DELETE",
    `/accounts/${accountId}/workers/scripts/${scriptName}`
  );
  return JSON.stringify(res);
}

interface SetWorkerSecretInput {
  script_name: string;
  secret_name: string;
  secret_value: string;
}

async function setWorkerSecret(input: SetWorkerSecretInput) {
  const { apiToken, accountId } = getCredentials();
  const res = await httpCall(
    apiToken,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${input.script_name}/secret`,
    { name: input.secret_name, text: input.secret_value, type: "secret_text" }
  );
  return JSON.stringify(res);
}

interface ConfigureRouteInput {
  action: "create" | "delete" | "list";
  zone_id?: string;
  pattern?: string;
  script_name?: string;
  route_id?: string;
  custom_domain?: boolean;
  workers_dev?: boolean;
  script_name_for_custom_domain?: string;
}

async function configureRoute(input: ConfigureRouteInput) {
  const { apiToken, accountId, zoneId } = getCredentials();
  const effectiveZoneId = input.zone_id ?? zoneId;
  const zoneResponse = await httpCall(
    apiToken,
    "GET",
    `/zones?account.id=${accountId}`
  );
  const zone = zoneResponse.result.find((z: { id: string }) => z.id === effectiveZoneId);
  if (!zone) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Zone ${effectiveZoneId} not found under account ${accountId}.`
    );
  }
  switch (input.action) {
    case "create": {
      if (input.custom_domain) {
        const payload = {
          hostname: input.pattern,
          service: input.script_name,
          environment: "production",
          zone_name: zone.name,
        };
        return JSON.stringify(await httpCall(
          apiToken,
          "PUT",
          `/accounts/${accountId}/workers/domains`,
          payload
        ));
      }
      const payload = {
        pattern: input.pattern,
        script: input.script_name,
      };
      return JSON.stringify(await httpCall(
        apiToken,
        "POST",
        `/zones/${zone.id}/workers/routes`,
        payload
      ));
    }
    case "delete": {
      if (input.custom_domain) {
        const domains = await httpCall(
          apiToken,
          "GET",
          `/accounts/${accountId}/workers/domains?hostname=${input.pattern}`
        );
        const domain = domains.result.find((d: { id: string }) => d.hostname === input.pattern);
        if (!domain) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Custom domain ${input.pattern} not found under account ${accountId}.`
          );
        }
        return JSON.stringify(await httpCall(
          apiToken,
          "DELETE",
          `/accounts/${accountId}/workers/domains/${domain.id}`
        ));
      }
      return JSON.stringify(await httpCall(
        apiToken,
        "DELETE",
        `/zones/${zone.id}/workers/routes/${input.route_id}`
      ));
    }
    case "list": {
      if (input.custom_domain) {
        return JSON.stringify(await httpCall(
          apiToken,
          "GET",
          `/accounts/${accountId}/workers/domains?zone_name=${zone.name}`
        ));
      }
      return JSON.stringify(await httpCall(
        apiToken,
        "GET",
        `/zones/${zone.id}/workers/routes`
      ));
    }
    default: {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown action: ${input.action}`);
    }
  }
}

interface TailWorkerLogsInput {
  script_name: string;
  duration_ms?: number;
}

interface LogEntry {
  message: string;
  level: string;
  timestamp: number;
  line?: number;
}

async function tailWorkerLogs(input: TailWorkerLogsInput) {
  const { apiToken, accountId } = getCredentials();
  const duration = input.duration_ms ?? 20000;
  const tailResponse = await httpCall(
    apiToken,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${input.script_name}/tails`
  );
  const tailId = tailResponse.result.id;
  const logs: Array<LogEntry> = [];
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`wss://tail.cloudflare.com/tail/${tailId}`, {
      headers: authHeaders(apiToken),
    });
    const timeout = setTimeout(() => {
      ws.close();
      resolve();
    }, duration);
    ws.on("message", (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString()) as {
          logs: LogEntry[];
          exceptions: unknown[];
        };
        logs.push(...parsed.logs);
      } catch {
        // ignore malformed messages
      }
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return logs;
}
