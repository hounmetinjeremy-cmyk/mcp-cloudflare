/**
 * cfClient.ts — Bibliothèque cliente Cloudflare réutilisable.
 *
 * Ce module N'EST PAS câblé dans index.ts : il sert de bibliothèque pour
 * étendre le serveur (comptes, zones, DNS, KV, R2...) sans dupliquer le client.
 * Les outils actifs du serveur MCP sont ceux de src/tools/*.
 *
 * Différences vs la 1re version (corrigées) :
 *  - imports explicites (McpError + ErrorCode), plus de dépendance `ws`
 *    (WebSocket natif de Node 22), typage propre (plus d'erreurs TS).
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function getCredentials() {
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY ?? "";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? "";
  return { apiToken, accountId, zoneId };
}

function authHeaders(
  apiToken: string,
  contentType?: string,
): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${apiToken}` };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

function truncate(text: string, maxLength = 8000): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

interface CFResponse<T = any> {
  success: boolean;
  errors?: any[];
  messages?: any[];
  result?: T;
  result_info?: any;
}

async function httpCall(
  apiToken: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<CFResponse> {
  const url = `${CLOUDFLARE_API_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: { ...authHeaders(apiToken), ...(extraHeaders ?? {}) },
  };

  if (body !== undefined) {
    if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
      (init as any).body = body; // corps brut ou multipart (boundary géré par undici)
    } else {
      init.body = JSON.stringify(body);
      if (!extraHeaders?.["Content-Type"]) {
        (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    }
  }

  const response = await fetch(url, init);
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    payload = await response.text();
  }

  if (!response.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      `Cloudflare API request failed with status ${response.status}: ${truncate(
        JSON.stringify(payload),
        1000,
      )}`,
    );
  }
  return payload as CFResponse;
}

/* ------------------------------------------------------------------ */
/* Résolution du compte                                                */
/* ------------------------------------------------------------------ */

let cachedAccountId: string | null = null;

export async function resolveAccountId(apiToken: string): Promise<string> {
  const explicit = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (explicit) return explicit;
  if (cachedAccountId) return cachedAccountId;

  const res = await httpCall(apiToken, "GET", "/accounts");
  const accounts = (res.result ?? []) as Array<{ id: string; name: string }>;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Failed to resolve Cloudflare account ID: ${truncate(
        JSON.stringify(res.errors ?? res),
        500,
      )}`,
    );
  }
  if (accounts.length > 1) {
    console.error(
      "[mcp-cloudflare] Multiple Cloudflare accounts found. Using the first one. " +
        "Set CLOUDFLARE_ACCOUNT_ID to select a specific account. " +
        `Accounts: ${accounts.map((a) => `${a.name} (${a.id})`).join(", ")}`,
    );
  }
  cachedAccountId = accounts[0].id;
  return cachedAccountId;
}

/* ------------------------------------------------------------------ */
/* Déploiement de Workers (mono ou multi-modules ES)                   */
/* ------------------------------------------------------------------ */

export interface DeployWorkerInput {
  name: string;
  main_module?: string;
  script?: string;
  modules?: Record<string, string>;
  bindings?: Array<Record<string, unknown>>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  migrations?: Record<string, unknown>;
  keep_bindings?: string[];
}

export async function deployWorker(input: DeployWorkerInput): Promise<string> {
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
            keep_bindings: input.keep_bindings,
          }),
        ],
        { type: "application/json" },
      ),
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
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            bindings: input.bindings ?? [],
            compatibility_date: input.compatibility_date,
            compatibility_flags: input.compatibility_flags ?? [],
            migrations: input.migrations,
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append(
      "script",
      new Blob([input.script ?? ""], { type: "application/javascript" }),
      "script",
    );
  }

  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/workers/scripts/${encodeURIComponent(input.name)}`,
    { method: "PUT", headers: authHeaders(apiToken), body: form },
  );
  const payload: any = await res.json().catch(() => null);
  return JSON.stringify({ ok: res.ok, status: res.status, body: payload }, null, 2);
}

/* ------------------------------------------------------------------ */
/* Outils Workers                                                      */
/* ------------------------------------------------------------------ */

export async function listWorkers(): Promise<string> {
  const { apiToken, accountId } = getCredentials();
  const scripts = await httpCall(
    apiToken,
    "GET",
    `/accounts/${accountId}/workers/scripts`,
  );
  return JSON.stringify(scripts, null, 2);
}

