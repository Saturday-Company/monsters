# Monster animations

`renderMonster` produces a static SVG that is ready to be animated; `monsterCss` (exported by
`@monsters/monster-kit`) is the style sheet that animates it. Include it once in the page (`<style>{monsterCss}</style>`).
Without the CSS the monster stays still and correct.

## How the SVG is made
- Root `<svg data-monster="…" data-expression="idle|talk|think|happy|error">`, with three variables in `style`:
  `--m-bounce` and `--m-speed` (the genome's personality, 0–1) and `--m-phase` (an offset from the seed, so two
  neighboring monsters neither breathe nor blink together).
- Every part that moves has a fixed class and its pivot in `transform-origin` (units of the 200 × 200 `viewBox`):

| Class | What | Pivot |
|---|---|---|
| `m-body` | the whole monster except the shadow (breathing, hops, trembling) | center of the feet, on the ground (y 186) |
| `m-torso` | silhouette, belly, spots, highlight | base of the body |
| `m-shadow` | ground shadow | center of the shadow |
| `m-arm-l`, `m-arm-r` | arms | shoulder |
| `m-feet` (`m-foot-l/r`) | feet | on the ground |
| `m-tail` | tail | root on the side |
| `m-topper` | tuft, antenna, crest, geyser | root at the top of the head |
| `m-face`, `m-mouth` | face; mouth | top of the head; center of the upper lip |
| `m-eyes`, `m-eye0…2` | eyes | center of the eye |
| `m-pupil` | iris, pupil and highlights (with `--m-look`: how far it can move) | — |
| `m-lid` | eyelid, closed at `scale(1 0)` until the CSS opens it | top edge of the eye |
| `m-brow`, `m-cheeks`, `m-fx` | eyebrows, cheeks, thought bubbles or sweat drop | — |

`m-root` carries the possible `transform` that fits the monster to the canvas: it must not be animated.

## What `monsterCss` does
Only `transform` and `opacity`. Durations are multiplied by `--m-k = 1.3 − 0.6 · speed`, amplitudes by
`--m-amp = 0.4 + 1.2 · bounce`.

| Expression | Movement |
|---|---|
| always (idle) | slow breathing; irregular blinking (a single one, then a double one, a cycle of ~6 s); a gaze that slowly turns left and right; tail and tuft that sway |
| talk | the mouth opens and closes (`scaleY` from the lip), the right arm gestures |
| think | slow swaying, the three bubbles appear one after the other |
| happy | hops with a squash on landing, a shadow that narrows, arms that wave, a fast tail |
| error | a short shake and then a pause, trembling pupils, a sweat drop that slides down |

A change of expression is a new render (`data-expression` changes). With `prefers-reduced-motion: reduce` all the
animations are off: only the change of expression remains, and the eyes stay open (eyelids reduced to zero).

## Notes for the UI
- The SVG has `overflow: visible` (from the CSS): Titan's hop goes a few units outside the canvas, the container must
  not cut it.
- A new animation must be written on these classes, never on the inner elements: the inner structure may change.
- `team.html` in this folder is a live test: it opens the sheet with the CSS included.
