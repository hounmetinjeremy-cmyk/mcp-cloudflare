/*
 * index.ts — Point d'entrée : Express + MCP streamable HTTP (sans état).
 * Multi-utilisateurs : le token Cloudflare de CHAQUE requête vient de
 * l'en-tête envoyé par chat libre (propre à la personne connectée),
 * jamais d'une variable d'environnement partagée.
 */
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { configFromRequest, hasCredentials } from "./config.js";
import type { CfConfig } from "./config.js";
import { registerCfApi } from "./tools/cf-api.js";
import { registerWorkersTools } from "./tools/workers.js";
import { registerRoutesTools } from "./tools/routes.js";
import { registerLogsTools } from "./tools/logs.js";

function createServer(cfg: CfConfig): McpServer {
  const server = new McpServer({
    name: "cloudflare-mcp-server",
    version: "2.0.0",
  });

  registerCfApi(server, cfg);
  registerWorkersTools(server, cfg);
  registerRoutesTools(server, cfg);
  registerLogsTools(server, cfg);

  return server;
}

const app = express();
app.use(express.json());

// L'autorisation, c'est le token Cloudflare lui-même : sans lui, aucun appel
// à l'API Cloudflare ne peut réussir. On exige juste sa présence ici pour
// renvoyer un message clair plutôt qu'une erreur Cloudflare opaque.
function requireCredentials(req: Request, res: Response, next: NextFunction) {
  const cfg = configFromRequest(req);
  if (!hasCredentials(cfg)) {
    return res.status(401).json({
      error:
        "Token Cloudflare manquant. Dans chat libre, connecte ton compte Cloudflare " +
        "via la fenêtre de configuration de l'outil (icône MCP) avant d'utiliser ce serveur.",
    });
  }
  next();
}

app.post("/mcp", requireCredentials, async (req, res) => {
  try {
    const cfg = configFromRequest(req);
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
