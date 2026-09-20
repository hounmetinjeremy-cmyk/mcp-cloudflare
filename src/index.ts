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
    version: "1.1.0",
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

// Secret permanent d'autorisation : protège à la fois la page d'approbation
// ET l'endpoint /mcp. Il ne change jamais, donc aucun redémarrage ne casse
// la connexion une fois configurée dans chat libre.
const AUTHORIZE_SECRET = process.env.AUTHORIZE_SECRET;
if (!AUTHORIZE_SECRET) {
  console.error(
    "⚠️  AUTHORIZE_SECRET manquant — la page d'autorisation et /mcp seront indisponibles."
  );
}

app.get("/authorize/:secret", (req, res) => {
  if (!AUTHORIZE_SECRET || req.params.secret !== AUTHORIZE_SECRET) {
    return res.status(404).send("Introuvable.");
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="utf-8"><title>Autoriser l'accès Cloudflare</title></head>
    <body style="font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center;">
      <h2>Connexion au serveur MCP Cloudflare</h2>
      <p>Veux-tu autoriser l'accès à ton compte Cloudflare (Workers, secrets, routes, DNS, KV, R2, D1) ?</p>
      <form method="POST" action="/authorize/${encodeURIComponent(req.params.secret)}">
        <button type="submit" style="padding: 12px 24px; font-size: 16px; background: #f6821f; color: white; border: none; border-radius: 6px; cursor: pointer;">
          Autoriser
        </button>
      </form>
    </body>
    </html>
  `);
});

app.post("/authorize/:secret", express.urlencoded({ extended: true }), (req, res) => {
  if (!AUTHORIZE_SECRET || req.params.secret !== AUTHORIZE_SECRET) {
    return res.status(404).send("Introuvable.");
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="utf-8"><title>Autorisé</title></head>
    <body style="font-family: sans-serif; max-width: 560px; margin: 60px auto;">
      <h2>✅ Accès autorisé</h2>
      <p>Chat libre se connectera automatiquement — aucune action supplémentaire n'est nécessaire de ta part.</p>
    </body>
    </html>
  `);
});

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!AUTHORIZE_SECRET || !token || token !== AUTHORIZE_SECRET) {
    return res.status(401).json({
      error: "Non autorisé. Ouvre le lien d'autorisation fourni par le propriétaire pour te connecter.",
    });
  }
  next();
}

app.post("/mcp", requireAuth, async (req, res) => {
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
  console.log(`cloudflare-mcp-server à l'écoute sur le port ${PORT} (endpoint: POST /mcp, protégé)`);
});
