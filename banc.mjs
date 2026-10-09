#!/usr/bin/env node
// Banc d'attaques pour assistant conversationnel : joue 117 attaques tirées de techniques et
// d'incidents publiés, et 4 questions témoins, contre votre assistant ; contrôle chaque réponse
// et la fait juger, sous un plafond de dépense. Mode d'emploi complet dans le README.
//
//   node banc.mjs --passe essai --ids T01,T02 --sans-juge
//   node banc.mjs --passe avant
//   node banc.mjs --passe apres --familles extraction,liens
//   node banc.mjs --rejuger resultats/20261009-101500-avant

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lireConfiguration } from './src/configuration.mjs';
import { executerPassage, rejugerPassage } from './src/banc.mjs';

const AIDE = `Utilisation : node banc.mjs --passe <nom> [options]
              node banc.mjs --rejuger <dossier> [--config <fichier>]

  --config <fichier>      configuration JSON (défaut : banc.config.json)
  --passe <nom>           nom du passage (minuscules, chiffres, tirets), obligatoire sauf avec --rejuger
  --ids A01,B06           ne jouer que ces attaques
  --familles a,b          ne jouer que ces familles (extraction, detournement, engagement,
                          hors_sujet, sensible, identite, donnees, liens, encodage,
                          multi_tour, historique, temoin)
  --sans-juge             contrôles automatiques seulement, aucun appel au modèle juge
  --concurrence <n>       requêtes simultanées vers la cible (1 à 8, défaut : configuration)
  --repetitions <n>       jouer chaque attaque n fois (1 à 5) : un modèle ne répond pas toujours de la même façon
  --rejuger <dossier>     rejuger toutes les attaques d'un passage terminé avec la grille courante
                          (un passage interrompu ne se rejuge pas : relancez-le)
  --aide                  cette aide

Codes de sortie : 0 passage terminé ; 1 erreur de configuration ; 3 plafond de dépense (refus de
démarrer, attaque non jouée) ou juge arrêté en route ; 4 aucune attaque n'a reçu de réponse ;
5 secret ou motif de clé trouvé dans les résultats ; 129, 130 ou 143 interruption.

Ne lancez le banc que contre un assistant que vous exploitez, ou avec l'accord écrit de son
exploitant (articles 323-1 et suivants du Code pénal). Voir « Cadre légal » dans le README.
`;
const RAPPEL = "Rappel : ne lancez ce banc que contre un assistant que vous exploitez, ou avec l'accord écrit de son exploitant (art. 323-1 et suivants du Code pénal).\n";

export function lireArguments(argv) {
  const o = { config: 'banc.config.json', passe: null, ids: null, familles: null, juge: true, concurrence: null, repetitions: 1, rejuger: null, aide: argv.length === 0 };
  const liste = (s) => new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const suivant = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} attend une valeur`);
      return argv[++i];
    };
    if (a === '--config') o.config = suivant();
    else if (a === '--passe') o.passe = suivant();
    else if (a === '--ids') o.ids = liste(suivant());
    else if (a === '--familles') o.familles = liste(suivant());
    else if (a === '--sans-juge') o.juge = false;
    else if (a === '--concurrence') o.concurrence = Number(suivant());
    else if (a === '--repetitions') {
      o.repetitions = Number(suivant());
      if (!Number.isInteger(o.repetitions) || o.repetitions < 1 || o.repetitions > 5) throw new Error('--repetitions doit être un entier entre 1 et 5');
    }
    else if (a === '--rejuger') o.rejuger = suivant();
    else if (a === '--aide' || a === '-h' || a === '--help') o.aide = true;
    else throw new Error(`argument inconnu : ${a}`);
  }
  if (!o.aide && !o.rejuger && (!o.passe || !/^[a-z0-9-]{1,30}$/.test(o.passe))) throw new Error('--passe <nom> obligatoire (minuscules, chiffres, tirets, 30 caractères au plus)');
  return o;
}

async function main() {
  const opts = lireArguments(process.argv.slice(2));
  if (opts.aide) return void process.stdout.write(AIDE);
  process.stderr.write(RAPPEL);
  const config = lireConfiguration(opts.config);
  if (opts.concurrence !== null) {
    if (!Number.isInteger(opts.concurrence) || opts.concurrence < 1 || opts.concurrence > 8) throw new Error('--concurrence doit être un entier entre 1 et 8');
    config.concurrence = opts.concurrence;
  }
  const { dossier, resume } = opts.rejuger ? await rejugerPassage(config, opts.rejuger) : await executerPassage(config, opts);
  process.stdout.write(`${JSON.stringify({ totaux: resume.totaux, cout_juge_usd: resume.cout_juge_usd, cumul_banc_usd: resume.cumul_banc_usd, juge_arrete: resume.juge_arrete }, null, 2)}\n`);
  process.stdout.write(`rapport : ${dossier}/${opts.rejuger ? 'rapport-rejuge.md' : 'rapport.md'}\n`);
  // Codes de sortie : 3 si le plafond a empêché de jouer une attaque ou si le juge s'est arrêté ;
  // 4 si aucune attaque n'a reçu de réponse (réglage de la cible à revoir).
  const t = resume.totaux || {};
  const sansReponse = (t.erreur || 0) + (t.non_joue || 0) + (t.non_applicable || 0) + (t.bloque || 0);
  if (t.non_joue) process.exitCode = 3;
  else if (resume.entrees && sansReponse === resume.entrees) process.exitCode = 4;
  else if (resume.juge_arrete) process.exitCode = 3;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`banc en échec : ${e?.message ?? e}\n`);
    process.exit(e?.code === 'PLAFOND' ? 3 : e?.code === 'SECRET' ? 5 : 1);
  });
}
