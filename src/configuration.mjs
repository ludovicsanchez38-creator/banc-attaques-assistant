// Lecture et validation de la configuration du banc (un fichier JSON, voir docs/configuration.md).
// Les secrets ne s'écrivent jamais dans ce fichier : l'adresse, un en-tête ou une valeur du corps
// peut citer une variable d'environnement sous la forme ${NOM}, remplacée au moment de l'envoi.

import fs from 'node:fs';
import path from 'node:path';

// Tarifs connus du juge, en dollars par million de tokens, lus le 09/10/2026 sur
// https://platform.claude.com/docs/en/about-claude/pricing (prix de base, hors cache et hors
// traitement par lots). « palier » : tarif appliqué au-delà d'un nombre de tokens d'entrée
// (Haiku 5.5 au-delà de 100 000). Pour un autre modèle, donnez juge.tarif_usd_par_million.
export const TARIFS_CONNUS = {
  'claude-fable-5-1': { entree: 10, sortie: 50 },
  'claude-fable-5': { entree: 10, sortie: 50 },
  'claude-opus-5-5': { entree: 4, sortie: 20 },
  'claude-opus-5': { entree: 5, sortie: 25 },
  'claude-opus-4-8': { entree: 5, sortie: 25 },
  'claude-opus-4-7': { entree: 5, sortie: 25 },
  'claude-opus-4-6': { entree: 5, sortie: 25 },
  'claude-sonnet-5-5': { entree: 2, sortie: 10 },
  'claude-sonnet-5': { entree: 2, sortie: 10 },
  'claude-sonnet-4-6': { entree: 3, sortie: 15 },
  'claude-haiku-5-5': { entree: 0.1, sortie: 0.5, palier: { au_dela_de: 100_000, entree: 0.5, sortie: 2.5 } },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
};

/** Adresse locale (juge factice, passerelle sur la machine) : seul cas où un tarif nul est admis. */
export const adresseLocale = (url) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

const PARAMETRES_PAR_DEFAUT = {
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' } },
  'claude-haiku-5-5': { thinking: { type: 'disabled' } },
};

// Paramètres d'appel que la configuration peut ajouter. Tout le reste (modèle, max_tokens,
// outils...) est refusé : ces valeurs servent au calcul du plafond.
const PARAMETRES_PERMIS = new Set(['thinking', 'output_config', 'metadata']);

export const DEFAUTS = {
  plafond_usd: 3,
  dossier_resultats: 'resultats',
  dossier_donnees: '.banc',
  concurrence: 1,
  temoins_supplementaires: [],
  cible: {
    methode: 'POST',
    entetes: {},
    historique: {
      mode: 'corps',
      format_message: { role: '{{role}}', content: '{{contenu}}' },
      roles: { utilisateur: 'user', assistant: 'assistant', systeme: 'system' },
      attributs_assistant: {},
    },
    reponse: { format: 'json', chemin: 'reponse' },
    session: { cookies: true, chemin_identifiant: null },
    statuts_refus: [400, 403, 422],
    delai_entre_requetes_ms: 0,
    delai_max_ms: 60_000,
    cout_estime_par_appel_usd: 0,
  },
  controles: {
    liens_autorises: null,
    marqueurs_fuite: [],
    fichier_consignes: null,
    fichier_base: null,
    motifs_interdits: [],
    longueur_max: 1200,
  },
  juge: {
    modele: 'claude-sonnet-5-5',
    tarif_usd_par_million: null,
    max_tokens: 400,
    parametres: null,
    variable_cle: 'ANTHROPIC_API_KEY',
    url_api: null,
    fichier_grille: null,
  },
};

const estObjet = (x) => x && typeof x === 'object' && !Array.isArray(x);
function fusion(base, ajout) {
  if (!estObjet(ajout)) return ajout === undefined ? base : ajout;
  const out = { ...base };
  for (const [k, v] of Object.entries(ajout)) out[k] = estObjet(v) && estObjet(base?.[k]) ? fusion(base[k], v) : v;
  return out;
}

function erreur(msg) {
  return new Error(`configuration : ${msg}`);
}

