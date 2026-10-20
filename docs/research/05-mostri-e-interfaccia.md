# 05 · Mostri e interfaccia: tecnologia

> Ricerca del 14/10/2026. Tema: come disegnare, animare e generare i mostri; camminata sulla dashboard; glassmorphism stile Apple; stack frontend.
> Riferimento di stile: `bozze/monsters-first.png` (filigrana Magnific/Freepik: **solo riferimento**, non va usato, ricalcato o dato in input img2img).

---

## 0. In sintesi

- **Mostri = SVG parametrici** ("genoma" JSON → parti vettoriali combinate e colorate), animati con **CSS/WAAPI + Motion**. È l'unica opzione che soddisfa insieme: stile del riferimento, leggerezza con 7+ mostri, animazioni condivise da tutti i personaggi, **generazione automatica di nuovi mostri da un agente AI** senza un designer, ricolorazione, licenze pulite (tutto MIT o nostro).
- **Lottie e Rive** sono ottimi per un *singolo* personaggio disegnato a mano, ma ogni nuovo mostro richiede lavoro in un editor: non scalano sulla generazione automatica. Rive in più chiede un piano a pagamento per esportare.
- **3D (img2threejs, Blender + three.js)** perde il look "cartoon con contorno scuro" se non con molto lavoro (toon shading + outline), pesa di più e rende difficile generare mostri nuovi. Da tenere solo per eventuali vetrine 3D, non per la dashboard.
- **Camminata**: motore nostro molto piccolo (rAF + steering: wander, arrive, separazione, evitare i rettangoli della UI) su un livello "habitat" sopra la dashboard. Niente fisica. PixiJS solo se un giorno i mostri a schermo diventano decine.
- **Vetro**: tre livelli. Base `backdrop-filter` ovunque; rifrazione SVG (Liquid Glass) solo su pochi elementi e **solo dove gira Chromium** (Safari e WebKitGTK non la supportano). Contrasto ≥ 4.5:1 garantito da un velo opaco e un'opzione "riduci trasparenza".
- **Stack**: React 19 + Vite 8 + TypeScript + Tailwind 4 + componenti shadcn (Bubble, giugno 2026) + Motion. Terminale per agente: **log formattato** di default, **xterm.js 6** solo per output di shell vero.

---

## 1. Cosa definisce lo stile di riferimento

Guardando l'immagine, lo stile si scompone bene in regole, quindi è riproducibile in codice:

| Elemento | Regola osservata | Come si traduce in SVG |
|---|---|---|
| Contorno | Spesso, scuro, tinta del corpo molto scurita (non nero puro) | `stroke` = colore corpo in OKLCH con L≈0.25, larghezza ~2.5% dell'altezza |
| Colore | Pieno, saturo, 1 tinta dominante per mostro | Palette generata in OKLCH: base, ombra (L −0.12), luce (L +0.08) |
| Volume | Sfumatura morbida radiale, luce in alto a sinistra | `radialGradient` condiviso, centro a (35%, 30%) |
| Riflesso | Ellisse bianca semitrasparente sul "cranio" | Path fisso con `opacity .35–.5` |
| Occhi | Grandi, bianchi, iride colorata, riflesso; 1–3 occhi, a volte su antenne | Parte "occhi" con varianti: 1 ciclope, 2, 3, peduncoli |
| Bocca | Ampia, interno rosso scuro, lingua rosa, denti/zanne triangolari | Varianti bocca + slot zanne |
| Pancia | Ovale di colore contrastante (complementare o chiaro) | Parte "pancia" opzionale |
| Accessori | Corna a strisce, ciuffo, aculei dorsali, coda, macchie, orecchie lunghe | Parti opzionali con punti di aggancio |
| Base | Ombra ellittica viola a terra, zampe corte | Ombra fissa + parte "zampe" |
| Proporzioni | Corpo a goccia/fagiolo/pera, testa = corpo, 1:1 circa | 6–8 sagome base deformabili |

