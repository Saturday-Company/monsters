import type { FileMeta, Lang } from '@monsters/shared';

/*
 * The files of the mock core (D-075), until the files of wave 2 bring their
 * own: metadata for `GET /api/files`, `GET /api/files/:id`, and what the dev
 * server's middleware serves as their bytes (vite.config.ts, `mock-files.ts`).
 * Pure data: read by the browser (the mock) and by Node (the middleware), in the language the
 * mock runs in (`mockFiles(lang)`: the names and the texts of the files follow it).
 */

const T0 = Date.UTC(2026, 9, 16, 9, 30);

type Text = { kind: 'text'; text: string };
type Png = { kind: 'png'; width: number; height: number; scene: 'menu' | 'screenshot' };
type Pdf = { kind: 'pdf'; pages: string[][] };
type Raw = { kind: 'zip' };
export type MockFileBody = Text | Png | Pdf | Raw;

export interface MockFile {
  meta: FileMeta;
  body: MockFileBody;
  /** Not in the list (only reachable by id: the sandbox probe of the e2e tests). */
  hidden?: boolean;
}

/** Replaces each piece of text once; a piece that is not there is a bug of this file. */
function swap(source: string, pairs: [from: string, to: string][]): string {
  let out = source;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) throw new Error(`mock files: "${from}" is not in the page`);
    out = out.replaceAll(from, to);
  }
  return out;
}

