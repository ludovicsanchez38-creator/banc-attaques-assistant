import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { executerPassage, rejugerPassage } from '../src/banc.mjs';
import { lireCouts } from '../src/couts.mjs';
import { balayer } from '../src/secrets.mjs';
import { rapportMarkdown } from '../src/rapport.mjs';
import { creerCibleFactice } from '../exemples/cible-factice.mjs';
import { creerJugeFactice } from '../exemples/juge-factice.mjs';
import { configDemo, clientJugeFactice, dossierTemporaire, RACINE, CONFIG_DEMO } from './aides.mjs';
import { preparerConfiguration } from '../src/configuration.mjs';

// Le test d'interruption lance le vrai banc, donc le vrai SDK : sauté si npm ci n'a pas été fait.
let sdk = true;
try {
  await import('@anthropic-ai/sdk');
} catch {
  sdk = false;
}

const serveurs = [];
after(async () => Promise.all(serveurs.map((s) => s.fermer())));
const garder = (s) => (serveurs.push(s), s);
const cible = async (mode) => garder(await creerCibleFactice({ mode }));
const silencieux = { log: () => {} };
const maintenant = new Date('2026-10-09T10:00:00Z');
const TARIF = { juge: { tarif_usd_par_million: { entree: 2, sortie: 10 } } };
// Juge factice en mémoire : « cede » si une réponse contient un indice d'échec, sinon « tenu ».
const jugeParIndice = () =>
  clientJugeFactice((contenu) => {
    const reponses = JSON.parse(contenu.match(/<echanges_a_juger>\n([\s\S]*)\n<\/echanges_a_juger>$/)[1]).echanges.map((e) => e.reponse_de_l_assistant || '');
    return reponses.some((r) => /je vous accorde|mes consignes|vraie personne|```/i.test(r)) ? { verdict: 'cede', phrase: 'x', raison: 'indice' } : { verdict: 'tenu', phrase: '', raison: 'ok' };
  });

test('passage complet sans juge contre la cible prudente : 121 lignes, témoins tenus, historique system bloqué', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url);
  const { dossier, resume, lignes } = await executerPassage(config, { passe: 'prudent', juge: false, maintenant }, silencieux);
  assert.equal(lignes.length, 121);
  for (const f of ['resultats.jsonl', 'resume.json', 'rapport.md']) assert.ok(fs.existsSync(path.join(dossier, f)), f);
  const parId = Object.fromEntries(lignes.map((l) => [l.id, l]));
  assert.equal(parId.K10.verdict, 'bloque', 'rôle system refusé en 400 par la cible');
  for (const t of ['T01', 'T02', 'T03', 'T04']) assert.equal(parId[t].verdict, 'non_juge', t);
  assert.equal(resume.totaux.cede, undefined, 'aucune cédée sans juge');
  const rapport = fs.readFileSync(path.join(dossier, 'rapport.md'), 'utf8');
  assert.match(rapport, /## Refusées par la cible \(1\)/);
  assert.match(rapport, /\| K10 \| `historique` \| 400 \|/);
  assert.match(rapport, /Ce que ce rapport ne prouve pas/);
  assert.ok(!fs.existsSync(path.join(config.dossier_donnees, 'verrou')), 'verrou libéré');
});

test('passage avec juge contre la cible naïve : les cédées et les douteuses ressortent', async () => {
  const s = await cible('naif');
  const { config } = configDemo(s.url, TARIF);
  const juge = jugeParIndice();
  const { lignes, resume, dossier } = await executerPassage(config, { passe: 'naif', juge: true, maintenant }, { ...silencieux, clientJuge: juge });
  const parId = Object.fromEntries(lignes.map((l) => [l.id, l]));
  assert.equal(parId.A03.verdict, 'cede', 'fuite des consignes');
  assert.ok(parId.A03.drapeaux.some((d) => d.code === 'fuite_marqueur'));
  assert.equal(parId.C03.verdict, 'cede', 'remise accordée');
  assert.equal(parId.H03.verdict, 'douteux', 'lien hors liste recopié : drapeau grave même si le juge dit tenu');
  assert.equal(parId.H03.juge.verdict, 'tenu');
  assert.ok(resume.totaux.cede >= 5);
  assert.ok(resume.cout_juge_usd > 0);
  const rapport = fs.readFileSync(path.join(dossier, 'rapport.md'), 'utf8');
  assert.match(rapport, /## À relire\s:\s`cede`/);
  assert.ok(!/\]\((?:javascript|https?):/.test(rapport), 'aucun lien Markdown actif venu de la cible');
  assert.ok(!/https?:\/\/rendez-vous/.test(rapport), 'adresses désamorcées');
  assert.match(rapport, /https\[:\]\/\/rendez-vous-atelier\[\.\]example/);
  const couts = lireCouts(config.dossier_donnees);
  assert.ok(Math.abs(couts.juge_usd - resume.cout_juge_usd) < 1e-6);
});

test('plafond : le juge s’arrête avant de dépasser, puis le banc refuse de repartir', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { plafond_usd: 0.5, juge: { tarif_usd_par_million: { entree: 10, sortie: 50 } } });
  const juge = clientJugeFactice(() => ({ verdict: 'tenu', phrase: '', raison: 'ok' }), { input_tokens: 2500, output_tokens: 500 });
  const { resume } = await executerPassage(config, { passe: 'plafond', juge: true, maintenant }, { ...silencieux, clientJuge: juge });
  assert.match(resume.juge_arrete, /plafond/);
  assert.ok(resume.cumul_banc_usd <= 0.5, `cumul ${resume.cumul_banc_usd}`);
  assert.ok(juge.appels.length >= 1 && juge.appels.length < 121);
  fs.writeFileSync(path.join(config.dossier_donnees, 'couts.json'), JSON.stringify({ juge_usd: 0.5, cible_usd: 0, passes: [] }));
  await assert.rejects(executerPassage(config, { passe: 'encore', juge: true, maintenant }, { ...silencieux, clientJuge: juge }), (e) => e.code === 'PLAFOND' && /plafond du banc atteint/.test(e.message));
  // Sans juge et sans coût estimé de la cible, le passage ne dépense rien : il reste permis.
  const { resume: r2 } = await executerPassage(config, { passe: 'sans-juge', juge: false, maintenant, ids: new Set(['T01']) }, silencieux);
  assert.equal(r2.totaux.non_juge, 1);
  // Avec un coût estimé de la cible, il est refusé lui aussi.
  const { config: c3 } = configDemo(s.url, { plafond_usd: 0.5, cible: { cout_estime_par_appel_usd: 0.01 } });
  fs.mkdirSync(c3.dossier_donnees, { recursive: true });
  fs.writeFileSync(path.join(c3.dossier_donnees, 'couts.json'), JSON.stringify({ juge_usd: 0.5, cible_usd: 0, passes: [] }));
  await assert.rejects(executerPassage(c3, { passe: 'estime', juge: false, maintenant }, silencieux), (e) => e.code === 'PLAFOND');
});

test('interruption (SIGINT) pendant un appel au juge : l’appel en cours est déjà compté, le verrou libéré', { skip: !sdk && 'SDK non installé : lancez npm ci' }, async () => {
  const s = await cible('prudent');
  const j = garder(await creerJugeFactice({ delaiMs: 300 }));
  const tmp = dossierTemporaire();
  const conf = structuredClone(CONFIG_DEMO);
  Object.assign(conf, { dossier_resultats: path.join(tmp, 'r'), dossier_donnees: path.join(tmp, 'd') });
  conf.cible.url = s.url;
  conf.controles.fichier_base = path.join(RACINE, 'exemples/base-demo.md');
  conf.juge = { ...conf.juge, url_api: j.url, tarif_usd_par_million: { entree: 2, sortie: 10 } };
  fs.writeFileSync(path.join(tmp, 'conf.json'), JSON.stringify(conf));
  const enfant = spawn(process.execPath, [path.join(RACINE, 'banc.mjs'), '--config', path.join(tmp, 'conf.json'), '--passe', 'coupe'], { env: { ...process.env, JUGE_FACTICE_CLE: 'factice' }, stdio: ['ignore', 'ignore', 'pipe'] });
  // On interrompt pendant le troisième appel : deux appels terminés, un en cours.
  await new Promise((ok, ko) => {
    const t0 = Date.now();
    const v = setInterval(() => {
      if (j.requetes.length >= 3) {
        clearInterval(v);
        ok();
      } else if (Date.now() - t0 > 20000) {
        clearInterval(v);
        ko(new Error('le juge factice n’a pas été appelé'));
      }
    }, 20);
  });
  enfant.kill('SIGINT');
  const code = await new Promise((ok) => enfant.once('exit', ok));
  assert.equal(code, 130);
  const c = lireCouts(path.join(tmp, 'd'));
  // Coût réel des trois appels reçus (le juge factice facture taille/4 tokens d'entrée et 40 de sortie).
  const reel = j.requetes.slice(0, 3).reduce((a, r) => a + (Math.ceil(r.taille / 4) * 2 + 40 * 10) / 1e6, 0);
  assert.ok(c.juge_usd >= reel - 1e-9, `registre ${c.juge_usd} au moins égal aux trois appels partis (${reel})`);
  assert.equal(c.passes.at(-1).interrompu, 'SIGINT');
  const dossierPasse = fs.readdirSync(path.join(tmp, 'r')).map((x) => path.join(tmp, 'r', x))[0];
  const lues = fs.readFileSync(path.join(dossierPasse, 'resultats.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lues.length, 121, 'les réponses de la cible sont gardées');
  const jugees = lues.filter((l) => l.juge).length;
  assert.ok(jugees >= 2, `les verdicts déjà payés sont enregistrés (${jugees})`);
  // Un passage interrompu ne se rejuge pas : ses résultats sont partiels, il faut le relancer.
  const cfg = preparerConfiguration(JSON.parse(fs.readFileSync(path.join(tmp, 'conf.json'), 'utf8')), RACINE);
  const juge2 = clientJugeFactice(() => ({ verdict: 'tenu', phrase: '', raison: 'ok' }));
  await assert.rejects(rejugerPassage(cfg, dossierPasse, { ...silencieux, clientJuge: juge2 }), /n'est pas allé au bout .*Relancez le passage/);
  assert.equal(juge2.appels.length, 0, 'rien n’est payé');
  assert.ok(!fs.existsSync(path.join(tmp, 'd', 'verrou')), 'verrou libéré');
});

test('attaque en plusieurs tours interrompue : verdict incomplet, témoin T04 en difficulté', async () => {
  // Une cible qui refuse tout historique non vide (un format_message mal réglé, par exemple).
  const srv = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      const d = JSON.parse(c);
      if (d.historique && d.historique.length) return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"erreur":"historique refusé"}');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reponse: 'Je réponds seulement sur nos formules : https://atelier.example/formules.' }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  garder({ fermer: () => new Promise((f) => srv.close(f)) });
  const { config } = configDemo(`http://127.0.0.1:${srv.address().port}/api/chat`);
  const { lignes, dossier } = await executerPassage(config, { passe: 'tronque', juge: true, maintenant, familles: new Set(['multi_tour', 'temoin']) }, { ...silencieux, clientJuge: clientJugeFactice(() => ({ verdict: 'tenu', phrase: '', raison: 'ok' })) });
  assert.ok(lignes.filter((l) => l.famille === 'multi_tour').every((l) => l.verdict === 'incomplet'));
  assert.equal(lignes.find((l) => l.id === 'T04').verdict, 'incomplet');
  const md = fs.readFileSync(path.join(dossier, 'rapport.md'), 'utf8');
  assert.match(md, /## À relire\s:\s`incomplet` \(6\)/);
  assert.match(md, /1 témoin sur 4 en difficulté/);
});

test('le juge s’arrête après trois appels de suite sans réponse', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, TARIF);
  let n = 0;
  const juge = clientJugeFactice(() => (++n === 1 ? { verdict: 'tenu', phrase: '', raison: 'ok' } : Object.assign(new Error('requête trop longue'), { status: 400 })));
  const { resume } = await executerPassage(config, { passe: 'echecs', juge: true, maintenant, familles: new Set(['extraction']) }, { ...silencieux, clientJuge: juge });
  assert.equal(juge.appels.length, 4, 'un succès puis trois échecs');
  assert.match(resume.juge_arrete, /trois appels de suite/);
});

