// Client HTTP générique : envoie une question à n'importe quel assistant conversationnel décrit
// dans la section "cible" de la configuration, et en extrait le texte de la réponse.
//
// Le corps de la requête est un gabarit JSON. Ses marqueurs :
//   "{{question}}"    la question du visiteur (aussi à l'intérieur d'une chaîne) ;
//   "{{historique}}"  la conversation précédente, sous forme de tableau de messages ;
//   "{{messages}}"    la conversation précédente PLUS la question, en un seul tableau
//                     (forme des API de type « chat completions ») ;
//   "{{session}}"     l'identifiant de conversation renvoyé par la cible au tour précédent.
// ${NOM} dans l'adresse, les en-têtes ou les chaînes du corps est remplacé par la variable
// d'environnement NOM. Aucun en-tête, aucun cookie n'est écrit dans les résultats.

import { resoudreEnv } from './configuration.mjs';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lit une valeur par un chemin pointé : "choices.0.message.content". */
export function valeurChemin(objet, chemin) {
  let v = objet;
  for (const morceau of String(chemin).split('.')) {
    if (v === null || v === undefined) return undefined;
    v = Array.isArray(v) && /^\d+$/.test(morceau) ? v[Number(morceau)] : v[morceau];
  }
  return v;
}

function remplacerDansChaine(s, valeurs) {
  return s.replace(/\{\{(question|session|role|contenu)\}\}/g, (tout, nom) => (valeurs[nom] === undefined || valeurs[nom] === null ? '' : String(valeurs[nom])));
}

/** Parcourt un gabarit JSON et remplace les marqueurs. Un marqueur seul dans sa chaîne garde son type. */
export function remplirGabarit(gabarit, valeurs) {
  if (typeof gabarit === 'string') {
    const seul = gabarit.match(/^\{\{(historique|messages|session|question|role|contenu)\}\}$/);
    if (seul && seul[1] in valeurs) return valeurs[seul[1]] === undefined ? null : valeurs[seul[1]];
    return remplacerDansChaine(gabarit, valeurs);
  }
  if (Array.isArray(gabarit)) return gabarit.map((x) => remplirGabarit(x, valeurs));
  if (gabarit && typeof gabarit === 'object') return Object.fromEntries(Object.entries(gabarit).map(([k, v]) => [k, remplirGabarit(v, valeurs)]));
  return gabarit;
}

function formaterMessages(messages, h) {
  const roles = { user: h.roles.utilisateur, assistant: h.roles.assistant, system: h.roles.systeme };
  return messages.map((m) => {
    const f = remplirGabarit(h.format_message, { role: roles[m.role] ?? m.role, contenu: m.content });
    // Attributs renvoyés par la cible avec sa réponse (une signature, par exemple), recopiés tels quels.
    return m.attributs && f && typeof f === 'object' && !Array.isArray(f) ? { ...f, ...m.attributs } : f;
  });
}

const resoudreDans = (x, env) => {
  if (typeof x === 'string') return resoudreEnv(x, env);
  if (Array.isArray(x)) return x.map((y) => resoudreDans(y, env));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, resoudreDans(v, env)]));
  return x;
};

/** Construit le corps de la requête pour une question, un historique et un état de session. */
export function construireCorps(cible, { question, historique = [], session = null }, env = process.env) {
  const h = cible.historique;
  const valeurs = {
    question,
    session,
    historique: formaterMessages(historique, h),
    messages: formaterMessages([...historique, { role: 'user', content: question }], h),
  };
  // Les variables d'environnement d'abord, les marqueurs ensuite : un texte d'attaque qui
  // contiendrait ${...} n'est jamais interprété.
  return JSON.stringify(remplirGabarit(resoudreDans(cible.corps, env), valeurs));
}

/** Extrait le texte de la réponse selon le format déclaré (json, texte ou sse). */
export function extraireTexte(reponse, brut) {
  if (reponse.format === 'texte') return { texte: brut };
  if (reponse.format === 'json') {
    let json;
    try {
      json = JSON.parse(brut);
    } catch {
      return { texte: '', erreur: 'réponse illisible : JSON attendu (voir cible.reponse.format)' };
    }
    const v = valeurChemin(json, reponse.chemin);
    if (typeof v !== 'string') return { texte: '', erreur: `chemin « ${reponse.chemin} » introuvable ou non textuel dans la réponse`, json };
    return { texte: v, json };
  }
  // sse : on concatène la valeur du chemin dans chaque événement « data: », et on garde les
  // événements lus pour y chercher l'identifiant de session ou les attributs à renvoyer.
  // Un événement qui n'est pas du JSON est pris tel quel comme fragment de texte.
  let texte = '';
  let lus = 0;
  const evenements = [];
  for (const ligne of brut.split(/\r?\n/)) {
    if (!ligne.startsWith('data:')) continue;
    const donnee = ligne.slice(5).replace(/^ /, '');
    if (!donnee.trim() || donnee.trim() === '[DONE]') continue;
    lus++;
    let objet;
    try {
      objet = JSON.parse(donnee);
    } catch {
      texte += donnee;
      continue;
    }
    evenements.push(objet);
    const v = valeurChemin(objet, reponse.chemin);
    if (typeof v === 'string') texte += v;
  }
  if (!texte && lus) return { texte: '', evenements, erreur: `aucun fragment de texte lu au chemin « ${reponse.chemin} » dans ${lus} événement(s) du flux (voir cible.reponse.chemin)` };
  if (!lus) return { texte: '', evenements, erreur: 'aucun événement « data: » dans la réponse : est-ce bien un flux SSE ? (voir cible.reponse.format)' };
  return { texte, evenements };
}

