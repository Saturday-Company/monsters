# Monsters design · "Instrument"

> The single reference for the interface (web, desktop app, terminal), from the evening of 15/10/2026 (D-062, the
> maintainer's choice among three proposals). It replaces the Apple style with glass (D-056, D-061). The idea:
> **Monsters is an instrument**, like a Teenage Engineering synthesizer or a Nothing Phone. The chassis is serious and
> measured; the only colorful, living things are the monsters, **creatures made of glowing dots** that live on small
> black screens. From outside it looks like a cute object, inside it is precise: a beginner sees lively little
> monsters and clear keys, an expert sees instrumentation, numbers and shortcuts.

## Principles
1. **Neutral chassis, color only from the monsters.** Warm aluminium (light) or graphite (dark). A single action
   color, **signal orange**; red only for Stop and for errors. Every other color is a monster's light on its black
   screen.
2. **Objects, not windows.** Keys that sink, switches with a lever, recessed fields, black screens with dots. The
   joints between parts are **seams** (a dark line with a light one below), not borders or soft shadows.
3. **Two layers, one language.** Everything says in words what is happening ("Writing the captions"); below it, in
   small monospace, is the instrumentation (tools, time, cost, model). No technical layer lives somewhere else:
   "Behind the scenes" is another screen of the same instrument.
4. **Stepped motion.** Animations are frame by frame, like a display (`steps()`, one frame = 40 ms), 80-160 ms. The
   monsters, the lights and the levers move. No animated gradients, no blurs. "Reduce motion" leaves only the state
   changes. Every movement says something: the grammar is in the "Motion" section.
5. **Generous scale.** Body 15 px, chat 16 px, controls of 40-44 px, monster rows of 68 px. Uppercase monospace never
   goes below 11 px.
6. **Light by construction.** Solid colors, no `backdrop-filter`, no `filter` on the monsters, no permanent
   `will-change`. Budget ≥ 55 fps (target 60) with `?mock=demo&vita=1` at 1440×900.
7. **The same everywhere.** The same monster, from the same grid, in the app, in the terminal (half blocks `▀▄█`), in
   the system bar and on Telegram.

## Window structure
```
┌─ top rail 52 px = integrated title bar (chassis) ───────────────────────────────────────────────────────────────┐
│ ● ● ●  monsters        │ View title  [view keys]                  ▐ ● 2 AT WORK · 1 QUESTION    17:42 ▌  STOP [▤] │ ← (— □ ✕ on Win/Linux)
├─ sidebar 300 ──────────┼─ content module (recessed panel, top-left corner radius 14) ─────────────────────────────┤
│ [ SEARCH         ⌘K ]  │ ┌ monster monitor (black screen, 76 px) ─────────────────────────────────────────────┐ │
│ PERSONAL SQUAD · 4     │ │ [monster]  TITAN   squad lead · coordinates 3 monsters    3 TOOLS · 4.1 S · FREE   │ │
│ ▣ Titan   ● 1   17:41  │ └────────────────────────────────────────────────────────────────────────────────────┘ │
│   Asks you something   │      messages …                                                                      │
│ ▣ Rhea    ▮▮▯   now    │      [A] Photo of the dish     ● RECOMMENDED                                         │
│ ▣ Dione                │      [B] Carousel                                                                    │
│ ─────                  │  [ Write to Titan…                                              SEND ↵ ]             │
│ AUTOMATIONS  ⌘2        │                                                                                      │
│ NOTES        ⌘3        │                                                                                      │
│ FILES        ⌘4        │                                                                                      │
│ ACTIVITY     ⌘5        │                                                                                      │
│ SETTINGS     ⌘,        │                                                                                      │
│ ● THIS COMPUTER    ▾   │                                                                                      │
└────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘
```
- **Top rail (52 px)**: it is the title bar, and it is part of the instrument, not a system frame. A single band of
  chassis across the whole width, draggable (`-webkit-app-region: drag`, controls `no-drag`). From the left: the macOS
  traffic lights (92 px reserved: they end at 76 px since macOS 26) and the **monsters** wordmark (lowercase) in Doto,
  as wide as the sidebar; a vertical seam; the view's title and its keys; on the right the **status display** (black
  screen with glowing text: squad status and time) and **Stop**; then, on Windows and Linux, the space for the system
  buttons (`env(titlebar-area-x/width)`), drawn by the system in the chassis color.
- **Sidebar** (300 px): directly on the chassis, no panel. The god's bar (it is its chat, D-102), the recessed search,
  then the **squads** (Personal squad and projects, D-100) with a **strip per monster** and "New project": only this
  part scrolls. At the bottom, fixed, Automations, Notes, Files, Activity, Settings as rows with the shortcut and the
  computer selector (desktop app only).
- **Content module**: a panel one tone lighter than the chassis (darker in the dark theme), recessed: the seam
  separates it from the rail and the sidebar, the top-left corner has radius 14 like a module inserted in the frame.
  It touches the right and bottom edges.
- **Phone (< 768 px)**: the rail stays (wordmark or "Back", display reduced to the light and the number, Stop). The
  sidebar is the home screen; every view opens full screen. "‹ Back" is the only back: with the right-hand pane or the
  "To review" sheet open it closes that and nothing else; a view inside a view (a note above the list) takes it up one
  level and says so ("‹ Notes", `useToolbarBack`); otherwise it goes back to the sidebar.
- Sign-in and first start: the same rail on top (without the display), the chassis below with their content.

## Integrated title bar (desktop app)
- **macOS** (`inset`): `titleBarStyle: 'hidden'`, traffic lights centered in the 52 px row at 16 px from the edge
  (`trafficLightPosition` `{ x: 16, y: 18 }`: no more floating panel with an 8 px margin).
- **Windows and Linux** (`overlay`): a `titleBarOverlay` 52 px tall in the `--chassis` color with `--ink` symbols; the
  color updates with the theme (existing IPC, `#rrggbb` only). The content no longer needs to touch the edge: the rail
  is all chassis.
- The document keeps `data-chrome="inset" | "overlay"`; in the browser no space is reserved. Double click on the rail:
  maximize (the system does it).
- Secondary windows (Connections, the status page) and `page-theme.ts`: the same parts as the UI (rail with monsters,
  keys, fields, screens, lights, the device with the screws, Titan made of dots) and the same typefaces, which travel
  inside the `data:` pages (`page-fonts.ts`, Latin only, `font-src data:`; D-089). The status page is the sign-in
  device: a big screen while waiting, the monitor strip when there is a problem.

## Colors (tokens in `apps/web/src/theme/tokens.ts`)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--chassis` | `#e3e1db` | `#151514` | window, rail, sidebar |
| `--panel` | `#f2f1ec` | `#1c1c1a` | content module |
| `--raised` | `#fbfaf7` | `#252523` | monsters' bubbles, cards, menus, dialogs, key caps |
| `--well` | `#d8d5ce` | `#0f0f0e` | fields and search (recessed), switch tracks |
| `--seam` | `rgba(0,0,0,.13)` | `rgba(0,0,0,.6)` | dark line of the seams |
| `--seam-light` | `rgba(255,255,255,.65)` | `rgba(255,255,255,.05)` | light line below the seam |
| `--key-edge` | `#b5b2a9` | `#0a0a09` | thickness of the keys (solid shadow at the bottom) |
| `--lever` / `--lever-edge` | `#fbfaf7` / `#78756d` | `#64635e` / `#0a0a09` | switch lever: edge (light) or cap (dark) ≥ 3:1 on the track |
| `--ink` | `#1a1a18` | `#ecebe5` | text |
| `--ink-muted` | `#5c5a54` | `#a3a19a` | secondary text (≥ 4.5:1 on chassis, panel, raised, well) |
| `--ink-faint` | `#6b6963` | `#8d8b85` | labels and times only on panel and raised |
| `--signal` | `#ff4f00` | `#ff5e14` | the main action and the "something to do" lights: a fill under dark text |
| `--on-signal` | `#170800` | `#170800` | text on the signal |
| `--signal-ink` | `#a83500` | `#ff8a4c` | the signal as text, links, focus ring (≥ 4.5:1) |
| `--stop` / `--on-stop` | `#d8231a` / `#ffffff` | `#ff3b2f` / `#1a0302` | Stop, serious errors |
| `--stop-ink` | `#b51c14` | `#ff7b72` | red text |
| `--ok` | `#1f8f4e` | `#4fd98a` | green light (connected, done) |
| `--screen` | `#0d0d0c` | `#050505` | all screens (the same in both themes, they are objects) |
| `--screen-ink` | `#efe9dc` | `#efe9dc` | main text on screens |
| `--screen-muted` | `#8f8b81` | `#8f8b81` | secondary text on screens (≥ 4.5:1 on black) |
| `--screen-off` | `rgba(255,255,255,.07)` | `rgba(255,255,255,.07)` | unlit dots |

