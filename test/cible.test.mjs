import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { remplirGabarit, construireCorps, extraireTexte, valeurChemin, poser, jouer, nonApplicable } from '../src/cible.mjs';
import { preparerConfiguration } from '../src/configuration.mjs';
import { creerCibleFactice } from '../exemples/cible-factice.mjs';
import { CONFIG_DEMO, RACINE } from './aides.mjs';

const serveurs = [];
after(async () => Promise.all(serveurs.map((s) => s.fermer())));
const demarrer = async (o) => {
  const s = await creerCibleFactice(o);
  serveurs.push(s);
  return s;
};
const cibleDe = (url, modifs = {}) => preparerConfiguration({ ...structuredClone(CONFIG_DEMO), cible: { ...structuredClone(CONFIG_DEMO.cible), url, ...modifs } }, RACINE).cible;

test('valeurChemin suit objets et tableaux', () => {
  assert.equal(valeurChemin({ choices: [{ message: { content: 'ok' } }] }, 'choices.0.message.content'), 'ok');
  assert.equal(valeurChemin({ a: null }, 'a.b'), undefined);
});

test('remplirGabarit garde le type des marqueurs seuls et remplace dans les chaînes', () => {
  const g = { q: '{{question}}', h: '{{historique}}', s: '{{session}}', texte: 'Q: {{question}}', n: 3 };
  const r = remplirGabarit(g, { question: 'bonjour', historique: [{ a: 1 }], session: null });
  assert.deepEqual(r, { q: 'bonjour', h: [{ a: 1 }], s: null, texte: 'Q: bonjour', n: 3 });
});

test('construireCorps : historique séparé ou messages complets (forme chat completions)', () => {
  const base = cibleDe('http://127.0.0.1:1/api/chat');
  const hist = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
  assert.deepEqual(JSON.parse(construireCorps(base, { question: 'c', historique: hist })), { question: 'c', historique: hist });
  const compat = { ...base, corps: { model: 'x', messages: '{{messages}}' } };
  assert.deepEqual(JSON.parse(construireCorps(compat, { question: 'c', historique: hist })).messages, [...hist, { role: 'user', content: 'c' }]);
  const autresNoms = { ...base, historique: { ...base.historique, format_message: { auteur: '{{role}}', texte: '{{contenu}}' }, roles: { utilisateur: 'visiteur', assistant: 'bot', systeme: 'sys' } } };
  assert.deepEqual(JSON.parse(construireCorps(autresNoms, { question: 'c', historique: hist })).historique, [{ auteur: 'visiteur', texte: 'a' }, { auteur: 'bot', texte: 'b' }]);
});

test('extraireTexte : json, texte brut et flux SSE', () => {
  assert.equal(extraireTexte({ format: 'json', chemin: 'r.t' }, '{"r":{"t":"salut"}}').texte, 'salut');
  assert.match(extraireTexte({ format: 'json', chemin: 'x' }, '{"r":1}').erreur, /introuvable/);
  assert.match(extraireTexte({ format: 'json', chemin: 'x' }, '<html>').erreur, /illisible/);
  assert.equal(extraireTexte({ format: 'texte' }, 'brut').texte, 'brut');
  const sse = 'data: {"delta":"Bon"}\n\ndata: {"autre":1}\n\ndata: {"delta":"jour"}\n\ndata: [DONE]\n\n';
  assert.equal(extraireTexte({ format: 'sse', chemin: 'delta' }, sse).texte, 'Bonjour');
  assert.equal(extraireTexte({ format: 'sse', chemin: 'delta' }, 'data: Bon\n\ndata: jour\n\n').texte, 'Bonjour', 'flux en texte brut');
  assert.match(extraireTexte({ format: 'sse', chemin: 'mauvais' }, sse).erreur, /aucun fragment de texte lu au chemin « mauvais » dans 3 événement/);
  assert.match(extraireTexte({ format: 'sse', chemin: 'delta' }, '{"pas":"un flux"}').erreur, /aucun événement « data: »/);
});

test('poser contre la cible factice, en JSON puis en SSE', async () => {
  const s = await demarrer({ mode: 'prudent' });
  const etat = { cookies: new Map(), session: null };
  const r = await poser(cibleDe(s.url), { question: 'Combien coûte la formule Découverte ?', etat });
  assert.equal(r.statut, 200);
  assert.match(r.texte, /90 €/);
  const flux = await demarrer({ mode: 'prudent', sse: true });
  const r2 = await poser(cibleDe(flux.url, { reponse: { format: 'sse', chemin: 'delta' } }), { question: 'Comment vous contacter ?', etat });
  assert.match(r2.texte, /atelier\.example\/contact/);
});