/** Dernière valeur trouvée à ce chemin dans les objets JSON reçus (une réponse, ou les événements d'un flux). */
function chercher(objets, chemin) {
  let trouve;
  for (const o of objets) {
    const v = valeurChemin(o, chemin);
    if (v !== undefined && v !== null) trouve = v;
  }
  return trouve;
}

function enTetes(cible, etat, env) {
  // resoudreEnv lève une erreur si une variable citée manque (vérifiée aussi avant le passage).
  const h = {};
  for (const [k, v] of Object.entries(cible.entetes || {})) h[k] = resoudreEnv(v, env);
  if (cible.session?.cookies && etat.cookies.size) h.Cookie = [...etat.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  return h;
}

function retenirSession(cible, etat, r, objets) {
  if (cible.session?.cookies) {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      if (i > 0) etat.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
  }
  if (cible.session?.chemin_identifiant) {
    const id = chercher(objets, cible.session.chemin_identifiant);
    if (id !== undefined) etat.session = id;
  }
}

function attributsDe(cible, objets) {
  const out = {};
  for (const [nom, chemin] of Object.entries(cible.historique?.attributs_assistant || {})) {
    const v = chercher(objets, chemin);
    if (v !== undefined) out[nom] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Envoie une question. Ne lève jamais : une panne réseau devient un statut 0 avec une erreur. */
export async function poser(cible, { question, historique = [], etat, env = process.env }) {
  if (cible.delai_entre_requetes_ms > 0) await attendre(cible.delai_entre_requetes_ms);
  let r;
  let brut = '';
  try {
    r = await fetch(resoudreEnv(cible.url, env), {
      method: cible.methode,
      headers: enTetes(cible, etat, env),
      body: construireCorps(cible, { question, historique, session: etat.session }, env),
      signal: AbortSignal.timeout(cible.delai_max_ms),
      redirect: 'manual',
    });
    brut = await r.text();
  } catch (e) {
    const code = e?.cause?.code || e?.name || '';
    const clair = {
      ENOTFOUND: 'adresse introuvable (DNS) : vérifiez cible.url',
      EAI_AGAIN: 'adresse introuvable pour le moment (DNS) : vérifiez cible.url et votre connexion',
      ECONNREFUSED: 'connexion refusée : le service tourne-t-il à cette adresse ?',
      ECONNRESET: 'connexion coupée par la cible',
      TimeoutError: `délai dépassé (cible.delai_max_ms = ${cible.delai_max_ms})`,
    }[code];
    return { statut: 0, texte: '', erreur: clair ? `requête impossible : ${clair}` : `requête impossible : ${code} ${e?.message || e}`.trim() };
  }
  if (r.status < 200 || r.status >= 300) return { statut: r.status, texte: '', erreur: null, extrait: brut.slice(0, 300) };
  const { texte, erreur, json, evenements } = extraireTexte(cible.reponse, brut);
  const objets = json ? [json] : evenements || [];
  retenirSession(cible, etat, r, objets);
  return { statut: r.status, texte, erreur: erreur || null, attributs: attributsDe(cible, objets), ...(erreur ? { extrait: brut.slice(0, 300) } : {}) };
}

/** Pourquoi une attaque ne s'applique pas à cette cible (ou null si elle se joue). */
export function nonApplicable(att, mode) {
  if (att.historique && mode !== 'corps') return "la cible ne reçoit pas d'historique dans la requête (historique.mode différent de \"corps\")";
  if (att.tours && mode === 'aucun') return 'la cible ne garde pas de conversation (historique.mode "aucun")';
  return null;
}

/**
 * Joue une attaque : une question, plusieurs tours ou un historique fabriqué.
 * `garde` est appelée avant chaque requête ; si elle renvoie false, on s'arrête (plafond atteint).
 */
export async function jouer(cible, att, garde = async () => true, env = process.env) {
  const mode = cible.historique.mode;
  const etat = { cookies: new Map(), session: null };
  const echanges = [];
  const questions = att.tours || [att.question];
  const historique = att.tours ? [] : att.historique || [];
  for (const q of questions) {
    if (!(await garde())) {
      echanges.push({ question: q, statut_http: null, reponse: '', erreur: 'non jouée : plafond de dépense atteint' });
      break;
    }
    const r = await poser(cible, { question: q, historique: mode === 'corps' ? historique : [], etat, env });
    echanges.push({ question: q, statut_http: r.statut, reponse: r.texte, erreur: r.erreur, ...(r.extrait ? { extrait: r.extrait } : {}) });
    if (r.statut < 200 || r.statut >= 300 || r.erreur || !r.texte.trim()) break;
    if (att.tours) historique.push({ role: 'user', content: q }, { role: 'assistant', content: r.texte, ...(r.attributs ? { attributs: r.attributs } : {}) });
  }
  return echanges;
}
