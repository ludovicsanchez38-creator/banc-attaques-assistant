// Chargement du corpus : remplissage des variables {{...}} avec la section "contexte" de la
// configuration, encodage des charges, filtres par identifiant ou par famille.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoder } from './encodages.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const FICHIER_CORPUS = path.resolve(ICI, '../corpus/attaques.json');

/** Variables que le corpus peut utiliser. Toutes doivent être fournies dans "contexte". */
export const VARIABLES = ['entreprise', 'assistant', 'dirigeant', 'offre', 'offre_2', 'offre_absente', 'concurrent', 'ville', 'domaine'];

export function lireCorpus(fichier = FICHIER_CORPUS) {
  return JSON.parse(fs.readFileSync(fichier, 'utf8'));
}

/** Variables dérivées, calculées à partir du contexte. */
function variablesCompletes(contexte) {
  const v = {};
  for (const k of VARIABLES) {
    if (typeof contexte?.[k] !== 'string' || !contexte[k].trim()) throw new Error(`contexte.${k} manquant dans la configuration`);
    v[k] = contexte[k].trim();
  }
  // example.org -> example-promo.org : un domaine qui imite celui du site (attaque H06).
  const m = v.domaine.match(/^(.*?)(\.[^.]+)$/);
  v.domaine_promo = m ? `${m[1]}-promo${m[2]}` : `${v.domaine}-promo`;
  return v;
}

// Élision devant une valeur qui commence par une voyelle : « que Atelier » devient « qu'Atelier »,
// « de Atelier » devient « d'Atelier ». Un h initial est laissé tel quel (muet ou aspiré, on ne sait pas).
const VOYELLE = /^[aeiouyàâäéèêëîïôöùûüAEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/;
export function remplir(texte, v) {
  const elide = String(texte).replace(/\b(que|Que|de|De) \{\{([a-z0-9_]+)\}\}/g, (tout, mot, nom) =>
    nom in v && VOYELLE.test(v[nom]) ? `${mot.slice(0, -1)}'{{${nom}}}` : tout,
  );
  return elide.replace(/\{\{([a-z0-9_]+)\}\}/g, (tout, nom) => {
    if (nom === 'charge') return tout; // traité à part
    if (!(nom in v)) throw new Error(`variable inconnue dans le corpus : {{${nom}}}`);
    return v[nom];
  });
}

function remplirQuestion(texte, att, v) {
  let q = remplir(texte, v);
  // Fonction de remplacement : un « $& » dans le texte encodé ne doit rien réinjecter.
  if (att.charge) q = q.replace('{{charge}}', () => encoder(att.charge, remplir(att.charge.texte, v)));
  return q;
}

/** Vos propres questions légitimes, ajoutées aux 4 témoins du corpus (identifiants T05, T06...). */
export function temoinsSupplementaires(questions = []) {
  return questions.map((q, i) => ({
    id: `T${String(i + 5).padStart(2, '0')}`,
    famille: 'temoin',
    technique: 'question légitime ajoutée par la configuration',
    source: 'temoin',
    langue: 'fr',
    question: q,
    echec: 'refuse, invente ou se trompe',
  }));
}

/** Renvoie le corpus prêt à jouer, avec les variables remplies et les charges encodées. */
export function preparerCorpus(brut, contexte, { ids = null, familles = null, temoins = [] } = {}) {
  const v = variablesCompletes(contexte);
  return [...brut, ...temoinsSupplementaires(temoins)]
    .filter((a) => (!ids || ids.has(a.id)) && (!familles || familles.has(a.famille)))
    .map((a) => {
      const out = { ...a, echec: remplir(a.echec, v) };
      delete out.charge;
      if (a.question !== undefined) out.question = remplirQuestion(a.question, a, v);
      if (a.tours) out.tours = a.tours.map((t) => remplir(t, v));
      if (a.historique) out.historique = a.historique.map((m) => ({ role: m.role, content: remplir(m.content, v) }));
      return out;
    });
}
