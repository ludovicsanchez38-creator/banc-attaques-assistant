// Orchestration d'un passage : jouer les attaques contre la cible, contrôler chaque réponse,
// faire juger, écrire les résultats, tenir le registre des dépenses, balayer les secrets.

import fs from 'node:fs';
import path from 'node:path';
import { lireCorpus, preparerCorpus } from './corpus.mjs';
import { jouer, nonApplicable } from './cible.mjs';
import { preparerControles, controler } from './controles.mjs';
import { tarifJuge, secretsCites, verifierEnv } from './configuration.mjs';
import { ArretJuge, systemeJuge, contenuJuge, coutMaximal, creerClientJuge, juger } from './juge.mjs';
import { ouvrirRegistre, ErreurPlafond } from './couts.mjs';
import { verdictFinal, resumer, rapportMarkdown, neutre } from './rapport.mjs';
import { balayer } from './secrets.mjs';

async function enParallele(elements, n, f) {
  const out = new Array(elements.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, elements.length) }, async () => {
      while (i < elements.length) {
        const k = i++;
        out[k] = await f(elements[k], k);
      }
    }),
  );
  return out;
}

/** L'adresse de la cible sans identifiants ni paramètres de requête (qui peuvent porter un jeton). */
const cibleAffichee = (url) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(adresse illisible)';
  }
};

/** Prépare le juge avant de jouer quoi que ce soit : une erreur de clé ou de tarif doit arriver tôt. */
async function preparerJuge(config, avecJuge, deps) {
  if (!avecJuge) return null;
  const tarif = tarifJuge(config.juge);
  const client = deps.clientJuge || (await creerClientJuge(config.juge, deps.env));
  return { client, tarif, juge: config.juge, systeme: systemeJuge(config) };
}

const attaqueDe = (l) => ({ famille: l.famille, technique: l.technique, echec: l.echec_si, historique: l.historique_fabrique });
const servie = (l) => l.echanges.some((e) => e.statut_http >= 200 && e.statut_http < 300 && e.reponse);

/**
 * Fait juger les lignes dans l'ordre. Une attaque dont l'estimation haute ferait dépasser le
 * plafond n'est pas jugée (les suivantes, moins chères, peuvent l'être). Le juge s'arrête sur une
 * erreur de clé, de facturation ou de connexion, et après trois appels de suite sans réponse.
 */
async function phaseJuge(lignes, j, registre, log, { apresVerdict = () => {} } = {}) {
  let arret = null;
  let reussis = 0;
  let echecsDeSuite = 0;
  const nonJugees = [];
  const crochets = { peut: registre.peut, reserver: (m) => registre.ajouterJuge(m), ajuster: (d) => registre.ajouterJuge(d) };
  for (const l of lignes) {
    l.juge = null; // un rejugement repart toujours de zéro : jamais de mélange de grilles
    if (!j || arret || l.non_applicable || !servie(l)) continue;
    const att = attaqueDe(l);
    const majorant = coutMaximal(j.systeme, contenuJuge(att, l.echanges), j.juge, j.tarif);
    if (!registre.peut(majorant)) {
      nonJugees.push(l.id);
      continue;
    }
    try {
      const { repondu, ...verdict } = await juger(j.client, j, att, l.echanges, { ...crochets, premierAppel: reussis === 0 });
      l.juge = verdict;
      apresVerdict();
      if (repondu) {
        reussis++;
        echecsDeSuite = 0;
      } else if (++echecsDeSuite >= 3) {
        arret = `juge arrêté après trois appels de suite sans réponse (dernier : ${verdict.raison})`;
        log(`${arret}\n`);
      }
    } catch (e) {
      if (!(e instanceof ArretJuge)) throw e;
      arret = e.message;
      log(`${arret}\n`);
    }
  }
  if (nonJugees.length) {
    const note = `plafond de dépense proche : ${nonJugees.length} ${nonJugees.length > 1 ? 'attaques non jugées' : 'attaque non jugée'} (${nonJugees.slice(0, 8).join(', ')}${nonJugees.length > 8 ? '...' : ''})`;
    log(`${note}\n`);
    arret = arret ? `${arret} ; ${note}` : note;
  }
  return arret;
}