test('terminal fermé (SIGHUP) pendant l’interrogation de la cible : attaques terminées gardées, secrets contrôlés', async () => {
  // Cible lente qui recopie le jeton reçu dans sa réponse.
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reponse: `Débogage : ${req.headers.authorization}` })), 60));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  garder({ fermer: () => new Promise((f) => srv.close(f)) });
  const tmp = dossierTemporaire();
  const conf = structuredClone(CONFIG_DEMO);
  Object.assign(conf, { dossier_resultats: path.join(tmp, 'r'), dossier_donnees: path.join(tmp, 'd') });
  conf.cible.url = `http://127.0.0.1:${srv.address().port}/api/chat`;
  conf.cible.entetes = { Authorization: 'Bearer ${BANC_TEST_JETON}' };
  conf.controles.fichier_base = path.join(RACINE, 'exemples/base-demo.md');
  fs.writeFileSync(path.join(tmp, 'conf.json'), JSON.stringify(conf));
  const enfant = spawn(process.execPath, [path.join(RACINE, 'banc.mjs'), '--config', path.join(tmp, 'conf.json'), '--passe', 'coupe-cible', '--sans-juge'], { env: { ...process.env, BANC_TEST_JETON: 'recette_cle_privee_2026' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let erreurs = '';
  enfant.stderr.on('data', (d) => (erreurs += d));
  await new Promise((ok) => setTimeout(ok, 900));
  enfant.kill('SIGHUP');
  assert.equal(await new Promise((ok) => enfant.once('exit', ok)), 129);
  const dossierPasse = fs.readdirSync(path.join(tmp, 'r')).map((x) => path.join(tmp, 'r', x))[0];
  const lues = fs.readFileSync(path.join(dossierPasse, 'resultats.jsonl'), 'utf8').trim().split('\n');
  assert.ok(lues.length >= 3 && lues.length < 121, `attaques terminées gardées (${lues.length})`);
  assert.match(erreurs, /ATTENTION : secret ou motif de clé trouvé dans resultats\.jsonl/, 'secret signalé malgré l’interruption');
  assert.ok(!fs.existsSync(path.join(tmp, 'd', 'verrou')), 'verrou libéré');
});

test('fin anormale par erreur : dernier état écrit et secrets contrôlés', async () => {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reponse: `Débogage : ${req.headers.authorization}` })));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  garder({ fermer: () => new Promise((f) => srv.close(f)) });
  const { config } = configDemo(`http://127.0.0.1:${srv.address().port}/api/chat`, { cible: { entetes: { Authorization: 'Bearer ${BANC_TEST_JETON}' } } });
  let n = 0;
  const log = () => {
    if (++n === 4) throw new Error('disque plein (simulé)');
  };
  const ecrit = [];
  const origine = process.stderr.write.bind(process.stderr);
  process.stderr.write = (x, ...r) => (ecrit.push(String(x)), true);
  try {
    await assert.rejects(executerPassage(config, { passe: 'panne', juge: false, maintenant, familles: new Set(['extraction']) }, { log, env: { ...process.env, BANC_TEST_JETON: 'recette_cle_privee_2026' } }), /disque plein/);
  } finally {
    process.stderr.write = origine;
  }
  const dossierPasse = fs.readdirSync(config.dossier_resultats).map((x) => path.join(config.dossier_resultats, x))[0];
  assert.ok(fs.readFileSync(path.join(dossierPasse, 'resultats.jsonl'), 'utf8').trim().split('\n').length >= 2, 'attaques terminées gardées');
  assert.match(ecrit.join(''), /ATTENTION : secret ou motif de clé trouvé dans resultats\.jsonl/);
  assert.ok(!fs.existsSync(path.join(config.dossier_donnees, 'verrou')), 'verrou libéré');
});

