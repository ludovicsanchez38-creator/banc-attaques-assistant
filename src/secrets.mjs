// Balayage des fichiers de résultats avant de rendre la main : on y cherche toute valeur secrète
// citée par la configuration (clé du juge, jetons des en-têtes) et tout ce qui ressemble à une clé connue.
// Si quelque chose est trouvé, le banc échoue et nomme le fichier : à mettre à l'écart avant
// tout partage ou commit.

import fs from 'node:fs';
import path from 'node:path';

export const MOTIFS_CLES = [
  /sk-ant-[A-Za-z0-9_-]{8,}/, // Anthropic
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, // OpenAI et compatibles
  /\bAKIA[0-9A-Z]{16}\b/, // AWS
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google
  /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/, // Stripe
  /\bhf_[A-Za-z0-9]{30,}\b/, // Hugging Face
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // jeton JWT
];

/** Renvoie la liste des fichiers du dossier qui contiennent un secret (sans jamais afficher le secret). */
export function balayer(dossier, secrets = []) {
  const touches = [];
  for (const f of fs.readdirSync(dossier)) {
    const p = path.join(dossier, f);
    if (!fs.statSync(p).isFile()) continue;
    const contenu = fs.readFileSync(p, 'utf8');
    if (secrets.some((s) => s && contenu.includes(s)) || MOTIFS_CLES.some((re) => re.test(contenu))) touches.push(f);
  }
  return touches;
}
