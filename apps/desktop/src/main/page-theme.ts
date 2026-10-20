import { FONT_DISPLAY, FONT_MONO, FONT_SANS, PAGE_FONTS_CSS } from './page-fonts.ts';

/*
 * The palette and the parts of docs/design.md ("Strumento", D-062) for the pages the app
 * builds itself (status page, "Connessioni", the reconnection banner) and for the window
 * chrome. The web UI keeps its own copy in apps/web/src/theme/tokens.ts and styles.css (a test
 * keeps the colours equal); these pages are data: URLs rendered by the main process and must
 * not depend on the web bundle, so their fonts travel inside them (page-fonts.ts, D-089).
 * Values and names follow the spec's table, so a page here looks like the rest of the app.
 */

export type PageThemeName = 'light' | 'dark';

export interface PagePalette {
  /** Window, top rail: the overlay of the system buttons is painted in it. */
  chassis: string;
  /** The content module. */
  panel: string;
  /** Cards, the caps of the keys. */
  raised: string;
  /** Fields, sunk. */
  well: string;
  /** The dark and the light line of a seam. */
  seam: string;
  seamLight: string;
  /** The thickness of the keys. */
  keyEdge: string;
  /** The lever of a switch: its cap and its edge (≥ 3:1 on the well). */
  lever: string;
  leverEdge: string;
  ink: string;
  /** Secondary text, ≥ 4.5:1 on chassis, panel, raised and well. */
  inkMuted: string;
  /** Labels on panel and raised only. */
  inkFaint: string;
  /** The action colour: a fill under dark text. */
  signal: string;
  onSignal: string;
  /** The signal as text, links and focus rings. */
  signalInk: string;
  /** The thickness of a signal key. */
  signalEdge: string;
  /** Ferma and serious errors: a fill. */
  stop: string;
  onStop: string;
  /** Red text. */
  stopInk: string;
  /** The soft red behind an error. */
  stopSoft: string;
  /** Green light. */
  ok: string;
  /** Every screen (the same in both themes). */
  screen: string;
  /** Text on the screens, and its quiet version (≥ 4.5:1 on black). */
  screenInk: string;
  screenMuted: string;
  /** Dots switched off. */
  screenOff: string;
  /** Red and green as light on a screen (≥ 4.5:1 on black). */
  screenStop: string;
  screenOk: string;
  /** Translucent ink: rows, chips, code. */
  fill: string;
  fillStrong: string;
  /** Hairlines between rows. */
  separator: string;
  /** `r,g,b` of the soft shadows (`--shadow-rgb`). */
  shadowRgb: string;
}

const SCREEN = {
  screenInk: '#efe9dc',
  screenMuted: '#8f8b81',
  screenOff: 'rgba(255,255,255,.07)',
  screenStop: '#ff5a4e',
  screenOk: '#4fd98a',
} as const;

/** Same values as apps/web/src/theme/tokens.ts (contrast checked there, ≥ 4.5:1). */
export const PAGE_PALETTE: Readonly<Record<PageThemeName, Readonly<PagePalette>>> = {
  light: {
    chassis: '#e3e1db',
    panel: '#f2f1ec',
    raised: '#fbfaf7',
    well: '#d8d5ce',
    seam: 'rgba(0,0,0,.13)',
    seamLight: 'rgba(255,255,255,.65)',
    keyEdge: '#b5b2a9',
    lever: '#fbfaf7',
    leverEdge: '#78756d',
    ink: '#1a1a18',
    inkMuted: '#5c5a54',
    inkFaint: '#6b6963',
    signal: '#ff4f00',
    onSignal: '#170800',
    signalInk: '#a83500',
    signalEdge: '#a33300',
    stop: '#d8231a',
    onStop: '#ffffff',
    stopInk: '#b51c14',
    stopSoft: '#f4dcd5',
    ok: '#1f8f4e',
    screen: '#0d0d0c',
    ...SCREEN,
    fill: 'rgba(60,52,30,.07)',
    fillStrong: 'rgba(60,52,30,.1)',
    separator: 'rgba(0,0,0,.11)',
    shadowRgb: '40,34,20',
  },
  dark: {
    chassis: '#151514',
    panel: '#1c1c1a',
    raised: '#252523',
    well: '#0f0f0e',
    seam: 'rgba(0,0,0,.6)',
    seamLight: 'rgba(255,255,255,.05)',
    keyEdge: '#0a0a09',
    lever: '#64635e',
    leverEdge: '#0a0a09',
    ink: '#ecebe5',
    inkMuted: '#a3a19a',
    inkFaint: '#8d8b85',
    signal: '#ff5e14',
    onSignal: '#170800',
    signalInk: '#ff8a4c',
    signalEdge: '#8a2c00',
    stop: '#ff3b2f',
    onStop: '#1a0302',
    stopInk: '#ff7b72',
    stopSoft: '#2e1513',
    ok: '#4fd98a',
    screen: '#050505',
    ...SCREEN,
    fill: 'rgba(0,0,0,.3)',
    fillStrong: 'rgba(255,255,255,.07)',
    separator: 'rgba(255,255,255,.07)',
    shadowRgb: '0,0,0',
  },
};

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function declarations(name: PageThemeName): string {
  return Object.entries(PAGE_PALETTE[name])
    .map(([k, v]) => `--${kebab(k)}:${v}`)
    .join(';');
}

