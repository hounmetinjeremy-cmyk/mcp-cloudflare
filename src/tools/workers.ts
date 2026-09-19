/*
 * tools/workers.ts — Coût zéro clic : déployer, lister, supprimer, sceller un secret.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CfConfig } from "../config.js";
import { cfRequest } from "../cf-client.js";

/**
 * Déploiement d'un Worker en module ES via PUT JSON
 * (endpoint officiel : PUT /accounts/{id}/workers/scripts/{script_name}, content-type multipart
 * à l'origine ; l'API accepte le format JSON 'metadata + main_module' encodé en multipart.
 * Pour rester simple et fiable, nous utilisons le format multipart via FormData.
 */
async function deployScript(cfg: CfConfig, name: string, code: string, bindings: any[], compatDate: string): Promise<any> {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: compatDate,
    bindings,
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "worker.js",
    new Blob([code], { type: "application/javascript+module" }),
    "worker.js",
  );

  return cfRequestRawForm(cfg, "PUT", `/accounts/${cfg.accountId}/workers/scripts/${encodeURIComponent(name)}`, form);
}

async function cfRequestRawForm(cfg: CfConfig, method: string, path: string, form: FormData): Promise<any> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.apiToken}` },
    body: form as any,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: res.ok, result: text, errors: res.ok ? [] : [{ code: res.status, message: text.slice(0, 2000) }], messages: [] };
  }
}

export function registerWorkersTools(server: McpServer, cfg: CfConfig): void {
  server.tool(
    "deploy_worker",
    "Déployer (ou mettre à jour) un Worker Cloudflare : publie le code, les bindings et la date de compatibilité en une seule commande. IMPORTANT : ce déploiement remplace TOUS les bindings — si le Worker a des secrets, incluez-les dans 'bindings' ou appelez ensuite set_worker_secret. Après le déploiement, le Worker n'est pas exposé sur workers.dev ni sur un domaine : appelez configure_route ou cf-api (POST /accounts/{id}/workers/scripts/{name}/subdomains {\"enabled\":true}).",
    {
      name: z.string().describe("Nom du Worker (ex: 'mon-worker')"),
      code: z.string().describe("Code JavaScript du Worker en module ES, ex: 'export default { fetch() { return new Response(\"ok\") } }'"),
      bindings: z.array(z.object({
        type: z.string().describe("Type de binding : 'secret_text' pour un secret, 'plain_text' pour une variable, 'kv_namespace', 'r2_bucket', 'd1', 'ai', etc."),
        name: z.string().describe("Nom de la variable dans le code du Worker (ex: 'API_KEY')"),
        text: z.string().optional().describe("Valeur pour secret_text / plain_text"),
        namespace_id: z.string().optional().describe("ID du namespace pour kv_namespace"),
        bucket_name: z.string().optional().describe("Nom du bucket pour r2_bucket"),
        id: z.string().optional().describe("ID pour d1"),
      })).optional().describe("Bindings du Worker (variables, secrets, KV, R2, D1...)"),
      compatDate: z.string().optional().describe("compatibility_date (défaut : '2024-09-23')"),
    },
    async ({ name, code, bindings, compatDate }) => {
      try {
        const result = await deployScript(cfg, name, code, bindings ?? [], compatDate ?? "2024-09-23");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ code: -2, message: String(e?.message ?? e) }], messages: [], result: null }, null, 2) }] };
      }
    },
  );

  server.tool(
    "list_workers",
    "Lister tous les Workers du compte avec leurs modifications et usages.",
    {},
    async () => {
      const res = await cfRequest(cfg, "GET", `/accounts/${cfg.accountId}/workers/scripts`);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    "delete_worker",
    "Supprimer définitivement un script Worker (destructif).",
    { name: z.string().describe("Nom du Worker à supprimer") },
    async ({ name }) => {
      const res = await cfRequest(cfg, "DELETE", `/accounts/${cfg.accountId}/workers/scripts/${encodeURIComponent(name)}`);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    "set_worker_secret",
    "Définir un secret sur un Worker sans le redéployer : PUT /accounts/{id}/workers/scripts/{name}/secrets (utile pour clés API, tokens, mots de passe). Le secret est immédiatement disponible sous 'env.NOM' dans le Worker.",
    {
      scriptName: z.string().describe("Nom du Worker"),
      secretName: z.string().describe("Nom du secret (ex: 'OPENAI_API_KEY')"),
      value: z.string().describe("Valeur du secret (jamais journalisée)"),
    },
    async ({ scriptName, secretName, value }) => {
      const res = await cfRequest(cfg, "PUT", `/accounts/${cfg.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`, {
        name: secretName,
        text: value,
        type: "secret_text",
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