- The user's bubble is solid `--ink` with `--panel` text (dark in light, light in dark): like the instrument, the
  user's voice is the sharpest. The monsters' bubbles are `--raised` with a tint of the monster's color at 7-9%.
- Contrast verified by `test/contrast.test.ts`: text ≥ 4.5:1 on every surface where it can be; monsters' lights ≥ 3:1
  on the screen (they are graphics); a switch's lever ≥ 3:1 on its track (WCAG 1.4.11, D-066). The light
  `--signal-ink` is `#a83500` (not `#b83a00`): it is needed for 4.5:1 on the chassis and in the well too.
- Extra tokens, born in the implementation: `--signal-edge` (`#a33300` / `#8a2c00`, thickness of the orange keys),
  `--stop-soft` (`#f4dcd5` / `#2e1513`, the "stopped" band and the errors), `--screen-stop` (`#ff5a4e` in both
  themes: red as text on screens, where the light `--stop` doesn't reach 4.5:1). For the views not yet redone, `--fill`,
  `--fill-strong`, `--separator` and the old Tailwind names remain (`bg-content` → panel, `bg-accent` → signal,
  `text-on-danger-soft` → `--stop-ink`…), to be removed when nobody uses them anymore.

## Typefaces (local, with `@fontsource`, OFL license; no fonts from the internet)
| Role | Typeface | Use |
|---|---|---|
| Text | **Instrument Sans** (variable) | everything that is read: messages, fields, buttons, titles |
| Labels and instrumentation | **Martian Mono** | spaced uppercase labels (`.label`: 11 px, +0.06em), instrumentation rows, times, shortcuts, log |
| Display | **Doto** (dotted) | wordmark, monsters' names on the monitors, display clock, big numbers. Never below 18 px, never for sentences |

Scale (existing Tailwind classes, same names): `micro` 12/16, `caption` 13/18, `footnote` 14/20, `body` 15/22,
`large` 16/24, `title3` 18/24, `title2` 22/28, `title1` 24/30, `display` 30/36. Numbers always `tabular-nums`.

## Materials and components
- **Seam** (`.seam-*`): 1 px `--seam` + 1 px `--seam-light`, between rail and content, between sidebar and content,
  between groups. Never gray borders around things.
- **Key** (`Button`): `--raised` cap, 1 px `--key-edge` border, thickness `box-shadow: 0 3px 0 var(--key-edge)`,
  radius 10. Pressed: it sinks by 2 px (`translateY(2px)`, thickness 1 px), in 80 ms in two steps; released, it
  comes straight back up. Variants: `primary` (signal, dark text, thickness `#a33300`), `danger` (stop), `ghost` (no
  cap, for the icons in the rail), `key` with the letter or the shortcut in a monospace tile. Heights 40 / 44 / 48. A
  `primary` that can't be pressed yet is a normal key (`--raised` cap, `--ink-muted` words): orange only when there
  is something to do, and a single orange key per screen.
- **Labeled key** (`LabeledKey`): an icon on its own is a riddle. In the rail and in the module bars the icons carry
  their name in `.label`: next to the icon where there is room, under the icon on the phone, tooltip only where it
  doesn't fit. A tiny number (a `--signal` tile) says how many things are waiting (To review).
- **Switch** (`Switch`): a recessed `--well` track 52×30 with a lever (`.lever`, token `--lever`) that slides in
  steps and a light (green on, gray off) beside it. The lever is visible in both themes: in light it has the dark
  edge, in dark the gray cap; it doesn't change on mouse hover. Segments and tabs: a row of joined keys; the chosen one
  is "pressed" (it sinks, `--panel` cap, an orange light on top).
- **Field**: recessed (`--well`, 1 px inner shadow at the top), radius 10, 44 tall; focus: 2 px `--signal-ink` ring.
  The placeholder is normal text.
- **Screen** (`.screen`): `--screen`, radius 8-12, 1 px inner reflection; inside, only light: dots, Doto or Martian
  Mono in `--screen-ink` / `--screen-muted` or in a monster's color. Static scan lines (2 px gradient, opacity 0.05)
  only on large screens.
- **Lights**: 8 px dots. Green = ready, orange = there is a question or something to do (it blinks slowly, 1 Hz in
  steps, only without "Reduce motion"), red = stopped or error. Color is never the only signal: there is always a word
  or a number too.
- **Meter** (VU): 4 vertical segments of 3×10 px in the monster's color; when the monster works they light up in
  sequence, in steps; at rest they are off.
- **Menus, popovers, dialogs**: `--raised`, the seam as border, a short solid shadow `0 6px 0 -2px rgba(0,0,0,.12)`
  plus a light soft one; radius 14. The terminal sheet is a large screen.

## Motion (D-084)
Every animation answers "what does it say?". If it says nothing, it isn't there. A frame is 40 ms (a 25 fps display);
everything runs in `steps()`, only `transform`, `opacity` and `visibility` change. Tokens in `styles.css`
(`--dur-press` 80 ms, `--dur-ui` 120 ms, `--dur-sheet` 160 ms, `--steps-*`, `--sink-*`, `--row-hover`,
`--screen-hover`), the lengths for timers in `lib/motion.ts`. No animation library.
- **Press** ("I heard you"): every key sinks until 1 px of thickness is left, in two frames (80 ms): the keys (3 px)
  sink by 2, the tiles (2 px) by 1; the keys without a cap (ghost, light keys on screens, panel tabs, the home of Stop)
  sink by 1 px like a membrane, because they have no thickness to compress. Released, it comes straight back up. Rows
  (strips, list and module rows, menu items) are surfaces, not keys: they don't move, and pressed they immediately take
  the outline of the choice. Pressable images get a ring.
- **Hover** ("this can be pressed"): only what can be pressed reacts, always by lighting up, never by moving. A row
  takes the neighboring tone of the surface it sits on (`--row-hover`: chassis → panel, panel → raised, raised →
  panel); a cap changes by one tone; on a screen the words go from dim to lit with a 7% veil of light. The hand cursor
  only on what can be pressed (never on disabled things). On a touch screen there is no hover
  (`@media (hover: hover)`): what elsewhere appears on hover (the keys of the file cards, the instrumentation arrow) is
  always visible there. From the keyboard the focus ring is a single one: 2 px `--signal-ink`, `--signal` on screens.
- **Appear** ("something arrived"): four movements, all in steps. `rise-in` (4 px up, three frames): what arrives in
  the flow, that is a message, a question, a card, a step, the @ menu, a notice. `drop-in` (6 px down): the palette,
  which hangs from the rail. `slide-in` (24 px from the right, four frames, 160 ms): the right-hand pane and "To
  review". `light-on` (from off to on, three frames, no displacement): a part of a screen that lights up, that is a
  card, a row of the guide, a context dash, "Saved", the uploaded file, the paused question. **Disappear** is faster or
  instant: only the right-hand pane leaves in three frames, everything else goes at once.
- **Attention** ("it needs you"): an orange light that blinks at 1 Hz, only for what is waiting for the user (a
  question, the first-start step you are on, Stop armed). Nothing else blinks. The display clock ticks the seconds at
  0.5 Hz: it is a clock, not a call.
- **Waiting and work** ("I'm working on it"): the meter dashes lighting up in sequence, or the 10 dashes of progress;
  the cursor that blinks while a monster writes; the monsters thinking. Never spinners. A connection or a check in
  progress is a wait, not a call: dashes, not a blinking light.
- **State change** ("now it is like this"): an instant change or a single step; never colors that fade. The levers (the
  switches, the Stop lever) snap in two frames; the Stop cover lifts in four and falls straight back; a drawer's little
  triangle turns in two. The name on the monitor flickers (520 ms) when a monster starts working.
- **Scroll**: scrolling to a question or to new messages is the system's (smooth), instant with "Reduce motion".
- **Reduce motion** (the system's or the app's, `data-motion="reduced"` on `<html>`): every change becomes a state
  change. Animations don't start, every transition lasts 0 (a pressed key is down, with no travel), the monsters stay
  on the first frame, the lights and dashes are lit and still.
- **Performance**: no layout animation, no permanent `will-change`; off-screen monsters stay on the first frame
  (`data-offscreen`). Measured on 16/10/2026 (`?mock=demo&vita=1`, 1440×900): 60 fps scrolling the chat, opening and
  closing the pane and hovering over rows and files. `e2e/movimento.e2e.ts` checks that everything runs in steps,
  that only what may (lights, dashes, monsters, cursors) goes round in circles, and that with "Reduce motion" nothing
  is left running.

## The top rail
- **Wordmark**: "monsters", lowercase, in Doto 20 px, spacing 0.08em. On the phone the wordmark stays at home; inside a
  view it becomes "‹ Back".
- **View title**: Instrument Sans 17 px semibold. In the chat the title is only for screen readers (the name is on the
  monster's monitor). The view's keys are `ghost` with a 20 px icon and a tooltip; those with a label use `.label`.
- **Status display** (`StatusDisplay`): a black screen 32 px tall, 240-340 px wide. Martian Mono 11 px uppercase text
  and the time in Doto 18 px (with the unlit digits `88:88` behind, like a real display). It shows the first true
  state in this order: `STOPPED` (red) · `NOT CONNECTED` (red) · `RECONNECTING…` (a steady orange light and a meter: it
  is a wait) · `● TITAN ASKS` (a question: the name first, it is the useful information) or `● N QUESTIONS · TITAN`
  (the orange light blinks: it is waiting for you; if someone is working meanwhile, the meter beside it) · `N AT
  WORK` (with a meter; `RHEA IS CHANGING COURSE` if a monster at work is spinning its wheels, D-068) · `ALL QUIET`.
  Below 300 px of display the meter gives way to words. The connection state comes before questions and work (which,
  without a connection, are old), and "quiet" is last. Click: it goes to the chat that is waiting, otherwise to
  Activity. Below 1100 px only light and number; on the phone only the light.
- **Stop** (`KillSwitch`): a switch with a **safety cover**, like in a recording studio or a cockpit. At rest the
  cover (orange diagonal stripes, signal border) is closed over the red lever, with the "STOP" label beside it. First
  click (or Enter): the cover lifts (a 68° rotation in 160 ms, four steps) and is "armed" for 5 s, the `.label` says
  "AGAIN" (the full sentence, "Press again to stop all monsters", is in the tooltip and in the screen-reader
  announcement). Second click: the lever snaps down, a lever sound if sounds are on, all the monsters stop. Stopped:
  the lever stays down, the cover lifted, red light, label "RESUME"; a click brings it back up. When at least one
  monster is working the light is on, steady orange (there is something to stop: it is a state, not a call); it blinks
  only when armed, while waiting for the second click. It sits beside the word, not on the cover, so it is visible with
  the cover lifted too. Always visible and reachable from the keyboard, accessible name "Stop all monsters" /
  "Resume". `⌘.` / `Ctrl+.` (or "Stop all monsters" in the palette) lifts the cover (even with nobody at work) and
  brings the focus there; Esc closes it again: nothing stops the monsters with a single gesture. On the phone only the
  cover and the light; the word appears only when armed ("AGAIN"): when stopped, "Resume" is in the band, once.
- Below the rail, when the monsters are stopped, a band (`HaltBanner`) "The monsters are stopped", with what the stop
  left half done ("Pending: Titan's question and Rhea's work", `haltedWork`) and the keys "Resume" (only resume: Stop
  is a safety switch, nothing restarts by itself) and, when there is something to restart, "Resume and continue"
  (orange): the core resumes and restarts, for every stopped job, the request that had started it (the monster reads
  "Resume the work I had stopped: «…»"). In the chat the user's message doesn't come back: a status line "RESUMED THE
  STOPPED WORK: «…»" with the green light, only in that monster's chat (D-072; the same for "Ask me again"). The
  monsters' screens go to "asleep" (just the word: the band says why).

## The sidebar
- **Search**: a recessed key 40 tall like a field, "Search monsters and notes" and the `⌘K` tile on the right: it
  opens the palette (below). The squad is never filtered: the monsters stay in their place.
- **Squads** (D-100): below the god's bar and the search, one per group: the `.label` "PERSONAL SQUAD · 4" or the
  project's name ("SATURDAY SOCIAL · 3", a link to its page: chosen, the strip's `--ink` outline), with a 32 px
  little triangle that folds the squad (remembered in this browser). Inside, the strips with the lead first and the
  others in the squad's order. After the last squad the "New project" row (+) and, folded under "ARCHIVED PROJECTS ·
  N", the archived projects. The up and down arrows move between the god's bar (the first stop) and the open strips of
  all squads.
- **The foot**: Automations, Notes, Files, Activity, Settings and the computer don't scroll with the squads (a seam
  above): they stay within reach even with many squads and on a short window.
