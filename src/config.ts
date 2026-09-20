/*
 * config.ts — Identifiants Cloudflare PAR UTILISATEUR.
 * L'utilisateur ne fournit QUE son token API (une seule valeur à copier-coller).
 * L'ID de compte est déduit automatiquement du token via l'API Cloudflare
 * (GET /accounts), et mis en cache en mémoire pour éviter un aller-retour
 * réseau à chaque appel d'outil.
 */
import type { Request } from "express";

export interface CfConfig {
  apiToken: string;
  accountId: string;
  apiBase: string;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// Cache token -> accountId (mémoire, pas de secret stocké : juste l'ID de compte,
// qui n'est pas sensible). Se vide au redémarrage, se re-remplit à la première requête.
const accountIdCache = new Map<string, string>();

export function tokenFromRequest(req: Request): string {
  const authHeader = req.headers["authorization"];
  return typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
}

/** Résout automatiquement le premier compte Cloudflare accessible avec ce token. */
export async function resolveAccountId(apiToken: string): Promise<string | null> {
  if (accountIdCache.has(apiToken)) {
    return accountIdCache.get(apiToken)!;
  }
  try {
    const res = await fetch(`${CF_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const body = (await res.json()) as any;
    const accountId: string | undefined = body?.result?.[0]?.id;
    if (accountId) {
      accountIdCache.set(apiToken, accountId);
      return accountId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function configFromRequest(req: Request): Promise<CfConfig> {
  const apiToken = tokenFromRequest(req);
  const accountId = apiToken ? (await resolveAccountId(apiToken)) ?? "" : "";
  return { apiToken, accountId, apiBase: CF_API_BASE };
}

export function hasCredentials(cfg: CfConfig): boolean {
  return Boolean(cfg.apiToken);
}
