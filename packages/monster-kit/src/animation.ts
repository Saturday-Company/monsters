/**
 * Animation layer for `renderMonster` output. The SVG carries stable class names, a pivot
 * (`transform-origin`) on every movable group and three custom properties on the root
 * (`--m-bounce`, `--m-speed` from the genome personality, `--m-phase` from the seed).
 * `monsterCss` animates them with `transform` and `opacity` only. An expression change is a
 * re-render (new `data-expression`); with `prefers-reduced-motion` (or `data-motion="reduced"` on
 * an ancestor, for a host's own switch) that is all that changes.
 * Walking is driven by the host: while a monster moves, an ancestor carries `data-gait="walk"`
 * and the legs, arms and body follow a step cycle paced by the same personality.
 */

import { EYE_LIFE_ATTR } from './eyes.ts';

/** Class names the renderer guarantees (when the part exists) and the CSS relies on. */
export const MONSTER_CLASSES = [
  'm-root',
  'm-shadow',
  'm-body',
  'm-torso',
  'm-tail',
  'm-ears',
  'm-horns',
  'm-topper',
  'm-stalks',
  'm-feet',
  'm-arm-l',
  'm-arm-r',
  'm-face',
  'm-mouth',
  'm-cheeks',
  'm-eyes',
  'm-pupil',
  'm-lid',
  'm-brow',
  'm-fx',
] as const;

const S = 'svg[data-monster]';
const X = (expr: string): string => `${S}[data-expression="${expr}"]`;