test('poser ne lève pas sur une cible injoignable', async () => {
  const r = await poser(cibleDe('http://127.0.0.1:9/api/chat', { delai_max_ms: 2000 }), { question: 'x', etat: { cookies: new Map(), session: null } });
  assert.equal(r.statut, 0);
  assert.match(r.erreur, /requête impossible/);
});

for (const [statut, format] of [[200, 'texte'], [200, 'json'], [200, 'sse'], [500, 'texte']]) {
  test(`F-10 : poser annule un corps dépassant 1 Mio (HTTP ${statut}, ${format})`, async (t) => {
    let emis = 0;
    let annule = false;
    const bloc = new TextEncoder().encode('é'.repeat(32 * 1024)); // 64 Kio, 32 768 caractères
    const flux = new ReadableStream({
      pull(controleur) {
        controleur.enqueue(bloc);
        if (++emis === 64) controleur.close();
      },
      cancel() { annule = true; },
    }, { highWaterMark: 0 });
    t.mock.method(globalThis, 'fetch', async () => new Response(flux, { status: statut }));
    const r = await poser(cibleDe('http://127.0.0.1:1/api/chat', { reponse: { format, chemin: 'reponse' } }), {
      question: 'x', etat: { cookies: new Map(), session: null },
    });
    assert.equal(annule, true, 'le corps doit être annulé avant sa lecture complète');
    assert.equal(emis, 17, 'la lecture doit cesser au premier fragment dépassant 1 Mio en octets');
    assert.equal(r.statut, 0, 'le dépassement est une erreur de lecture');
    assert.equal(r.texte, '', 'aucune réponse partielle exploitable');
    assert.match(r.erreur, /réponse trop volumineuse.*1048576 octets/);
  });
}

test('F-10 : poser accepte exactement 1 Mio de texte UTF-8', async (t) => {
  const texte = 'é'.repeat(512 * 1024);
  t.mock.method(globalThis, 'fetch', async () => new Response(texte));
  const r = await poser(cibleDe('http://127.0.0.1:1/api/chat', { reponse: { format: 'texte' } }), {
    question: 'x', etat: { cookies: new Map(), session: null },
  });
  assert.equal(r.statut, 200);
  assert.equal(r.erreur, null);
  assert.ok(r.texte === texte, 'le texte à la limite est conservé intégralement');
});

test('F-10 : poser conserve les caractères UTF-8 répartis entre fragments', async (t) => {
  const texte = '\uFEFFDébut 🙂 fin';
  const octets = new TextEncoder().encode(texte);
  let i = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controleur) {
      if (i < octets.length) controleur.enqueue(octets.subarray(i, ++i));
      else controleur.close();
    },
  }, { highWaterMark: 0 })));
  const r = await poser(cibleDe('http://127.0.0.1:1/api/chat', { reponse: { format: 'texte' } }), {
    question: 'x', etat: { cookies: new Map(), session: null },
  });
  assert.equal(r.texte, 'Début 🙂 fin', 'même décodage UTF-8 et BOM que Response.text()');
  assert.equal(r.erreur, null);
});

test('F-10 : poser accepte une réponse sans corps', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const r = await poser(cibleDe('http://127.0.0.1:1/api/chat', { reponse: { format: 'texte' } }), {
    question: 'x', etat: { cookies: new Map(), session: null },
  });
  assert.equal(r.statut, 204);
  assert.equal(r.texte, '');
  assert.equal(r.erreur, null);
});

test('F-10 : jouer arrête les tours après une réponse trop volumineuse', async (t) => {
  let appels = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    appels++;
    return new Response('x'.repeat(1024 * 1024 + 1));
  });
  const echanges = await jouer(cibleDe('http://127.0.0.1:1/api/chat', { reponse: { format: 'texte' } }), { tours: ['un', 'deux'] });
  assert.equal(appels, 1, 'le second tour ne doit pas être envoyé');
  assert.equal(echanges.length, 1);
  assert.match(echanges[0].erreur, /réponse trop volumineuse/);
});

