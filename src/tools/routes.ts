/*
 * tools/routes.ts — Routage : lier un Worker à un domaine, zones, sous-domaine workers.dev.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CfConfig } from "../config.js";
import { cfRequest } from "../cf-client.js";

export function registerRoutesTools(server: McpServer, cfg: CfConfig): void {
  server.tool(
    "configure_route",
    "Lier (ou détacher) un Worker à un motif d'URL d'une zone. Mode upsert : si la route existe déjà pour ce motif, elle est mise à jour automatiquement. Si 'pattern' est fourni seul, la route est supprimée (worker non lié).",
    {
      zoneId: z.string().describe("ID de la zone (trouvable via cf-api GET /zones)"),
      pattern: z.string().describe("Motif d'URL, ex: 'api.exemple.com/*' ou '*.exemple.com/api/*'"),
      workerName: z.string().optional().describe("Nom du Worker à lier (si omis, la route est supprimée)"),
    },
    async ({ zoneId, pattern, workerName }) => {
      // Vérifier si la route existe déjà (upsert)
      const existing = await cfRequest(cfg, "GET", `/accounts/${cfg.accountId}/workers/routes`);
      let routeId: string | null = null;
      if (existing.success && Array.isArray(existing.result)) {
        const hit = (existing.result as any[]).find((r) => r.pattern === pattern);
        routeId = hit?.id ?? null;
      }

      if (!workerName) {
        if (!routeId) return { content: [{ type: "text", text: JSON.stringify({ success: true, result: "Aucune route à supprimer pour ce motif.", errors: [], messages: [] }, null, 2) }] };
        const del = await cfRequest(cfg, "DELETE", `/zones/${zoneId}/workers/routes/${routeId}`);
        return { content: [{ type: "text", text: JSON.stringify(del, null, 2) }] };
      }

      const payload = { pattern, script: workerName };
      const res = routeId
        ? await cfRequest(cfg, "PUT", `/zones/${zoneId}/workers/routes/${routeId}`, payload)
        : await cfRequest(cfg, "POST", `/zones/${zoneId}/workers/routes`, payload);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