- **Monster strip** (row 68 tall, radius 12, padding 8/10): on the left the 60×52 **screen** with the animated dot
  monster; then the name (16 semibold) and a status line in Instrument Sans 13.5 `--ink-muted` (one line, ellipsis at
  the end); on the right the time (Martian Mono 11) and below, depending on the state: the orange light and the number
  of questions, the meter if it is working, the number of unread in a solid `--ink` tile. On hover: `--panel`.
  Chosen: `--panel` with a 1.5 px inner `--ink` outline. On error the state is in `--stop-ink`.
- **Automations, Notes, Files, Activity, Settings**: 44 rows with a 20 px icon and the shortcut's `.label` on the
  right (`⌘2`, `⌘3`, `⌘4`, `⌘5`, `⌘,`; D-096). Chosen: like the strip. On Automations, the orange light and the number
  of runs waiting for an answer.
- **Computer selector** (desktop only): a row with the light (green ready, orange connecting, gray unreachable),
  "THIS COMPUTER" or the connection's name in `.label`, and the little triangle. It opens Connections.

## The god's bar (D-101)
- **Where**: at the top of the sidebar, above the search and the squads (margins 12, like the strips); on the phone at
  the top of the home screen, full width. It is the **god's chat** (the orchestrator, head of the Personal squad and of
  the projects) in the sidebar: a link to its chat, and the god has no strip of its own (D-102).
- **Like a strip** (D-102): with its chat open (also the home on the big windows, `⌘1`) it has the chosen strip's
  outline, 1.5 px `--ink` outside the screen after 2 px of chassis; on the right of the row, the blinking orange
  light and the number of questions waiting in its chat (`--signal` as text), otherwise the unread in a tile of light
  (solid `--screen-ink`, black text). It is the first stop of the sidebar's arrows and, with its chat open, the one in
  the Tab order. Accessible name like the strips: "Titan, at work, asks you: …, 2 to read. Head of all 2 squads: <the
  line>. <the `.label`>"; `aria-keyshortcuts` with `⌘1`.
- **What it looks like**: a black screen (`.screen` with scan lines, radius 12) in both themes; the theme's chassis
  around it. At the top the **ribbon**: 4 rows of dots (5 px pitch, dots at 80%) with the colors of all the monsters of
  all squads, each a rounded band of 6 columns in its light (`dotPalette`) crossed by diagonal stripes of its second
  color; one unlit column between two monsters, three between two squads; first the god, then the Personal squad, then
  the projects. Below, the god on its screen (46×40, the face of its state), the name in Doto 20 in its light, on the
  right the `.label` with the light, and a line in Martian Mono 11 (`--screen-ink` when there is work or a question,
  otherwise `--screen-muted`).
- **States**: at work the ribbon scrolls left in steps of one column, 6 columns a second with one monster and +2 for
  each additional one (20 at most); the monsters at work are at full light, the others dimmed; the `.label` "2 AT
  WORK" with the green light. An open question: slow drift (1.5 columns a second) and "1 QUESTION" with the blinking
  orange light. Just finished (less than 90 s): slow drift, "5 MONSTERS" dim. All quiet: still. Stopped (Stop) or not
  connected: still, lights at 45%, name dim, "STOPPED" / "NOT CONNECTED" in screen red, the god asleep.
