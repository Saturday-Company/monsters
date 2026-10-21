# Monster style (style bible v0)

The rules, in numbers, of the `packages/monster-kit` kit. The external style reference (not included in the repo)
belongs to a third party: only its visual language is taken (dark outline of the same hue, flat color, soft
shading, highlight, big glossy eyes, fangs, light belly, ground shadow, squat proportions). No shape is traced: every
part is drawn in code. Units: the canvas is a `viewBox` of **200 × 200**; `a` is the half-width of the body, `H` its
height.

## Canvas and construction
- Ground at **y = 186**, center at x = 100, margin 5. If a part falls outside the canvas, the whole monster is scaled
  around the ground point (nothing is ever cut off).
- Layer order: shadow, tail, ears, horns, tuft, eye stalks, feet, arms, **body**, belly, spots, highlight, mouth, eyes,
  effects.
- Everything that is attached (horns, ears, tail, arms, feet, stalks) sits **behind** the body and enters it with its
  root: the body's outline covers the joint, so there are no detached parts.
- Head and body are one thing. Silhouettes: `blob`, `egg`, `pear`, `bean`, `dome`, `lumpy` (asymmetric), base width
  92–112 units, `w` and `h` multipliers from 0.7 to 1.3. Titan is the biggest, Mimas the smallest.

