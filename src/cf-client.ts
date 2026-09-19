/*
 * cf-client.ts — Client HTTP Cloudflare v4.
 * Injecte l'Authorization: Bearer automatiquement et insère l'account_id
 * dans les chemins '/accounts/...' non qualifiés.
 * Renvoie TOUJOURS l'enveloppe standard Cloudflare { success, result, errors, messages }
 * afin que l'IA puisse lire l'erreur et se corriger seule (mode autonome).
 */
import type { CfConfig } from "./config.js";

export interface CfEnvelope {
  success: boolean;
  result: unknown;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  _http_status?: number;
}

export async function cfRequest(
  cfg: CfConfig,
  method: string,
  path: string,
  body?: unknown,
  raw = false,
): Promise<CfEnvelope> {
  let p = (path || "").trim();
  if (!p.startsWith("/")) p = "/" + p;

  // Injection transparente de l'account_id : /workers/scripts -> /accounts/{id}/workers/scripts
  if (cfg.accountId && !p.startsWith("/accounts/")) {
    p = `/accounts/${cfg.accountId}${p}`;
  }

  const url = `${cfg.apiBase}${p}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiToken}`,
  };

  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    if (typeof body === "string") {
      payload = body; // corps brut (KV, upload de module...)
    } else {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();

  if (raw) {
    return { success: res.ok, result: text, errors: [], messages: [], _http_status: res.status };
  }

  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object" && "success" in parsed) {
    parsed._http_status = res.status;
    return parsed as CfEnvelope;
  }

  return {
    success: res.ok,
    result: text || null,
    errors: res.ok
      ? []
      : [{ code: res.status, message: text?.slice(0, 2000) || "Réponse non JSON de l'API" }],
    messages: [],
    _http_status: res.status,
  };
}

/** GET pratique pour les tools. */
export function cfGet(cfg: CfConfig, path: string) {
  return cfRequest(cfg, "GET", path);
}
