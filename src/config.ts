/*
 * config.ts — Authentification transparente.
 * Les identifiants Cloudflare sont lus UNE fois au démarrage et injectés
 * automatiquement dans chaque requête HTTP par cf-client.ts.
 * L'IA n'a donc AUCUN identifiant à fournir, JAMAIS.
 */

export interface CfConfig {
  apiToken: string;
  accountId: string;
  apiBase: string;
}

export function loadConfig(): CfConfig {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!apiToken || !apiToken.trim()) {
    console.error(
      "CLOUDFLARE_API_TOKEN manquant — le serveur démarre en mode dégradé " +
      "(les outils renverront des erreurs claires jusqu'à correction des variables d'environnement)."
    );
  }
  if (!accountId || !accountId.trim()) {
    console.error(
      "CLOUDFLARE_ACCOUNT_ID manquant — les chemins /accounts/{account_id}/... échoueront."
    );
  }

  return {
    apiToken: (apiToken || "").trim(),
    accountId: (accountId || "").trim(),
    apiBase: "https://api.cloudflare.com/client/v4",
  };
}

/** Vérification automatique du jeton au démarrage (journal, non bloquant). */
export async function verifyToken(cfg: CfConfig): Promise<void> {
  try {
    const res = await fetch(`${cfg.apiBase}/user/tokens/verify`, {
      headers: { Authorization: `Bearer ${cfg.apiToken}` },
    });
    const body = (await res.json()) as any;
    if (body?.success) {
      const status = body.result?.status ?? "inconnu";
      console.log(`Jeton Cloudflare vérifié automatiquement : status=${status}`);
    } else {
      const err = body?.errors?.[0]?.message ?? JSON.stringify(body);
      console.error(`Vérification du jeton Cloudflare : ÉCHEC — ${err}`);
    }
  } catch (e: any) {
    console.error(`Vérification du jeton Cloudflare impossible : ${e?.message ?? e}`);
  }
}
