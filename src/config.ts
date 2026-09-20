/*
 * config.ts — Identifiants Cloudflare PAR UTILISATEUR.
 * Chaque requête MCP porte le token de l'utilisateur qui l'a envoyée,
 * injecté par chat libre via customUserVars ({{CLOUDFLARE_API_TOKEN}},
 * {{CLOUDFLARE_ACCOUNT_ID}}). Rien n'est stocké ni partagé côté serveur :
 * un utilisateur ne peut jamais agir sur le compte Cloudflare d'un autre.
 */
import type { Request } from "express";

export interface CfConfig {
  apiToken: string;
  accountId: string;
  apiBase: string;
}

export function configFromRequest(req: Request): CfConfig {
  const authHeader = req.headers["authorization"];
  const apiToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

  const accountIdHeader = req.headers["x-cf-account-id"];
  const accountId = typeof accountIdHeader === "string" ? accountIdHeader.trim() : "";

  return {
    apiToken,
    accountId,
    apiBase: "https://api.cloudflare.com/client/v4",
  };
}

export function hasCredentials(cfg: CfConfig): boolean {
  return Boolean(cfg.apiToken);
}