// Écriture atomique (fichier temporaire puis renommage) : un fichier de résultats n'est jamais à moitié écrit.
function ecrire(dossier, nom, contenu) {
  const tmp = path.join(dossier, `.${nom}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, contenu, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dossier, nom));
}
const PROVISOIRE = 'passage en cours ou interrompu : résultats partiels, à relancer pour obtenir un rapport';
const jsonl = (lignes) => lignes.map((l) => JSON.stringify(l)).join('\n') + (lignes.length ? '\n' : '');

/** Valeurs secrètes à chercher : en clair (resultats.jsonl) et sous leur forme neutralisée (rapport). */
const formesSecretes = (config, env) => {
  const secrets = secretsCites(config, env);
  return [...secrets, ...secrets.map((x) => neutre(x, 10_000))];
};
const erreurSecret = (touches, dossier) =>
  Object.assign(new Error(`secret ou motif de clé trouvé dans ${touches.join(', ')} (dossier ${dossier}) : mettez tout ce dossier à l'écart avant tout partage`), { code: 'SECRET' });

/**
 * Contrôle des secrets après une interruption : le banc ne peut plus échouer, il prévient, à l'écran
 * et dans le dossier (ALERTE-SECRET.txt), car l'écran peut avoir disparu (terminal fermé).
 */
function balayerApresInterruption(dossier, config, env) {
  const touches = balayer(dossier, formesSecretes(config, env));
  if (!touches.length) return;
  const message = erreurSecret(touches, dossier).message;
  ecrire(dossier, 'ALERTE-SECRET.txt', `${message}\n`);
  process.stderr.write(`\nATTENTION : ${message}\n`);
}

/** Crée le dossier du passage ; si le nom existe déjà (même seconde, même passe), ajoute un suffixe. */
function creerDossierPasse(racine, nom) {
  fs.mkdirSync(racine, { recursive: true, mode: 0o700 });
  for (let n = 1; n < 100; n++) {
    const d = path.join(racine, n === 1 ? nom : `${nom}-${n}`);
    try {
      fs.mkdirSync(d, { mode: 0o700 });
      return d;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error(`impossible de créer un dossier de résultats pour ${nom}`);
}

const verdicts = (lignes, config, ctx) => {
  for (const l of lignes) l.verdict = verdictFinal({ att: { famille: l.famille }, echanges: l.echanges, drapeaux: l.drapeaux, juge: l.juge, nonApplicable: l.non_applicable, toursPrevus: l.tours_prevus || 1 }, config.cible, ctx);
};

function ecrireResultats(dossier, suffixe, lignes, resume, config, env, ctx) {
  ecrire(dossier, `resultats${suffixe ? '-rejuges' : ''}.jsonl`, jsonl(lignes));
  ecrire(dossier, `resume${suffixe}.json`, JSON.stringify(resume, null, 2) + '\n');
  ecrire(dossier, `rapport${suffixe}.md`, rapportMarkdown(lignes, resume, ctx));
  // Un secret recopié par la cible apparaît en clair dans resultats.jsonl et sous forme neutralisée
  // dans le rapport : on cherche les deux formes.
  const touches = balayer(dossier, formesSecretes(config, env));
  if (touches.length) throw erreurSecret(touches, dossier);
}

/** Refuse un passage jugé quand le reste du plafond ne couvre même pas un appel au juge. */
function verifierReste(j, registre, avecJuge) {
  if (!avecJuge || !j) return;
  const minimum = coutMaximal(j.systeme, '', j.juge, j.tarif);
  if (!registre.peut(minimum)) {
    throw new ErreurPlafond(`plafond du banc presque atteint (${registre.cumul.toFixed(4)} $ sur ${registre.plafond} $) : il ne couvre plus un seul appel au juge. Relevez plafond_usd ou déplacez le registre en connaissance de cause, ou lancez --sans-juge`);
  }
}

/**
 * Lance un passage. `opts` : { passe, ids, familles, juge, repetitions, maintenant } ;
 * `deps` : { clientJuge, env, log, fichierCorpus } pour les tests.
 */
export async function executerPassage(config, opts, deps = {}) {
  const log = deps.log || ((s) => process.stderr.write(s));
  const env = deps.env || process.env;
  const repetitions = opts.repetitions || 1;
  const choisies = preparerCorpus(lireCorpus(deps.fichierCorpus), config.contexte, { ids: opts.ids, familles: opts.familles, temoins: config.temoins_supplementaires });
  if (!choisies.length) throw new Error('aucune attaque ne correspond aux filtres --ids / --familles');
  const attaques = repetitions > 1 ? choisies.flatMap((a) => Array.from({ length: repetitions }, (_, k) => ({ ...a, tirage: k + 1 }))) : choisies;
  const ctx = preparerControles(config.controles, config.contexte);
  verifierEnv(config, env);

  const maintenant = opts.maintenant || new Date();
  const horodatage = maintenant.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const estimation = Number(config.cible.cout_estime_par_appel_usd) || 0;
  // Sans juge et sans coût estimé de la cible, un passage ne dépense rien : il reste permis plafond atteint.
  const registre = ouvrirRegistre(config.dossier_donnees, config.plafond_usd, { passe: opts.passe, horodatage, entrees: attaques.length }, { exigerReste: Boolean(opts.juge) || estimation > 0 });
  let fini = false;
  let dossier = null;
  let lignes = null;
  const faites = [];
  // Sur toute fin anormale (signal ou erreur), le dernier état est écrit et les secrets contrôlés.
  const finAnormale = () => {
    if (!dossier) return;
    ecrire(dossier, 'resultats.jsonl', jsonl(lignes || faites));
    balayerApresInterruption(dossier, config, env);
  };
  registre.avantSortie = finAnormale;
  try {
    const j = await preparerJuge(config, opts.juge, { ...deps, env });
    verifierReste(j, registre, opts.juge);
    dossier = creerDossierPasse(config.dossier_resultats, `${horodatage}-${opts.passe}`);
    const garde = async () => {
      if (!estimation) return true;
      if (!registre.peut(estimation)) return false;
      registre.ajouterCible(estimation);
      return true;
    };

    // Enregistrement au fil de l'eau : resume.json provisoire dès le départ, chaque attaque terminée
    // ajoutée à resultats.jsonl, puis chaque verdict réécrit dans ce fichier. Un passage interrompu
    // garde ces résultats pour consultation ; il ne se rejuge pas (il faut le relancer).
    const meta = { passe: opts.passe, horodatage, dossier_nom: path.basename(dossier), date_utc: maintenant.toISOString().slice(0, 16).replace('T', ' '), cible: cibleAffichee(config.cible.url), repetitions };
    ecrire(dossier, 'resume.json', JSON.stringify({ ...meta, provisoire: PROVISOIRE }, null, 2) + '\n');

    log(`${attaques.length} entrées, passe « ${opts.passe} », cible ${cibleAffichee(config.cible.url)}\n`);
    lignes = await enParallele(attaques, config.concurrence, async (att) => {
      const na = nonApplicable(att, config.cible.historique.mode);
      const echanges = na ? [] : await jouer(config.cible, att, garde, env);
      const drapeaux = echanges.flatMap((e, i) => controler(e.reponse, ctx).map((d) => ({ ...d, tour: i + 1 })));
      log(`${att.id}${att.tirage ? `#${att.tirage}` : ''} ${na ? 'sans objet' : echanges.map((e) => e.statut_http ?? '-').join('/')} ${drapeaux.map((d) => d.code).join(',')}\n`);
      const ligne = {
        id: att.id,
        ...(att.tirage ? { tirage: att.tirage } : {}),
        famille: att.famille,
        technique: att.technique,
        source: att.source,
        langue: att.langue,
        echec_si: att.echec,
        historique_fabrique: att.historique || null,
        non_applicable: na,
        tours_prevus: att.tours ? att.tours.length : 1,
        echanges,
        drapeaux,
        juge: null,
      };
      faites.push(ligne);
      fs.appendFileSync(path.join(dossier, 'resultats.jsonl'), JSON.stringify(ligne) + '\n', { mode: 0o600 });
      return ligne;
    });

    verdicts(lignes, config, ctx);
    ecrire(dossier, 'resultats.jsonl', jsonl(lignes)); // remis dans l'ordre du corpus
    const arretJuge = await phaseJuge(lignes, j, registre, log, {
      apresVerdict: () => {
        verdicts(lignes, config, ctx); // le champ verdict suit chaque avis du juge
        ecrire(dossier, 'resultats.jsonl', jsonl(lignes));
      },
    });
    verdicts(lignes, config, ctx);
    const resume = resumer(lignes, {
      ...meta,
      juge: j ? j.juge.modele : null,
      juge_arrete: arretJuge,
      cout_juge_usd: Number(registre.juge.toFixed(6)),
      cout_cible_estime_usd: Number(registre.cible.toFixed(6)),
      cumul_banc_usd: Number(registre.cumul.toFixed(6)),
      plafond_usd: config.plafond_usd,
    });
    registre.fermer();
    fini = true;
    ecrireResultats(dossier, '', lignes, resume, config, env, ctx);
    return { dossier, resume, lignes };
  } finally {
    if (!fini) {
      try {
        finAnormale();
      } catch {
        /* rien de plus à faire : le registre est déjà à jour */
      }
      registre.fermer({ termine: false, erreur: true });
    }
  }
}

/**
 * Rejuge toutes les attaques d'un passage terminé avec la grille courante : mêmes réponses, aucun
 * appel à la cible. Un passage interrompu ne se rejuge pas : ses résultats sont partiels.
 */
export async function rejugerPassage(config, dossier, deps = {}) {
  const log = deps.log || ((s) => process.stderr.write(s));
  const env = deps.env || process.env;
  const fichierResultats = path.join(dossier, 'resultats.jsonl');
  if (!fs.existsSync(fichierResultats)) {
    throw new Error(`aucun resultats.jsonl dans ${dossier} : ce n'est pas un dossier de passage, ou le passage a été interrompu avant la première réponse de la cible (rien à juger)`);
  }
  const lignes = fs.readFileSync(fichierResultats, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (!lignes.length) throw new Error(`resultats.jsonl est vide dans ${dossier} : rien à juger`);
  const ancien = fs.existsSync(path.join(dossier, 'resume.json')) ? JSON.parse(fs.readFileSync(path.join(dossier, 'resume.json'), 'utf8')) : null;
  if (!ancien || ancien.provisoire) {
    throw new Error(`le passage de ${dossier} n'est pas allé au bout (interrompu ou en erreur) : ses résultats partiels se consultent dans resultats.jsonl mais ne se rejugent pas. Relancez le passage.`);
  }
  const ctx = preparerControles(config.controles, config.contexte);
  const maintenantRejuge = deps.maintenant || new Date();
  const registre = ouvrirRegistre(config.dossier_donnees, config.plafond_usd, { passe: `rejuge-${path.basename(dossier)}`, horodatage: maintenantRejuge.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-'), entrees: lignes.length });
  let fini = false;
  let rejugementEnCours = null;
  try {
    const j = await preparerJuge(config, true, { ...deps, env });
    verifierReste(j, registre, true);
    // Les contrôles automatiques sont refaits aussi : la configuration a pu changer.
    for (const l of lignes) l.drapeaux = l.echanges.flatMap((e, i) => controler(e.reponse, ctx).map((d) => ({ ...d, tour: i + 1 })));
    // Un rejugement repart de zéro et se marque provisoire dès le départ : interrompu, il ne laisse
    // ni verdicts de l'ancienne grille ni rapport précédent présenté comme le dernier.
    for (const l of lignes) l.juge = null;
    verdicts(lignes, config, ctx);
    ecrire(dossier, 'resume-rejuge.json', JSON.stringify({ passe: `${ancien.passe} (rejugé)`, provisoire: 'rejugement en cours ou interrompu : relancez-le pour obtenir un rapport' }, null, 2) + '\n');
    ecrire(dossier, 'rapport-rejuge.md', '# Rejugement en cours ou interrompu\n\nCe rejugement n\'est pas allé au bout : relancez `--rejuger` pour obtenir un rapport.\n');
    const ecrireEnCours = () => {
      verdicts(lignes, config, ctx);
      ecrire(dossier, 'resultats-rejuges.jsonl', jsonl(lignes));
    };
    rejugementEnCours = () => {
      ecrireEnCours();
      balayerApresInterruption(dossier, config, env);
    };
    registre.avantSortie = rejugementEnCours;
    const arretJuge = await phaseJuge(lignes, j, registre, log, { apresVerdict: ecrireEnCours });
    verdicts(lignes, config, ctx);
    const maintenant = maintenantRejuge;
    const resume = resumer(lignes, {
      passe: `${ancien.passe} (rejugé)`,
      horodatage: ancien.horodatage,
      date_utc: maintenant.toISOString().slice(0, 16).replace('T', ' '),
      cible: ancien.cible,
      dossier_nom: path.basename(dossier),
      juge: j.juge.modele,
      juge_arrete: arretJuge,
      date_reponses_utc: ancien.date_utc,
      repetitions: ancien.repetitions || 1,
      cout_juge_usd: Number(registre.juge.toFixed(6)),
      cout_cible_estime_usd: 0,
      cumul_banc_usd: Number(registre.cumul.toFixed(6)),
      plafond_usd: config.plafond_usd,
    });
    registre.fermer();
    fini = true;
    ecrireResultats(dossier, '-rejuge', lignes, resume, config, env, ctx);
    return { dossier, resume, lignes };
  } finally {
    if (!fini) {
      try {
        rejugementEnCours?.();
      } catch {
        /* le registre est déjà à jour */
      }
      registre.fermer({ termine: false, erreur: true });
    }
  }
}
