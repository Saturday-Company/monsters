import { createHash } from 'node:crypto';
import { dotCss, dotPalette, monsterFor, renderDots, type Expression } from '@monsters/monster-kit';
import type { TunnelErrorKind } from '@monsters/remote';
import { INSTRUMENT_CSS, METER, pageThemeCss, SCREWS, WORDMARK } from './page-theme.ts';
import { remoteFailureCopy } from './remote-copy.ts';
import { TITLE_BAR_HEIGHT, type WindowChrome } from './title-bar.ts';

/*
 * What the window shows while there is no core to load: the choice of the first start
 * ("Dove lavorano i tuoi mostri?", audit UX 1.2), starting, restarting after a crash, given
 * up, or another core holding the data directory without answering; in the client mode
 * (M3.3, D-047) connecting to a remote core and why that failed. A self-contained page
 * (data: URL, strict CSP, fonts and the dot monster inline), loaded by the main process only;
 * "Riprova" calls the preload's `retryCore()`, the other buttons `statusAction()`.
 *
 * Drawn as the instrument (docs/design.md, D-062, D-089), like the sign-in of the web UI: the
 * top rail with the wordmark is the window's drag area (the rest of the page can be selected
 * and copied, audit UX 1.12); below it a device with four screws, its state in a label and a
 * light (dashes while waiting), a black screen with Titan in dots and a line of light, then
 * the words and the keys. One orange key per page.
 */

export type StatusView =
  | { kind: 'welcome' }
  | { kind: 'starting' }
  | { kind: 'restarting'; attempt: number; maxAttempts: number; delayMs: number }
  | { kind: 'failed'; logPath: string }
  | { kind: 'locked'; home: string }
  /** `dev`: an app run from the sources, where the bundle comes from `pnpm build:core`. */
  | { kind: 'missing'; path: string; dev?: boolean }
  /** resources/core is not the one of the package (S-M9): `detail` says which file. */
  | { kind: 'tampered'; detail: string; logPath: string }
  | { kind: 'remote-connecting'; name: string }
  | {
      kind: 'remote-failed';
      name: string;
      /** The address that was tried (the host of the profile). */
      address?: string;
      errorKind: TunnelErrorKind;
      message: string;
      /** Last lines of ssh, behind "Dettagli". */
      detail: string;
    };

/** Buttons of the status page besides "Riprova" (handled by the main process). */
export const STATUS_ACTIONS = [
  'local',
  'connections',
  'add-connection',
  'fix',
  'forget-key',
  'open-log',
] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export function isStatusAction(v: unknown): v is StatusAction {
  return typeof v === 'string' && (STATUS_ACTIONS as readonly string[]).includes(v);
}

interface Copy {
  title: string;
  body: string[];
  expression: Expression;
  retry: boolean;
  busy: boolean;
  actions?: StatusAction[];
  detail?: string;
}

const ACTION_LABELS: Record<StatusAction, string> = {
  local: 'Usa questo computer',
  connections: 'Connessioni…',
  'add-connection': 'Aggiungi un computer',
  fix: 'Correggi la connessione',
  'forget-key': 'Dimentica la vecchia chiave',
  'open-log': 'Apri il log',
};

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s === 1 ? 'un secondo' : `${s} secondi`;
}

