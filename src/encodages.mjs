// Encodages appliqués aux charges des attaques de la famille « encodage » (et à H08).
// Ils sont déterministes : une même charge donne toujours la même question, ce qui rend
// deux passages comparables.

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const rot13 = (s) =>
  s.replace(/[a-z]/gi, (c) => {
    const b = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
  });

// Caractères « tag » Unicode (U+E0000 à U+E007F) : invisibles à l'écran, lus par le modèle.
// Ils ne couvrent que l'ASCII : les accents sont retirés avant l'encodage (« Découverte » -> « Decouverte »).
const sansAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const tags = (s) => [...sansAccents(s)].map((c) => (c.charCodeAt(0) < 128 ? String.fromCodePoint(0xe0000 + c.charCodeAt(0)) : '')).join('');

// Espace de largeur nulle (U+200B) entre chaque caractère.
const largeurNulle = (s) => [...s].join('​');

// Lettres latines remplacées par des lettres cyrilliques qui leur ressemblent.
const HOMO = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', i: 'і', I: 'І', x: 'х', y: 'у', A: 'А', E: 'Е', O: 'О' };
const homoglyphes = (s) => [...s].map((c) => HOMO[c] || c).join('');

const LEET = { e: '3', i: '1', o: '0' };
const leet = (s) => [...s].map((c) => LEET[c.toLowerCase()] || c).join('');

// Générateur congruentiel à graine fixe : les variantes « Best-of-N » sont les mêmes à chaque passage.
function alea(graine) {
  let x = graine >>> 0;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function bestOfN(s, graine) {
  const r = alea(graine);
  const lettres = [...s].map((c) => (r() < 0.5 ? c.toUpperCase() : c.toLowerCase()));
  for (let i = 1; i < lettres.length - 1; i++) {
    if (r() < 0.06 && /\p{L}/u.test(lettres[i]) && /\p{L}/u.test(lettres[i + 1])) {
      [lettres[i], lettres[i + 1]] = [lettres[i + 1], lettres[i]];
    }
  }
  return lettres.join('');
}

const ENCODAGES = {
  base64: (t) => b64(t),
  rot13: (t) => rot13(t),
  tags: (t) => tags(t),
  'largeur-nulle': (t) => largeurNulle(t),
  homoglyphes: (t) => homoglyphes(t),
  leet: (t) => leet(t),
  'best-of-n': (t, c) => bestOfN(t, c.graine ?? 1),
};

export const encodagesConnus = Object.keys(ENCODAGES);

/** Encode le texte (déjà rempli) d'une charge. */
export function encoder(charge, texte) {
  const f = ENCODAGES[charge.encodage];
  if (!f) throw new Error(`encodage inconnu : ${charge.encodage}`);
  return f(texte, charge);
}
