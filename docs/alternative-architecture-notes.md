# Notes d'architecture alternative (roadmap phase 2)

> Contexte : un fichier `src/registerTools.ts` a été poussé sur le repo par une session
> parallèle. Il référençait des modules inexistants (`./init`, `./types`) et le package
> npm `cloudflare` (non installé) — donc **non compilable**. Il a été retiré du build ;
> son **intention est conservée ici** comme feuille de route.

## Ce que ce design prévoyait (plus riche que la v1)

Des groupes d'outils dédiés, tous enregistrés via un unique `registerTools()` :

| Groupe | Exemples d'outils |
|---|---|
| `account` | info compte, membres, rôles |
| `dns` | CRUD enregistrements, import/export zone file |
| `zone` | création de zone, settings (SSL, cache, pagination, always-online…) |
| `worker` | équivalent des outils v1 (deploy/list/delete/secrets/routes) |
| `kv` | namespaces + CRUD clé/valeur |
| `r2` | buckets + objets |
| `d1` | bases + requêtes SQL |
| `bearer` | gestion de tokens API (création/roll) |
| `proxyEndpoints` | alias haut-niveau pour endpoints courants |

## Variables d'environnement évoquées par `render.yaml`

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` (utilisés)
- `CLOUDFLARE_CLIENT_ID` + `CLOUDFLARE_CLIENT_SECRET` → OAuth (phase 2)
- `MCP_AUTH_TOKEN` → **protection de l'endpoint `/mcp`** (phase 2, recommandé si
  l'URL est publique : exiger un header `Authorization` sur POST /mcp)

## Bibliothèque réutilisable déjà en place

`src/cfClient.ts` (corrigé et compilable) expose : `resolveAccountId`, `deployWorker`
(mono/multi-modules ES + wasm/json/txt), `listWorkers`, `deleteWorker`,
`setWorkerSecret`, `configureRoute` (routes + domaines personnalisés),
`tailWorkerLogs` (API tail moderne, WebSocket natif Node 22).

Pour câbler ces fonctions comme outils MCP, il suffit d'un `server.tool(...)` par
fonction dans un nouveau fichier `src/tools/*.ts` + `registerXxx(server, cfg)` dans
`src/index.ts`.
