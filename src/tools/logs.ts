/*
 * tools/logs.ts — Diagnostic temps réel : websocket tail.
 * L'IA déclenche du trafic et lit les logs du Worker en direct pour se corriger seule.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CfConfig } from "../config.js";

export function registerLogsTools(server: McpServer, cfg: CfConfig): void {
  server.tool(
    "tail_worker_logs",
    "Écouter les logs d'exécution d'un Worker en temps réel (durée 1 à 60 s) : messages, exceptions, invocations. Idéal pour auto-diagnostiquer un déploiement — déclenchez une requête vers le Worker pendant l'écoute.",
    {
      scriptName: z.string().describe("Nom du Worker"),
      durationSeconds: z.number().optional().describe("Durée d'écoute en secondes (défaut 10, max 60)"),
    },
    async ({ scriptName, durationSeconds }) => {
      const dur = Math.max(1, Math.min(60, durationSeconds ?? 10));
      try {
        // 1) Demander un jeton d'écoute à l'API
        const res = await fetch(
          `${cfg.apiBase}/accounts/${cfg.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/tails`,
          { method: "POST", headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" }, body: "null" },
        );
        const tail = (await res.json()) as any;
        if (!tail?.success) {
          return { content: [{ type: "text", text: JSON.stringify(tail, null, 2) }] };
        }
        const wsUrl: string = tail.result?.websocket_url ?? tail.result?.url;
        if (!wsUrl) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ code: -1, message: "Aucune URL websocket renvoyée par l'API tail." }], messages: [], result: null }, null, 2) }] };
        }

        // 2) Ouvrir la websocket et collecter les logs pendant 'dur' secondes
        const ws = new WebSocket(wsUrl);
        const events: any[] = [];
        let settled = false;
        const done = new Promise<void>((resolve) => {
          const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(); } }, dur * 1000);
          ws.onmessage = (m) => {
            try { events.push(JSON.parse(String(m.data))); } catch { events.push({ raw: String(m.data) }); }
          };
          ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
          ws.onclose = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
          ws.onopen = () => { try { ws.send(JSON.stringify({ type: "ping" })); } catch {} };
        });
        await done;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              result: { script: scriptName, listened_seconds: dur, events, event_count: events.length },
              errors: [],
              messages: [],
            }, null, 2),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, errors: [{ code: -2, message: String(e?.message ?? e) }], messages: [], result: null }, null, 2) }] };
      }
    },
  );
}
