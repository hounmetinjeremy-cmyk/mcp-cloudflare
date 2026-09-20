/*
 * index.ts — Point d'entrée : Express + MCP streamable HTTP (sans état).
 * Multi-utilisateurs : seul le token Cloudflare de la personne est requis.
 * L'ID de compte est déduit automatiquement (config.ts) — rien d'autre à
 * chercher ou copier pour l'utilisateur final.
 */
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { configFromRequest, tokenFromRequest } from "./config.js";
import type { CfConfig } from "./config.js";
import { registerCfApi } from "./tools/cf-api.js";
import { registerWorkersTools } from "./tools/workers.js";
import { registerRoutesTools } from "./tools/routes.js";
import { registerLogsTools } from "./tools/logs.js";

function createServer(cfg: CfConfig): McpServer {
  const server = new McpServer({
    name: "cloudflare-mcp-server",
    version: "2.1.0",
  });

  registerCfApi(server, cfg);
  registerWorkersTools(server, cfg);
  registerRoutesTools(server, cfg);
  registerLogsTools(server, cfg);

  return server;
}

const app = express();
app.use(express.json());

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (!tokenFromRequest(req)) {
    return res.status(401).json({
      error:
        "Token Cloudflare manquant. Dans chat libre, connecte ton compte Cloudflare " +
        "via la fenêtre de configuration de l'outil (icône MCP) avant de l'utiliser.",
    });
  }
  next();
}

app.post("/mcp", requireToken, async (req, res) => {
  try {
    const cfg = await configFromRequest(req);
    if (!cfg.accountId) {
      return res.status(401).json({
        error:
          "Token Cloudflare invalide, ou aucun compte accessible avec ce token. " +
          "Vérifie le token dans les réglages de chat libre.",
      });
    }
    const server = createServer(cfg);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // sans état : un serveur neuf par requête
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "cloudflare-mcp-server" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`cloudflare-mcp-server à l'écoute sur le port ${PORT} (endpoint: POST /mcp, multi-utilisateurs)`);
});
