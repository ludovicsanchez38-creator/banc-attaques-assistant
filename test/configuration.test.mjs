import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparerConfiguration, resoudreEnv, secretsCites, verifierEnv, variablesCitees } from '../src/configuration.mjs';
import { lireArguments } from '../banc.mjs';
import { CONFIG_DEMO, RACINE } from './aides.mjs';

const avec = (modifs) => ({ ...structuredClone(CONFIG_DEMO), ...modifs });
const cible = (m) => ({ cible: { ...structuredClone(CONFIG_DEMO.cible), ...m } });

test('la configuration de démonstration est valide et complétée par les défauts', () => {
  const c = preparerConfiguration(structuredClone(CONFIG_DEMO), RACINE);
  assert.equal(c.cible.methode, 'POST');
  assert.equal(c.cible.historique.mode, 'corps');
  assert.deepEqual(c.controles.liens_autorises, ['https://atelier.example/', 'https://www.atelier.example/', 'https://atelier.example/contact']);
  assert.equal(c.cible.entetes['Content-Type'], 'application/json');
  assert.equal(c.plafond_usd, 3);
});

test('Content-Type ajouté si absent, gardé si donné ; thinking par défaut seulement pour Sonnet 5.5', () => {
  const a = preparerConfiguration(avec(cible({ entetes: { Authorization: 'Bearer ${X}' } })), RACINE);
  assert.deepEqual(a.cible.entetes, { 'Content-Type': 'application/json', Authorization: 'Bearer ${X}' });
  const b = preparerConfiguration(avec(cible({ entetes: { 'content-type': 'application/vnd.api+json' } })), RACINE);
  assert.deepEqual(b.cible.entetes, { 'content-type': 'application/vnd.api+json' });
  const sonnet = preparerConfiguration(avec({ juge: { modele: 'claude-sonnet-5-5' } }), RACINE);
  assert.deepEqual(sonnet.juge.parametres, { thinking: { type: 'between_tools' } });
  const haiku = preparerConfiguration(avec({ juge: { modele: 'claude-haiku-5-5' } }), RACINE);
  assert.deepEqual(haiku.juge.parametres, { thinking: { type: 'disabled' } });
  const autre = preparerConfiguration(avec({ juge: { modele: 'autre-modele', tarif_usd_par_million: { entree: 1, sortie: 1 } } }), RACINE);
  assert.deepEqual(autre.juge.parametres, {});
});

test('les erreurs de configuration sont nommées', () => {
  const cas = [
    [cible({ url: 'ftp://x' }), /cible\.url/],
    [cible({ corps: { message: 'fixe' } }), /\{\{question\}\}/],
    [cible({ corps: '{"q":"{{question}}"}' }), /objet JSON/],
    [cible({ corps: { q: '{{question}}' } }), /historique.mode "corps"/],
    [cible({ historique: { mode: 'autre' } }), /historique\.mode/],
    [cible({ reponse: { format: 'xml' } }), /reponse\.format/],
    [cible({ methode: 'GET' }), /methode/],
    [cible({ cout_estime_par_appel_usd: -0.01 }), /cout_estime_par_appel_usd/],
    [cible({ statuts_refus: [200] }), /statuts_refus/],
    [{ plafond_usd: 0 }, /plafond_usd/],
    [{ plafond_usd: '3' }, /plafond_usd/],
    [cible({ cout_estime_par_appel_usd: true }), /cout_estime_par_appel_usd/],
    [cible({ corps: { q: '{{question}}', h: 'avant {{historique}}' } }), /doit occuper toute la valeur/],
    [{ concurrence: 50 }, /concurrence/],
    [{ temoins_supplementaires: [''] }, /temoins_supplementaires/],
    [{ juge: { ...CONFIG_DEMO.juge, max_tokens: 200000 } }, /max_tokens/],
    [{ juge: { ...CONFIG_DEMO.juge, parametres: { max_tokens: 200000 } } }, /parametres\.max_tokens n'est pas permis/],
    [{ juge: { ...CONFIG_DEMO.juge, parametres: { model: 'autre' } } }, /parametres\.model n'est pas permis/],
    [{ controles: { motifs_interdits: [{ code: 'x', motif: '(' }] } }, /Invalid regular expression/],
    [{ juge: { ...CONFIG_DEMO.juge, url_api: 'http://passerelle.example.org' } }, /url_api doit être une adresse https/],
    [cible({ delai_max_ms: 10 }), /delai_max_ms/],
    [cible({ delai_entre_requetes_ms: -1 }), /delai_entre_requetes_ms/],
  ];
  for (const [m, re] of cas) assert.throws(() => preparerConfiguration(avec(m), RACINE), re, JSON.stringify(m).slice(0, 80));
});

test('les secrets viennent de l’environnement, vérifiés avant de jouer', () => {
  assert.equal(resoudreEnv('Bearer ${JETON_TEST}', { JETON_TEST: 'abc' }), 'Bearer abc');
  assert.throws(() => resoudreEnv('Bearer ${JETON_ABSENT}', {}), /JETON_ABSENT absente/);
  assert.throws(() => resoudreEnv('Bearer ${jeton_minuscule}', {}), /jeton_minuscule absente/, 'une variable en minuscules est reconnue aussi');
  const c = preparerConfiguration(avec(cible({ url: 'https://x.example/api?cle=${CLE_URL}', entetes: { Authorization: 'Bearer ${JETON_TEST}' }, corps: { q: '{{question}}', h: '{{historique}}', compte: '${COMPTE}' } })), RACINE);
  assert.deepEqual(variablesCitees(c).sort(), ['CLE_URL', 'COMPTE', 'JETON_TEST']);
  assert.throws(() => verifierEnv(c, { JETON_TEST: 'a' }), /CLE_URL absente/);
  const env = { JETON_TEST: 'jeton-de-test-123', CLE_URL: 'cle-url-456789', COMPTE: 'compte-7890123', JUGE_FACTICE_CLE: 'cle-du-juge-456' };
  assert.deepEqual(secretsCites(c, env).sort(), ['cle-du-juge-456', 'cle-url-456789', 'compte-7890123', 'jeton-de-test-123']);
});

test('arguments de la ligne de commande', () => {
  const o = lireArguments(['--passe', 'avant', '--ids', 'A01, B06', '--sans-juge', '--familles', 'liens', '--repetitions', '3']);
  assert.equal(o.passe, 'avant');
  assert.deepEqual([...o.ids], ['A01', 'B06']);
  assert.equal(o.juge, false);
  assert.equal(o.repetitions, 3);
  assert.deepEqual([...o.familles], ['liens']);
  assert.equal(lireArguments([]).aide, true, 'sans argument : l’aide');
  assert.throws(() => lireArguments(['--sans-juge']), /--passe/);
  assert.throws(() => lireArguments(['--passe', 'Avec Espace']), /--passe/);
  assert.throws(() => lireArguments(['--passe', 'a', '--inconnu']), /argument inconnu/);
  assert.throws(() => lireArguments(['--passe']), /attend une valeur/);
  assert.throws(() => lireArguments(['--passe', 'a', '--repetitions', '9']), /repetitions/);
  assert.equal(lireArguments(['--rejuger', 'resultats/x']).rejuger, 'resultats/x');
});