## Outline
- Thickness **3.8** (1.9% of the canvas, about 3% of the body's height); eyes and mouth **2.3–3.4**; teeth, claws and
  fine details **1.8**. Rounded joins and caps.
- Color: the **same hue as the body**, OKLCH with **L 0.22–0.30** and **C ≤ 0.085**. Never pure black, never an outline
  of another hue (horns and tufts use the body's outline too).

## Color (OKLCH, a single hue)
The genome gives only `hue`, `chroma` (0.04–0.20) and `lightness` (0.45–0.85); everything else is derived and
converted to hexadecimal sRGB, lowering the chroma if the color falls outside the gamut.

| Role | Rule |
|---|---|
| Base | L, C, h |
| Light | L + 0.09, C × 0.92, h − 6 |
| Shadow | L − 0.16, C × 1.08, h + 6 |
| Outline | L − 0.47 (limited to 0.22–0.30), C × 0.75 (max 0.085) |
| Light belly | L + 0.16 (0.80–0.95), C × 0.42, same h |
| Contrast belly | L + 0.14, C ≤ 0.11, h + 55 |
| Spots | L − 0.17, C × 1.05 |
| Accent (horns, crest, claws) | cream 0.93 / 0.05 / 88, gold 0.84 / 0.14 / 82, analogous h + 38, complementary h + 180, tone L + 0.12 |
| Mouth, tongue, cheeks | 0.33 / 0.11 / 18, 0.72 / 0.13 / 8, 0.72 / 0.14 / 15 at 55% |
| Ground shadow | 0.32 / 0.04 / 290 at 20% |

**Distance between monsters:** at least **30° of hue** between two monsters of the same team. The test checks it on
the 7 in every A/B combination; the generator receives the hues already used (`avoidHues`).

| Titan | Rhea | Dione | Tethys | Enceladus | Hyperion | Mimas |
|---|---|---|---|---|---|---|
| 62 / 55 | 280 / 272 | 165 / 160 | 22 / 18 | 222 / 215 | 100 / 95 | 315 / 312 |

## Volume, highlight, shadow
- **Shading:** a radial gradient for each part, center (40%, 32%), focus (34%, 24%), radius 78%: light → base at 55% →
  shadow at the edge. The light always comes from the top left.
- **Highlight:** a white ellipse 0.17a × 0.075H rotated by −38°, opacity 0.42, at 24% of the width and 16% of the
  height, plus a small dot of 0.045a at 50%.
- **Ground shadow:** a flat ellipse (ry 7, rx equal to 52% of the body's width + 6). No filters or `drop-shadow`.

## Face proportions
- Eyes at **34%** of the height (cyclops 38%); mouth at **57%**, always at least 6–7 units below the eyes.
- Two eyes: radius **0.205a** (diameter about 1/5 of the body's width); cyclops **0.36a**; on stalks **0.25a**. Iris 60%
  of the radius, pupil 55% of the iris, main highlight 30% of the iris at the top left plus a secondary one of 13%.
  White with a slight gradient toward the edge.
- Open mouth: dark red inside, pink tongue, white teeth with a fine outline. The **upper lip is a smile curve**, never a
  straight line: corners raised by 45% of the dip, center lower by 9% (grin) or 11% (canyon) of the width. Fangs and
  teeth start from the curve and follow its slope. Wide mouths (over 0.75a) have two small comma-shaped creases at the
  corners.
- Belly: an oval at 73% of the height, 66% of the silhouette's width, clipped from the body. **The mouth sits entirely
  inside the belly with a margin of 3.5 units, or entirely above it**: first the belly grows (upward and sideways,
  without rising past the eyes); if that isn't enough, the mouth just ends within 80% of the height and the belly goes
  below it. The check applies to every expression (the open mouth of “happy” and “talk” included).
- Eyes on stalks: the mouth is 18% bigger and always carries the pink cheeks (more subdued), so that a muzzle remains
  under the stalks; in “talk”, “think” and “error” the eyebrows sit above the eyes on the stalks.
- Feet: ellipses 0.29a × 9.5 that stick out below the body; short arms (0.44a, 0.66a long) coming out of the sides.
- Little horns (`nubs`): squat, separate cones, each with its own highlight, coming out along the head's normal (half
  of them upward) and fanning out like a crown over an arc of ±(34 + 4n)°.
- Plume tail: a soft silhouette that curls toward the head, tufted edge (arcs with small notches every 0.26a) and a
  round tip; the light stripes are transverse bands curved toward the tip, not veins.

## Expressions
| State | Eyes | Mouth | Other |
|---|---|---|---|
| idle | open, gaze slightly down | the genome's own | arms at rest |
| talk | open | open oval with tongue | one arm gesturing |
| think | up, on the side opposite the tail; one eyebrow | small crooked line | three thought bubbles, away from the tail |
| happy | closed in an arch | big open smile | pink cheeks, arms up |
| error | small pupils, worried eyebrows | zig-zag line | desaturated color, sweat drop (away from the tail), arms out |
| sleep | closed in an arch (like happy) | the genome's own | the “stopped” state of the dot creatures; in the glossy one it only closes the eyes |

The animations (breathing, eyelashes, gaze, talking, hops) are in `ANIMATIONS.md`.

## Legibility
At 64 px the outline is worth about 1.2 px and the monster stays recognizable (silhouette, eyes, mouth, color); at 32
px the silhouette, eyes and color remain. No detail under 1.5 units; marks and stripes are decoration, not
information.

## Don'ts
Pure black; more than one dominant hue; outlines of different colors between parts; SVG filters on the monsters;
tracing the external reference or using it as an input.

## Dot creatures
The same genome drawn as an LED creature on a black screen (`renderDots`, `dotGrid`, `renderDotsText` in
`packages/monster-kit/src/dots/`). No change to the schema: every existing genome already has its dot version. The
reference sheet is `dots.png` / `dots.html` / `dots.txt` (`pnpm --filter @monsters/monster-kit dots-sheet`). The
glossy renderer (`renderMonster`) stays as it is.

### Grid
- **17 × 15 dots, the same for everyone**: an odd width, so the face has a central column (8) and the symmetric
  monsters are symmetric to the dot. 17 : 15 is close to the 60 × 52 of the monster strip; at 60 px a dot is worth 3.5
  px.
- Row 14 = ground (the feet); the body ends on 13 (on 14 if it has no feet). **Row 0 stays free** at rest: it is needed
  for the hop, the thought bubbles and the “z”s.
- Pitch 10 units, LED radius 4.6 (92% of the pitch: the body reads as a mass, the holes of the face stand out). The
  unlit dots are `rgba(255,255,255,.07)` in a single `<pattern>`; the lit ones are one `<path>` per color (every dot
  is a zero-length segment with a round cap). A monster with all its frames is ~25 nodes and ~5 KB; no filters or
  masks.

### Art rules (October 2026)
References: the best 1-bit or few-color sprites (Playdate, Tamagotchi, Space Invaders, Nothing's glyphs): every dot is
intentional. The rules apply to any genome, not just the seven of the roster: the `dots.png` sheet also shows 30
random genomes.
- **Less blob, more character.** Round silhouettes with negative space around them: a rounded crown (the first row is
  40–60% of the width), the last row steps in by one dot so the **feet stick out** and stay separate, the **arms hang
  from the lowest of the wide rows** with a dot of dark between hand and body, ears and horns grow from the shoulders
  with a gap between one and the other.
- **Face first.** The eyes are the strongest thing: ovals 2 × 3 tall by default (2 × 2 only if the body is small),
  3 × 3 on wide bodies, always **at least three dots apart** (they get closer only if nothing else fits), with the white
  highlight at the top left. The cyclops has a **white bulb** with a dark pupil (2 × 2 on Mimas's big eye, 1 dot on the
  3 × 3) that moves when it thinks. The mouths are **small**: a “v”, a three-dot D, a dot; Tethys's canyon is a thin
  smile.
- **White teeth, and few.** A single fang (on the left, low) on small mouths, two on big mouths: two white dots next
  to the mouth would look like a second pair of eyes.
- **Little dimming.** The body is a solid color: no shaded edge. The dimmed level stays for the inside of the ears, the
  stripes and the marks, which are few and clear (2–4 freckles, 1–2 L-shaped craters, 3–6 pores gathered on one side,
  never holes: they would look like more eyes).
- **Expressions legible at 60 px**: happy with `^ ^` eyes, pink tongue, cheeks and a hop; think with eyes up and
  **accent bubbles** rising toward the corner (a dot, a pair, a 2 × 2 cloud); sleep with closed eyelids and a **real
  z** (3 × 4) that becomes a 4 × 4 Z; talk with an open mouth, closed (a line), wide open; error with **X eyes** (3 × 3,
  growing outward; `> <` if there is no room).
- **Lively LEDs.** Yellow and lime hues don't turn olive: the light rises toward the hue's most saturated brightness.

### From the genome to the dots
| Genome | Dots |
|---|---|
| `body.w` | half-width 4–6 dots (`3.4 + 3.1·(w−0.7)/0.6`; `dome` +1, `bean` −1): Titan and Tethys 6 (13 dots), the others 5, Mimas 4 |
| `body.h` | 8–11 rows (`6.7 + 4.4·(h−0.7)/0.6`; `dome` −1, `bean` +1, at least 9 for the cyclops's big eye), reduced if the parts above the head don't fit |
| `body.shape` | superellipse profile per row, widths always odd: `blob` round, `egg` narrower at the top, `pear` small head and wide base, `bean` tall narrow capsule, `dome` squat dome with a flat base, `lumpy` potato (an oblique oval: the upper half slides to one side, the lower to the other, and a hump on the high shoulder, from the seed) |
| `body.lean` | the upper rows slide up to 2 dots sideways |
| `round` eyes | ovals 2 × 3 (2 × 2 if they don't fit, 3 × 3 on 13-dot bodies with `size ≥ 0.9`), white highlight at the top left; distance ≥ 3, wider with `spacing` on big bodies; `asym ≥ 0.4` raises and lengthens the right eye |
| `cyclops` | white bulb with a dark pupil: 5 × 4 with rounded corners if `size ≥ 1.15` (Mimas), otherwise 3 × 3 |
| `stalk` | two 4 × 4 bulbs in the accent color on stalks, with a 2 × 2 hole and the highlight; three free dots between the two (the geyser) |
| `trio` | two eyes plus a third 1 × 2 (or 1 × 1) on the forehead, with a row of body in between |
| mouth | below the eyes with a row of body in between: `smile` a “v” (a 5-wide U if `width > 1.1`), `grin` a 3-wide D (5 if `width > 1.12`), `canyon` a thin smile 7 wide with the corners up, `tiny` a dot |
| teeth (white) | `fangs`: one fang at the low left corner of the small mouth, two on the big one, two under the canyon's smile; `row` fills the top row; `buck` a tooth in the middle. The `tiny` mouth has no teeth |
| `horns` (accent) | `nubs` little horns that follow the dome, the central one 2 tall: Titan's crown; `spike` 2–3 dots, the last one bent outward; `curved` out and then up; `stripes` alternates full and dimmed accent |
| `ears` | from the shoulders: `long` 2 columns 3–4 tall with a dimmed inside (Rhea), `round` 2 × 2, `pointy` cat-like (they fill the corner beside the crown and end in a point), `fin` fins on the sides |
| `tail` | always at the bottom right, the body shifts to make room for it and the tail slides out until it touches the body: `plume` a 7-tall plume that bends toward the head (stripes = accent rows), `spiky`, `curl` |
| `topper` | `tuft` sprout, `antenna` stalk with an accent ball, `crest` accent crest, `geyser` dashed jet (Enceladus) |
| `arms` | shoulder against the body and the hand hanging one dot lower (`long`: two), detached from the body, which narrows; up like `\o/` when happy, out in error, a wave while talking |
| `feet` | 2–3 dots on the ground that stick out past the last row, a gap in the middle; `claws` adds an accent claw on the outside |
| `marks` (dimmed) | `spots` 2–4 well-spaced freckles, `craters` 1–2 three-dot L-shaped dimples, `sponge` 3–6 pores gathered on one side, `stripes` notches from the sides under the eyes |
| `belly` | `light`: a rounded light patch at the bottom; `contrast`: the same with the hue shifted. Only if two rows fit below the mouth, otherwise none |
| `seed` | position of the marks, direction of the potato, rhythm and phase of the animation, single or double blink |

Fixed rules: eyes and mouth are **holes in the body**, always surrounded by light on four sides (the row above and the
one below the mouth too), never touching each other; marks and belly stay away from the face (not even between the
eyes: it would look like a nose). The parts on the head are placed in order (eyes on stalks, horns, ears, tuft) and a
part that doesn't fit whole is shrunk or not drawn: never cut.

### Colors (OKLCH, then hexadecimal sRGB with chroma reduction)
| Role | Rule |
|---|---|
| Light (`lit`) | L 0.78–0.82 (from the genome's `lightness`), C = `chroma`·1.35 + 0.03 within 0.11–0.22, h of the genome; if the screen can't reach that chroma, L rises (up to 0.91) as long as the possible chroma grows: yellows become lemon, not olive |
| Dimmed (`dim`) | L 0.55, C × 0.8 |
| Accent | cream 0.93 / 0.05 / 88, gold 0.87 / 0.17 / 82, analogous h + 38, complementary h + 180, tone 0.94 / C × 0.45 / h; dimmed to L 0.6 |
| Belly | light 0.93 / ≤ 0.06 / h; contrast L + 0.06 / 0.11 / h + 55 |
| Cheeks and tongue (happy) | pink 0.72 / 0.17 / 8; on pink or red monsters 0.9 / 0.08 / 350 |
| Highlight, cyclops bulb, teeth | white `#ffffff` |

Every lit color is **at least 3:1** on `#0d0d0c` (if it doesn't get there, the brightness rises until it does); light and
dimmed are at least 1.6:1 apart. The test checks it on the whole roster and on 400 random genomes.

### Expressions and frames
| State | Frames | What it does |
|---|---|---|
| idle | 2 | eyes open; blink (the eyes become a line at half height) |
| talk | 3 | mouth in an “o” (the still image), closed (a line of three), wide open (5 dots, with the fangs); the right arm waves on the third |
| think | 3 | eyes up (highlight and pupil toward the thought), “hmm” mouth to the side, accent bubbles rising toward the free corner (on the left if there is a tail): a dot, a pair, a 2 × 2 cloud |
| happy | 2 | `^ ^` arched eyes, open mouth with pink tongue and fangs, pink cheeks, arms up; the second frame is a one-row hop |
| error | 2 | X eyes, zig-zag mouth, arms out; the second is a flicker at 45% |
| sleep | 3 | closed eyelids (curves down on wide eyes), tiny mouth, everything at 55%; a 3 × 4 z that rises and becomes a 4 × 4 Z in the top corner |
| confused | 3 | going in circles (D-068): eyes open with the highlight (or the cyclops's pupil) this way, then that way, then a blink; a crooked “~” mouth toward the free side; an accent `?` 3 × 5 in the top corner (in the other one if there are ears or crests there) that rises one row on the second frame |

Frame 0 of every expression is also the still image (reduced motion) and on its own says the state.

### Timing
The frames are `<g data-frame>` groups; `dotCss` turns them on and off with keyframes on `visibility` and `step-end`
(steps, no cross-fade). Without CSS, with `data-animated="off"`, with `prefers-reduced-motion` or with
`data-motion="reduced"` on an ancestor, frame 0 remains (the others have `visibility="hidden"` as an attribute).

| Cycle | Sequence (ms, before the monster's tempo) |
|---|---|
| idle, single blink | open 4200 · closed 150 |
| idle, double blink | open 3300 · 120 · 170 · 130 · open 1500 |
| talk | irregular syllables of 110–260 ms, a 420 pause at the end of the sentence (cycle 1.8 s) |
| think | 520 · 520 · 1100 |
| happy | two hops (240 · 170 · 200 · 170) and a 1100 pause |
| error | still 1600, then flicker 80 · 90 · 70, still 700 |
| sleep | 1100 · 1100 · 1300 |
| confused | this way 700 · that way 620 · this way 520 · that way 680 · blink 140 |

Every monster has `--dk-t` (tempo, 0.82–1.22 × (1.15 − 0.3·speed)) and `--dk-phase` (offset 0–1) from the seed, and the
seed chooses between single and double blink: two neighboring monsters neither blink nor talk together.

### Terminal
`renderDotsText` prints the same drawing in 8 rows × 17 columns with the half blocks `▀ ▄ █`: two grid rows per text
row, 24-bit ANSI colors (light, dimmed, accent, highlight and white teeth), eyes and mouth as spaces. With `color:
'none'` only the blocks remain (lit / unlit).