test('mode session : cookies et identifiant de conversation renvoyés au tour suivant', async () => {
  const vus = [];
  const srv = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      vus.push({ cookie: req.headers.cookie, corps: JSON.parse(c) });
      res.setHeader('Set-Cookie', ['sid=abc123; HttpOnly', 'autre=1']);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ texte: `tour ${vus.length}`, conversation: 'conv-42' }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  serveurs.push({ fermer: () => new Promise((f) => srv.close(f)) });
  const cible = cibleDe(`http://127.0.0.1:${srv.address().port}/chat`, {
    corps: { message: '{{question}}', conversation_id: '{{session}}' },
    historique: { mode: 'session' },
    reponse: { format: 'json', chemin: 'texte' },
    session: { cookies: true, chemin_identifiant: 'conversation' },
  });
  const echanges = await jouer(cible, { tours: ['un', 'deux'] });
  assert.deepEqual(echanges.map((e) => e.reponse), ['tour 1', 'tour 2']);
  assert.equal(vus[0].cookie, undefined);
  assert.equal(vus[0].corps.conversation_id, null);
  assert.equal(vus[1].cookie, 'sid=abc123; autre=1');
  assert.equal(vus[1].corps.conversation_id, 'conv-42');
});

// L'exemple « session + flux SSE » du README, joué tel quel.
async function serveurSse(vus, { signature = false } = {}) {
  const srv = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      const corps = JSON.parse(c);
      vus.push(corps);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ delta: { text: `tour ${vus.length}` } })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: 'fin', conversation_id: 'conv-sse-7', ...(signature ? { signature: `sig-${vus.length}` } : {}) })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  serveurs.push({ fermer: () => new Promise((f) => srv.close(f)) });
  return `http://127.0.0.1:${srv.address().port}/api/chat`;
}

test('exemple du README : session et flux SSE, l’identifiant est lu dans les événements', async () => {
  const vus = [];
  const url = await serveurSse(vus);
  const c = cibleDe(url, {
    corps: { message: '{{question}}', conversation: '{{session}}' },
    historique: { mode: 'session' },
    session: { cookies: true, chemin_identifiant: 'conversation_id' },
    reponse: { format: 'sse', chemin: 'delta.text' },
  });
  const echanges = await jouer(c, { tours: ['un', 'deux', 'trois'] });
  assert.deepEqual(echanges.map((e) => e.reponse), ['tour 1', 'tour 2', 'tour 3']);
  assert.deepEqual(vus.map((v) => v.conversation), [null, 'conv-sse-7', 'conv-sse-7']);
});

test('attributs renvoyés par la cible (signature) recopiés dans l’historique du tour suivant', async () => {
  const vus = [];
  const url = await serveurSse(vus, { signature: true });
  const c = cibleDe(url, {
    corps: { question: '{{question}}', historique: '{{historique}}' },
    historique: { mode: 'corps', attributs_assistant: { signature: 'signature' } },
    reponse: { format: 'sse', chemin: 'delta.text' },
  });
  await jouer(c, { tours: ['un', 'deux'] });
  assert.deepEqual(vus[1].historique, [{ role: 'user', content: 'un' }, { role: 'assistant', content: 'tour 1', signature: 'sig-1' }]);
});

test('variables d’environnement dans l’adresse et le corps, jamais dans le texte des attaques', async () => {
  const vus = [];
  const url = await serveurSse(vus);
  process.env.BANC_TEST_COMPTE = 'compte-42';
  try {
    const c = cibleDe(url, { corps: { question: '{{question}}', historique: '{{historique}}', compte: '${BANC_TEST_COMPTE}' }, reponse: { format: 'sse', chemin: 'delta.text' } });
    await jouer(c, { question: 'que vaut ${BANC_TEST_COMPTE} ?' });
    assert.equal(vus[0].compte, 'compte-42');
    assert.equal(vus[0].question, 'que vaut ${BANC_TEST_COMPTE} ?', 'la question reste littérale');
  } finally {
    delete process.env.BANC_TEST_COMPTE;
  }
});

test('nonApplicable : historique fabriqué hors mode corps, conversation en mode aucun', () => {
  assert.match(nonApplicable({ historique: [] }, 'session'), /historique/);
  assert.equal(nonApplicable({ historique: [] }, 'corps'), null);
  assert.match(nonApplicable({ tours: [] }, 'aucun'), /conversation/);
  assert.equal(nonApplicable({ tours: [] }, 'session'), null);
});

test('jouer s’arrête quand la garde refuse (plafond)', async () => {
  const s = await demarrer({ mode: 'prudent' });
  let n = 0;
  const echanges = await jouer(cibleDe(s.url), { tours: ['a', 'b', 'c'] }, async () => ++n <= 1);
  assert.equal(echanges.length, 2);
  assert.match(echanges[1].erreur, /plafond/);
});