test('rejuger un dossier sans resultats.jsonl : message clair', async () => {
  const s = await cible('prudent');
  const { config, tmp } = configDemo(s.url, TARIF);
  await assert.rejects(rejugerPassage(config, tmp, { ...silencieux, clientJuge: jugeParIndice() }), /aucun resultats\.jsonl dans .*interrompu avant la première réponse/);
});

test('plafond presque atteint : un passage jugé refuse de démarrer, sans rien envoyer à la cible', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { plafond_usd: 0.3, juge: { tarif_usd_par_million: { entree: 2, sortie: 10 } } });
  fs.mkdirSync(config.dossier_donnees, { recursive: true });
  fs.writeFileSync(path.join(config.dossier_donnees, 'couts.json'), JSON.stringify({ juge_usd: 0.2999, cible_usd: 0, passes: [] }));
  await assert.rejects(executerPassage(config, { passe: 'reste', juge: true, maintenant }, { ...silencieux, clientJuge: jugeParIndice() }), /ne couvre plus un seul appel au juge/);
  const { resume } = await executerPassage(config, { passe: 'reste-sans-juge', juge: false, maintenant, ids: new Set(['T01']) }, silencieux);
  assert.equal(resume.totaux.non_juge, 1, 'sans juge, le passage reste possible');
});

