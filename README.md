# cloudflare-mcp-server (repo `mcp-cloudflare`)

Serveur **MCP (Model Context Protocol)** en **TypeScript / Node.js** qui donne à une IA un
contrôle **total et autonome** de l'écosystème Cloudflare : Workers, DNS, routes, KV, R2,
D1, Pages, cron, domaines personnalisés, logs temps réel…

Aucune intervention humaine : l'authentification est injectée automatiquement depuis les
variables d'environnement, et l'outil générique `cf-api` permet d'appeler **n'importe quel
endpoint** de l'API Cloudflare v4 à la volée.

---

## Architecture

```
┌──────────── client MCP (LibreChat, Chap Libre, Claude…) ───────────┐
│                                                                    │
│                 POST /mcp  (JSON-RPC, streamable HTTP)             │
▼                                                                    │
┌──────────────────────────── src/ ──────────────────────────────────┐
│ index.ts      → Express + transport MCP sans état                  │
│ config.ts     → lit CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID   │
│ cf-client.ts  → client HTTP v4 (auth auto, enveloppe standard)     │
│ tools/                                                             │
│   cf-api.ts   → outil générique (liberté totale)                   │
│   workers.ts  → deploy_worker / list_workers / delete_worker       │
│                 / set_worker_secret                                │
│   routes.ts   → configure_route (upsert + désactivation)           │
│   logs.ts     → tail_worker_logs (WebSocket temps réel)            │
└─────────────────────────────────────────────────────────────────────┘
                                │  HTTPS (Authorization: Bearer injecté)
                                ▼
              https://api.cloudflare.com/client/v4
```

### Principes
- **Auth transparente** : les deux variables d'environnement sont lues au démarrage,
  injectées dans chaque requête (`Authorization: Bearer …`) et le `account_id` est
  automatiquement inséré dans les chemins `/accounts/{account_id}/...`.
- **Mode autonome** : le serveur ne demande jamais de confirmation ; les erreurs API sont
  renvoyées sous forme d'enveloppe Cloudflare `{ success, result, errors, messages }`
  afin que l'IA lise l'erreur et se corrige seule.
- **Sans état** : un serveur MCP neuf par requête → aucune session à gérer, parfait
  pour Render / LibreChat.

## Outils exposés

| Outil | Rôle |
|---|---|
| `cf-api` | Appel HTTP générique (GET/POST/PUT/PATCH/DELETE) vers n'importe quel endpoint v4 |
| `deploy_worker` | Publie un Worker (module ES) + bindings + compat date en une seule commande |
| `list_workers` | Liste les Workers du compte |
| `delete_worker` | Supprime un script obsolète |
| `set_worker_secret` | Injecte/renouvelle un secret (`env.XXX`) sans redéploiement |
| `configure_route` | Lie/détache un Worker à un motif d'URL d'une zone (upsert auto) |
| `tail_worker_logs` | Écoute les logs d'exécution en temps réel (1–60 s) pour auto-diagnostic |

### Aide-mémoire `cf-api`

| Action | Appel |
|---|---|
| Lister les zones | `GET /zones?per_page=50` |
| Créer un enregistrement DNS | `POST /zones/{zone_id}/dns_records` `{type:"A", name:"api", content:"1.2.3.4", proxied:true}` |
| Activer workers.dev | `POST /accounts/{account_id}/workers/scripts/{name}/subdomains` `{"enabled":true}` |
| Domaine personnalisé | `PUT /accounts/{account_id}/workers/domains` `{zone_id, hostname, service, environment:"production"}` |
| Cron | `PUT /accounts/{account_id}/workers/scripts/{name}/schedules` `[{"cron":"* * * * *"}]` |
| KV (créer un namespace) | `POST /accounts/{account_id}/storage/kv/namespaces` `{"title":"cache"}` |
| KV (écrire une valeur) | `PUT /accounts/{account_id}/storage/kv/namespaces/{ns}/values/{clé}` (corps = texte brut) |
| R2, D1, Pages, Queues… | même principe — référence complète : https://developers.cloudflare.com/api/ |

> Pour un corps JSON, passez un **objet** (sérialisé automatiquement) ; pour une valeur
> brute (KV), passez une **chaîne** (envoyée telle quelle, `text/plain`).

## Configuration du jeton Cloudflare

1. Tableau de bord → **Mon profil → Jetons d'API → Créer un jeton** (personnalisé).
2. Permissions minimales recommandées :
   - **Compte / Workers Scripts / Édition** (déploiement, secrets, tail)
   - **Zone / Zone / Lecture** + **Zone / Workers Routes / Édition** (routes)
   - + KV / R2 / D1 / Pages selon l'usage prévu de `cf-api`
3. Ressources : *Tous les comptes / toutes les zones* (ou restreindre si besoin).
4. Noter le **Account ID** (tableau de bord → page d'accueil d'une zone).

> ⚠️ Le jeton ne vit que dans les variables d'environnement du service — ne le committez
> jamais, ne le collez jamais dans un code de Worker.

## Variables d'environnement

| Variable | Obligatoire | Exemple |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | `v1.0-xxxxxxxx…` |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | `a1b2c3d4…` |
| `PORT` | non (Render la fournit) | `3000` |

Au démarrage, le serveur **vérifie automatiquement le jeton** (`/user/tokens/verify`) et
affiche un diagnostic clair dans les logs.

## Déploiement sur Render

1. **New → Web Service** → repo `mcp-cloudflare`.
2. Runtime **Docker** (Dockerfile fourni : install → build TS → prune devDeps).
3. Ajouter les 2 variables d'environnement ci-dessus.
4. Health check path : `/health` — auto-deploy actif sur `main`.

## Développement local

```bash
npm install
CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx npm run build && npm start
# → http://localhost:3000/mcp
```

## Connexion d'un client MCP

```json
{
  "mcpServers": {
    "cloudflare": {
      "type": "streamable-http",
      "url": "https://<service>.onrender.com/mcp"
    }
  }
}
```

Pour le mode **100 % autonome (zéro clic d'approbation)** : côté client, désactivez
l'approbation des outils pour ce serveur (LibreChat : réglages de l'agent → approbation
d'outils = automatique). Les outils destructeurs (`delete_worker`) portent l'annotation
`destructiveHint` si vous souhaitez les filtrer côté client.

## Notes & limites
- `deploy_worker` attend du **module ES** (`export default { fetch }`). Pour un script
  "service worker" legacy, passez par `cf-api` en multipart manuel.
- ⚠️ Un déploiement **remplace tous les bindings** : si vous avez des secrets, repassez-les
  dans `bindings` ou appelez `set_worker_secret` après chaque `deploy_worker`.
- Un Worker créé via l'API est **désactivé sur workers.dev** par défaut : activez-le via
  `cf-api` (aide-mémoire ci-dessus) ou liez une route avec `configure_route`.
- `tail_worker_logs` n'affiche que la fenêtre d'écoute : déclenchez du trafic (curl sur
  l'URL du Worker) pendant les `duration_seconds`.
- Secrets : `set_worker_secret` renvoie la confirmation API **sans jamais afficher la valeur**.
