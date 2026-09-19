/*
 * tools/cf-api.ts — L'outil universel.
 * Liberté totale : n'importe quelle méthode, n'importe quel endpoint v4.
 * Référence des endpoints : https://developers.cloudflare.com/api/
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CfConfig } from "../config.js";
import { cfRequest } from "../cf-client.js";

export function registerCfApi(server: McpServer, cfg: CfConfig): void {
  server.tool(
    "cf-api",
    "Appel HTTP générique vers l'API Cloudflare v4 (GET/POST/PUT/PATCH/DELETE) : crée/configure/supprime n'importe quelle ressource (DNS, Workers, KV, R2, D1, Pages, zones...). Les chemins commençant par /accounts/{account_id} acceptent simplement '/accounts/...' — l'ID de compte est injecté automatiquement. Corps JSON : passer un objet ; corps brut (ex: valeur KV) : passer une chaîne. Enveloppe renvoyée : { success, result, errors, messages }.",
    {
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .describe("Méthode HTTP"),
      path: z
        .string()
        .describe(
          "Chemin de l'endpoint après /client/v4, ex: '/zones', '/accounts/.../workers/scripts', '/accounts/.../zones/{zone_id}/dns_records'. Le préfixe '/accounts/{account_id}' peut être abrégé en '/accounts/...'."
        ),
      body: z
        .any()
        .optional()
        .describe("Corps de la requête : objet (sérialisé en JSON) ou chaîne (envoyée brute)"),
      raw: z
        .boolean()
        .optional()
        .describe("Si true, renvoie le corps brut de la réponse (utile pour du texte non JSON)"),
    },
    async ({ method, path, body, raw }) => {
      if (!cfg.apiToken || !cfg.accountId) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              errors: [{ code: -1, message: "Identifiants Cloudflare absents du serveur. Définir CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID." }],
              messages: [],
              result: null,
            }, null, 2),
          }],
        };
      }
      try {
        const envelope = await cfRequest(cfg, method, path, body, raw === true);
        return {
          content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              errors: [{ code: -2, message: String(e?.message ?? e) }],
              messages: [],
              result: null,
            }, null, 2),
          }],
        };
      }
    },
  );
}
