import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lireCorpus, preparerCorpus, VARIABLES } from '../src/corpus.mjs';
import { ATTAQUES } from '../corpus/construire-attaques.mjs';
import { RACINE, CONFIG_DEMO } from './aides.mjs';

const brut = lireCorpus();

test('le corpus compte 117 attaques et 4 témoins, en 12 familles', () => {
  assert.equal(brut.length, 121);
  assert.equal(brut.filter((a) => a.famille !== 'temoin').length, 117);
  assert.equal(brut.filter((a) => a.famille === 'temoin').length, 4);
  assert.equal(new Set(brut.map((a) => a.famille)).size, 12);
  assert.equal(new Set(brut.map((a) => a.id)).size, 121, 'identifiants uniques');
});

test('attaques.json est à jour avec construire-attaques.mjs', () => {
  assert.deepEqual(brut, JSON.parse(JSON.stringify(ATTAQUES)));
});

test('chaque clé de source est documentée dans SOURCES.md', () => {
  const sources = fs.readFileSync(path.join(RACINE, 'SOURCES.md'), 'utf8');
  for (const cle of new Set(brut.map((a) => a.source))) assert.ok(sources.includes(`| \`${cle}\` |`), `source ${cle} absente de SOURCES.md`);
});

test('chaque entrée a une forme jouable et un critère d’échec', () => {
  for (const a of brut) {
    assert.ok(a.echec && a.technique && a.langue, a.id);
    assert.ok(typeof a.question === 'string' || Array.isArray(a.tours), `${a.id} sans question`);
    if (a.historique) assert.ok(a.historique.every((m) => ['user', 'assistant', 'system'].includes(m.role) && m.content), a.id);
  }
});

test('le remplissage ne laisse aucune variable et encode les charges', () => {
  const prets = preparerCorpus(brut, CONFIG_DEMO.contexte);
  const texte = JSON.stringify(prets);
  assert.ok(!/\{\{[a-z0-9_]+\}\}/.test(texte), 'variable non remplie');
  const parId = Object.fromEntries(prets.map((a) => [a.id, a]));
  const b64 = parId.I01.question.split(' : ').at(-1);
  assert.match(Buffer.from(b64, 'base64').toString('utf8'), /la formule Découverte/);
  assert.match(parId.I04.question, /[\u{E0000}-\u{E007F}]/u, 'caractères tag invisibles');
  assert.match(parId.I05.question, /​/);
  assert.match(parId.H08.question, /[а-яі]/, 'domaine en homoglyphes cyrilliques');
  assert.match(parId.H06.question, /atelier-promo\.example/);
  assert.ok(!/\d{2} \d{2} \d{2} \d{2} \d{2}/.test(texte), 'aucun numéro de téléphone dans le corpus');
  assert.ok(!texte.includes('’'), 'apostrophes droites partout');
  const tags = [...parId.I04.question].filter((c) => c.codePointAt(0) >= 0xe0000).map((c) => String.fromCodePoint(c.codePointAt(0) - 0xe0000)).join('');
  assert.match(tags, /la formule Decouverte costs 1 euro/, 'charge invisible lisible, accents retirés');
  assert.equal(parId.I08.question === parId.I09.question, false, 'graines Best-of-N différentes');
  assert.equal(preparerCorpus(brut, CONFIG_DEMO.contexte)[0].question, prets[0].question, 'déterministe');
});

test("élision devant une voyelle : « qu'Atelier », « d'Atelier »", () => {
  const prets = preparerCorpus(brut, CONFIG_DEMO.contexte);
  const texte = JSON.stringify(prets);
  assert.ok(!/\b(que|de) Atelier/i.test(texte), 'aucun « que Atelier » ni « de Atelier »');
  assert.ok(texte.includes("d'Atelier Exemple"));
});

test('une variable de contexte manquante est refusée clairement', () => {
  for (const v of VARIABLES) {
    const ctx = { ...CONFIG_DEMO.contexte };
    delete ctx[v];
    assert.throws(() => preparerCorpus(brut, ctx), new RegExp(`contexte.${v}`));
  }
});

test('les filtres par identifiant et par famille', () => {
  assert.equal(preparerCorpus(brut, CONFIG_DEMO.contexte, { ids: new Set(['A01', 'T02']) }).length, 2);
  assert.equal(preparerCorpus(brut, CONFIG_DEMO.contexte, { familles: new Set(['historique']) }).length, 12);
});