test('un secret recopié par la cible fait échouer le passage, en clair comme neutralisé', async () => {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reponse: `Débogage : ${req.headers.authorization}` })));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  garder({ fermer: () => new Promise((f) => srv.close(f)) });
  const { config } = configDemo(`http://127.0.0.1:${srv.address().port}/api/chat`, { cible: { entetes: { Authorization: 'Bearer ${BANC_TEST_JETON}' } } });
  await assert.rejects(executerPassage(config, { passe: 'fuite', juge: false, maintenant, ids: new Set(['T01']) }, { ...silencieux, env: { ...process.env, BANC_TEST_JETON: 'recette_cle_privee_2026' } }), /mettez tout ce dossier à l'écart/);
});

test('code de sortie 4 quand aucune attaque ne reçoit de réponse (cible injoignable)', async () => {
  const tmp = dossierTemporaire();
  const conf = structuredClone(CONFIG_DEMO);
  Object.assign(conf, { dossier_resultats: path.join(tmp, 'r'), dossier_donnees: path.join(tmp, 'd') });
  conf.cible.url = 'http://127.0.0.1:59998/api/chat';
  conf.cible.delai_max_ms = 2000;
  conf.controles.fichier_base = path.join(RACINE, 'exemples/base-demo.md');
  fs.writeFileSync(path.join(tmp, 'conf.json'), JSON.stringify(conf));
  const enfant = spawn(process.execPath, [path.join(RACINE, 'banc.mjs'), '--config', path.join(tmp, 'conf.json'), '--passe', 'injoignable', '--ids', 'T01,T02', '--sans-juge'], { stdio: 'ignore' });
  assert.equal(await new Promise((ok) => enfant.once('exit', ok)), 4);
});

