# Animazioni dei mostri

`renderMonster` produce un SVG statico già pronto da animare; `monsterCss` (esportato da `@monsters/monster-kit`) è il
foglio di stile che lo anima. Si include una volta nella pagina (`<style>{monsterCss}</style>`). Senza il CSS il
mostro resta fermo e corretto.

## Come è fatto l'SVG
- Radice `<svg data-monster="…" data-expression="idle|talk|think|happy|error">`, con tre variabili nello `style`:
  `--m-bounce` e `--m-speed` (personalità del genoma, 0–1) e `--m-phase` (sfasamento dal seed, così due mostri vicini
  non respirano né sbattono le ciglia insieme).
- Ogni parte che si muove ha una classe fissa e il suo perno in `transform-origin` (unità della `viewBox` 200 × 200):

| Classe | Cosa | Perno |
|---|---|---|
| `m-body` | tutto il mostro tranne l'ombra (respiro, saltelli, tremito) | centro dei piedi, a terra (y 186) |
| `m-torso` | sagoma, pancia, macchie, riflesso | base del corpo |
| `m-shadow` | ombra a terra | centro dell'ombra |
| `m-arm-l`, `m-arm-r` | braccia | spalla |
| `m-feet` (`m-foot-l/r`) | piedi | a terra |
| `m-tail` | coda | radice sul fianco |
| `m-topper` | ciuffo, antenna, cresta, geyser | radice in cima alla testa |
| `m-face`, `m-mouth` | viso; bocca | cima della testa; centro del labbro superiore |
| `m-eyes`, `m-eye0…2` | occhi | centro dell'occhio |
| `m-pupil` | iride, pupilla e riflessi (con `--m-look`: quanto può spostarsi) | — |
| `m-lid` | palpebra, chiusa a `scale(1 0)` finché il CSS non la apre | bordo alto dell'occhio |
| `m-brow`, `m-cheeks`, `m-fx` | sopracciglia, guance, bolle di pensiero o goccia di sudore | — |

`m-root` porta l'eventuale `transform` di adattamento alla tela: non va animato.

## Cosa fa `monsterCss`
Solo `transform` e `opacity`. Durate moltiplicate da `--m-k = 1.3 − 0.6 · speed`, ampiezze da
`--m-amp = 0.4 + 1.2 · bounce`.

| Espressione | Movimento |
|---|---|
| sempre (idle) | respiro lento; battito di ciglia irregolare (uno singolo, poi uno doppio, ciclo di ~6 s); sguardo che gira piano a sinistra e a destra; coda e ciuffo che ondeggiano |
| parla | la bocca si apre e si chiude (`scaleY` dal labbro), il braccio destro gesticola |
| pensa | dondolio lento, le tre bolle compaiono una dopo l'altra |
| felice | saltelli con schiacciamento all'atterraggio, ombra che si stringe, braccia che salutano, coda veloce |
| errore | breve scossa e poi pausa, pupille che tremano, goccia di sudore che scivola |

Il cambio di espressione è un nuovo render (cambia `data-expression`). Con `prefers-reduced-motion: reduce` tutte le
animazioni sono spente: resta solo il cambio di espressione, e gli occhi restano aperti (palpebre ridotte a zero).

## Note per la UI
- L'SVG ha `overflow: visible` (dal CSS): il saltello di Titan esce di qualche unità dalla tela, il contenitore non
  deve tagliarlo.
- Un'animazione nuova va scritta su queste classi, mai sugli elementi interni: la struttura interna può cambiare.
- `team.html` in questa cartella è una prova dal vivo: apre il foglio con il CSS incluso.