/** `:root` custom properties (`--chassis`, `--ink`, …), light and dark by the system theme. */
export function pageThemeCss(): string {
  return `:root{${declarations('light')}}@media (prefers-color-scheme:dark){:root{${declarations('dark')}}}`;
}

/** The system font stack (the reconnection banner; the pages use the fonts of page-fonts.ts). */
export const SYSTEM_FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI","Ubuntu Sans",Cantarell,system-ui,sans-serif';

/**
 * The parts of the instrument for the app's own pages, as in the web UI (styles.css): fonts,
 * the top rail, seams, wells, screens, lights, the level meter, keys, fields, switches, the
 * faceplate of a device with its screws, cards, drawers. Motion follows D-084: frames of
 * 40 ms by `steps()`, only transform, opacity and visibility (and the turn of a caret); the
 * release of a key is instant; "Riduci movimento" leaves only the states.
 *
 * - `.rail`: the 52 px top rail of chassis with the wordmark in Doto; `data-chrome` on
 *   `<html>` leaves room for the traffic lights (inset: 92 px, as the web UI's rail) or the
 *   system buttons (overlay).
 * - `button`: a key (raised cap, 1 px edge, 3 px thickness, sinks 2 px in two frames);
 *   `.primary` signal orange, `.danger` stop red, `.ghost` no cap (sinks 1 px).
 * - `.label`: Martian Mono 11 px upper case. `.screen`: black, only light inside.
 *   `.led` (`data-tone` ok / signal / stop, `data-blink` for what waits for the user);
 *   `.meter`: four dashes lit in turns, a wait (never a spinner).
 * - `input.switch`: a checkbox drawn as the switch of the spec (a lever in a sunk track), with
 *   a `.led` after it that lights green when on.
 */