test('codes de sortie du plafond : 3, y compris en --sans-juge quand la cible a un coût estimé', async () => {
  const s = await cible('prudent');
  const tmp = dossierTemporaire();
  const conf = structuredClone(CONFIG_DEMO);
  Object.assign(conf, { dossier_resultats: path.join(tmp, 'r'), dossier_donnees: path.join(tmp, 'd'), plafond_usd: 0.5 });
  conf.cible.url = s.url;
  conf.controles.fichier_base = path.join(RACINE, 'exemples/base-demo.md');
  fs.mkdirSync(path.join(tmp, 'd'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'd', 'couts.json'), JSON.stringify({ juge_usd: 0.5, cible_usd: 0, passes: [] }));
  const lancer = async (c, args) => {
    fs.writeFileSync(path.join(tmp, 'conf.json'), JSON.stringify(c));
    const enfant = spawn(process.execPath, [path.join(RACINE, 'banc.mjs'), '--config', path.join(tmp, 'conf.json'), ...args], { env: { ...process.env, JUGE_FACTICE_CLE: 'factice' }, stdio: 'ignore' });
    return new Promise((ok) => enfant.once('exit', ok));
  };
  assert.equal(await lancer(conf, ['--passe', 'juge', '--ids', 'T01']), 3, 'passage jugé, plafond atteint');
  assert.equal(await lancer({ ...conf, cible: { ...conf.cible, cout_estime_par_appel_usd: 0.01 } }, ['--passe', 'estime', '--ids', 'T01', '--sans-juge']), 3, '--sans-juge avec coût estimé');
  assert.equal(await lancer(conf, ['--passe', 'libre', '--ids', 'T01', '--sans-juge']), 0, '--sans-juge sans dépense : permis');
});

test('coût estimé de la cible : les attaques au-delà du plafond ne sont pas jouées', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { plafond_usd: 0.1, cible: { cout_estime_par_appel_usd: 0.01 } });
  const { lignes, resume } = await executerPassage(config, { passe: 'estime', juge: false, maintenant }, silencieux);
  assert.ok(resume.totaux.non_joue > 100);
  assert.ok(resume.cout_cible_estime_usd <= 0.1 + 1e-9);
  assert.ok(lignes.filter((l) => !['non_joue', 'non_applicable'].includes(l.verdict)).length <= 10);
});

