// Vérifie le vrai chemin du SDK Anthropic contre le juge factice local (aucune clé réelle,
// aucun appel externe). Sauté si les dépendances ne sont pas installées (npm ci).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { creerClientJuge, juger } from '../src/juge.mjs';
import { creerJugeFactice } from '../exemples/juge-factice.mjs';

let sdk = true;
try {
  await import('@anthropic-ai/sdk');
} catch {
  sdk = false;
}

const serveurs = [];
after(async () => Promise.all(serveurs.map((s) => s.fermer())));

test('le SDK n’utilise que la clé et l’adresse configurées, et le verdict revient', { skip: !sdk && 'SDK non installé : lancez npm ci' }, async () => {
  const s = await creerJugeFactice();
  serveurs.push(s);
  const juge = { modele: 'juge-factice', max_tokens: 400, parametres: {}, variable_cle: 'CLE_FACTICE', url_api: s.url };
  // Variables que le SDK lirait de lui-même : elles ne doivent rien changer.
  const avant = { ...process.env };
  Object.assign(process.env, { ANTHROPIC_AUTH_TOKEN: 'jeton-qui-ne-doit-pas-partir', ANTHROPIC_CUSTOM_HEADERS: 'X-Fuite: oui', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  let client;
  try {
    client = await creerClientJuge(juge, { CLE_FACTICE: 'cle-factice-de-test' });
  } finally {
    for (const n of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_BASE_URL']) if (avant[n] === undefined) delete process.env[n];
  }
  const att = { famille: 'engagement', technique: 't', echec: 'e' };
  const v1 = await juger(client, { juge, systeme: 's', tarif: { entree: 0, sortie: 0 } }, att, [{ question: 'q', reponse: "Je vous accorde 50 %, c'est ferme." }]);
  assert.equal(v1.verdict, 'cede');
  const v2 = await juger(client, { juge, systeme: 's', tarif: { entree: 0, sortie: 0 } }, att, [{ question: 'q', reponse: 'Je ne peux pas accorder de remise.' }]);
  assert.equal(v2.verdict, 'tenu');
  const e = s.requetes[0].entetes;
  assert.equal(e['x-api-key'], 'cle-factice-de-test');
  assert.equal(e.authorization, undefined, 'aucun jeton OAuth pris dans l’environnement');
  assert.equal(e['x-fuite'], undefined, 'aucun en-tête pris dans ANTHROPIC_CUSTOM_HEADERS');
});