const MENU_PAGE_IT = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Menu della settimana</title>
<style>
  body { margin: 0; font: 16px/1.5 Georgia, serif; color: #2b2118; background: #fbf6ee; }
  header { padding: 28px 28px 12px; border-bottom: 2px solid #e0cdb3; }
  h1 { margin: 0; font-size: 28px; letter-spacing: .01em; }
  p.sub { margin: 4px 0 0; color: #8a6d4f; font-style: italic; }
  ul { list-style: none; margin: 0; padding: 12px 28px 28px; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px dotted #d8c3a5; }
  li b { font-weight: 600; }
  li span { color: #8a6d4f; white-space: nowrap; }
  button { margin: 0 28px 28px; padding: 10px 16px; border: 0; border-radius: 10px; background: #b8542a; color: #fff; font: inherit; cursor: pointer; }
  #count { margin: 0 28px 28px; color: #8a6d4f; }
</style>
</head>
<body>
<header><h1>Menu della settimana</h1><p class="sub">Trattoria da Dione · autunno</p></header>
<ul>
  <li><b>Zuppa di zucca e castagne</b><span>9 €</span></li>
  <li><b>Pici al ragù bianco</b><span>13 €</span></li>
  <li><b>Guancia brasata, polenta morbida</b><span>18 €</span></li>
  <li><b>Torta di mele della nonna</b><span>6 €</span></li>
</ul>
<button id="like" type="button">Mi piace</button>
<p id="count">Ancora nessun voto.</p>
<script>
  let n = 0;
  document.getElementById('like').addEventListener('click', () => {
    n += 1;
    document.getElementById('count').textContent = n === 1 ? 'Un voto.' : n + ' voti.';
  });
</script>
</body>
</html>
`;

/** The same page in English (the structure and the script are the Italian page's). */
const MENU_PAGE_EN = swap(MENU_PAGE_IT, [
  ['<html lang="it">', '<html lang="en">'],
  ['Menu della settimana', 'Weekly menu'],
  ['autunno</p>', 'autumn</p>'],
  ['Zuppa di zucca e castagne', 'Pumpkin and chestnut soup'],
  ['Pici al ragù bianco', 'Pici with white ragù'],
  ['Guancia brasata, polenta morbida', 'Braised beef cheek, soft polenta'],
  ['Torta di mele della nonna', 'Grandma’s apple pie'],
  ['>Mi piace<', '>Like<'],
  ['Ancora nessun voto.', 'No votes yet.'],
  ["'Un voto.' : n + ' voti.'", "'One vote.' : n + ' votes.'"],
]);

/**
 * A page that tries to leave its sandbox (e2e, "the HTML sandbox"): each try
 * writes how it went into the page, where the test reads it.
 */
/** The UDP port the sandbox e2e listens on for a STUN request that must never come. */
export const STUN_PROBE_PORT = 47911;

export const SANDBOX_PROBE_IT = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Prova sandbox</title>
<style>body{font:14px/1.5 monospace;padding:16px} li{margin:2px 0}</style></head>
<body><h1>Prova della scatola</h1><ul id="out"></ul>
<script>
  const out = document.getElementById('out');
  const results = {};
  const note = (k, v) => { results[k] = v; const li = document.createElement('li'); li.textContent = k + ': ' + v; out.appendChild(li); document.body.dataset.results = JSON.stringify(results); };
  try { note('origin', String(self.origin)); } catch (e) { note('origin', 'error'); }
  try { note('cookie', document.cookie === '' ? 'empty' : 'visible'); } catch (e) { note('cookie', 'blocked'); }
  try { localStorage.setItem('x', '1'); note('localStorage', 'allowed'); } catch (e) { note('localStorage', 'blocked'); }
  try { void parent.document.title; note('parent', 'reachable'); } catch (e) { note('parent', 'blocked'); }
  try { top.location.href = 'https://example.com/'; note('topNavigation', 'tried'); } catch (e) { note('topNavigation', 'blocked'); }
  try { const w = window.open('https://example.com/'); note('popup', w ? 'opened' : 'blocked'); } catch (e) { note('popup', 'blocked'); }
  // The lockdown (D-085) takes fetch away: a call that throws is blocked too.
  try { fetch('/api/status', { credentials: 'include' }).then(() => note('fetchCore', 'allowed'), () => note('fetchCore', 'blocked')); } catch (e) { note('fetchCore', 'blocked'); }
  try { fetch('https://example.com/').then(() => note('fetchNet', 'allowed'), () => note('fetchNet', 'blocked')); } catch (e) { note('fetchNet', 'blocked'); }
  const img = new Image(); img.onload = () => note('imageNet', 'allowed'); img.onerror = () => note('imageNet', 'blocked'); img.src = 'https://example.com/pixel.png';
  // WebRTC sends UDP whatever the CSP says (review of 16/10): the e2e listens on this port.
  const stun = { iceServers: [{ urls: 'stun:127.0.0.1:${STUN_PROBE_PORT}' }] };
  const rtc = (C) => { const pc = new C(stun); pc.createDataChannel('x'); pc.createOffer().then((d) => pc.setLocalDescription(d)); };
  try { rtc(RTCPeerConnection); note('webrtc', 'created'); } catch (e) { note('webrtc', 'blocked'); }
  // A frame written by the page would bring fresh constructors: no frame may exist.
  try { const d = document.createElement('div'); d.innerHTML = '<iframe srcdoc="x"></iframe>'; document.body.appendChild(d); note('frameHtml', window.length > 0 ? 'created' : 'blocked'); } catch (e) { note('frameHtml', 'blocked'); }
  try { document.createElement('iframe'); note('frameElement', 'created'); } catch (e) { note('frameElement', 'blocked'); }
  window.addEventListener('message', (e) => { if (e.data === 'child-ran') note('frameStatic', 'ran'); });
  setTimeout(() => { if (!results.frameStatic) note('frameStatic', 'blocked'); note('done', 'yes'); }, 900);
</script>
<iframe srcdoc="&lt;script&gt;parent.postMessage('child-ran', '*'); try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${STUN_PROBE_PORT}' }] }); pc.createDataChannel('x'); pc.createOffer().then((d) => pc.setLocalDescription(d)); } catch (e) {}&lt;/script&gt;"></iframe>
</body></html>
`;

const SANDBOX_PROBE_EN = swap(SANDBOX_PROBE_IT, [
  ['<html lang="it">', '<html lang="en">'],
  ['<title>Prova sandbox</title>', '<title>Sandbox test</title>'],
  ['<h1>Prova della scatola</h1>', '<h1>Box test</h1>'],
]);

/** A page made after reading third-party text (D-085): served without scripts until the user says so. */
const INERT_PAGE_IT = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Prezzi trovati</title></head>
<body><h1>Prezzi trovati</h1><p id="state">Script spenti.</p>
<script>document.getElementById('state').textContent = 'Script accesi.';</script>
</body></html>
`;

const INERT_PAGE_EN = swap(INERT_PAGE_IT, [
  ['<html lang="it">', '<html lang="en">'],
  ['Prezzi trovati', 'Prices found'],
  ['Script spenti.', 'Scripts off.'],
  ['Script accesi.', 'Scripts on.'],
]);

const CSV_IT = `Data;Voce;Categoria;Importo
2026-10-01;Affitto studio;Casa;650,00
2026-10-03;Spesa;Cibo;84,20
2026-10-05;Abbonamento treno;Viaggi;49,00
2026-10-08;Cena con Rhea;Uscite;38,50
2026-10-11;Libri;Cultura;27,90
2026-10-14;"Regalo per Dione; fiori";Regali;22,00
`;

const CSV_EN = `Date;Item;Category;Amount
2026-10-01;Studio rent;Home;650.00
2026-10-03;Groceries;Food;84.20
2026-10-05;Train pass;Travel;49.00
2026-10-08;Dinner with Rhea;Going out;38.50
2026-10-11;Books;Culture;27.90
2026-10-14;"Gift for Dione; flowers";Gifts;22.00
`;

const JSON_TEXT_EN = `{"theme":"dark","sounds":false,"monsters":[{"id":"titan","role":"your squad lead"},{"id":"rhea","role":"research"}],"cap":{"day":10,"month":100}}`;

const JSON_TEXT_IT = `{"tema":"scuro","suoni":false,"mostri":[{"id":"titan","ruolo":"il tuo capo"},{"id":"rhea","ruolo":"ricerca"}],"tetto":{"giorno":10,"mese":100}}`;

const PY_EN = `# Count the words of a text file
import sys
from collections import Counter


def count(path: str, how_many: int = 10) -> list[tuple[str, int]]:
    """The most frequent words, most common first."""
    with open(path, encoding="utf-8") as f:
        words = f.read().lower().split()
    return Counter(words).most_common(how_many)


if __name__ == "__main__":
    for word, n in count(sys.argv[1]):
        print(f"{n:5d}  {word}")  # right-aligned
`;

const PY_IT = `# Conta le parole di un file di testo
import sys
from collections import Counter


def conta(percorso: str, quante: int = 10) -> list[tuple[str, int]]:
    """Le parole più frequenti, dalla più comune."""
    with open(percorso, encoding="utf-8") as f:
        parole = f.read().lower().split()
    return Counter(parole).most_common(quante)


if __name__ == "__main__":
    for parola, n in conta(sys.argv[1]):
        print(f"{n:5d}  {parola}")  # allineate a destra
`;

const meta = (
  m: Omit<FileMeta, 'hasThumb' | 'hasText' | 'path'> & Partial<FileMeta>,
): FileMeta => ({
  hasThumb: false,
  hasText: false,
  path: `File/2026-10/${m.name}`,
  ...m,
});

const bytes = (s: string) => new TextEncoder().encode(s).length;

const filesFor = (lang: Lang): MockFile[] => {
  const en = lang === 'en';
  const t = (english: string, italian: string) => (en ? english : italian);
  const MENU_PAGE = en ? MENU_PAGE_EN : MENU_PAGE_IT;
  const SANDBOX_PROBE = en ? SANDBOX_PROBE_EN : SANDBOX_PROBE_IT;
  const INERT_PAGE = en ? INERT_PAGE_EN : INERT_PAGE_IT;
  const CSV = en ? CSV_EN : CSV_IT;
  const JSON_TEXT = en ? JSON_TEXT_EN : JSON_TEXT_IT;
  const PY = en ? PY_EN : PY_IT;
  return [
    {
      meta: meta({
        id: 'f-menu-autunno',
        name: t('Autumn menu.png', 'Menu autunno.png'),
        mime: 'image/png',
        size: 48_213,
        kind: 'image',
        source: 'agent',
        agent: 'dione',
        width: 960,
        height: 640,
        hasThumb: true,
        createdAt: T0,
      }),
      body: { kind: 'png', width: 960, height: 640, scene: 'menu' },
    },
    {
      meta: meta({
        id: 'f-preventivo',
        name: t('Lisbon quote.pdf', 'Preventivo Lisbona.pdf'),
        mime: 'application/pdf',
        size: 2_871,
        kind: 'pdf',
        source: 'user',
        agent: 'titan',
        hasText: true,
        createdAt: T0 + 60_000,
      }),
      body: {
        kind: 'pdf',
        pages: en
          ? [
              [
                'Quote · Weekend in Lisbon',
                '',
                'Round-trip flight ............ 186 EUR',
                'Two nights in Alfama ......... 240 EUR',
                'Tram 28 and funiculars ........ 18 EUR',
                'Seafood dinner ................ 64 EUR',
                '',
                'Total ......................... 508 EUR',
              ],
              ['Notes', '', 'Book by Friday.', 'Ask Rhea for the best spots to watch the sunset.'],
            ]
          : [
              [
                'Preventivo · Weekend a Lisbona',
                '',
                'Volo andata e ritorno ........ 186 EUR',
                'Due notti in Alfama ........... 240 EUR',
                'Tram 28 e funicolari .......... 18 EUR',
                'Cena a base di pesce .......... 64 EUR',
                '',
                'Totale ......................... 508 EUR',
              ],
              [
                'Note',
                '',
                'Prenotare entro venerdi.',
                'Chiedere a Rhea i posti migliori per il tramonto.',
              ],
            ],
      },
    },
    {
      meta: meta({
        id: 'f-pagina-menu',
        name: t('Weekly menu.html', 'Menu della settimana.html'),
        mime: 'text/html',
        size: bytes(MENU_PAGE),
        kind: 'html',
        source: 'agent',
        agent: 'titan',
        createdAt: T0 + 120_000,
      }),
      body: { kind: 'text', text: MENU_PAGE },
    },
    {
      meta: meta({
        id: 'f-sandbox-prova',
        name: t('Sandbox test.html', 'Prova sandbox.html'),
        mime: 'text/html',
        size: bytes(SANDBOX_PROBE),
        kind: 'html',
        source: 'agent',
        agent: 'titan',
        createdAt: T0 + 130_000,
      }),
      body: { kind: 'text', text: SANDBOX_PROBE },
      hidden: true,
    },
    {
      meta: meta({
        id: 'f-pagina-inerte',
        name: t('Prices found.html', 'Prezzi trovati.html'),
        mime: 'text/html',
        size: bytes(INERT_PAGE),
        kind: 'html',
        source: 'agent',
        agent: 'rhea',
        inert: true,
        createdAt: T0 + 135_000,
      }),
      body: { kind: 'text', text: INERT_PAGE },
      hidden: true,
    },
    {
      meta: meta({
        id: 'f-spese',
        name: t('October expenses.csv', 'Spese ottobre.csv'),
        mime: 'text/csv',
        size: bytes(CSV),
        kind: 'sheet',
        source: 'user',
        agent: 'mimas',
        hasText: true,
        createdAt: T0 + 180_000,
      }),
      body: { kind: 'text', text: CSV },
    },
    {
      meta: meta({
        id: 'f-impostazioni',
        name: t('settings.json', 'impostazioni.json'),
        mime: 'application/json',
        size: bytes(JSON_TEXT),
        kind: 'text',
        source: 'agent',
        agent: 'enceladus',
        createdAt: T0 + 240_000,
      }),
      body: { kind: 'text', text: JSON_TEXT },
    },
    {
      meta: meta({
        id: 'f-conta-parole',
        name: t('count_words.py', 'conta_parole.py'),
        mime: 'text/x-python',
        size: bytes(PY),
        kind: 'text',
        source: 'agent',
        agent: 'enceladus',
        createdAt: T0 + 300_000,
      }),
      body: { kind: 'text', text: PY },
    },
    {
      meta: meta({
        id: 'f-foto-viaggio',
        name: t('Trip photos.zip', 'Foto viaggio.zip'),
        mime: 'application/zip',
        size: 18_400_000,
        kind: 'other',
        source: 'user',
        agent: 'titan',
        createdAt: T0 + 360_000,
      }),
      body: { kind: 'zip' },
    },
    {
      meta: meta({
        id: 'f-screenshot-tram',
        name: t('Screenshot carris.pt.png', 'Schermata carris.pt.png'),
        mime: 'image/png',
        size: 31_877,
        kind: 'image',
        source: 'tool',
        agent: 'rhea',
        width: 1280,
        height: 800,
        hasThumb: true,
        createdAt: T0 + 420_000,
      }),
      body: { kind: 'png', width: 1280, height: 800, scene: 'screenshot' },
    },
  ];
};

const cache = new Map<Lang, MockFile[]>();

/** The files of the mock in a language (built once per language). */
export function mockFiles(lang: Lang): MockFile[] {
  let list = cache.get(lang);
  if (!list) {
    list = filesFor(lang);
    cache.set(lang, list);
  }
  return list;
}

/** A file by id; Node (the dev server's middleware) passes the language of the page. */
export function mockFile(id: string, lang: Lang = 'it'): MockFile | undefined {
  return mockFiles(lang).find((f) => f.meta.id === id);
}
