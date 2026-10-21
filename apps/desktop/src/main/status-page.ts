import { createHash } from 'node:crypto';
import { appLang } from '@monsters/shared';
import { dotCss, dotPalette, monsterFor, renderDots, type Expression } from '@monsters/monster-kit';
import type { TunnelErrorKind } from '@monsters/remote';
import { INSTRUMENT_CSS, METER, pageThemeCss, SCREWS, WORDMARK } from './page-theme.ts';
import { remoteFailureCopy } from './remote-copy.ts';
import { statusPageStrings } from './status-page.strings.ts';
import { TITLE_BAR_HEIGHT, type WindowChrome } from './title-bar.ts';

/*
 * What the window shows while there is no core to load: the choice of the first start
 * ("Where do your monsters work?", audit UX 1.2), starting, restarting after a crash, given
 * up, or another core holding the data directory without answering; in the client mode
 * (M3.3, D-047) connecting to a remote core and why that failed. A self-contained page
 * (data: URL, strict CSP, fonts and the dot monster inline), loaded by the main process only;
 * "Try again" calls the preload's `retryCore()`, the other buttons `statusAction()`.
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
      /** Last lines of ssh, behind "Details". */
      detail: string;
    };

/** Buttons of the status page besides "Try again" (handled by the main process). */
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

function seconds(ms: number): string {
  return statusPageStrings().seconds(Math.max(1, Math.round(ms / 1000)));
}

export function statusCopy(view: Exclude<StatusView, { kind: 'welcome' }>): Copy {
  const t = statusPageStrings();
  switch (view.kind) {
    case 'starting':
      return {
        title: t.starting.title,
        body: [t.starting.body],
        expression: 'think',
        retry: false,
        busy: true,
        actions: ['connections'],
      };
    case 'restarting':
      return {
        title: t.restarting.title,
        body: [
          t.restarting.restartIn(seconds(view.delayMs), view.attempt, view.maxAttempts),
          t.restarting.interrupted,
        ],
        expression: 'error',
        retry: false,
        busy: true,
      };
    case 'failed':
      return {
        title: t.failed.title,
        body: [t.failed.body],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['open-log', 'connections'],
        detail: t.failed.detail(view.logPath),
      };
    case 'locked':
      return {
        title: t.locked.title,
        body: [t.locked.body(view.home), t.locked.close],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['connections'],
      };
    case 'missing':
      return view.dev
        ? {
            title: t.missing.title,
            body: [t.missing.devNotFound(view.path), t.missing.devFix],
            expression: 'error',
            retry: true,
            busy: false,
            actions: ['connections'],
          }
        : {
            title: t.missing.title,
            body: [t.missing.body],
            expression: 'error',
            retry: true,
            busy: false,
            actions: ['connections'],
            detail: t.missing.detail(view.path),
          };
    case 'tampered':
      return {
        title: t.tampered.title,
        body: [t.tampered.why, t.tampered.fix],
        expression: 'error',
        retry: true,
        busy: false,
        actions: ['open-log', 'connections'],
        detail: t.tampered.detail(
          `${view.detail[0]!.toUpperCase()}${view.detail.slice(1)}`,
          view.logPath,
        ),
      };
    case 'remote-connecting':
      return {
        title: t.remoteConnecting.title(view.name),
        body: [t.remoteConnecting.body],
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
        title: t.remoteFailed.title(view.name),
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
 * (Enter chooses it). "Details" open on a small screen, like "Behind the scenes".
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
  const f = statusPageStrings().face;
  switch (view.kind) {
    case 'welcome':
      return {
        section: f.welcomeSection,
        state: f.welcomeState,
        light: 'idle',
        line: f.welcomeLine,
      };
    case 'starting':
      return {
        section: f.startupSection,
        state: f.startingState,
        light: 'wait',
        line: f.startingLine,
      };
    case 'restarting':
      return {
        section: f.startupSection,
        state: f.restartingState,
        light: 'wait',
        line: f.restartingLine(view.attempt, view.maxAttempts),
      };
    case 'failed':
      return {
        section: f.startupSection,
        state: f.stoppedState,
        light: 'stop',
        line: f.failedLine,
        lineTone: 'stop',
      };
    case 'locked':
      return {
        section: f.startupSection,
        state: f.lockedState,
        light: 'stop',
        line: f.lockedLine,
        lineTone: 'stop',
      };
    case 'missing':
      return {
        section: f.startupSection,
        state: f.missingState,
        light: 'stop',
        line: f.missingLine,
        lineTone: 'stop',
      };
    case 'tampered':
      return {
        section: f.startupSection,
        state: f.stoppedState,
        light: 'stop',
        line: f.tamperedLine,
        lineTone: 'stop',
      };
    case 'remote-connecting':
      return {
        section: f.linkSection,
        state: f.connectingState,
        light: 'wait',
        line: view.name,
        lineTone: 'ink',
      };
    case 'remote-failed':
      return {
        section: f.linkSection,
        state: f.notConnectedState,
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
<html lang="${appLang()}" data-chrome="${chrome}">
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
  const t = statusPageStrings().welcome;
  return pageHtml(
    'welcome',
    false,
    `${deviceHead(faceOf({ kind: 'welcome' }), 'happy')}
<h1>${escape(t.title)}</h1>
<p>${escape(t.hint)}</p>
<div class="choices" role="group" aria-label="${escape(t.title)}">
<button type="button" class="choice recommended" id="local" data-action="local" autofocus><strong>${escape(t.local)} <em>${escape(t.recommended)}</em></strong><span>${escape(t.localHint)}</span></button>
<button type="button" class="choice" id="other" data-action="add-connection"><strong>${escape(t.other)}</strong><span>${escape(t.otherHint)}</span></button>
</div>`,
    true,
    chrome,
  );
}

/** The page for `view`; `chrome` is the window's title bar (room for the traffic lights or buttons). */
export function statusPageHtml(view: StatusView, chrome: WindowChrome = 'frame'): string {
  if (view.kind === 'welcome') return welcomeHtml(chrome);
  const copy = statusCopy(view);
  // One primary button: the fix when the profile is what is wrong, else "Try again".
  const actions = copy.actions ?? [];
  const fixFirst = actions.includes('fix');
  const action = (a: StatusAction, primary: boolean) =>
    `<button type="button"${primary ? '' : ' class="secondary"'} data-action="${a}">${escape(statusPageStrings().actions[a])}</button>`;
  const retry = (primary: boolean) =>
    copy.retry
      ? `<button id="retry" type="button"${primary ? '' : ' class="secondary"'}>${escape(statusPageStrings().retry)}</button>`
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
${copy.detail ? `<details><summary>${escape(statusPageStrings().details)}</summary><pre class="screen">${escape(copy.detail)}</pre></details>` : ''}
${buttons ? `<div class="actions">${buttons}</div>` : ''}`,
    buttons !== '',
    chrome,
  );
}

export function statusPageUrl(view: StatusView, chrome: WindowChrome = 'frame'): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(statusPageHtml(view, chrome)).toString('base64')}`;
}
