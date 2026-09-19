/*
 * index.ts — Point d'entrée : Express + MCP streamable HTTP (sans état).
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, verifyToken } from "./config.js";
import { registerCfApi } from "./tools/cf-api.js";
import { registerWorkersTools } from "./tools/workers.js";
import { registerRoutesTools } from "./tools/routes.js";
import { registerLogsTools } from "./tools/logs.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "cloudflare-mcp-server",
    version: "1.0.0",
  });

  const cfg = loadConfig();
  registerCfApi(server, cfg);
  registerWorkersTools(server, cfg);
  registerRoutesTools(server, cfg);
  registerLogsTools(server, cfg);

  return server;
}

const app = express();
app.use(express.json());

// Diagnostic de démarrage : authentification transparente et vérifiée automatiquement.
const cfg = loadConfig();
verifyToken(cfg);

app.post("/mcp", async (req, res) => {
  try {
    const server = createServer();
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
  console.log(`cloudflare-mcp-server à l'écoute sur le port ${PORT} (endpoint: POST /mcp)`);
});