export const INSTRUMENT_CSS = `${PAGE_FONTS_CSS}
:root{--font-sans:${FONT_SANS};--font-mono:${FONT_MONO};--font-display:${FONT_DISPLAY};--dur-press:80ms;--dur-ui:120ms;--steps-press:steps(2,jump-end);--steps-ui:steps(3,jump-end);--hi:rgba(255,255,255,.75);--hi-signal:rgba(255,255,255,.3)}
@media (prefers-color-scheme:dark){:root{--hi:rgba(255,255,255,.07);--hi-signal:rgba(255,255,255,.2)}}
*{box-sizing:border-box}
html{background:var(--chassis);color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{margin:0;background:var(--chassis);color:var(--ink);font:15px/22px var(--font-sans);font-variant-numeric:tabular-nums}
::selection{background:color-mix(in oklab,var(--signal),transparent 68%)}
:focus-visible{outline:2px solid var(--signal-ink);outline-offset:2px}
.label{font-family:var(--font-mono);font-size:11px;line-height:16px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.wordmark{font-family:var(--font-display);font-weight:900;font-size:20px;line-height:1;letter-spacing:.08em;color:var(--ink);white-space:nowrap}
.rail{height:52px;display:flex;align-items:center;gap:16px;padding:0 20px;background:var(--chassis);box-shadow:0 1px 0 var(--seam),0 2px 0 var(--seam-light);-webkit-app-region:drag;user-select:none}
html[data-chrome=inset] .rail{padding-left:92px}
html[data-chrome=overlay] .rail{padding-right:max(12px,calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,100vw) + 8px))}
.rail-seam{flex:none;align-self:stretch;width:2px;margin:12px 0;background:linear-gradient(to right,var(--seam) 0 1px,var(--seam-light) 1px 2px)}
.screen{background:var(--screen);color:var(--screen-ink);border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),inset 0 0 0 1px rgba(255,255,255,.045),0 0 0 1px var(--seam),0 1px 0 1px var(--seam-light)}
.screen-lines{position:relative}
.screen-lines::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.05) 0 1px,transparent 1px 2px)}
.led{--led:color-mix(in oklab,var(--ink),transparent 80%);display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--led);box-shadow:inset 0 -1px 1px rgba(0,0,0,.3),inset 0 1px 1px rgba(255,255,255,.4)}
.led:is([data-tone=ok],[data-tone=signal],[data-tone=stop]){box-shadow:inset 0 -1px 1px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.5),0 0 7px 1px color-mix(in oklab,var(--led),transparent 45%)}
.led[data-tone=ok]{--led:var(--ok)}
.led[data-tone=signal]{--led:var(--signal)}
.led[data-tone=stop]{--led:var(--stop)}
.screen .led{--led:rgba(255,255,255,.13)}
.screen .led[data-tone=stop]{--led:var(--screen-stop)}
.meter{display:inline-flex;flex:none;align-items:flex-end;gap:2px;height:10px;color:var(--signal-ink)}
.meter>i{display:block;width:3px;height:10px;border-radius:1px;background:currentColor;opacity:.2}
.meter>i:first-child{opacity:1}
@media (prefers-reduced-motion:no-preference){
.meter>i:nth-child(2){animation:meter-2 480ms steps(1,end) infinite}
.meter>i:nth-child(3){animation:meter-3 720ms steps(1,end) infinite}
.meter>i:nth-child(4){animation:meter-4 1120ms steps(1,end) infinite}
.led[data-blink]{animation:led-blink 1s steps(1,end) infinite}
.rise-in{animation:rise-in var(--dur-ui) var(--steps-ui) backwards}
}
@media (prefers-reduced-motion:reduce){.meter>i:nth-child(2){opacity:1}*{transition:none!important}}
@keyframes meter-2{0%,100%{opacity:1}70%{opacity:.2}}
@keyframes meter-3{0%,100%{opacity:.2}30%{opacity:1}80%{opacity:.2}}
@keyframes meter-4{0%,100%{opacity:.2}45%{opacity:1}60%{opacity:.2}}
@keyframes led-blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes rise-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
button{-webkit-app-region:no-drag}
button{--cap:var(--raised);--cap-hover:color-mix(in oklab,var(--raised),var(--ink) 4%);--edge:var(--key-edge);--hi-cap:var(--hi);font:inherit;font-size:15px;line-height:20px;font-weight:600;color:var(--ink);min-height:44px;padding:0 20px;margin:0 0 3px;border:0;border-radius:10px;background:var(--cap);box-shadow:inset 0 0 0 1px var(--edge),inset 0 2px 0 -1px var(--hi-cap),0 3px 0 var(--edge);transform:translateY(0);cursor:pointer;user-select:none}
@media (hover:hover){button:hover:not(:disabled){--cap:var(--cap-hover)}}
button:active:not(:disabled){transform:translateY(2px);box-shadow:inset 0 0 0 1px var(--edge),inset 0 2px 0 -1px var(--hi-cap),0 1px 0 var(--edge);transition:transform var(--dur-press) var(--steps-press),box-shadow var(--dur-press) var(--steps-press)}
button.primary{--cap:var(--signal);--cap-hover:color-mix(in oklab,var(--signal),white 7%);--edge:var(--signal-edge);--hi-cap:var(--hi-signal);color:var(--on-signal)}
button.danger{--cap:var(--stop);--cap-hover:color-mix(in oklab,var(--stop),white 6%);--edge:color-mix(in oklab,var(--stop),black 40%);--hi-cap:rgba(255,255,255,.22);color:var(--on-stop)}
button.ghost{background:transparent;box-shadow:none;color:var(--ink-muted);margin-bottom:0}
@media (hover:hover){button.ghost:hover:not(:disabled){background:color-mix(in oklab,var(--ink),transparent 93%);color:var(--ink)}}
button.ghost:active:not(:disabled){transform:translateY(1px);box-shadow:none;background:color-mix(in oklab,var(--ink),transparent 89%)}
button:disabled{--cap:var(--raised);--edge:var(--key-edge);--hi-cap:var(--hi);color:var(--ink-muted);cursor:default}
input:not([type=checkbox]){width:100%;min-width:0;height:44px;padding:0 14px;border:0;border-radius:10px;font:inherit;font-size:15px;color:var(--ink);background:var(--well);box-shadow:inset 0 1px 0 var(--seam),inset 0 0 0 1px color-mix(in oklab,var(--seam),transparent 55%),0 1px 0 var(--seam-light)}
input:not([type=checkbox]):focus{outline:2px solid var(--signal-ink);outline-offset:0}
input::placeholder{color:var(--ink-muted);opacity:1}
input[aria-invalid=true]{outline:2px solid var(--stop);outline-offset:0}
input.highlight{outline:2px solid var(--signal-ink);outline-offset:0}
input.switch{appearance:none;position:relative;flex:none;width:52px;height:30px;margin:0;border-radius:9px;cursor:pointer;background:var(--well);box-shadow:inset 0 1px 0 var(--seam),inset 0 0 0 1px color-mix(in oklab,var(--seam),transparent 55%),0 1px 0 var(--seam-light)}
input.switch::before{content:'';position:absolute;top:3px;left:3px;width:24px;height:21px;border-radius:6px;background:var(--lever);box-shadow:inset 0 0 0 1px var(--lever-edge),inset 0 2px 0 -1px rgba(255,255,255,.55),0 2px 0 var(--lever-edge)}
input.switch::after{content:'';position:absolute;top:9px;left:13px;width:2px;height:9px;border-inline:1px solid var(--lever-edge)}
input.switch::before,input.switch::after{transition:transform var(--dur-press) var(--steps-press)}
input.switch:checked::before,input.switch:checked::after{transform:translateX(22px)}
input.switch+.led{margin-left:10px}
input.switch:checked+.led{--led:var(--ok);box-shadow:inset 0 -1px 1px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.5),0 0 7px 1px color-mix(in oklab,var(--led),transparent 45%)}
@media (prefers-color-scheme:dark){input.switch::before{box-shadow:inset 0 0 0 1px var(--lever-edge),inset 0 2px 0 -1px rgba(255,255,255,.16),0 2px 0 var(--lever-edge)}}
summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;width:fit-content;border-radius:8px;user-select:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'';flex:none;width:0;height:0;border-block:4.5px solid transparent;border-left:6px solid currentColor;transition:rotate var(--dur-press) var(--steps-press)}
details[open]>summary::before{rotate:90deg}
.device{position:relative;border-radius:22px;background:var(--raised);box-shadow:0 0 0 1px var(--seam),inset 0 1px 0 var(--seam-light),0 8px 0 -3px rgba(var(--shadow-rgb),.14),0 30px 60px -30px rgba(var(--shadow-rgb),.35)}
@media (prefers-color-scheme:dark){.device{box-shadow:0 0 0 1px var(--seam),inset 0 1px 0 rgba(255,255,255,.05),0 8px 0 -3px rgba(0,0,0,.45),0 30px 60px -30px rgba(0,0,0,.8)}}
.screw{position:absolute;width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,transparent 0 42%,var(--key-edge) 42% 58%,transparent 58%),var(--well);box-shadow:inset 0 1px 0 var(--seam),0 1px 0 var(--seam-light)}
.screw:nth-of-type(1){top:10px;left:10px}
.screw:nth-of-type(2){top:10px;right:10px;rotate:90deg}
.screw:nth-of-type(3){bottom:10px;left:10px;rotate:45deg}
.screw:nth-of-type(4){bottom:10px;right:10px;rotate:-45deg}
.card{border-radius:14px;background:var(--raised);box-shadow:0 0 0 1px var(--seam),0 6px 0 -2px rgba(var(--shadow-rgb),.08)}
@media (prefers-color-scheme:dark){.card{box-shadow:0 0 0 1px var(--seam),inset 0 1px 0 rgba(255,255,255,.05),0 6px 0 -2px rgba(0,0,0,.35)}}
@media (prefers-contrast:more){.device,.card{box-shadow:inset 0 0 0 1px var(--ink-faint)}}
[hidden]{display:none!important}
`;

/** The four screws of a faceplate (`.device`). */
export const SCREWS =
  '<i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i>';

/** The four dashes of a wait (`.meter`): never a spinner. */
export const METER = '<span class="meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

/** The wordmark of the top rail (decorative: the window title says the name). */
export const WORDMARK = '<span class="wordmark" aria-hidden="true">monsters</span>';