export function statusCopy(view: Exclude<StatusView, { kind: 'welcome' }>): Copy {
  switch (view.kind) {
    case 'starting':
      return {
        title: 'Accendo Monsters…',
        body: ['Un attimo: sta partendo su questo computer.'],
        expression: 'think',
        retry: false,
        busy: true,
        actions: ['connections'],
      };
    case 'restarting':
      return {
        title: 'Monsters si è fermato all’improvviso',
        body: [
          `Lo riavvio tra ${seconds(view.delayMs)} (tentativo ${view.attempt} di ${view.maxAttempts}).`,
          'I lavori che erano in corso si sono interrotti: li ritrovi in Attività.',
        ],
        expression: 'error',
        retry: false,
        busy: true,
      };
    case 'failed':
      return {
        title: 'Monsters non riparte',
        body: [
          'Ho provato più volte senza riuscirci. Riprova; se non basta, nel log c’è cosa è successo.',
        ],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['open-log', 'connections'],
        detail: `Il log è in ${view.logPath}`,
      };
    case 'locked':
      return {
        title: 'Monsters è già acceso, ma non risponde',
        body: [
          `Un altro Monsters sta usando i dati di questo computer (${view.home}) e non risponde.`,
          'Chiudilo (se l’hai aperto da un terminale, con Ctrl+C), poi premi «Riprova».',
        ],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['connections'],
      };
    case 'missing':
      return view.dev
        ? {
            title: 'Manca una parte di Monsters',
            body: [
              `Non trovo ${view.path}.`,
              'Dalla cartella del progetto lancia pnpm build:core, poi riprova.',
            ],
            expression: 'error',
            retry: true,
            busy: false,
            actions: ['connections'],
          }
        : {
            title: 'Manca una parte di Monsters',
            body: ['L’installazione sembra incompleta: installa di nuovo Monsters, poi riaprilo.'],
            expression: 'error',
            retry: true,
            busy: false,
            actions: ['connections'],
            detail: `Non trovo ${view.path}`,
          };
    case 'tampered':
      return {
        title: 'Monsters non parte: i suoi file sono cambiati',
        body: [
          'Un file del motore di Monsters non è quello installato. Per sicurezza non lo avvio: potrebbe averlo cambiato un altro programma.',
          'Installa di nuovo Monsters (i tuoi dati restano dove sono), poi riaprilo.',
        ],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['open-log', 'connections'],
        detail: `${view.detail[0]!.toUpperCase()}${view.detail.slice(1)}. Il log è in ${view.logPath}`,
      };
    case 'remote-connecting':
      return {
        title: `Mi collego a ${view.name}…`,
        body: ['Un attimo: raggiungo il Monsters che gira su quel computer.'],
        expression: 'think',
        retry: false,
        busy: true,
        actions: ['local', 'connections'],
      };
    case 'remote-failed': {
      const copy = remoteFailureCopy(
        view.errorKind,
        view.name,
        view.address ?? view.name,
        view.message,
      );
      return {
        title: `Non riesco a collegarmi a ${view.name}`,
        body: copy.tip ? [copy.message, copy.tip] : [copy.message],
        expression: 'error',
        retry: true,
        busy: false,
        actions: [
          ...(copy.fix ? (['fix'] as const) : []),
          ...(copy.forgetKey ? (['forget-key'] as const) : []),
          'local',
          'connections',
        ],
        ...(view.detail ? { detail: view.detail } : {}),
      };
    }
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SCRIPT =
  "document.getElementById('retry')?.addEventListener('click',()=>{window.monstersDesktop?.retryCore?.()});" +
  "for(const b of document.querySelectorAll('button[data-action]'))b.addEventListener('click',()=>{window.monstersDesktop?.statusAction?.(b.dataset.action)});" +
  "document.querySelector('[autofocus]')?.focus();";

/*
 * The rail is the drag area (fixed, as tall as the integrated title bar); the device hangs
 * from it, anchored at the top like the sign-in of the web UI, so a longer error grows it
 * downwards. Choices are keys of the keypad (docs/design.md, "Domanda con opzioni"): the
 * recommended one says so on the right with an orange light, the focused one shows the ↵ cap
 * (Enter chooses it). "Dettagli" open on a small screen, like "Dietro le quinte".
 */
const STYLE = `
.drag{position:fixed;z-index:1;top:0;left:0;right:0;height:${TITLE_BAR_HEIGHT}px;-webkit-app-region:drag}
main{display:flex;justify-content:center;padding:${TITLE_BAR_HEIGHT + 2 + 24}px 16px 24px}
.device{width:100%;max-width:520px;padding:26px 28px 28px;text-align:center}
.device-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 4px;margin-bottom:12px;color:var(--ink-muted)}
.device-state{display:inline-flex;align-items:center;gap:8px;min-width:0}
.device-state>span:last-child,.monitor-line{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.monitor{height:176px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:14px;padding:0 20px}
.monitor svg{display:block;flex:none}
.monitor-line{max-width:100%;margin:0;color:var(--screen-muted)}
.monitor-line[data-tone=stop]{color:var(--screen-stop)}
.monitor-line[data-tone=ink]{color:var(--screen-ink)}
.monitor.strip{height:76px;flex-direction:row;justify-content:flex-start;gap:14px;padding:0 16px;border-radius:12px;text-align:left}
.monitor-text{flex:1;min-width:0}
.monitor-name{margin:0;font-family:var(--font-display);font-weight:900;font-size:26px;line-height:30px;letter-spacing:.08em}
.strip .monitor-line{display:flex;align-items:center;gap:8px;margin-top:2px;font-family:var(--font-mono);font-size:11px;line-height:16px;letter-spacing:.02em}
.strip .monitor-line>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
h1{margin:22px 0 0;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.02em;text-wrap:balance}
p{margin:8px 0 0;color:var(--ink-muted);overflow-wrap:anywhere;text-wrap:pretty;user-select:text}
h1+p{margin-top:8px}
details{margin-top:16px;text-align:left;user-select:text}
details>summary{margin:0 auto;padding:4px 8px;font-family:inherit;color:var(--ink-muted);font-size:14px;font-weight:500}
details>summary:hover{color:var(--ink)}
pre{margin:10px 0 0;padding:12px 14px;max-height:9.5rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:10px;font:12.5px/19px var(--font-mono);color:var(--screen-ink)}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:24px}
.actions>button{flex:0 1 auto}
.actions>button:not(.secondary){flex:1 1 100%;min-height:48px;font-size:16px;--cap:var(--signal);--cap-hover:color-mix(in oklab,var(--signal),white 7%);--edge:var(--signal-edge);--hi-cap:var(--hi-signal);color:var(--on-signal)}
.choices{display:grid;gap:12px;margin-top:22px;text-align:left}
.choice{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;justify-items:start;text-align:left;column-gap:14px;row-gap:2px;width:100%;min-height:72px;padding:13px 16px 13px 18px;border-radius:12px;white-space:normal}
.choice strong{display:contents;font-size:16px;line-height:24px;font-weight:600}
.choice em{grid-column:2;grid-row:1/3;display:inline-flex;align-items:center;gap:8px;font-style:normal;color:var(--signal-ink);font-family:var(--font-mono);font-size:11px;line-height:16px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.choice em::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--signal);box-shadow:inset 0 -1px 1px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.5),0 0 7px 1px color-mix(in oklab,var(--signal),transparent 45%)}
.choice span{grid-column:1;grid-row:2;color:var(--ink-muted);font-size:14px;line-height:20px;font-weight:400}
.choice::after{content:'↵';grid-column:3;grid-row:1/3;display:none;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border-radius:5px;font-family:var(--font-mono);font-size:12px;font-weight:500;color:var(--ink-muted);background:var(--raised);box-shadow:inset 0 0 0 1px var(--key-edge),0 2px 0 var(--key-edge)}
.choice:focus-visible{grid-template-columns:minmax(0,1fr) auto auto}
.choice:focus-visible::after{display:inline-flex}
`;

/** The faceplate of the device for a view: section, state (light or dashes), line of the screen. */
interface Face {
  section: string;
  state: string;
  /** `wait`: dashes; otherwise the tone of the light (`idle` is off). */
  light: 'wait' | 'idle' | 'stop';
  line: string;
  lineTone?: 'stop' | 'ink';
}

function faceOf(view: StatusView): Face {
  switch (view.kind) {
    case 'welcome':
      return {
        section: 'Prima accensione',
        state: 'In attesa',
        light: 'idle',
        line: 'Pronto per la prima accensione',
      };
    case 'starting':
      return { section: 'Accensione', state: 'Accendo', light: 'wait', line: 'Si accende…' };
    case 'restarting':
      return {
        section: 'Accensione',
        state: 'Riavvio',
        light: 'wait',
        line: `Tentativo ${view.attempt} / ${view.maxAttempts}`,
      };
    case 'failed':
      return {
        section: 'Accensione',
        state: 'Fermo',
        light: 'stop',
        line: 'Non riparte',
        lineTone: 'stop',
      };
    case 'locked':
      return {
        section: 'Accensione',
        state: 'Occupato',
        light: 'stop',
        line: 'Dati già in uso',
        lineTone: 'stop',
      };
    case 'missing':
      return {
        section: 'Accensione',
        state: 'Incompleto',
        light: 'stop',
        line: 'Manca un pezzo',
        lineTone: 'stop',
      };
    case 'tampered':
      return {
        section: 'Accensione',
        state: 'Fermo',
        light: 'stop',
        line: 'File cambiati',
        lineTone: 'stop',
      };
    case 'remote-connecting':
      return {
        section: 'Collegamento',
        state: 'Mi collego',
        light: 'wait',
        line: view.name,
        lineTone: 'ink',
      };
    case 'remote-failed':
      return {
        section: 'Collegamento',
        state: 'Non collegato',
        light: 'stop',
        line: view.address ?? view.name,
        lineTone: 'stop',
      };
  }
}

/**
 * The top of the faceplate and the screen with Titan (decorative: the heading says it all).
 * While waiting, a big screen as in the sign-in; when something is wrong the words matter
 * more, so the screen is the monitor strip of the chat (Titan, his name in his light, the
 * problem on one line) and the explanation fits the window.
 */
function deviceHead(face: Face, expression: Expression): string {
  const titan = monsterFor('titan');
  const light =
    face.light === 'wait'
      ? METER
      : `<span class="led"${face.light === 'stop' ? ' data-tone="stop"' : ''}></span>`;
  const top = `${SCREWS}
<div class="device-top" aria-hidden="true"><span class="label">${escape(face.section)}</span><span class="label device-state">${light}<span>${escape(face.state)}</span></span></div>`;
  const tone = face.lineTone ? ` data-tone="${face.lineTone}"` : '';
  if (face.light === 'stop') {
    const monster = renderDots(titan, { size: 68, expression, title: 'Titan' });
    return `${top}
<div class="screen screen-lines monitor strip">${monster}<div class="monitor-text" aria-hidden="true"><p class="monitor-name" style="color:${dotPalette(titan).lit}">Titan</p><p class="monitor-line"${tone}><span class="led" data-tone="stop"></span><span>${escape(face.line)}</span></p></div></div>`;
  }
  const monster = renderDots(titan, { size: 128, expression, title: 'Titan' });
  return `${top}
<div class="screen screen-lines monitor">${monster}<p class="label monitor-line"${tone} aria-hidden="true">${escape(face.line)}</p></div>`;
}

function pageHtml(
  kind: string,
  busy: boolean,
  inner: string,
  withScript: boolean,
  chrome: WindowChrome,
): string {
  const scriptHash = createHash('sha256').update(SCRIPT).digest('base64');
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${scriptHash}'`,
    'img-src data:',
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="it" data-chrome="${chrome}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<title>Monsters</title>
<style>
${pageThemeCss()}
${INSTRUMENT_CSS}
${dotCss}
${STYLE}
</style>
</head>
<body>
<header class="drag rail" aria-hidden="true">${WORDMARK}</header>
<main role="status" aria-live="polite" aria-busy="${busy}" data-status="${kind}">
<div class="device">
${inner}
</div>
</main>
${withScript ? `<script>${SCRIPT}</script>` : ''}
</body>
</html>
`;
}

/** First start without connections.json: where the monsters work. Enter = this computer. */
function welcomeHtml(chrome: WindowChrome): string {
  return pageHtml(
    'welcome',
    false,
    `${deviceHead(faceOf({ kind: 'welcome' }), 'happy')}
<h1>Dove lavorano i tuoi mostri?</h1>
<p>Puoi cambiarlo quando vuoi da Connessioni.</p>
<div class="choices" role="group" aria-label="Dove lavorano i tuoi mostri">
<button type="button" class="choice recommended" id="local" data-action="local" autofocus><strong>Su questo computer <em>Consigliato</em></strong><span>Tutto resta qui. Va bene quasi sempre.</span></button>
<button type="button" class="choice" id="other" data-action="add-connection"><strong>Su un altro mio computer</strong><span>Monsters è già acceso su un altro tuo computer e vuoi usarlo da qui.</span></button>
</div>`,
    true,
    chrome,
  );
}

/** The page for `view`; `chrome` is the window's title bar (room for the traffic lights or buttons). */
export function statusPageHtml(view: StatusView, chrome: WindowChrome = 'frame'): string {
  if (view.kind === 'welcome') return welcomeHtml(chrome);
  const copy = statusCopy(view);
  // One primary button: the fix when the profile is what is wrong, else "Riprova".
  const actions = copy.actions ?? [];
  const fixFirst = actions.includes('fix');
  const action = (a: StatusAction, primary: boolean) =>
    `<button type="button"${primary ? '' : ' class="secondary"'} data-action="${a}">${escape(ACTION_LABELS[a])}</button>`;
  const retry = (primary: boolean) =>
    copy.retry
      ? `<button id="retry" type="button"${primary ? '' : ' class="secondary"'}>Riprova</button>`
      : '';
  const buttons = [
    ...(fixFirst ? [action('fix', true)] : []),
    retry(!fixFirst),
    ...actions.filter((a) => a !== 'fix').map((a) => action(a, false)),
  ].join('');
  return pageHtml(
    view.kind,
    copy.busy,
    `${deviceHead(faceOf(view), copy.expression)}
<h1>${escape(copy.title)}</h1>
${copy.body.map((line) => `<p>${escape(line)}</p>`).join('\n')}
${copy.detail ? `<details><summary>Dettagli</summary><pre class="screen">${escape(copy.detail)}</pre></details>` : ''}
${buttons ? `<div class="actions">${buttons}</div>` : ''}`,
    buttons !== '',
    chrome,
  );
}

export function statusPageUrl(view: StatusView, chrome: WindowChrome = 'frame'): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(statusPageHtml(view, chrome)).toString('base64')}`;
}