export const monsterCss = `
${S} {
  /* hops and gestures may leave the 200×200 box for a moment: never clip them */
  overflow: visible;
  --m-k: calc(1.3 - 0.6 * var(--m-speed, 0.5));
  --m-amp: calc(0.4 + 1.2 * var(--m-bounce, 0.5));
}
${S} :is(.m-body, .m-torso, .m-tail, .m-topper, .m-arm-l, .m-arm-r, .m-mouth, .m-lid, .m-pupil, .m-shadow, .m-fx, .m-brow, .m-cheeks, .m-foot-l, .m-foot-r) {
  transform-box: view-box;
}

/* ---- idle (and the base for every expression) ---- */
${S} .m-body {
  animation: m-breathe calc(3.6s * var(--m-k)) ease-in-out infinite var(--m-phase, 0s);
}
${S} .m-lid {
  animation: m-blink calc(5.8s * var(--m-k)) linear infinite var(--m-phase, 0s);
}
${S} .m-pupil {
  animation: m-look calc(9s * var(--m-k)) ease-in-out infinite var(--m-phase, 0s);
}
${S} .m-tail {
  animation: m-wag calc(2.8s * var(--m-k)) ease-in-out infinite var(--m-phase, 0s);
}
${S} .m-topper {
  animation: m-sway calc(3.2s * var(--m-k)) ease-in-out infinite var(--m-phase, 0s);
}

/* ---- eyes run by startEyeLife (eyes.ts) when the host marks an ancestor with data-eye-life:
   the same blinks and glances as short Web Animations, nothing to compute in between ---- */
[${EYE_LIFE_ATTR}] ${S} .m-lid,
[${EYE_LIFE_ATTR}] ${X('idle')} .m-pupil,
[${EYE_LIFE_ATTR}] ${X('happy')} .m-pupil {
  animation: none;
}

/* ---- talk: the mouth opens and closes, one arm gestures ---- */
${X('talk')} .m-mouth {
  animation: m-talk calc(0.36s * var(--m-k)) ease-in-out infinite alternate;
}
${X('talk')} .m-arm-r {
  animation: m-gesture calc(1.4s * var(--m-k)) ease-in-out infinite;
}
${X('talk')} .m-pupil {
  animation: none;
}

/* ---- think: slow sway, bubbles rising one after the other ---- */
${X('think')} .m-body {
  animation: m-ponder calc(4.4s * var(--m-k)) ease-in-out infinite;
}
${X('think')} .m-pupil {
  animation: none;
}
${X('think')} .m-fx > * {
  animation: m-bubble calc(2.4s * var(--m-k)) ease-in-out infinite both;
}
${X('think')} .m-fx > :nth-child(2) {
  animation-delay: calc(0.3s * var(--m-k));
}
${X('think')} .m-fx > :nth-child(3) {
  animation-delay: calc(0.6s * var(--m-k));
}

/* ---- happy: little hops, arms waving, tail wagging fast ---- */
${X('happy')} .m-body {
  animation: m-hop calc(0.9s * var(--m-k)) ease-in-out infinite;
}
${X('happy')} .m-shadow {
  animation: m-shadow-hop calc(0.9s * var(--m-k)) ease-in-out infinite;
}
${X('happy')} .m-arm-l {
  animation: m-wave-l calc(0.9s * var(--m-k)) ease-in-out infinite;
}
${X('happy')} .m-arm-r {
  animation: m-wave-r calc(0.9s * var(--m-k)) ease-in-out infinite;
}
${X('happy')} .m-tail {
  animation: m-wag calc(0.5s * var(--m-k)) ease-in-out infinite;
}

/* ---- error: a short shake, then a nervous tremble; the sweat drop slides ---- */
${X('error')} .m-body {
  animation: m-shake calc(2.6s * var(--m-k)) ease-in-out infinite;
}
${X('error')} .m-pupil {
  animation: m-tremble 0.18s linear infinite;
}
${X('error')} .m-fx {
  animation: m-sweat calc(2.6s * var(--m-k)) ease-in infinite;
}

/* ---- walk: set by the host on an ancestor while the monster moves (after the expressions, so it wins) ---- */
[data-gait='walk'] ${S} {
  --m-step: calc(0.56s * var(--m-k));
}
[data-gait='walk'] ${S} .m-body {
  animation: m-step var(--m-step) ease-in-out infinite;
}
[data-gait='walk'] ${S} .m-shadow {
  animation: m-shadow-step calc(var(--m-step) / 2) ease-in-out infinite;
}
[data-gait='walk'] ${S} .m-foot-l {
  animation: m-foot var(--m-step) ease-in-out infinite;
}
[data-gait='walk'] ${S} .m-foot-r {
  animation: m-foot var(--m-step) ease-in-out infinite calc(var(--m-step) / -2);
}
[data-gait='walk'] ${S} .m-arm-l {
  animation: m-swing var(--m-step) ease-in-out infinite;
}
[data-gait='walk'] ${S} .m-arm-r {
  animation: m-swing var(--m-step) ease-in-out infinite calc(var(--m-step) / -2);
}
[data-gait='walk'] ${S} .m-tail {
  animation: m-wag var(--m-step) ease-in-out infinite;
}

@keyframes m-breathe {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(calc(1 - 0.012 * var(--m-amp, 1)), calc(1 + 0.024 * var(--m-amp, 1))); }
}
@keyframes m-blink {
  0%, 3.6%, 58%, 61.6%, 64%, 67.6%, 100% { transform: scale(1, 0); }
  1.8%, 59.8%, 65.8% { transform: scale(1, 1); }
}
@keyframes m-look {
  0%, 28%, 88%, 100% { transform: translate(0, 0); }
  34%, 48% { transform: translate(calc(-1 * var(--m-look, 2px)), 0); }
  56%, 76% { transform: translate(var(--m-look, 2px), calc(-0.35 * var(--m-look, 2px))); }
}
@keyframes m-wag {
  0%, 100% { transform: rotate(calc(-4deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(5deg * var(--m-amp, 1))); }
}
@keyframes m-sway {
  0%, 100% { transform: rotate(calc(-3deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(3deg * var(--m-amp, 1))); }
}
@keyframes m-talk {
  from { transform: scale(1, 1); }
  to { transform: scale(0.94, 0.55); }
}
@keyframes m-gesture {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(calc(-14deg * var(--m-amp, 1))); }
}
@keyframes m-ponder {
  0%, 100% { transform: rotate(calc(-1.5deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(1.5deg * var(--m-amp, 1))); }
}
@keyframes m-bubble {
  0% { opacity: 0; transform: translate(0, 2px); }
  30%, 70% { opacity: 1; transform: translate(0, 0); }
  100% { opacity: 0; transform: translate(0, -3px); }
}
@keyframes m-hop {
  0%, 100% { transform: translate(0, 0) scale(1.03, 0.96); }
  15% { transform: translate(0, 0) scale(1, 1); }
  50% { transform: translate(0, calc(-7px * var(--m-amp, 1))) scale(0.98, 1.03); }
  85% { transform: translate(0, 0) scale(1, 1); }
}
@keyframes m-shadow-hop {
  0%, 15%, 85%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.8); opacity: 0.7; }
}
@keyframes m-wave-l {
  0%, 100% { transform: rotate(calc(10deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(-6deg * var(--m-amp, 1))); }
}
@keyframes m-wave-r {
  0%, 100% { transform: rotate(calc(-10deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(6deg * var(--m-amp, 1))); }
}
@keyframes m-shake {
  0%, 24%, 100% { transform: translate(0, 0); }
  4%, 12%, 20% { transform: translate(calc(-2.2px * var(--m-amp, 1)), 0); }
  8%, 16% { transform: translate(calc(2.2px * var(--m-amp, 1)), 0); }
}
@keyframes m-tremble {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(0.5px, 0); }
}
@keyframes m-sweat {
  0%, 20% { transform: translate(0, 0); opacity: 1; }
  90% { transform: translate(0, 6px); opacity: 0; }
  100% { transform: translate(0, 0); opacity: 0; }
}

@keyframes m-step {
  0%, 100% { transform: translate(0, 0) rotate(calc(-2deg * var(--m-amp, 1))); }
  25%, 75% { transform: translate(0, calc(-4px * var(--m-amp, 1))) rotate(0deg); }
  50% { transform: translate(0, 0) rotate(calc(2deg * var(--m-amp, 1))); }
}
@keyframes m-shadow-step {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.93); }
}
@keyframes m-foot {
  0%, 50%, 100% { transform: translate(0, 0) rotate(0deg); }
  22% { transform: translate(0, -6px) rotate(-9deg); }
}
@keyframes m-swing {
  0%, 100% { transform: rotate(calc(-9deg * var(--m-amp, 1))); }
  50% { transform: rotate(calc(9deg * var(--m-amp, 1))); }
}

@media (prefers-reduced-motion: reduce) {
  ${S} * {
    animation: none !important;
  }
}
/* the host's own "reduce motion" switch, on any ancestor (e.g. <html>) */
[data-motion="reduced"] ${S} * {
  animation: none !important;
}
`;
