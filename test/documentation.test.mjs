// La documentation ne doit pas mentir sur la configuration : les exemples se chargent tels quels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { preparerConfiguration, lireConfiguration } from '../src/configuration.mjs';
import { RACINE, CONFIG_DEMO } from './aides.mjs';

test('les configurations d’exemple se chargent et se valident', () => {
  for (const f of ['exemples/configuration.exemple.json', 'exemples/configuration.demo.json']) {
    const c = lireConfiguration(path.join(RACINE, f));
    assert.ok(c.cible.url && c.contexte.entreprise, f);
  }
});

test('chaque exemple JSON de docs/configuration.md est une configuration valide', () => {
  const doc = fs.readFileSync(path.join(RACINE, 'docs/configuration.md'), 'utf8');
  const blocs = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocs.length >= 4);
  for (const b of blocs) {
    const brut = structuredClone(CONFIG_DEMO);
    if (b.cible) brut.cible = b.cible;
    if (b.juge) brut.juge = b.juge;
    const c = preparerConfiguration(brut, RACINE);
    assert.ok(c.cible.corps);
  }
});