Conclusione: è uno stile **vettoriale 2D a parti**. Gli stessi 10–12 "slot" bastano per tutti e 6 i mostri di riferimento: è la prova che un sistema parametrico funziona.

---

## 2. Confronto tecnologie per i mostri

Voti da 1 (scarso) a 5 (ottimo).

| Tecnologia | Qualità nello stile | Peso / prestazioni con 7+ mostri | Produrre idle/walk/talk/think per molti | Generare nuovi mostri in automatico | Ricolorare | Strumenti | Licenza |
|---|---|---|---|---|---|---|---|
| **SVG parametrico + CSS/WAAPI/Motion** | 4–5 (stile vettoriale nativo) | 5: pochi KB per mostro, DOM leggero, solo `transform` | 5: animazioni scritte **una volta** per slot, valgono per tutti | **5**: un LLM compila un JSON valido | 5: variabili CSS | Editor di testo, Figma/Inkscape per le parti | Nostra (MIT) |
| **Lottie** (lottie-web / dotLottie + ThorVG) | 5 se animato da un animatore | 3–4: JSON spesso grande; dotLottie ora ha WebGL/WebGPU ([LottieFiles, mag 2026](https://lottiefiles.com/blog/working-with-lottie-animations/hardware-accelerated-lottie-on-the-web-dotlottie-web-now-ships-webgl-webgpu)) | 2: ogni personaggio va animato in un editor (After Effects o Lottie Creator) | 2: Lottie Creator ha Motion Copilot e un server MCP ([Creator](https://lottiefiles.com/creator)), ma il risultato è da rifinire | 4: slot e temi colore (`setColorSlot`, `setTheme`) ([docs](https://docs.lottiefiles.com/en/runtimes/distributions/js/v0.x/core-concepts/theming)) | Lottie Creator (web) o AE | Runtime MIT; editor proprietario |
| **Rive** | 5 (il migliore per personaggi interattivi) | 4–5: file molto piccoli, WASM ~261 KB brotli ([Rive docs](https://rive.app/docs/runtimes/web/migrating-from-v1-to-v2)); un canvas per istanza | 3: state machine ottima, ma ogni mostro va rigato e animato nell'editor | 2: esistono MCP comunitari ([RiveMCP](https://glama.ai/mcp/servers/paradoxsyn/rivemcp-releases)), immaturi | 5: data binding con proprietà colore ([docs](https://rive.app/docs/runtimes/react/data-binding)) | Editor Rive (proprietario, cloud) | Runtime MIT ([npm](https://npmjs.com/package/@rive-app/canvas)); **export per runtime solo da piano Cadet**, 17 $/mese o 108 $/anno per posto ([pricing](https://rive.app/docs/account-admin/pricing.md)) |
| **img2threejs** (procedurale Three.js) | 2–3: 3D "plastico", contorno cartoon da aggiungere (outline pass/toon) | 2–3: three.js pesa centinaia di KB; una scena WebGL condivisa regge 7 mostri, ma serve GPU | 3: le parti sono in codice, le animazioni si scrivono a mano | 3: codice procedurale generabile da un LLM, ma ogni mostro è un progetto di ricostruzione con controlli visivi | 4: materiali | Skill `img2threejs`, browser per verifica | Apache-2.0 (skill), MIT (three.js) |
| **Blender** (glTF con rig + three.js / R3F) | 3–4 con toon shader + Freestyle/outline, molto lavoro | 2: glTF animati 0.5–3 MB l'uno, skinning su GPU | 2: rig e animazioni per ogni mostro (le azioni si possono riusare solo con rig uguali) | 1–2: script Python bpy per mesh parametriche possibile ma complesso | 4 | Blender 5.2, RTX 3070 ok | GPL lo strumento, asset nostri |
| **Sprite sheet** (PNG/WebP a fotogrammi) | 4–5 se disegnati bene | 3: leggero a runtime, pesante come asset (fotogrammi × stati × mostri), sfocato su schermi HiDPI se piccolo | 1–2: ogni fotogramma va disegnato o generato; coerenza tra fotogrammi difficile anche con i modelli 2026 ([Sprite Sheet Diffusion](https://arxiv.org/html/2412.03685v2)) | 2: modello di immagini + video, qualità variabile | 1: niente ricolorazione | Modello di immagini, editor | Dipende dal modello |

**Raccomandazione**: SVG parametrico. Lottie e Rive restano opzioni per un eventuale **mostro "eroe"** (l'orchestratore) animato a mano in Fase 3+, se si vuole un livello in più di espressività. Il 3D non conviene per la dashboard.

---

## 3. Generare mostri nuovi in modo programmatico

| Approccio | Come funziona | Coerenza di stile | Robustezza | Costo | Animabile? |
|---|---|---|---|---|---|
| **A. Kit parametrico SVG ("genoma")** | Libreria di parti vettoriali disegnate una volta (corpo, occhi, bocca, corna, orecchie, zampe, braccia, coda, pancia, macchie, aculei, ciuffo). Un JSON sceglie parti, proporzioni e colori | **Garantita** dalle parti | **Alta**: lo schema JSON valida tutto, nessun output rotto | Zero a runtime | **Sì**, ogni slot ha pivot e animazioni |
| B. Modello di immagini + vettorizzazione | Prompt di stile → immagine → SVG (Recraft V4 genera SVG direttamente, ~0.08–0.30 $ per immagine via [OpenRouter](https://openrouter.ai/recraft/recraft-v4-pro-vector); oppure vectorizer.ai/vtracer) | Media: deriva tra un'immagine e l'altra | Bassa: SVG con centinaia di path senza struttura | API a pagamento, serve rete | **No**: path "piatti", niente parti separate da animare |
| C. Mesh 3D parametrica | Codice Three.js (stile img2threejs) o bpy con primitive deformate | Media | Media | GPU | Sì, ma pipeline pesante |
| D. Modello di immagini + sprite sheet | Immagine base → video AI → fotogrammi | Bassa tra i fotogrammi | Bassa | Alto | Solo i loop generati |

**Scelta: A**, con B solo come **aiuto creativo** in fase di design (bozze di concept da cui ridisegnare le parti, mai asset finali).

### Come funziona il kit parametrico

```jsonc
// MonsterGenome v1 (validato con JSON Schema / zod)
{
  "id": "enceladus",
  "seed": 48213,                       // hash del nome: stesso nome → stesso mostro
  "body":   { "shape": "pear", "w": 1.0, "h": 1.1 },   // 6–8 sagome base
  "palette":{ "hue": 200, "chroma": 0.12, "belly": "light" }, // OKLCH; il resto si deriva
  "eyes":   { "kind": "stalk", "count": 2, "iris": "complement", "size": 1.1 },
  "mouth":  { "kind": "grin", "teeth": "fangs-2" },
  "horns":  { "kind": "curved", "stripes": true } ,   // o null
  "ears": null, "tail": { "kind": "spiky" }, "arms": "stubby", "feet": "claws",
  "marks":  { "kind": "spots", "density": 0.3 },
  "topper": { "kind": "geyser-tuft" },              // ciuffo, antenna, cresta
  "personality": { "bounce": 0.7, "speed": 0.9 }    // influenza le animazioni
}
```

- **Parti**: ogni parte è un componente SVG con **punti di aggancio** definiti sulla sagoma (es. `eyeAnchor`, `hornL`, `tailRoot`) e un **pivot** per l'animazione. Le sagome del corpo espongono gli ancoraggi in coordinate normalizzate, così ogni combinazione si incastra.
- **Colori**: si genera solo la tinta; ombra, luce, contorno, pancia e iride si derivano in OKLCH con regole fisse. Questo mantiene l'armonia del riferimento (colore pieno + contorno scuro della stessa tinta) e permette il cambio colore in un clic. Contorno: stessa tinta, L≈0.25.
- **Generatore**: tool `design_monster` dell'orchestratore. L'LLM riceve ruolo e nome dell'agente e restituisce un genoma **con output strutturato vincolato allo schema** (enum delle parti, intervalli numerici). Il codice valida, corregge i valori fuori range, controlla che la tinta sia diversa da quelle già usate (distanza ≥ 30° di hue) e mostra l'anteprima. L'utente può cambiare colore, rigenerare o modificare le parti.
- **Senza LLM** (fallback): genoma casuale deterministico dal `seed`, come fa [DiceBear](https://www.dicebear.com/) con gli avatar (stesso seed → stesso avatar; core MIT, ogni stile con la sua licenza).
- **Controllo qualità opzionale**: render dell'SVG in PNG (resvg) e verifica visiva con un modello multimodale ("le parti si sovrappongono male?"). Utile nel nostro processo di design, non necessario a runtime.
- **Numeri**: con 8 corpi × 6 occhi × 6 bocche × 5 corna × 4 code × 5 accessori × colori continui ci sono decine di migliaia di combinazioni.

### Animazioni condivise (poche ma buone)

Tutte scritte una volta sugli slot, con `transform` e `opacity` soltanto (GPU, niente reflow):

| Stato | Animazione |
|---|---|
| idle | respiro (corpo `scaleY` 1→1.03 con origine ai piedi), battito di ciglia casuale (palpebra `scaleY`), occhi che guardano intorno |
| walk | rimbalzo + squash & stretch, zampe alternate (rotazione ±15°), leggera inclinazione nella direzione |
| talk | bocca che si apre e chiude a ritmo del fumetto, sopracciglia su |
| think / lavora | occhi in alto, "…" o ingranaggio sopra la testa, ondeggiamento lento |
| festeggia | saltello con braccia su, coriandoli (pochi) |
| errore | tremolio orizzontale, colore leggermente desaturato, goccia di sudore |

Il parametro `personality` modula ampiezza e velocità: stesse animazioni, carattere diverso per ogni mostro. Con `prefers-reduced-motion` restano solo battito di ciglia e cambi di espressione.

---

## 4. Camminata sulla dashboard

### Architettura

- **Livello "habitat"**: un `div` assoluto sopra la dashboard con `pointer-events: none`; i mostri hanno `pointer-events: auto`. Ogni mostro è un elemento posizionato solo con `transform: translate3d()`.
- **Zone percorribili**: di default una "striscia pavimento" in basso e gli spazi vuoti della griglia. Le aree della UI (chat, pannelli, input) si leggono con `getBoundingClientRect` + `ResizeObserver` e diventano **rettangoli da evitare**. Niente pathfinding a griglia: con rettangoli e pochi agenti basta lo steering.
- **Motore** (~150 righe, nostro): un unico loop `requestAnimationFrame` con `dt` fisso. Comportamenti "steering" alla Reynolds:
  - `wander` (passeggio casuale con pause frequenti: un mostro sta fermo 60–70% del tempo, così è vivo ma non distrae);
  - `arrive` (rallenta vicino alla meta);
  - `separation` (non si accavallano tra loro);
  - `avoid rects` (repulsione dai bordi delle aree UI e dei bordi schermo);
  - meta speciale: quando un agente lavora va verso "la sua postazione" o verso il pannello della chat in cui sta scrivendo.
- **Macchina a stati per mostro**: `idle → walk → idle`, eventi dall'agente (`talk`, `think`, `done`, `error`) hanno priorità. Il fumetto ("Sto cercando i voli…") viene dal riassunto di una riga che l'agente emette; dura 3–5 s, al massimo 2 fumetti a schermo insieme.
- **Interazione**: hover = il mostro si ferma e guarda il cursore; clic = apre il terminale/log dell'agente; trascinamento opzionale per spostarlo. Ogni mostro è un `button` con `aria-label` ("Rhea, sta scrivendo un post") e c'è una lista testuale equivalente per tastiera e screen reader.
- **Ispirazione**: i "desktop pet" Shimeji usano proprio una macchina a stati con comportamenti a tempo ([shimeji-ee](https://github.com/gil/shimeji-ee)).

### Librerie

| Libreria | Uso per Monsters | Licenza | Verdetto |
|---|---|---|---|
| **Motion** (ex Framer Motion, v12) | animazioni delle parti, molle, `AnimatePresence` per fumetti e pannelli | MIT ([OpenReplay](https://blog.openreplay.com/motion-vs-gsap/)) | **Sì** |
| GSAP 3.15 | timeline complesse, MorphSVG | Gratuita ma **proprietaria** (Webflow): vieta l'uso in strumenti visivi di animazione no-code concorrenti ([licenza](https://gsap.com/standard-license/)) | Evitare nel core open source; non serve |
| PixiJS v8 | rendering WebGL/WebGPU di molti sprite ([v8](https://pixijs.com/blog/pixi-v8-launches)) | MIT | Solo se servono decine di mostri; con 7–20 il DOM/SVG basta |
| Matter.js | fisica 2D | MIT | No (fisica inutile; al massimo un easter egg "lancia il mostro") |
| Yuka | steering e IA di gioco | MIT | Fermo dal 2025 ([npm](https://npmjs.com/package/yuka)); meglio 150 righe nostre |

### Prestazioni

- 7–15 mostri SVG con 40–80 nodi l'uno sono trascurabili per il browser se si animano solo `transform`/`opacity`.
- Niente `filter` o `backdrop-filter` sui mostri (costosi a ogni frame); l'ombra a terra è un'ellisse, non un `drop-shadow`.
- Loop in pausa quando la finestra non è visibile (`visibilitychange`) e a 30 fps quando l'app è in background o su batteria.
- Gradienti SVG definiti una volta in un `<defs>` condiviso, con id per mostro, per non duplicarli.

---

## 5. Glassmorphism stile Apple (Liquid Glass) nel 2026

Apple ha introdotto **Liquid Glass** con iOS 26/macOS 26 ([Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)). Sul web si imita in tre livelli:

| Livello | Tecnica | Supporto | Costo | Dove usarlo |
|---|---|---|---|---|
| **1. Vetro smerigliato** | `backdrop-filter: blur(20px) saturate(160%)`, sfondo `rgba` 55–75%, bordo 1px chiaro, `inset` shadow per il riflesso sul bordo | Tutti i browser moderni (Safari 18 senza prefisso, Firefox 103) ([web.dev](https://web.dev/articles/backdrop-filter)) | Medio: limitare il numero di livelli sovrapposti | Pannelli, sidebar, barra input, card |
| **2. Rifrazione (Liquid Glass vero)** | Filtro SVG `feDisplacementMap` richiamato da `backdrop-filter: url(#glass)` | **Solo Chromium**. Safari ignora il filtro (bug WebKit aperto dal 2022, ancora presente nel 2026: [245510](https://www2.webkit.org/show_bug.cgi?id=245510), [313914](https://bugs.webkit.org/show_bug.cgi?id=313914)) | Alto | 2–3 elementi "eroe": barra di input, dock degli agenti, interruttore tema |
| 3. Shader WebGL | Clona lo sfondo e lo deforma in un canvas | Ovunque | Alto, complesso | Non serve |

Librerie e riferimenti:
- [liquid-glass-react](https://github.com/rdev/liquid-glass-react) (MIT, ~6k stelle; ultimo push giugno 2025, conviene usarla come riferimento e scrivere il nostro componente).
- [Tutorial LogRocket su CSS + SVG](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/), [Hyalite.js](https://www.cssscript.com/svg-liquid-glass-hyalite/) (fallback CSS su Safari/Firefox), [liquid-glass-js](https://cdn.jsdelivr.net/npm/liquid-glass-js@0.1.0/README.md) ("clone mode" per Safari).

**Impatto sulla scelta dell'app desktop**: con **Electron** (Chromium ovunque) il livello 2 funziona su Linux, macOS e Windows. Con **Tauri** la webview è WebKit su macOS e WebKitGTK su Linux: niente rifrazione e `backdrop-filter` solo parziale su WebKitGTK ([confronto](https://www.youngju.dev/blog/culture/2026-05-14-tauri-2-rust-webview-desktop-mobile-electron-alternative-deep-dive-2026)). Tauri sta lavorando a un backend Chromium (CEF, [cef-rs](https://github.com/tauri-apps/cef-rs)), non ancora maturo. Va considerato nella decisione della Fase 3; in ogni caso il design deve reggere con il solo livello 1.

### Accessibilità (il punto debole di Liquid Glass)

Nelle beta di iOS 26 alcuni testi scendevano a un contrasto di **1.5:1** contro il minimo WCAG di 4.5:1 e Apple ha dovuto aumentare l'opacità ([Infinum](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/), [BGR](https://bgr.com/tech/ios-26-beta-3-liquid-glass-complaints/)). Regole per Monsters:
- Il testo non sta mai direttamente sul vetro: c'è sempre un **velo** (tema chiaro bianco ≥ 70%, scuro nero ≥ 60%) che garantisce **4.5:1** con qualsiasi sfondo; test automatico del contrasto sul caso peggiore.
- Le bubble della chat sono **piene** (colore dell'agente), non trasparenti: il vetro è per contenitori e cornici.
- `@media (prefers-reduced-transparency)` (solo Chrome/Edge 118+, [Chrome blog](https://developer.chrome.com/blog/css-prefers-reduced-transparency)) + **interruttore nell'app** "Riduci trasparenza", perché Safari e Firefox non lo leggono.
- `prefers-contrast: more` → bordi più marcati e veli opachi; `prefers-reduced-motion` → niente camminata.
- Sfondo dell'app controllato da noi (gradiente morbido con macchie di colore, tipo "wallpaper" di macOS): il vetro rende bene e il contrasto è prevedibile.

---

## 6. Stack frontend consigliato

| Area | Scelta | Perché |
|---|---|---|
| Framework | **React 19** + TypeScript | Ecosistema più grande (librerie chat, terminale, Motion, R3F se servirà); Svelte 5 e Solid sono più leggeri ma con meno componenti pronti ([confronto](https://www.pkgpulse.com/guides/solidjs-vs-svelte-5-vs-react-reactivity-2026)). Per un'app locale la differenza di peso non conta |
| Build | **Vite 8** (Rolldown, stabile da marzo 2026) + React Compiler via `@rolldown/plugin-babel` ([Vite 8](https://vite.dev/blog/announcing-vite8)) | Veloce, nessun SSR necessario (app locale) |
| Stile | **Tailwind 4** + variabili CSS per temi (chiaro/scuro) e colore di ogni agente | I token colore servono sia alle bubble sia ai mostri |
| Componenti | **shadcn/ui** (copiati nel repo) + i nuovi componenti chat Message, Bubble, MessageScroller (giugno 2026) ([changelog](https://ui.shadcn.com/docs/changelog/2026-06-chat-components)) | Bubble personalizzabili al 100%, nessuna dipendenza bloccante |
| Runtime chat (opz.) | [assistant-ui](https://designrevision.com/alternatives/assistant-ui) se servono thread, rami e tool call pronti | Valutare solo se il nostro protocollo di streaming combacia |
| Animazioni | **Motion** (MIT) | Molle e transizioni dei pannelli, animazioni dei mostri |
| Terminale agente | **Log formattato** nostro (eventi strutturati: pensiero, tool call, risultato, errore, con sezioni ripiegabili e testo semplice) + **xterm.js** (`@xterm/xterm` 6, [release](https://newreleases.io/project/npm/@xterm/xterm/release/6.0.0)) solo nella scheda "Shell" quando l'agente esegue comandi veri | Il ragionamento è testo strutturato, non un flusso ANSI: un log è più leggibile, cercabile e accessibile. xterm.js serve dove c'è un PTY |
| Stato | Zustand o store esterni + TanStack Query per le API locali | Semplice |
| Mostri | Componente `<Monster genome state />` in SVG, motore habitat nostro | Vedi sopra |

---

## 7. Raccomandazione per Monsters

### Tecnologia

| Fase | Scelta |
|---|---|
| **MVP (Fase 1)** | **SVG parametrico** con kit di parti. I 7 mostri appaiono come avatar nella sidebar e nelle bubble, più una "piazzetta" fissa in dashboard dove stanno fermi con **idle** (respiro, ciglia) e cambiano espressione per **talk / think / done / error**. Animazioni in CSS/WAAPI. Nessuna camminata. Generatore `design_monster` già attivo per gli agenti creati in onboarding |
| **Fase 2** | Stesso kit, si aggiungono: livello habitat con **camminata** (motore steering nostro), fumetti, clic → terminale, **Motion** per walk/festeggia/errore, animazioni modulate dalla personalità. PixiJS solo se un test mostra cali sotto 60 fps |
| Fase 3+ (opzionale) | Un mostro "eroe" (l'orchestratore) in **Rive** con state machine ricca, se il kit SVG risulta limitato per lui; sticker animati per Telegram (TGS/Lottie) esportati dagli stessi SVG |
| Da non fare | 3D per la dashboard (img2threejs/Blender): stile diverso, più peso, generazione difficile. Sprite sheet AI: incoerenti, non ricolorabili |

### Pipeline per i 7 mostri originali

I nomi sono **lune di Saturno**: un bel legame con Saturday Company. Ogni mostro prende un tratto dalla sua luna, così è originale e distante dai 6 del riferimento:

| Agente | Luna (tratto reale) | Idea di mostro |
|---|---|---|
| Titan | la più grande, atmosfera arancione e nebbiosa | il più grosso, arancio ambra, corona di piccole corna, aria da capo buono (orchestratore) |
| Rhea | ghiacciata, grigio-azzurra, crateri | lilla/pervinca, orecchie lunghe, macchie-cratere sulla pancia |
| Dione | scogliere di ghiaccio "a fili" | verde menta, coda a pennacchio con strisce chiare |
| Tethys | enorme canyon (Ithaca Chasma) | rosa corallo, bocca larghissima a "canyon", due zanne |
| Enceladus | bianca brillante, geyser dal polo sud | azzurro ghiaccio, ciuffo-geyser sulla testa, occhi su antenne |
| Hyperion | spugnosa e irregolare | giallo senape con macchie scure "a spugna", sagoma asimmetrica |
| Mimas | cratere Herschel che sembra un occhio gigante | il più piccolo, **ciclope** con un occhio enorme, viola scuro |

Passi:

1. **Style bible** (1 pagina): regole della sezione 1 in numeri (spessore contorno, gradiente, riflesso, ombra, proporzioni, palette OKLCH). Descrive lo stile senza usare l'immagine di riferimento come asset.
2. **Concept**: per ogni mostro 3–4 bozze. Si possono fare a mano o con un modello di immagini **solo da testo** (mai img2img sul riferimento); sceglie il maintainer. Nota: le immagini generate solo da prompt non sono proteggibili dal diritto d'autore negli USA ([Copyright Office, parte 2](https://copyrightalliance.org/ai-report-part-2-copyrightability/)); per questo l'asset finale va **ridisegnato** come parti SVG nostre, che sono anche ciò che ci serve tecnicamente.
3. **Kit di parti**: disegnare in SVG (Figma o Inkscape, oppure direttamente in codice) 8 corpi e le varianti di occhi, bocche, corna, orecchie, code, zampe, braccia, pancia, macchie, accessori, con ancoraggi e pivot.
4. **Genomi dei 7**: scritti a mano a partire dai concept, con tinte distanti tra loro. Foglio di anteprima con tutti e 7 in ogni stato, tema chiaro e scuro, a 32, 64 e 160 px.
5. **Rig e animazioni**: animazioni per slot (sezione 3), provate su tutti e 7 insieme.
6. **Componente e asset**: `<Monster>` in React; export statici SVG/PNG per avatar, favicon, Telegram e README.
7. **Generatore**: tool `design_monster` (schema vincolato + validazione + anteprima + "rigenera/cambia colore") per gli agenti creati dall'utente; fallback deterministico dal nome.
8. **Controllo**: test visivi (snapshot dei 7 in ogni stato) e test del contrasto delle bubble col colore di ogni agente.

### Fonti principali

- Lottie/dotLottie: https://lottiefiles.com/blog/working-with-lottie-animations/hardware-accelerated-lottie-on-the-web-dotlottie-web-now-ships-webgl-webgpu · https://docs.lottiefiles.com/en/runtimes/distributions/js/v0.x/core-concepts/theming · https://lottiefiles.com/creator
- Rive: https://rive.app/docs/account-admin/pricing.md · https://rive.app/docs/runtimes/web/migrating-from-v1-to-v2 · https://rive.app/docs/runtimes/react/data-binding · https://www.rive.app/blog/rive-as-a-lottie-alternative · https://callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation
- Generazione: https://www.dicebear.com/ · https://openrouter.ai/recraft/recraft-v4-pro-vector · https://invideo.io/blog/recraft-ai-image-generator/ · https://arxiv.org/html/2412.03685v2 · https://www.recraft.ai/blog/best-image-vectorizers
- Animazione e movimento: https://blog.openreplay.com/motion-vs-gsap/ · https://gsap.com/standard-license/ · https://pixijs.com/blog/pixi-v8-launches · https://npmjs.com/package/yuka · https://github.com/gil/shimeji-ee
- 3D: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide · https://www.utsubo.com/blog/webgpu-threejs-migration-guide · https://blenderartists.org/t/grease-pencil-lottie-lottie-animation-workflow-svg-blender-lottie/1638956
- Vetro e accessibilità: https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ · https://web.dev/articles/backdrop-filter · https://www2.webkit.org/show_bug.cgi?id=245510 · https://bugs.webkit.org/show_bug.cgi?id=313914 · https://github.com/rdev/liquid-glass-react · https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/ · https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/ · https://developer.chrome.com/blog/css-prefers-reduced-transparency
- Stack e desktop: https://vite.dev/blog/announcing-vite8 · https://ui.shadcn.com/docs/changelog/2026-06-chat-components · https://designrevision.com/alternatives/assistant-ui · https://newreleases.io/project/npm/@xterm/xterm/release/6.0.0 · https://www.pkgpulse.com/guides/solidjs-vs-svelte-5-vs-react-reactivity-2026 · https://www.youngju.dev/blog/culture/2026-05-14-tauri-2-rust-webview-desktop-mobile-electron-alternative-deep-dive-2026 · https://github.com/tauri-apps/cef-rs
- Diritto d'autore: https://copyrightalliance.org/ai-report-part-2-copyrightability/

> Note di affidabilità: i dati di prestazione di Rive e LottieFiles sono dichiarati dai produttori; i prezzi di Recraft variano tra le fonti (verificare prima dell'uso); il supporto di `backdrop-filter: url()` su Firefox va testato.