export function validerConfiguration(c) {
  if (!c.cible?.url || !/^https?:\/\//.test(c.cible.url)) throw erreur('cible.url doit être une adresse http:// ou https://');
  if (!['POST', 'PUT', 'PATCH'].includes(c.cible.methode)) throw erreur('cible.methode doit être POST, PUT ou PATCH');
  if (!c.cible.corps || typeof c.cible.corps !== 'object') throw erreur('cible.corps est obligatoire : un objet JSON qui contient {{question}} ou {{messages}}');
  const corps = JSON.stringify(c.cible.corps);
  if (!corps.includes('{{question}}') && !corps.includes('{{messages}}')) throw erreur('cible.corps doit contenir {{question}} ou {{messages}}');
  const mode = c.cible.historique?.mode;
  if (!['corps', 'session', 'aucun'].includes(mode)) throw erreur('cible.historique.mode doit valoir "corps", "session" ou "aucun"');
  if (mode === 'corps' && !corps.includes('{{historique}}') && !corps.includes('{{messages}}')) {
    throw erreur('avec historique.mode "corps", cible.corps doit contenir {{historique}} ou {{messages}}');
  }
  // {{historique}} et {{messages}} sont des tableaux : ils doivent occuper une valeur entière.
  const chaines = [];
  const parcourir = (x) => (typeof x === 'string' ? chaines.push(x) : x && typeof x === 'object' ? Object.values(x).forEach(parcourir) : null);
  parcourir(c.cible.corps);
  for (const ch of chaines) {
    if (/\{\{(historique|messages)\}\}/.test(ch) && !/^\{\{(historique|messages)\}\}$/.test(ch)) throw erreur(`dans cible.corps, ${ch.match(/\{\{(historique|messages)\}\}/)[0]} doit occuper toute la valeur (c'est un tableau) et ne peut pas figurer dans un texte`);
  }
  if (!['json', 'texte', 'sse'].includes(c.cible.reponse?.format)) throw erreur('cible.reponse.format doit valoir "json", "texte" ou "sse"');
  if (c.cible.reponse.format !== 'texte' && !c.cible.reponse.chemin) throw erreur('cible.reponse.chemin est obligatoire pour les formats json et sse');
  if (!Array.isArray(c.cible.statuts_refus) || !c.cible.statuts_refus.every((s) => Number.isInteger(s) && s >= 400 && s < 600)) throw erreur('cible.statuts_refus doit être une liste de statuts HTTP 4xx ou 5xx');
  if (typeof c.cible.cout_estime_par_appel_usd !== 'number' || !(c.cible.cout_estime_par_appel_usd >= 0)) throw erreur('cible.cout_estime_par_appel_usd doit être un nombre positif ou nul');
  if (typeof c.plafond_usd !== 'number' || !(c.plafond_usd > 0)) throw erreur('plafond_usd doit être un nombre positif');
  if (!Number.isInteger(c.concurrence) || c.concurrence < 1 || c.concurrence > 8) throw erreur('concurrence doit être un entier entre 1 et 8');
  if (!Array.isArray(c.temoins_supplementaires) || c.temoins_supplementaires.length > 50 || !c.temoins_supplementaires.every((q) => typeof q === 'string' && q.trim())) {
    throw erreur('temoins_supplementaires doit être une liste de 50 questions au plus');
  }
  if (!Number.isInteger(c.juge.max_tokens) || c.juge.max_tokens < 50 || c.juge.max_tokens > 8192) throw erreur('juge.max_tokens doit être un entier entre 50 et 8192');
  if (c.juge.url_api && !(/^https:\/\//.test(c.juge.url_api) || (/^http:\/\//.test(c.juge.url_api) && adresseLocale(c.juge.url_api)))) {
    throw erreur('juge.url_api doit être une adresse https:// (http:// seulement sur la machine locale) : la clé y est envoyée');
  }
  const entier = (v, min) => Number.isInteger(v) && v >= min;
  if (!entier(c.cible.delai_entre_requetes_ms, 0)) throw erreur('cible.delai_entre_requetes_ms doit être un entier positif ou nul');
  if (!entier(c.cible.delai_max_ms, 1000)) throw erreur('cible.delai_max_ms doit être un entier d\'au moins 1000');
  if (!entier(c.controles.longueur_max, 0)) throw erreur('controles.longueur_max doit être un entier positif ou nul');
  for (const k of Object.keys(c.juge.parametres || {})) {
    if (!PARAMETRES_PERMIS.has(k)) throw erreur(`juge.parametres.${k} n'est pas permis (seulement ${[...PARAMETRES_PERMIS].join(', ')})`);
  }
  for (const m of c.controles.motifs_interdits || []) {
    if (!m.code || !m.motif) throw erreur('chaque entrée de controles.motifs_interdits a un code et un motif');
    new RegExp(m.motif, 'iu'); // lève une erreur si l'expression est invalide
  }
  return c;
}

/** Charge le fichier, fusionne les valeurs par défaut et résout les chemins relatifs au fichier. */
export function lireConfiguration(fichier) {
  let brut;
  try {
    brut = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch (e) {
    throw erreur(`impossible de lire ${fichier} (${e.message})`);
  }
  return preparerConfiguration(brut, path.dirname(path.resolve(fichier)));
}

export function preparerConfiguration(brut, dossierBase = process.cwd()) {
  const c = fusion(DEFAUTS, brut);
  // Ces objets donnés par l'utilisateur remplacent ceux par défaut, sans fusion.
  if (brut?.cible?.historique?.format_message) c.cible.historique.format_message = brut.cible.historique.format_message;
  if (brut?.juge?.parametres) c.juge.parametres = brut.juge.parametres;
  // Sans paramètres donnés : pas de réflexion préalable pour les deux modèles connus, avec le réglage
  // que chacun accepte (between_tools pour Sonnet 5.5, disabled pour Haiku 5.5), pour qu'un verdict
  // court ne soit pas coupé par max_tokens. Rien pour un autre modèle.
  if (!c.juge.parametres) c.juge.parametres = PARAMETRES_PAR_DEFAUT[c.juge.modele] || {};
  // Un corps JSON part avec Content-Type: application/json, sauf si vous en donnez un autre.
  if (!Object.keys(c.cible.entetes || {}).some((k) => k.toLowerCase() === 'content-type')) c.cible.entetes = { 'Content-Type': 'application/json', ...(c.cible.entetes || {}) };
  const absolu = (p) => (p ? path.resolve(dossierBase, p) : p);
  c.dossier_resultats = absolu(c.dossier_resultats);
  c.dossier_donnees = absolu(c.dossier_donnees);
  c.controles.fichier_consignes = absolu(c.controles.fichier_consignes);
  c.controles.fichier_base = absolu(c.controles.fichier_base);
  c.juge.fichier_grille = absolu(c.juge.fichier_grille);
  if (!c.controles.liens_autorises && c.contexte?.domaine) {
    c.controles.liens_autorises = [`https://${c.contexte.domaine}/`, `https://www.${c.contexte.domaine}/`];
    if (c.contexte.lien_contact) c.controles.liens_autorises.push(c.contexte.lien_contact);
  }
  c.cible.methode = String(c.cible.methode).toUpperCase();
  return validerConfiguration(c);
}

/**
 * Tarif du juge : celui de la configuration, sinon un tarif connu, sinon erreur. Pour un modèle
 * connu, on garde le plus élevé des deux : un tarif saisi trop bas ne peut pas desserrer le plafond.
 */
export function tarifJuge(juge) {
  const donne = juge.tarif_usd_par_million;
  const connu = TARIFS_CONNUS[juge.modele];
  if (donne && !(typeof donne.entree === 'number' && donne.entree >= 0 && typeof donne.sortie === 'number' && donne.sortie >= 0)) throw erreur('juge.tarif_usd_par_million doit contenir deux nombres positifs, entree et sortie');
  const t = donne && connu ? { ...connu, entree: Math.max(donne.entree, connu.entree), sortie: Math.max(donne.sortie, connu.sortie) } : donne || connu;
  if (!t) throw erreur(`tarif inconnu pour le modèle juge « ${juge.modele} » : renseignez juge.tarif_usd_par_million {"entree": ..., "sortie": ...}`);
  // Un tarif nul neutraliserait le plafond : admis seulement pour un juge sur la machine locale.
  if ((t.entree === 0 || t.sortie === 0) && !adresseLocale(juge.url_api || '')) throw erreur('juge.tarif_usd_par_million nul : admis seulement pour un juge local (juge.url_api sur localhost ou 127.0.0.1)');
  return t;
}

/** Remplace ${NOM} par la variable d'environnement correspondante (erreur si absente). */
export function resoudreEnv(valeur, env = process.env) {
  return String(valeur).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, nom) => {
    if (env[nom] === undefined || env[nom] === '') throw erreur(`variable d'environnement ${nom} absente (citée dans la cible)`);
    return env[nom];
  });
}

/** Noms des variables d'environnement citées par la cible (adresse, en-têtes, corps). */
export const variablesCitees = (c) => [...new Set([...JSON.stringify(c.cible).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))];

/** Vérifie avant de jouer que chaque variable citée existe (sinon, 121 erreurs au lieu d'une). */
export function verifierEnv(c, env = process.env) {
  for (const nom of variablesCitees(c)) resoudreEnv(`\${${nom}}`, env);
}

/** Valeurs secrètes citées par la configuration, pour le balayage final des résultats. */
export function secretsCites(c, env = process.env) {
  return [...variablesCitees(c), c.juge.variable_cle].map((n) => env[n]).filter((v) => typeof v === 'string' && v.length >= 8);
}