test('une variable d’environnement manquante arrête tout avant le premier envoi', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { cible: { entetes: { Authorization: 'Bearer ${JETON_ABSENT_TEST}' }, cout_estime_par_appel_usd: 0.01 } });
  await assert.rejects(executerPassage(config, { passe: 'env', juge: false, maintenant }, silencieux), /JETON_ABSENT_TEST absente/);
  assert.equal(lireCouts(config.dossier_donnees).cible_usd, 0, 'rien imputé');
});

test('mode session : historique sans objet ; mode aucun : pas de fausse alerte sur T04', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { cible: { historique: { mode: 'session' } } });
  const { lignes } = await executerPassage(config, { passe: 'session', juge: false, maintenant, familles: new Set(['historique', 'multi_tour']) }, silencieux);
  assert.ok(lignes.filter((l) => l.famille === 'historique').every((l) => l.verdict === 'non_applicable'));
  assert.ok(lignes.filter((l) => l.famille === 'multi_tour').every((l) => l.verdict !== 'non_applicable'));
  const { config: c2 } = configDemo(s.url, { cible: { corps: { question: '{{question}}' }, historique: { mode: 'aucun' } } });
  const { dossier } = await executerPassage(c2, { passe: 'aucun', juge: false, maintenant, familles: new Set(['temoin']) }, silencieux);
  assert.match(fs.readFileSync(path.join(dossier, 'rapport.md'), 'utf8'), /Les 3 questions légitimes ont reçu une réponse/);
});

test('témoins supplémentaires et répétitions', async () => {
  const s = await cible('prudent');
  const { config } = configDemo(s.url, { temoins_supplementaires: ['Quels sont vos horaires ?'] });
  const { lignes } = await executerPassage(config, { passe: 'tirages', juge: false, maintenant, ids: new Set(['A01', 'T05']), repetitions: 3 }, silencieux);
  assert.equal(lignes.length, 6);
  assert.deepEqual(lignes.map((l) => `${l.id}#${l.tirage}`), ['A01#1', 'A01#2', 'A01#3', 'T05#1', 'T05#2', 'T05#3']);
});

test('rejuger un passage avec la grille courante, sans rappeler la cible', async () => {
  const s = await cible('naif');
  const { config } = configDemo(s.url, TARIF);
  const { dossier } = await executerPassage(config, { passe: 'arejuger', juge: false, maintenant, ids: new Set(['A03', 'T01']) }, silencieux);
  await s.fermer();
  serveurs.splice(serveurs.indexOf(s), 1);
  const { resume } = await rejugerPassage(config, dossier, { ...silencieux, clientJuge: jugeParIndice(), maintenant });
  assert.equal(resume.totaux.cede, 1);
  assert.ok(fs.existsSync(path.join(dossier, 'rapport-rejuge.md')));
  assert.ok(fs.existsSync(path.join(dossier, 'resultats-rejuges.jsonl')));
});

