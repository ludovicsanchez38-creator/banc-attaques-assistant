// Registre des dépenses du banc, cumulé d'un passage à l'autre dans <dossier_donnees>/couts.json.
// Le plafond (plafond_usd) porte sur ce cumul : une fois atteint, le banc refuse de repartir
// tant que vous n'avez pas déplacé ce fichier ou relevé le plafond, en connaissance de cause.
//
// Ce que le registre compte :
// - le juge, au coût réel renvoyé par l'API (usage) et au tarif de la configuration ; un appel
//   dont on ne sait pas s'il a été facturé (délai dépassé, erreur serveur) est compté à son
//   estimation haute ;
// - la cible, seulement si vous donnez cible.cout_estime_par_appel_usd (le banc ne voit pas
//   la facture de votre assistant), comptée au moment de l'envoi.
//
// Le registre est réécrit après chaque dépense (fichier temporaire puis renommage) : une
// interruption ne fait perdre aucune dépense. Un verrou empêche deux passages de partager le même registre.

import fs from 'node:fs';
import path from 'node:path';

const fichier = (dossier) => path.join(dossier, 'couts.json');

/** Refus lié au plafond : le banc sort alors avec le code 3. */
export class ErreurPlafond extends Error {
  code = 'PLAFOND';
}
const verrou = (dossier) => path.join(dossier, 'verrou');

/** Lit le registre. Absent : zéro. Présent mais illisible : erreur (jamais de remise à zéro silencieuse). */
export function lireCouts(dossier) {
  let brut;
  try {
    brut = fs.readFileSync(fichier(dossier), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { juge_usd: 0, cible_usd: 0, passes: [] };
    throw e;
  }
  let c;
  try {
    c = JSON.parse(brut);
  } catch {
    throw new Error(`registre des dépenses illisible (${fichier(dossier)}) : le banc refuse de repartir de zéro ; corrigez ou déplacez ce fichier en connaissance de cause`);
  }
  const juge = Number(c.juge_usd);
  const cible = Number(c.cible_usd);
  if (!(juge >= 0) || !(cible >= 0)) throw new Error(`registre des dépenses incohérent (${fichier(dossier)}) : montants négatifs ou absents`);
  return { juge_usd: juge, cible_usd: cible, passes: Array.isArray(c.passes) ? c.passes : [] };
}

export function ecrireCouts(dossier, c) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const tmp = `${fichier(dossier)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, fichier(dossier));
}

export const cumul = (c) => c.juge_usd + c.cible_usd;

const processusVivant = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// Le verrou est posé d'un seul geste (lien vers un fichier qui contient déjà le PID) : un autre
// processus ne peut jamais le lire vide.
function prendreVerrou(dossier) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const tmp = `${verrou(dossier)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, String(process.pid), { mode: 0o600 });
  try {
    for (let essai = 0; essai < 2; essai++) {
      try {
        fs.linkSync(tmp, verrou(dossier));
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid = 0;
        try {
          pid = Number(fs.readFileSync(verrou(dossier), 'utf8'));
        } catch {
          continue; // supprimé entre-temps : on réessaie
        }
        // Un verrou qui porte notre propre numéro (processus relancé, conteneur redémarré) est orphelin.
        if (!pid || (pid !== process.pid && processusVivant(pid))) throw new Error(`un autre passage (processus ${pid || 'inconnu'}) utilise déjà ce registre (${verrou(dossier)}) : attendez sa fin, ou donnez un autre dossier_donnees`);
        fs.unlinkSync(verrou(dossier)); // verrou laissé par un processus disparu
      }
    }
    throw new Error('impossible de poser le verrou du registre');
  } finally {
    fs.unlinkSync(tmp);
  }
}

function libererVerrou(dossier) {
  try {
    if (Number(fs.readFileSync(verrou(dossier), 'utf8')) === process.pid) fs.unlinkSync(verrou(dossier));
  } catch {
    /* déjà libéré */
  }
}

/**
 * Ouvre le registre pour un passage : pose le verrou, vérifie le plafond, et renvoie un compteur
 * qui réécrit le registre à chaque dépense. Toujours appeler fermer() (ou laisser le gestionnaire
 * de signal le faire).
 */
export function ouvrirRegistre(dossier, plafond, entree, { exigerReste = true } = {}) {
  prendreVerrou(dossier);
  let base;
  try {
    base = lireCouts(dossier);
  } catch (e) {
    libererVerrou(dossier);
    throw e;
  }
  const deja = cumul(base);
  // Un passage qui ne peut rien dépenser (sans juge, sans coût estimé de la cible) reste permis.
  if (exigerReste && deja >= plafond) {
    libererVerrou(dossier);
    throw new ErreurPlafond(`plafond du banc atteint (${deja.toFixed(4)} $ sur ${plafond} $) : voir « Plafond de dépense » dans le README`);
  }
  let juge = 0;
  let cible = 0;
  const ligne = { ...entree, juge_usd: 0, cible_usd: 0, termine: false };
  const persister = () => {
    ligne.juge_usd = Number(juge.toFixed(6));
    ligne.cible_usd = Number(cible.toFixed(6));
    ecrireCouts(dossier, { juge_usd: base.juge_usd + juge, cible_usd: base.cible_usd + cible, passes: [...base.passes, ligne] });
  };
  persister();
  let ferme = false;
  const fermer = (complement = {}) => {
    if (ferme) return;
    ferme = true;
    Object.assign(ligne, complement);
    persister();
    libererVerrou(dossier);
  };
  // L'objet rendu (défini plus bas) peut recevoir un crochet avantSortie, appelé sur interruption.
  let registre = null;
  const surSignal = (signal) => {
    // Dernier enregistrement des résultats et contrôle des secrets, avant de rendre la main.
    try {
      registre?.avantSortie?.();
    } catch (e) {
      process.stderr.write(`\nenregistrement final impossible : ${e?.message ?? e}\n`);
    }
    fermer({ interrompu: signal });
    process.stderr.write(`\npassage interrompu (${signal}) : registre des dépenses à jour\n`);
    process.exit({ SIGTERM: 143, SIGHUP: 129 }[signal] || 130);
  };
  process.once('SIGINT', surSignal);
  process.once('SIGTERM', surSignal);
  process.once('SIGHUP', surSignal); // terminal ou session SSH fermés
  // Pas d'Object.assign ici : il figerait la valeur des accesseurs juge, cible et cumul.
  registre = {
    avantSortie: null,
    deja,
    plafond,
    /** Vrai si `montant` peut encore être dépensé sans dépasser le plafond. */
    peut: (montant) => deja + juge + cible + montant <= plafond,
    ajouterJuge: (m) => {
      juge += m;
      persister();
    },
    ajouterCible: (m) => {
      cible += m;
      persister();
    },
    get juge() {
      return juge;
    },
    get cible() {
      return cible;
    },
    get cumul() {
      return deja + juge + cible;
    },
    fermer: (complement) => {
      process.removeListener('SIGINT', surSignal);
      process.removeListener('SIGTERM', surSignal);
      process.removeListener('SIGHUP', surSignal);
      fermer({ termine: true, ...complement });
    },
  };
  return registre;
}