export async function deleteWorker(scriptName: string): Promise<string> {
  const { apiToken, accountId } = getCredentials();
  const res = await httpCall(
    apiToken,
    "DELETE",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`,
  );
  return JSON.stringify(res, null, 2);
}

export interface SetWorkerSecretInput {
  script_name: string;
  secret_name: string;
  secret_value: string;
}

export async function setWorkerSecret(input: SetWorkerSecretInput): Promise<string> {
  const { apiToken, accountId } = getCredentials();
  const res = await httpCall(
    apiToken,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(input.script_name)}/secrets`,
    { name: input.secret_name, text: input.secret_value, type: "secret_text" },
  );
  return JSON.stringify(res, null, 2);
}

/* ------------------------------------------------------------------ */
/* Routes & domaines                                                   */
/* ------------------------------------------------------------------ */

export interface ConfigureRouteInput {
  action: "create" | "delete" | "list";
  zone_id?: string;
  pattern?: string;
  script_name?: string;
  route_id?: string;
  custom_domain?: boolean;
}

export async function configureRoute(input: ConfigureRouteInput): Promise<string> {
  const { apiToken, accountId, zoneId } = getCredentials();
  const effectiveZoneId = input.zone_id ?? zoneId;

  if (!effectiveZoneId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "zone_id requis (ou variable CLOUDFLARE_ZONE_ID). Lister les zones : cf-api GET /zones.",
    );
  }

  switch (input.action) {
    case "create": {
      if (input.custom_domain) {
        const payload = {
          hostname: input.pattern,
          service: input.script_name,
          environment: "production",
        };
        return JSON.stringify(
          await httpCall(
            apiToken,
            "PUT",
            `/accounts/${accountId}/workers/domains`,
            payload,
          ),
          null,
          2,
        );
      }
      const payload = { pattern: input.pattern, script: input.script_name };
      return JSON.stringify(
        await httpCall(
          apiToken,
          "POST",
          `/zones/${effectiveZoneId}/workers/routes`,
          payload,
        ),
        null,
        2,
      );
    }
    case "delete": {
      if (input.custom_domain) {
        const domains = await httpCall(
          apiToken,
          "GET",
          `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(input.pattern ?? "")}`,
        );
        const domain = (domains.result as any[] | undefined)?.find(
          (d: { id: string; hostname: string }) => d.hostname === input.pattern,
        );
        if (!domain) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Custom domain ${input.pattern} not found under account ${accountId}.`,
          );
        }
        return JSON.stringify(
          await httpCall(
            apiToken,
            "DELETE",
            `/accounts/${accountId}/workers/domains/${domain.id}`,
          ),
          null,
          2,
        );
      }
      if (!input.route_id) {
        throw new McpError(ErrorCode.InvalidRequest, "route_id requis pour supprimer une route.");
      }
      return JSON.stringify(
        await httpCall(
          apiToken,
          "DELETE",
          `/zones/${effectiveZoneId}/workers/routes/${input.route_id}`,
        ),
        null,
        2,
      );
    }
    case "list": {
      if (input.custom_domain) {
        return JSON.stringify(
          await httpCall(apiToken, "GET", `/accounts/${accountId}/workers/domains`),
          null,
          2,
        );
      }
      return JSON.stringify(
        await httpCall(apiToken, "GET", `/zones/${effectiveZoneId}/workers/routes`),
        null,
        2,
      );
    }
    default: {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown action: ${String((input as any).action)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Logs temps réel (API tail moderne : POST /tails → websocket_url)    */
/* ------------------------------------------------------------------ */

export interface TailWorkerLogsInput {
  script_name: string;
  duration_ms?: number;
}

export async function tailWorkerLogs(input: TailWorkerLogsInput): Promise<any[]> {
  const { apiToken, accountId } = getCredentials();
  const duration = input.duration_ms ?? 20000;

  const tailResponse = await httpCall(
    apiToken,
    "POST",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(input.script_name)}/tails`,
    {},
  );
  const wsUrl: string | undefined = (tailResponse.result as any)?.websocket_url;
  if (!wsUrl) {
    throw new McpError(
      ErrorCode.InternalError,
      "Aucune URL websocket renvoyée par l'API tail.",
    );
  }

  const logs: any[] = [];
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl); // WebSocket natif (Node 22+)
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
      resolve();
    }, duration);

    ws.onmessage = (event: any) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          logs?: any[];
          exceptions?: any[];
        };
        if (Array.isArray(parsed.logs)) logs.push(...parsed.logs);
        if (Array.isArray(parsed.exceptions)) {
          logs.push(...parsed.exceptions.map((e) => ({ level: "exception", ...e })));
        }
      } catch {
        // message malformé : ignoré
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        /* ignoré */
      }
    };
  });

  return logs;
}
