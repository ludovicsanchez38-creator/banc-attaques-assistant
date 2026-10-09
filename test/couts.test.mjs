import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ouvrirRegistre, lireCouts } from '../src/couts.mjs';
import { dossierTemporaire } from './aides.mjs';

test('le registre est réécrit après chaque dépense, avant même la fin du passage', () => {
  const d = dossierTemporaire();
  const r = ouvrirRegistre(d, 1, { passe: 'a' });
  r.ajouterJuge(0.2);
  r.ajouterCible(0.05);
  const pendant = lireCouts(d);
  assert.equal(pendant.juge_usd, 0.2);
  assert.equal(pendant.cible_usd, 0.05);
  assert.equal(pendant.passes.at(-1).termine, false);
  r.fermer();
  assert.equal(lireCouts(d).passes.at(-1).termine, true);
  assert.ok(!fs.existsSync(path.join(d, 'verrou')), 'verrou libéré');
});

test('plafond : peut() refuse ce qui dépasserait, et un registre plein refuse d’ouvrir', () => {
  const d = dossierTemporaire();
  const r = ouvrirRegistre(d, 0.5, { passe: 'a' });
  assert.ok(r.peut(0.5));
  r.ajouterJuge(0.4);
  assert.ok(!r.peut(0.2));
  r.ajouterJuge(0.1);
  r.fermer();
  assert.throws(() => ouvrirRegistre(d, 0.5, { passe: 'b' }), /plafond du banc atteint/);
  assert.ok(!fs.existsSync(path.join(d, 'verrou')), 'verrou libéré après refus');
});

test('deux passages ne partagent pas le même registre ; un verrou orphelin est repris', () => {
  const d = dossierTemporaire();
  // Verrou tenu par un autre processus vivant (le processus parent du test).
  fs.writeFileSync(path.join(d, 'verrou'), String(process.ppid));
  assert.throws(() => ouvrirRegistre(d, 1, { passe: 'b' }), /un autre passage/);
  fs.writeFileSync(path.join(d, 'verrou'), '999999999'); // processus qui n'existe pas
  ouvrirRegistre(d, 1, { passe: 'c' }).fermer();
  fs.writeFileSync(path.join(d, 'verrou'), String(process.pid)); // notre propre numéro : processus relancé
  ouvrirRegistre(d, 1, { passe: 'd' }).fermer();
  assert.ok(!fs.existsSync(path.join(d, 'verrou')));
});

test('un registre illisible ou incohérent bloque au lieu de repartir de zéro', () => {
  const d = dossierTemporaire();
  fs.writeFileSync(path.join(d, 'couts.json'), '{"juge_usd": 2.9, "cible');
  assert.throws(() => ouvrirRegistre(d, 3, { passe: 'a' }), /illisible/);
  fs.writeFileSync(path.join(d, 'couts.json'), '{"juge_usd": -5, "cible_usd": 0, "passes": []}');
  assert.throws(() => lireCouts(d), /incohérent/);
});
