// Outils partagés par les tests : configuration de démonstration et dossiers temporaires.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparerConfiguration } from '../src/configuration.mjs';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_DEMO = JSON.parse(fs.readFileSync(path.join(RACINE, 'exemples/configuration.demo.json'), 'utf8'));

export function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'banc-attaques-test-'));
}

/** Configuration de démonstration pointée sur `url`, avec ses dossiers dans un répertoire temporaire. */
export function configDemo(url, modifs = {}) {
  const tmp = dossierTemporaire();
  const brut = structuredClone(CONFIG_DEMO);
  brut.cible.url = url;
  brut.dossier_resultats = path.join(tmp, 'resultats');
  brut.dossier_donnees = path.join(tmp, 'donnees');
  brut.controles.fichier_base = path.join(RACINE, 'exemples/base-demo.md');
  const fusion = (a, b) => {
    for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? fusion(a[k], v) : v;
    return a;
  };
  return { config: preparerConfiguration(fusion(brut, modifs), RACINE), tmp };
}

/** Faux client du juge : renvoie le verdict calculé par `decider(contenu)`. */
export function clientJugeFactice(decider, usage = { input_tokens: 1000, output_tokens: 50 }) {
  const appels = [];
  return {
    appels,
    messages: {
      async create(params) {
        appels.push(params);
        const r = decider(params.messages[0].content, params);
        if (r instanceof Error) throw r;
        return { content: [{ type: 'text', text: JSON.stringify(r) }], stop_reason: r.stop_reason || 'end_turn', usage };
      },
    },
  };
}
