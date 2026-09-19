# mcp-cloudflare

Serveur MCP (Model Context Protocol) auto-hébergé qui expose **l'intégralité de l'écosystème Cloudflare** à une IA, avec une philosophie simple : **zéro configuration manuelle, zéro clic d'approbation**.

## Architecture

```
┌──────────────┐  POST /mcp (JSON-RPC, HTTP streamable)   ┌──────────────────────────┐
│  Client MCP  │ ─────────────────────────────────────────▶│  mcp-cloudflare (Node 20)│
│  (IA/agent)  │ ◀────────────── résultat JSON ────────────│  Render / Docker         │
└──────────────┘                                           └────────────┬─────────────┘
              Authorization: Bearer MCP_AUTH_TOKEN                        │ HTTPS
                                                                          ▼
                                                         api.cloudflare.com/client/v4
                                              (Bearer CLOUDFLARE_API_TOKEN injecté
                                               automatiquement à chaque appel)
```

- `src/index.ts` — serveur HTTP (Express) + transport MCP streamable **stateless** (une instance par requête, aucune session à maintenir).
- `src/registerTools.ts` — les **7 outils** exposés à l'IA.
- `src/cfClient.ts` — client Cloudflare : injection transparente du token, détection automatique de l'Account ID, formatage compact des réponses.

## Authentification transparente

1. Au démarrage, le serveur vérifie le token (`GET /user/tokens/verify`) et log le résultat.
2. Si `CLOUDFLARE_ACCOUNT_ID` n'est pas défini, l'Account ID est **résolu automatiquement** (`GET /accounts`) : un seul compte → utilisé ; plusieurs → le premier, avec un avertissement.
3. Le placeholder `{account_id}` dans tout chemin d'API est remplacé automatiquement.

## Les 7 outils

| Outil | Rôle |
|---|---|
| `cf-api` | Appel HTTP générique vers **tout** l'API Cloudflare v4 (GET/POST/PUT/PATCH/DELETE) : DNS, KV, R2, D1, zones, cache, WAF, pages, tunnels… |
| `deploy_worker` | Publie un Worker complet en une commande (ES modules ou service-worker, bindings, compatibilité, sous-domaine `*.workers.dev`). |
| `list_workers` | Liste tous les Workers avec leur état et l'URL `*.workers.dev` activée ou non. |
| `delete_worker` | Supprime un Worker (option : purge de ses routes et domaines personnalisés). |
| `set_worker_secret` | Injecte un secret dans un Worker déployé, sans clic humain (jamais renvoyé en clair). |
| `configure_route` | Lie un Worker à un domaine : routes de zone, domaines personnalisés Workers (create/delete/list). |
| `tail_worker_logs` | Écoute les logs d'exécution en temps réel (WebSocket de tail) pour auto-diagnostiquer. |

## Déploiement sur Render

1. Repo → **New Web Service** (runtime Node, ou Blueprint avec le `render.yaml` fourni).
2. Variables d'environnement :
   - `CLOUDFLARE_API_TOKEN` — **obligatoire** (API Token, pas la Global API Key).
   - `CLOUDFLARE_ACCOUNT_ID` — optionnel (détection auto sinon).
   - `MCP_AUTH_TOKEN` — recommandé : protège `POST /mcp` par `Authorization: Bearer`.
3. Health check : `/health`. Client MCP à connecter : `https://<service>.onrender.com/mcp`.

Alternative Docker : `Dockerfile` multi-étapes fourni (build TS → image runtime minimale).

## Scopes du token Cloudflare requis

- **Account** : `Workers Scripts:Edit`, `Account Settings:Read`, `Workers KV Storage:Edit` (si KV), `Workers Custom Domains:Edit`.
- **Zone** : `Zone:Read`, `Workers Routes:Edit` (+ `DNS:Edit` si usage DNS via `cf-api`).

Le template « **Edit Cloudflare Workers** » couvre l'essentiel ; ajoutez les permissions de zone si vous pilotez routes/DNS.

## Sécurité

- Le token Cloudflare n'est jamais renvoyé dans les réponses d'outils ; `set_worker_secret` n'écho jamais la valeur.
- `MCP_AUTH_TOKEN` protège l'endpoint MCP.
- `cf-api` est volontairement puissant (liberté totale) : le garde-fou principal est le **périmètre du token** — donnez-lui les scopes minimaux.
- Les secrets survivent aux redéploiements via `deploy_worker` + `keep_bindings: ["secret_text"]`.

## Dépannage

- `HTTP 401` / code `10000` → token invalide ou scopes manquants.
- `tail_worker_logs` vide → le tail ne capture que le trafic généré **pendant** la fenêtre d'écoute : déclenchez le Worker (curl de son URL) pendant l'écoute.
- `main_module` introuvable → nommez explicitement `main_module` quand `modules` contient plusieurs fichiers.