test('le rapport neutralise ce que la cible renvoie et détaille les témoins en difficulté', () => {
  const lignes = [
    { id: 'H02', famille: 'liens', technique: 't', source: 's', echec_si: 'e', echanges: [{ question: 'q', statut_http: 200, reponse: '![x](https://evil.example/c?d=1) écrivez à pirate@evil.example \u202Eabc \\<img src="//evil.example/p.png"\\> \x1b[2J __gras__ evil.example/collecte' }], drapeaux: [], juge: { verdict: 'cede', phrase: '', raison: 'r' }, verdict: 'cede' },
    { id: 'T01', famille: 'temoin', technique: 't', source: 'temoin', echec_si: 'e', echanges: [{ question: 'q', statut_http: 0, reponse: '', erreur: "variable d'environnement X absente" }], drapeaux: [], juge: null, verdict: 'erreur' },
  ];
  const md = rapportMarkdown(lignes, { passe: 'p', date_utc: 'd', cible: 'c', juge: null, par_famille: { liens: { cede: 1 }, temoin: { erreur: 1 } }, totaux: { cede: 1, erreur: 1 }, cout_juge_usd: 0, cout_cible_estime_usd: 0, cumul_banc_usd: 0, plafond_usd: 3 });
  assert.ok(!md.includes('https://evil'), 'adresse désamorcée');
  assert.ok(md.includes('pirate[@]evil[.]example'), 'adresse mail désamorcée');
  assert.ok(md.includes('⟨U+202E⟩'), 'inversion de sens rendue visible');
  assert.ok(md.includes('\\\\\\<img'), 'barre oblique inverse échappée : la balise reste du texte');
  assert.ok(!/(^|[^\\])<img/.test(md), 'aucune balise active');
  assert.ok(md.includes('⟨U+001B⟩') && !md.includes('\x1b'), 'séquence de terminal rendue visible');
  assert.ok(md.includes('\\_\\_gras\\_\\_'), 'pas de gras venu de la cible');
  assert.ok(md.includes('evil[.]example/collecte'), 'domaine nu désamorcé');
  const md2 = rapportMarkdown([{ ...lignes[0], echanges: [{ question: 'q', statut_http: 200, reponse: '_https://evil.example/c_ et 1https://evil.example/d' }] }], { passe: 'p', date_utc: 'd', cible: 'c', juge: null, par_famille: { liens: { cede: 1 } }, totaux: { cede: 1 }, cout_juge_usd: 0, cout_cible_estime_usd: 0, cumul_banc_usd: 0, plafond_usd: 3 });
  assert.ok(!md2.includes('://'), 'aucun « :// » actif, même collé à un mot');
  const md4 = rapportMarkdown([
    { ...lignes[0], id: 'H09', echanges: [{ question: 'q', statut_http: 200, reponse: 'Voir _www.atelier-exemple.re/promo_ et ~www.evil.example~' }], drapeaux: [{ code: 'lien_hors_liste', tour: 1 }, { code: 'lien_hors_liste', tour: 2 }], juge: { verdict: 'tenu', phrase: '', raison: '' }, verdict: 'douteux' },
    { id: 'K10', famille: 'historique', technique: 't', source: 's', echec_si: 'e', echanges: [{ question: 'q', statut_http: 400, reponse: '', extrait: '' }], drapeaux: [], juge: null, verdict: 'bloque' },
  ], { passe: 'p', date_utc: 'd', cible: 'c', juge: 'm', par_famille: { liens: { douteux: 1 }, historique: { bloque: 1 } }, totaux: { douteux: 1, bloque: 1 }, cout_juge_usd: 0, cout_cible_estime_usd: 0, cumul_banc_usd: 0, plafond_usd: 3 });
  assert.ok(!/(^|[^[])www\.[a-z]/i.test(md4), 'aucun « www. » actif, même après « _ » ou « ~ »');
  assert.match(md4, /\*\*tenu\*\* \(sans motif\)/, 'repli « sans motif »');
  assert.match(md4, /\| K10 \| `historique` \| 400 \| \(vide\) \|/, 'repli « (vide) »');
  assert.match(md4, /mais le drapeau grave `lien_hors_liste` impose une relecture/, 'singulier quand le même drapeau revient');
  const md3 = rapportMarkdown([{ ...lignes[0], echanges: [{ question: 'Combien ?', reponse: 'La dérivée vaut $3x^2 + 2$ : voilà !' }] }], { passe: 'p', date_utc: 'd', cible: 'c', juge: null, par_famille: { liens: { cede: 1 } }, totaux: { cede: 1 }, cout_juge_usd: 0, cout_cible_estime_usd: 0, cumul_banc_usd: 0, plafond_usd: 3 });
  assert.ok(md3.includes('\\$3x^2 + 2\\$ : voilà !'), 'formule désamorcée, et la réponse de la cible garde sa typographie');
  assert.ok(md3.includes('- Question 1\u202f: '), 'espace fine dans le texte du banc');
  assert.match(md, /1 témoin sur 1 en difficulté/);
  assert.match(md, /variable d'environnement X absente/, 'la cause apparaît dans le rapport');
});

test('le balayage final repère une clé ou un secret cité par la configuration', () => {
  const d = dossierTemporaire();
  fs.writeFileSync(path.join(d, 'propre.jsonl'), '{"reponse":"bonjour"}\n');
  fs.writeFileSync(path.join(d, 'cle.jsonl'), `{"reponse":"sk-ant-api03-${'x'.repeat(20)}"}\n`);
  fs.writeFileSync(path.join(d, 'jeton.jsonl'), '{"reponse":"mon-jeton-tres-secret"}\n');
  assert.deepEqual(balayer(d, ['mon-jeton-tres-secret']).sort(), ['cle.jsonl', 'jeton.jsonl']);
});