- **Line**: what the god is doing ("Waiting for Rhea", "Waiting for your answer"), otherwise who is working ("At
  work: Rhea and Dione"), who is waiting for an answer ("Rhea is waiting for your answer"), "All quiet" (or "… in 3
  squads"), "The monsters are stopped", "Not connected to the computer". One line, ellipsis at the end.
- **Motion and performance**: one canvas, one `drawImage` per step, never more than 20 steps a second, nothing when it
  is still, with the tab hidden or off-screen. "Reduce motion": the ribbon stays still with all the colors in a row.
  On hover the screens' veil of light (`--screen-hover`); pressed it sinks by 1 px; focus 2 px `--signal` at 5 px
  (outside the choice's outline).

## The palette (⌘K)
`⌘K` / `Ctrl K` from anywhere, or the sidebar's search key (on the phone too): a `--raised` popover up to 640 px wide,
below the rail (Stop stays uncovered), with no veil over the rest. At the top a recessed field with the "esc" tile;
below, the results in groups with the `.label`: **Monsters** (name or role, on their small screen), **Notes** (the
notes search, after 2 letters), **Messages** (the chats that contain the words, the most recent), **Commands**
(Automations `⌘2`, New automation, New note, Notes `⌘3`, Files `⌘4`, Activity `⌘5`, To review, Right-hand pane `⌘J`,
Stop `⌘.`, Settings and its tabs, Light / Dark theme / Same as the computer). 44 rows like the @ menu, the chosen
one with the `--ink` outline and the ↵ tile, the shortcut on the right. Arrows, Enter, Esc (first it empties the field,
then it closes); at the bottom "↑↓ choose · ↵ open · esc close". It opens in steps (120 ms) and closes when the page
changes.

## The chat
- **Monster monitor** at the top of the chat, fixed (it doesn't scroll), 76 tall: a black screen of full width
  (margins 16), with the big dot monster (height 60), the name in Doto 26 in the monster's color, below the role and
  what it is doing in Martian Mono 11 `--screen-muted`; on the right, on wide screens, the conversation summary (`N
  TOOLS · TIME · COST`: that monster's runs since the last "New conversation", from 1180 px of chat), the **CONTEXT**
  key (see "Usage") and the "Behind the scenes" and "New conversation" keys (light ghost keys on the screen, with
  the `.label` from 860 px of chat, below only the icon): the monster's state takes precedence and is never cut. When
  the monster starts working the name flickers like a screen lighting up (520 ms in steps) and the meter starts; a
  waiting question lights the orange light. The title in the rail is only for screen readers.
- **Bubbles**: the monsters' `--raised` with the monster's tint, radius 4/14/14/14, the seam as border; the user's
  `--ink` with `--panel` text, radius 14/4/14/14. Avatar: a small 34×30 screen with the monster, only on the first
  message of a group, still on the first frame (it talks only while it writes). Reading column up to 760 px. What
  arrives with the chat open (a bubble, a question, a receipt, a file) rises in three frames (4 px and opacity); when
  opening a chat the rows that were there stay still, and your message rises once, when you send it.
- **Drawn blocks** (D-162): a reply can hold a fence ```` ```ui ```` of OpenUI Lang (`ui-blocks.ts` in `@monsters/shared` is the
  library) that the bubble draws with our own components (`components/chat/ui-block/`, a chunk loaded when a reply has one):
  key numbers as tiles (the change has an arrow and a word, never only a colour), a table (numbers on the right,
  scrolling sideways), bar, line and donut charts in plain SVG (values in the tooltip and in a table for screen readers;
  series colours are the vault's tested palette, series of a line also differ by mark), comparison columns with the
  recommended one lit like the chosen strip, steps with status marks, a checklist, a timeline, a card, a callout. Parts
  take the bubble's own colour, rule and code background, so they fit every tint and both themes; on the agent terminal's
  screen they use the screen lights. While the reply streams: the partial drawing or a skeleton, never the source; a block
  that cannot be drawn shows its text and "Couldn’t draw this block". **Buttons** are suggested replies in the chat's own
  keys (the suggested one orange), wrapped on a phone; a tap sends the label as the user's message, and they stay
  `aria-disabled`, with the reason as title, while the reply streams, after the user wrote something newer, while the
  monster works or a question waits; the terminal and the pages without a chat do not draw them.
- **Instrumentation**: below the last bubble of each monster turn, a line in Martian Mono 10.5 uppercase
  `--ink-muted`: `TITAN › DELEGATE ×2 · WEB SEARCH ×3 · 4.1 S · FREE · LLAMA 3.3 70B`. It is built from the turn's
  events (`tool_call`, `tool_result`, `provider_usage`, run duration): the tools are those of the whole run, including
  those of the monsters it delegated to; the time is there only when the run is finished; "FREE" when every request
  went to a free model or the reported cost is 0; the model is missing with OpenRouter's free router (it doesn't say
  which one it chose). Web searches say in brackets the engine that answered last (`WEB SEARCH ×3 (OPENROUTER)`,
  `(WIKIPEDIA)` when the free search got blocked); the cost of a paid search goes into the cost, it is not the turn's
  model (D-071). Pure functions in `store/derive.ts` (`runStatsIndex`, `instrumentationLine`). Click: it opens "Behind
  the scenes" on that turn (the first row of the run, marked by a bar in the monster's color). It can be turned off in
  Settings → General ("Show technical details", on by default).
- **Events between monsters**: a centered `.label` line between two seam dashes of the same length ("RHEA FINISHED · 3
  CAPTIONS"); the time after a dot ("YOU STOPPED ALL THE MONSTERS · 00:02"). Below 480 px no dashes and the line wraps
  onto two lines instead of being cut. Several events in a row are grouped in a line that opens. A task handed over:
  "TITAN → RHEA · THE TASK"; the full sentence, in normal lowercase, is the accessible name and the tooltip (screen
  readers spell out the `.label`'s capitals).
- **Message written by another monster** (D-102): what the god sends to a project's lead with `project_send` sits in
  the lead's chat on the monsters' side, not as a bubble of yours: the `.label` "FROM TITAN" above, the god's small
  screen as avatar and the bubble in its tint; for screen readers "From Titan, 10:32:". In the list the lead's strip
  says "Titan: …", not "You: …".
- **Message from Telegram** (D-107): what a person writes to the bot dedicated to a monster sits in the monster's chat
  on the monsters' side, never as a bubble of yours (even if you wrote it in the group): the `.label` "BOB · FROM
  TELEGRAM · TEAM" (in private "from Telegram · in private", "(you)" for your account), the Telegram sign as avatar and
  a neutral bubble. The monster's replies in that job have the `.label` "ON TELEGRAM · TEAM" above. In the list the
  strip says "Bob: …".
- **Lead's report** (D-102): in the god's chat, when the lead finishes the `project_send` work (`project_report`), like
  a received task: the `.label` "REPORT FROM IAPETUS · SATURDAY SOCIAL · 10:41" between the seams, below the light and
  the outcome in bold ("Iapetus finished", green; "was interrupted: Monsters closed while it was working on it", red;
  "stopped before starting", dim; "is waiting for your answer", orange; "didn't make it", red) with the summary in
  `--ink-muted` (280 characters at most), and the orange-text `.label` link "Open the project's chat →". The full
  answer is in the lead's chat.
- **Error at the bottom of the chat**: in place of the first suggestions two keys, "Try again" (resends the request of
  the failed job, or the task it had started with) and "Behind the scenes" on that job.
- **Question with options** = **keypad**: a `--raised` card, the question in 16 semibold, the options as full-width
  keys with the letter tile (A, B, C…) on the left; the recommended one has the orange light on the right and
  "RECOMMENDED". With the focus outside every text field, pressing the letter on the keyboard presses that key (you
  see it sink, a click if sounds are on); in the writing field, which has the focus, a letter alone and Enter does the
  same, so a sentence that starts with "C" stays a sentence. A key picked with the keyboard shows "Sent: …" with
  "Undo" (Esc) for 3 seconds before it leaves; a click goes at once. Only the question the writing field answers (the
  oldest open one) takes the letters, and
  the letters hint appears only with a real keyboard (not on a touch screen). The free answer stays in the writing
  field.
- **Question closed without an answer**: never the "done" check. A light (red if Stop closed it, dim otherwise) and
  the reason in words ("You didn't answer: you stopped the monsters"); when the work hasn't restarted, the "Ask me
  again" key (resends the job's request, or asks the monster to ask the question again). When stopped it isn't
  there: "Resume and continue" does it.
- **Writing field**: recessed, radius 14, at least 52 tall; on the right the "SEND ↵" key (`.label`), a normal key
  while the field is empty and `primary` (orange) as soon as there is something to send; on the phone only "↵". `@`
  menu as a popover. With an open question, as soon as there are real words (not just a mention in progress), above
  the field "↳ Answer to Titan's question"; if the question doesn't block the work, a small ✕ turns it into a normal
  message ("It's an answer" goes back). The placeholder suggests the keys when there is a question ("Write to Titan, or
  press A, B or C").
- **Empty chat**: the monster on a big screen that talks for a moment and the greeting in Martian Mono with a blinking
  cursor, in its own words (livelier if the genome has a high `bounce`); the name in Doto is only on the monitor,
  once is enough. Below, the first suggestions as keys.
- **To review** (the questions waiting and the notes touched, with Undo): a key in the chat's rail (a `Tray` icon with
  "TO REVIEW" and the number of things waiting). From 1280 px it is a column beside the chat (remembered); below it is
  a sheet on the right, full screen on the phone; Esc or Back close it. Only one thing sits on the right: with the
  right-hand pane open the column steps aside below 1600 px (the key brings it back and closes the pane), from 1600 px
  they sit together; the sheet and the pane close each other.
- **Sounds** of the open chat (if on): `question` when a new question arrives, `done` when the monster finishes.
- **Receipt** (D-068): at the end of a turn with a user request and something to account for (tasks, notes, actions
  toward the outside, removed texts), a black **display** below the last bubble, indented like the questions: at the
  top the `.label` "RECEIPT" with the summary ("2 TASKS · 1 IN DOUBT · 1 NOTE · FREE") and the time; open it shows the
  request, the tasks with the monster in its light, the outcome (`✓ really done` screen green, `? in doubt` orange,
  `✗ incomplete / failed` screen red) and the ✓/✗ criteria with the reason, the notes touched (links), what left the
  computer, security; at the bottom, after a line of light, cost, steps and duration (and the instinct's questions if
  "Show technical details" is on) and the light key **"Undo the whole job"**: first touch "AGAIN" (red border, 5 s, like
  Stop), second touch undoes it and the display says "UNDONE · N CHANGES ROLLED BACK" with the notes and any errors.
  The last receipt in the chat is open, the others are a line. New token `--screen-ok` (`#4fd98a` in both themes, ≥
  4.5:1 on black).
- **Instinct lines**: like the events between monsters, a centered `.label` between the seams with `◇` ("◇ DIONE IS ON
  IT"); in orange text what needs checking, in red a refused action or a text with orders removed. What the instinct
  says about a task ("Dione hadn't finished the work: I asked it to complete it", "in doubt") sits below the task
  itself, in lowercase. In the chat only hint, reminder, doubt, change of course, brake and removed texts; the rest in
  Activity. Click: Behind the scenes on that job.
- **Monster going in circles**: with a `stuck_*` instinct event the monster at work makes the **confused** face
  (`confused` expression: it looks this way and that, crooked mouth, an accent `?` in the corner, 3 frames, only
  `visibility`); the monitor says `? IS CHANGING COURSE` ("CHANGING COURSE" if narrow), the strip "Is changing course",
  the status display "RHEA IS CHANGING COURSE" in place of "N AT WORK". It stays at least 4 s, then goes back to normal
  at the first new action (tool or words); "Reduce motion" leaves the first frame. The core keeps the state
  (`AgentSummary.confusedSince`, D-072): after a reload the confused face stays, with the same start.

## Right-hand pane (Preview, Behind the scenes, Usage; D-075)
- **A single screen on the right**, black, recessed in the chassis like the monitors, with three tabs at the top
  (light keys `.label`, the chosen one lit in `--screen-ink`, ← → arrows between the tabs) and ✕. In place of the
  overlapping sheets: Preview, **Behind the scenes** (the terminal) and **Usage**. "Behind the scenes", the
  instrumentation line and the CONTEXT key open their tab; the monster's tabs follow the chat you open (the pane
  doesn't close when changing chat: it is the inspector of the one beside it).
- **Where**: from 1100 px it is a column of the window to the right of the module (8 px below the rail, 12 from the
  edge), and the content narrows, never covered; between 768 and 1099 px it is a sheet over the content (top 60, short
  solid shadow); on the phone the whole screen below the rail, and changing page or chat closes it. Stop and the rail
  are never covered.
- **Width**: dragged from the **handle** in the seam on the left (an engraved dash, `col-resize`), or with the arrows
  when it has focus (Shift: ×4, Home/End); 380 px minimum, at most ~60% of the window leaving the content at least 400
  px; 520 to start, double click brings it back there. Remembered per viewer (`dockWidth` in the browser's
  preferences).
- **Keyboard**: `⌘J` / `Ctrl J` opens and closes (also from the palette, "Right-hand pane"); Esc closes (first it
  leaves an image's zoom); focus goes into the pane only when you asked for it.
- **Preview**: at the top the **strip** of what is open (12 at most: type icon, name, ✕; the last ✕ closes the pane),
  then the header: name (15 semibold), below in `.label` `TYPE · SIZE · FROM TITAN` ("from you" for your own files),
  and the light keys **Open in the system** and **Show in folder** (desktop app only, only on the monsters' computer;
  never for HTML pages: outside the box they would run free), **Copy** (text, code, pages, images as PNG) and
  **Download**. A note has **Open in Notes** and Copy.
- **By type**: an *image* fitted on a static checkerboard (the transparency), a click takes it to real size (double if
  it is already whole) and it moves by dragging, a click or Esc fits it again, at the bottom `FITTED · 52% · 960×640`;
  a *PDF* drawn by pdf.js on white sheets (pages are drawn as they come close, `PAGE 1 / 2`); a *note* on its
  `--raised` sheet with the Notes reader (links open here, `⌘` click goes to Notes); *text, code, JSON, CSV* in Martian
  Mono 12.5 with line numbers in a dim margin and a few colors of light (strings, numbers, comments, keywords), the
  JSON indented, the CSV as a table (or text); an *HTML page* made by a monster on white in a **closed box** (below:
  "in a closed box: no network, no access to Monsters"); if the monster made it after reading external content it
  arrives with scripts off, a line above ("Page with scripts turned off: it was made after reading external
  content") and the **Turn the scripts on** key, which asks a second time ("Yes, turn them on" / "Leave them off"), and
  never opens by itself; *other* (archives, Office documents): icon, name, type, size and what to do with it.
- **Where it opens from**: the attachment cards, the images in the chat (the computer's own show in the bubble, up to
  320 px tall; those from the internet stay a card with the address and "Show image": they load only on click,
  without referrer), the links to files, the notes cited (`[[note]]`), the files made by the tools in Behind the
  scenes (a screenshot is a thumbnail on the tool's row), and a monster with `preview_show`: in the chat a card
  ("TITAN SHOWS YOU · PAGE", name, its line, "OPEN"; "IN PREVIEW" when it is open) and, if that chat is on screen (not
  on the phone), the pane opens by itself without taking focus.
- **Motion**: it enters from the right in four frames (160 ms, 24 px and opacity), leaves in three (120 ms); the tab
  change is a light-on in three frames (120 ms). With "Reduce motion" it just appears and disappears. No blurs: a
  short solid shadow only for the sheet.

## Behind the scenes (the monster's terminal)
A tab of the right-hand pane that is a **large screen**: `--screen` background, static scan lines, Martian Mono 12.5
text in `--screen-ink`, the tools' names in the monster's color, errors in light red, times in `--screen-muted`. At
the top the small dot monster and the name in Doto. It opens from "Behind the scenes" and from the instrumentation
line (on that turn). Every row begins with a monospace sign (`▸` tool, `→`/`←` tasks, `✕` error, `·` thinking, `─`
start and end of the work); the filters are light keys on the screen (on the phone they wrap: all five in view, none
cut at the edge). On the phone it goes full screen below the rail (Stop stays uncovered). Another chat makes it show
that monster; Esc, ✕ or `⌘J` close the pane.

## Usage (a monster's context and spending, D-075)
- **CONTEXT key** on the monster's monitor, before "Behind the scenes": 20 dashes like those of the meter (3×10 px, one
  for every 5% of the model's window) and the percentage in Martian Mono 11; the word "CONTEXT" only from 1320 px of
  chat, the dashes down to 520 px (below, the percentage stays). Before the conversation's first step, "–"; with no
  known window, the tokens ("38K") and no dashes. From the compaction threshold (75%) the percentage is orange.
  Accessible name: "Titan's context and usage: 31% of the model's window".
- **Lights of the parts** (inside the screen only light): the monster's light at five intensities, from the most stable
  to the most recent like the prompt (instructions 46%, memory and profile 60%, tools 74%, conversation 87%, tool
  results 100%), the harness base (Claude Code, Codex: it is not ours) in `--screen-muted`, the current message in
  `--screen-ink`; free space `--screen-off`. Color is never alone: the parts are always in this order, a wider gap
  marks where one ends, the legend says name and tokens. A tick of `--screen-muted` light, taller than the bar, marks
  the 75% threshold.
- **Pane** (click on the key; `components/usage/UsagePanel.tsx`, a component of its own: the Usage tab of the
  right-hand pane). A screen: at the top the monster and "USAGE"; **Context** with the big number in Doto 44 (in the
  monster's light, orange from the threshold), tokens used / window and model, the big bar (40 dashes 22 tall across
  the whole width) with below "0 · 75% · COMPACTS HERE · 64K", the legend (sample dash, name, what it is for, tokens and
  share); **This conversation** (tokens in/out, cache read and written, calls, duration, cost in $ and €, per model,
  web searches, instinct); **Today · this month** against the squad's cap (10 segments as in Models) and the "Spending
  cap · Settings → Models" key. On a subscription, instead of money "included in the subscription" and a line that
  says so. Values in Martian Mono 14, `.label` labels 11. It follows the chat you open; Esc or ✕ close the pane.
- **Motion**: a dash that lights up (or changes part) does it in three frames (120 ms, `steps(3)`); with "Reduce
  motion" it just changes. Live data: the preview reads `provider_usage.context` from the stream, the pane rereads
  `GET /api/agents/:id/usage` when a monster event arrives.

## Plan usage (Claude and ChatGPT limits, D-111)
- **Block** (`components/usage/PlanLimitsBlock.tsx`): a small screen (`.screen`, black in both themes) with a row per
  plan window. Above, on the left the name in `.label` ("SESSION", "WEEK", "OPUS WEEK"; for ChatGPT the length: "5
  HOURS", "WEEK"), on the right the percentage in 14 tabular; below a bar of **20 dashes** (one every 5%, 14 tall,
  sharing the whole width, so on the phone too) and a 12 line in `--screen-muted`: "resets in 1 h 32 min" (within the
  day), "resets Wed 16:00" (later), or, when the window has already passed, "reset · updates on next use" at 0%. At the
  bottom "Updated 20 min ago. It updates only when a monster works on this plan." With no data: "No data yet: it appears
  after a monster's first job on the Claude plan."
- **Thresholds:** below 80% `--screen-ink` light; from 80% dashes and percentage in `--signal` with the words "running
  low"; from 95% in `--stop` with "almost at the limit", at 100% "limit reached". Color is never alone: the words, the
  percentage and the accessible name (`role="meter"`, "Session: 9% used") say the same.
- **Where:** in Settings → Models below the "Claude subscription" row (when sign-in is ready) and below the ChatGPT one,
  with the `.label` title "PLAN USAGE"; in the Usage pane of a monster on the plan, as a "Plan usage · Claude" section
  between "This conversation" and "Today · this month" (without the screen in the middle: the tab is already a screen).
  A monster on a free or key-based model doesn't have the section.
- **Clock:** the block recomputes every 30 s with the page's time: a window that resets while you watch goes to "reset"
  and "updated 20 min ago" ages.

## Attachments and Files (D-075)
- **Paperclip** in the writing field, on the left: a 40 ghost key with the icon (name "Attach a file"). Also paste (an
  image from the clipboard) and drag onto the chat: a `--panel` veil with a dashed `--signal-ink` border says "DROP
  THE FILES HERE TO ATTACH THEM".
- **File card** (`FileChip`): a `--raised` cap with the seam, radius 12, 56 tall, 180-280 wide. On the left the 40×40
  thumbnail (radius 8) or, for documents, a black **small screen** with the type icon in light; then the name (14
  medium, ellipsis at the end) and below the `.label` "PDF · 240 KB". In the writing field there is the ✕ to remove it
  and, while it uploads, **10 dashes** 3×10 in `--signal-ink` that light up with progress and the percentage (never a
  spinner); an error is a short `--stop-ink` line ("Too big: 25 MB at most", "HEIC photos can't be read yet: export it
  as JPEG"). "Send" stays a normal key while a file uploads. At most 10 attachments, 25 MB each.
- **In the chat**: attachments sit above the user's bubble, aligned right; images as tiles (radius 14, 140-260 wide
  depending on proportions), the others as cards. A message of only files has no bubble. The monsters' files are a line
  between the seams ("RHEA SAVED A SCREENSHOT · 18:01", "DIONE CREATED A PAGE: WEEKEND IN LISBON") with the file below.
  Every file opens in the Preview on the right; a deleted one is "FILE DELETED".
- **Files section** (`#/file`, `⌘4`): at the top the filters as a row of joined keys (All, Images, Documents, From the
  monsters; on the phone four equal columns) and the "Search files" field (name and extracted text; a file found by its
  text shows the snippet around the words), the count in `.label`. Below, a seam and the grid of cards (`--raised`,
  radius 14, 200 px columns, two on the phone): at the top the 4:3 thumbnail on `--well` (or the type's small screen
  with the extension in light), below the name (or the page's title) in 15 semibold, "IMAGE · 240 KB", who made it
  ("From you", the monster on its little screen with "Rhea's screenshot" / "Dione's page") and the date. Download and
  Delete are 36 keys in the corner, lit on hover (always visible on a touch screen); Delete asks for confirmation like
  Stop: first touch "AGAIN" (red border, 5 s), second touch deletes. Empty: a screen with the squad lead and two lines
  ("NO FILES YET" and how to add some).

## Notes, Activity, Settings
- **Notes**: a list on the left with title, date in `.label` (uppercase, like the sidebar's times) and tags as small
  tiles; the open note on `--raised`, Instrument Sans 17/28, a 68-character column, the `[[links]]` in `--signal-ink`
  underlined (dashed if the note doesn't exist yet). Who wrote it is a small screen with the monster. The keys (Graph,
  New note in the rail; Edit, History, Activity, Trash on the note) carry their name: beside the icon from 1280 px,
  below the icon on the phone, tooltip in between. On the phone there is a single back, in the rail ("‹ Notes"). The
  **graph** is a black screen: the notes are glowing dots (the light `dotPalette(genome).lit` of the monster that wrote
  them, `--screen-ink` for the others), the links thin `--screen-muted` lines, labels in Martian Mono, legend and counts
  inside the screen. On first draw it fits the screen (with margin for the labels); a label is drawn only if it doesn't
  touch those already drawn (first the open note and the most linked ones, `placeLabels`), the others on hover or with
  zoom. Color says only who wrote. A note's history (the differences) is also a small screen, green and red rows, with
  "‹ Back to the note" at the top: the jumps are "· line N ·", the note's changed properties are folded under "Changed
  properties", no hashes (only in the date's tooltip).
- **Activity and instinct** (D-068): among the "Important" ones, the texts with orders to the monsters removed and the
  brake on actions that leave the computer (yes, no, done and to check); the rest of the instinct (hints, reminders,
  changes of course, its individual answers) under "All" and in the "Instinct" filter. The light is that of the monster
  being talked about.
- **Activity** (the ribbon): rows in Martian Mono with the time on the left (tabular), the light in the monster's color
  (the same as its dots), the sentence in Instrument Sans, below the type in `.label`. At the top an "Important | All"
  segment (by default only what had an effect), then the filters as a row of keys ("Who" is a recessed menu, aligned
  to the top with the keys) and "More filters" (Messages, Monsters' jobs, Tasks handed over, Tools, System; the period
  "All time"); on the phone a single "Filters" key opens a drawer. A question still open has "Answer", which leads to
  its chat. Details open in a small screen, values in Martian Mono 12.5 (internal codes only under "Technical data").
  "Undo" and "Redo" are keys (in narrow columns a 32 px key with ↺, the name in a tooltip and for screen readers).
  Hyphenated words (a date) don't wrap.
- **Settings**: five tabs, one idea each (D-066), as a row of keys at the top: **Squad** (who is there, and who you are:
  name, tone, language, style; the Profile note; the lead is renamed on its row of the squad; at the bottom a closed
  "Advanced" drawer with the monsters' decisions and the scorecard, D-167), **Models** (what they think with: keys and
  subscriptions; the monsters' model, one for the whole squad until you choose "Choose for each monster"; a single
  model has no arrows or ✕, and the name reads in words, "Free, chosen by OpenRouter"),
  **Permissions** (first "They always ask you", then what each monster can use, at the bottom "Advanced"),
  **Connections** (the roads to and from the outside: paused tools when one waits, Telegram, "Apps and services" with
  the gallery, the browser and "Add a custom app", and one "Web search" group: free search with the Brave key, then the
  "Paid search" lever and, when on, the Cheap / Precise segment with the cost per 1,000 searches, D-071, D-167),
  **General** (Look and feel, "Account and security" with the keys' row, the notes folder). In Connections, below Telegram's main bot, the **"Bots dedicated to a monster"**
  group (D-107): one entry per bot (@username, the "N TO APPROVE" tile, monster · project or "Personal squad", the
  state light, "Remove bot"), with the groups (Approve / Reject, then Remove), "Who can talk to it" (your account with
  "you" and no key, the others Approve / Reject / Remove, "Add with the Telegram ID") and "Today's messages"; "Add a
  bot for a monster" (one row, with no title, while there is no dedicated bot) opens the four steps (BotFather, privacy, one app per token, group and `/join`), the token, the
  monster's menu (never the god) and the daily limit. Behind "How groups work", below the module, a line says that the things you decide are
  never approved in the group. Below 680 px of width the tabs share the row, smaller words and no icons. Every group
  is a **module** (`--raised`, radius 14, seam) with the `.label` at the top left, 52 rows with lever switches; an open
  row shows a darker drawer. The monsters always appear on their small screen (`AgentMark`). In General: Theme (Light /
  Dark / System), **Sounds** (off by default), Reduce motion ("The monsters stay still and animations become simple
  state changes"), Show technical details; only inside the desktop app the "App" module with the **Open at login**
  lever (D-095: off by default; where it can't be done, the lever is off and the reason takes the place of the
  description); the notes folder reads on a small screen. The keys "in the system keychain" (the technical name only in
  the tooltip).
- **Instinct** (Squad tab, D-068): a module with the `.label` "INSTINCT" and the sentence of `INSTINCT_DESCRIPTION`;
  the "Who decides" row with the Rules only / Small model / An expert model (TypeSafe) segment and below, always, the
  description of the chosen engine (it changes with the segment). The expert model without a key: the core answers 409
  `no_key`, the module says so in words above the key field, which takes the focus; with the key a line "TypeSafe key ·
  Active". The **"What it does"** drawer has a lever per use (name, description) and `.label` tiles: "ON TRIAL" (the
  shortcut: on means it only takes notes), "ONLY NOTES" (a use set so by hand), "NEEDS THE EXPERT MODEL" / "NEEDS THE
  EXPERT MODEL OR THE SMALL MODEL" / "NEEDS THE TYPESAFE KEY" in orange text when the use is on but with the chosen
  engine it does nothing. Below the module, small, "What leaves the computer" opens and says per use what goes to
  TypeSafe. Never "System 1", "gate", "shadow", "threshold" or probabilities.
- **The monsters' report card** (Squad tab, below Instinct): a row per monster and model with the monster on its screen,
  the model in monospace, "14 jobs · 10 really done · free per successful job · 6.5 steps on average" and on the right
  (below, on the phone) a small screen with 10 segments in the monster's light and "10/12". When the chain has been
  reordered, a line with the green light: "Now Rhea uses llama 3.3 70b first: it finishes more jobs and costs less."
  Below, the honest state: how many checked jobs are still needed.
- **Spending cap** (Models tab, D-070): a module with the `.label` "SPENDING CAP"; the "Today" and "This month" rows say
  in words how much was spent and out of how much ("Spent €0.42 today out of €10 (4%)"), on the right a small screen
  with 10 segments in `--screen-ink` that turn `--signal` at 80% and `--stop` at 100%, and "€0.42 / €10" in Martian
  Mono. Below, the two fields "Per day (€)" and "Per month (€)" (empty: no cap) with "Save", orange only if something
  changed; the "Per monster" drawer for the monsters with paid models; the closed row "Limits of each job" (steps,
  tokens, cost and delegations of one job, for paid-per-use models and, apart, for subscriptions; "Restore the
  defaults"). At the cap a line says the paid jobs are
  stopped and "Raise the cap" (double, rounded to €5) restarts them. At the bottom, small, what doesn't count (free
  models, subscriptions) and the fixed exchange rate. In the chat the 80% and the cap are lines between the seams
  (`--signal`, `--stop`), the stopped job has "Raise the cap" in place of "Try again"; also a notice at the bottom.
- **Paused tools** (Connections tab, D-070): a module that is there only when needed, above "Apps and services": "GitHub
  changed a tool: the monsters don't use it until you accept it", the tool's name in monospace with a tile
  ("DESCRIPTION CHANGED", "NEW", "ARGUMENTS CHANGED"), the previous description struck through and the current one on
  two small screens, a sentence on why to read it, then "Disconnect" (with confirmation) and "Accept".
- **Apps and services** (Connections tab, D-063): every service is a key with its logo on a small black screen (the
  logo's color as light, ≥ 3:1 on black; black logos take `--screen-ink`), the name, a sentence and the state in `.label`
  with the light. The pane asks only for what is needed and leaves the rail (Stop) uncovered. When connected with a
  token, next to Test and Disconnect there is **"Change the token"** (D-072): it opens below a (password) field with
  "Create the token", "Save and test" and "Cancel"; only the token changes, then the test starts by itself. The same
  key is in "Apps and services" for the programs with hidden values (with several values, a segment to choose it). During a
  pending sign-in, below the pane "Return page won't open?" (a drawer like "Details") opens the "Address of the
  return page" field with "Complete the sign-in"; when the core knows the page won't open (core reached over the
  network) the field is already open.

## Automations (D-094, D-096)
- **Section** `#/automazioni` (`⌘2`), above Notes in the sidebar. A column up to 920 px, three levels that on the phone
  open one above the other (the rail says "‹ Automations", "‹ Runs"): list, automation, run. In the rail "New
  automation".
- **List by squad**: the `.label` "PERSONAL SQUAD · 1" (then one per project, `project` field), a module with a row per
  automation: the monsters (the lead first) on **a single black screen**, the name (16 semibold), "every Sunday at 23:00
  · Titan with Dione and Mimas", below the light and the state of the last run (Done green, Running and Waiting for an
  answer orange, Error red, Skipped dim) and the next run; on the right the lever that pauses it. A draft has the
  "DRAFT" tile in place of the lever.
- **Automation**: at the top a monitor (black screen: the squad, the name in Doto 24, when and the next run in Martian
  Mono, "ACTIVE / PAUSED / DRAFT" with the light), then the keys "Run now" (the only orange one; when stopped it is a
  normal key and, pressed, says the monsters are stopped with "Resume the monsters"), "Pause"/"Resume", "Edit",
  "Delete" (confirmation on the page, red border, never a browser dialog). Right after, the **runs** (the state, when,
  why it started, the duration, `4 STEPS · 16,480 TOKENS · FREE`), then the Goal, When (with the next three runs), Who
  does it (the lead with "LEAD"), Results and notices modules. A draft proposed by a monster has at the top the "Draft:
  confirm" band (orange border, Discard and Confirm, with `/api/drafts` of D-098).
- **Run**: the state on a small screen, the questions that are waiting (you answer here: a message in the lead's chat
  doesn't answer a run), the final answer, "What it did" (the notes lead to Notes, the files to the pane and to
  Files), then the read-only conversation with the chat's bubbles: the goal as a dark bubble, the lead and the
  monsters it asked (indented, "for the lead").
- **Form**: name and goal, the lead and who takes part as keys with the monster on its screen, "When" as a row of keys
  (Every day, Every week with the days, Every month with the day, Advanced with the cron rule), the time, the time zone
  (yours by default), and a screen that says the rule in words and the next three runs (computed with croner, like the
  core); then folder, cap per run (steps, tokens, euros) and the two notice levers. A new one can be saved as a draft.
- **In the chat** the lead working on a run doesn't show that work (it belongs to the automation): above the writing
  field a line with the light, "Working on the automation «Post of the week»: your message goes out as soon as it
  finishes" and "See the run". At the end of the run a notice at the bottom ("run finished", "waiting for your
  answer") with "See".

## Projects (D-097, D-098, D-100)
- **Page** `#/progetto?id=…` (rail title: the project's name). Below the rail a row of joined keys: **Chat · Squad ·
  Notes · Folder · Connections · Automations · Spending** (on the phone it scrolls sideways, the chosen tab stays in
  view). A column up to 920 px for the tabs that are not the chat.
- **Chat**: the lead's chat as it is at home (monitor, bubbles, field), with in the rail the project's name, "Stop
  project" and "To review". `@Name` reaches the project's monsters (in the @ menu they come first).
- **Stop project**: a ghost key in the rail with the open hand and the `.label` ("STOP" on the phone). First touch:
  "AGAIN" in `--stop-ink` with a red border for 5 s; second touch: it stops the work of the project's monsters (not of
  the others, the kill switch stays up) and a notice says what ("1 job", "nobody was working").
- **Squad**: a module with a 52 row per monster (the 52×46 screen in its state, name 16 semibold, "LEAD" in
  `--signal-ink` for the lead, the role), "Write" and "Remove" (confirmation in the row; the lead can't be removed). At
  the bottom "Copy a monster" (the monsters of the other squads, each with "Copy": below the row the proposed name,
  "Rhea · Saturday", in a field, and "Copy into the project") and "New monster" (the Settings → Squad form). Then the
  "ARCHIVE THE PROJECT" module.
- **Notes**: the notes of the `Progetti/<name>/` area as rows (title, the path inside the area in Martian Mono, how long
  ago), which open Notes. **Folder**: the path on a small screen with "Copy", "Change folder" (An existing one / A new
  one) and "Remove the folder"; if the folder no longer exists it says so. **Connections**: the web search lever, then a
  lever per server or service given to the whole squad; those of a single monster, in words. **Automations**: its
  automations as in the section, "New automation" (already in the project's squad) and "All automations".
  **Spending**: "PROJECT CAP" (Today, This month with the 10-segment screen, the two fields), the squad's cap in words
  below, "PER MONSTER" with the fields of the monsters with paid models.
- **New project** (`#/progetto?vista=nuovo`, from the sidebar row): modules "THE PROJECT" (name, where the notes will
  go), "FOLDER" (None / An existing one / A new one; the new one follows the name in `~/Monsters Progetti/<name>`),
  "PROJECT LEAD" (A new one with an optional name / Copy a monster: the monsters as keys with their screen, and the
  name it will have), "FIRST MONSTERS" (keys to light up). "Create the project" is orange when there is a name; then
  the lead's chat opens.
- **Draft** (proposed by the god): the page "Draft: <name>" with the orange-outlined module ("Draft: confirm", who
  proposed it, the squad it will be on a small screen 52 tall, the plan, Discard and Confirm), then the modules that
  can be changed beforehand. **Archived**: a module with the dim light, "ARCHIVED ON …", where the notes and folder are,
  "Restore".
- **To review**: at the top, only when there is something, "TO CONFIRM · N" (blinking orange light) with a card per draft
  (`--raised`, the `.label` "TITAN PROPOSES A PROJECT", the monsters on their screen (the lead first: new, with the look
  its name will give it, D-102), the title, a summary line; for a project the plan in `.label` + text rows: Lead,
  Monsters, Folder, Afterwards) and the keys Confirm (orange only in the first), Edit, Discard.
- **Instructions proposal** (D-113): the same card ("IAPETUS PROPOSES A CHANGE TO THE INSTRUCTIONS", the monster on its
  screen, "CLAUDE.md of <project>", the summary with the reason), then the File `.label` row (name and folder in
  Martian Mono), the notices with the triangle in `--signal-ink` (text from third parties; file changed after the
  proposal), "WHAT CHANGES · +N −M" and the difference on the small screen of the notes' diffs (removed and added rows
  colored, "· line N ·" between the pieces, at most 360 tall and it scrolls by itself). Keys **Apply** (orange only in
  the first card, dim when the file has changed) and **Leave it**; no Edit. The same cards in the project's Folder tab,
  below "PROPOSALS FOR THE INSTRUCTIONS · N".

## Sign-in and first start
- **Sign-in**: at the top (not centered: an error or a new pane grows downward, nothing jumps) a "device" (`.device`: a
  `--raised` cap with four screws in the corners): at the top the `.label` "SIGN-IN" (or "FIRST POWER-ON") and a light
  with the state word (waiting, checking, refused, awake; during the check the dashes run in place of the light); then
  a big screen with the squad lead **asleep** and a line of light ("THE SQUAD IS ASLEEP"); below the title, the recessed
  fields and the "Sign in" key. The last email used is remembered (in this browser) and then the focus goes to the
  password. When sign-in succeeds the monster wakes up (happy, 600 ms, "task done" sound if sounds are on) and you go
  in (`login`/`setup` accept `beforeEnter`). A refused password or a missing field: the monster makes the error face for
  1.4 s, then falls asleep again. "I forgot my password" opens a recessed pane with the two roads (app, terminal), which
  scrolls into view and takes the focus.
- **First start** (power-on sequence): below the rail (wordmark in Doto, a row of lights for the steps: green done,
  slowly blinking orange the one in progress, a dashed ring for the model left for later; on the phone only the lights;
  on the right a small "SIGN OUT") each step sits in a big module (`--panel`, radius 18, seam) anchored at the top, with
  the step's `.label` and `01 / 04` at the head. Four steps: **Model**, **About you** (the questions), **What they can
  do** (the permissions), **Squad**. A single orange key per step: the OpenRouter key has "Verify and continue"
  (verifies and goes on), "I'll do it later" disappears as soon as there is a model. The guide speaks from a screen with
  its monster: the sentence in Martian Mono `--screen-ink` with the block cursor, the hint below in `--screen-muted`.
  Options as keys with the light, progress as a strip of segments in a well, the proposed monsters on their screens with
  the actions at the bottom of the card, each with its name under the icon (Tasks, Name, Look, Remove). When the squad is
  born every monster **lights up dot by dot** on its screen (`DotReveal`: `dotGrid` + `dotPalette`, random order from
  the seed, ~700 ms, one after the other, the squad lead first), with a "tick" for each monster and the "task done"
  sound at the last if sounds are on; "POWER-ON n/N" counts (with the dashes running, then the green light) and every
  monster lit is "AWAKE". With "Reduce motion" the monsters are already lit. Then the squad lead says hello.

## Sounds (off by default)
Synthesized with WebAudio, no files: key click (8 ms filtered noise), lever (two lower clicks), question light (two
short tones 880/1320 Hz), task done (three flat ascending tones). Low volume, no sounds if the window isn't in the
foreground, never more than one sound every 120 ms.

## The dot monsters
The drawing is generated by `packages/monster-kit` (`renderDots`) from the **same genome** as today: the monsters
already created change their look without migrations. Rules in numbers in the "Dot creatures" section of
`docs/monsters/STYLE.md`.
- A grid of dots (a fixed size for all, an odd width to have a central column), three levels of light: full, dimmed
  (belly, spots, shadows), off. The eyes are unlit "holes" with a white reflection dot. Parts with a second color
  (horns, crests) from `palette.accent`.
- Color: the monster's light from `palette.hue` (light, saturated OKLCH, converted to hexadecimal), ≥ 3:1 on the screen;
  the unlit dots are `--screen-off`.
- **Frame-by-frame expressions**: rest (with blinking), talk (mouth in 2-3 frames), think (eyes up, thought dots rising),
  happy (arched eyes, a one-dot hop), error (X eyes, flicker), **asleep** (closed eyes, 50% light, rising "z": when the
  monsters are stopped). CSS animations in `steps()` on the frame groups; rhythm and delays from the seed, so two
  monsters don't blink together.
- Performance: one SVG per monster, circles without filters; off-screen monsters and the messages' avatars don't animate
  (the strips do: at rest they blink, they are only `visibility` changes); "Reduce motion" leaves the first frame.
- In the terminal: `renderDotsText` prints the same monster with half blocks and 24-bit ANSI colors.

## Text glossary
One word per concept, everywhere (UI, core messages, desktop app notifications):
| Concept | Say | Don't say |
|---|---|---|
| Who coordinates | **squad lead** ("Your squad lead") | orchestrator, coordinator |
| History of what happens | **Activity** | Log, Action log, record |
| The user's memory | **notes** (Obsidian only for compatibility) | vault, second brain |
| The stop | **Stop** / **Resume** | Kill, Halt, Stop everything |
| Where Monsters runs | **computer** ("This computer", "Home PC") | PC, core, engine, server |
| Anthropic subscription | **Claude subscription** (Claude Code in the details) | Claude Agent |
| A monster's terminal | **Behind the scenes** (tooltip "terminal") | Terminal as a label |
| The model that thinks | **model** | provider, LLM |
| The squad's quick decisions (System 1) | **instinct** ("the squad's instinct"; "Instinct" module in Squad) | System 1, DecisionGate, gate, classifier |
| The account of a job | **receipt** ("Undo the whole job") | report, log of the run |
| The monsters' results per model | **report card** ("The monsters' report card") | scorecard, benchmark |
| A use of the instinct that for now only takes notes | **on trial** | trial, beta, shadow |
| A use that looks and writes what it would have done, changing nothing | **only notes** | shadow, shadow mode |
| A checked and complete job | **really done** | verified |
| A monster that repeats the same actions | **going in circles** / **changing course** | stuck, loop |
| The actions that leave the computer, stopped to ask | **brake** (in Activity) | outbound, gate |
| Undoing every note a job touched | **Undo the whole job** | undo run, rollback |
| How much the monsters can spend | **spending cap** ("Raise the cap") | budget, cap, cost limit |
| How much of the model's working memory the conversation takes up | **context** ("Context", "compacts here") | context window, token budget |
| A monster's tokens, costs and cap | **usage** ("Titan's usage") | consumption, metrics |
| A program's tools that changed and are held | **paused** ("Paused tools", "Accept") | rug pull, quarantine, pin |
| The space on the right with preview, terminal and usage | **right-hand pane** ("Preview", "Behind the scenes", "Usage" tabs) | dock, inspector, right sidebar |
| An HTML page made by a monster, closed | **page** "in a closed box" | artifact, sandbox, iframe |
| A job the squad does by itself at a set time | **automation** ("New automation") | routine, job, cron |
| A squad with its own lead, folder, notes and cap | **project** ("New project", "Stop project") | workspace, team |
| Who leads a project | **lead** ("Project lead") | head, orchestrator |
| What a monster proposes and waits for a tap | **draft** ("To confirm", "Confirm", "Discard") | pending proposal |
| One time an automation runs | **run** ("Run now", "the runs") | execution |
| Images and documents sent or created | **files**, **attachments** ("Attach a file", the "Files" section) | upload, asset |

"Jev" and "TypeSafe" appear only as the engine's name in the "Who decides" row and in the technical details (D-067).

The texts of "Sign in with ChatGPT" stay the official ones (D-005). Uppercase monospace labels are short (1-3 words);
sentences stay in normal lowercase.
