# Stile dei mostri (style bible v0)

Regole in numeri del kit `packages/monster-kit`. Il riferimento di stile esterno (non incluso nel repo) è di terzi: se
ne prende solo il linguaggio visivo (contorno scuro della stessa tinta, colore pieno, sfumatura morbida, riflesso,
occhi grandi e lucidi, zanne, pancia chiara, ombra a terra, proporzioni tozze). Nessuna forma viene ricalcata: ogni
parte è disegnata in codice. Unità: la tela è un `viewBox` di **200 × 200**; `a` è la semilarghezza del corpo, `H` la
sua altezza.

## Tela e costruzione
- Terra a **y = 186**, centro a x = 100, margine 5. Se una parte esce dalla tela, tutto il mostro si scala attorno al
  punto a terra (non si taglia mai niente).
- Ordine dei livelli: ombra, coda, orecchie, corna, ciuffo, antenne degli occhi, piedi, braccia, **corpo**, pancia,
  macchie, riflesso, bocca, occhi, effetti.
- Tutto ciò che è attaccato (corna, orecchie, coda, braccia, piedi, antenne) sta **dietro** il corpo e ci entra con la
  radice: il contorno del corpo copre la giunzione, quindi non esistono parti staccate.
- Testa e corpo sono una cosa sola. Sagome: `blob`, `egg`, `pear`, `bean`, `dome`, `lumpy` (asimmetrica), larghezza
  di base 92–112 unità, moltiplicatori `w` e `h` da 0.7 a 1.3. Titan è il più grande, Mimas il più piccolo.

## Contorno
- Spessore **3.8** (1.9% della tela, circa 3% dell'altezza del corpo); occhi e bocca **2.3–3.4**; denti, artigli e
  dettagli fini **1.8**. Giunzioni e terminali arrotondati.
- Colore: la **stessa tinta del corpo**, OKLCH con **L 0.22–0.30** e **C ≤ 0.085**. Mai nero puro, mai un contorno di
  un'altra tinta (anche corna e ciuffi usano il contorno del corpo).

## Colore (OKLCH, una sola tinta)
Il genoma dà solo `hue`, `chroma` (0.04–0.20) e `lightness` (0.45–0.85); tutto il resto si deriva e si converte in
sRGB esadecimale, riducendo il croma se il colore esce dalla gamma.

| Ruolo | Regola |
|---|---|
| Base | L, C, h |
| Luce | L + 0.09, C × 0.92, h − 6 |
| Ombra | L − 0.16, C × 1.08, h + 6 |
| Contorno | L − 0.47 (limitato a 0.22–0.30), C × 0.75 (max 0.085) |
| Pancia chiara | L + 0.16 (0.80–0.95), C × 0.42, stessa h |
| Pancia a contrasto | L + 0.14, C ≤ 0.11, h + 55 |
| Macchie | L − 0.17, C × 1.05 |
| Accento (corna, cresta, artigli) | crema 0.93 / 0.05 / 88, oro 0.84 / 0.14 / 82, analogo h + 38, complementare h + 180, tono L + 0.12 |
| Bocca, lingua, guance | 0.33 / 0.11 / 18, 0.72 / 0.13 / 8, 0.72 / 0.14 / 15 al 55% |
| Ombra a terra | 0.32 / 0.04 / 290 al 20% |

**Distanza tra i mostri:** almeno **30° di hue** tra due mostri dello stesso team. Il test lo verifica sui 7 in ogni
combinazione A/B; il generatore riceve le tinte già usate (`avoidHues`).

| Titan | Rhea | Dione | Tethys | Enceladus | Hyperion | Mimas |
|---|---|---|---|---|---|---|
| 62 / 55 | 280 / 272 | 165 / 160 | 22 / 18 | 222 / 215 | 100 / 95 | 315 / 312 |

## Volume, riflesso, ombra
- **Sfumatura:** gradiente radiale per ogni parte, centro (40%, 32%), fuoco (34%, 24%), raggio 78%: luce → base al
  55% → ombra al bordo. La luce viene sempre dall'alto a sinistra.
- **Riflesso:** ellisse bianca 0.17a × 0.075H ruotata di −38°, opacità 0.42, al 24% della larghezza e al 16%
  dell'altezza, più un puntino di 0.045a al 50%.
- **Ombra a terra:** ellisse piatta (ry 7, rx pari al 52% della larghezza del corpo + 6). Niente filtri né
  `drop-shadow`.

## Proporzioni del viso
- Occhi a **34%** dell'altezza (ciclope 38%); bocca a **57%**, sempre ad almeno 6–7 unità sotto gli occhi.
- Due occhi: raggio **0.205a** (diametro circa 1/5 della larghezza del corpo); ciclope **0.36a**; su antenne
  **0.25a**. Iride 60% del raggio, pupilla 55% dell'iride, riflesso principale 30% dell'iride in alto a sinistra più
  uno secondario del 13%. Bianco con una sfumatura leggera verso il bordo.
- Bocca aperta: interno rosso scuro, lingua rosa, denti bianchi con contorno fine. Il **labbro superiore è una curva a
  sorriso**, mai una riga dritta: angoli sollevati del 45% dell'avvallamento, centro più basso del 9% (grin) o 11%
  (canyon) della larghezza. Zanne e denti partono dalla curva e ne seguono la pendenza. Le bocche larghe (oltre 0.75a)
  hanno due piccole pieghe a virgola agli angoli.
- Pancia: ovale al 73% dell'altezza, largo 66% della sagoma, ritagliato dal corpo. **La bocca sta tutta dentro la
  pancia con 3.5 unità di margine, oppure tutta sopra**: prima la pancia cresce (in alto e di lato, senza salire oltre
  gli occhi); se non basta, la bocca si limita a finire entro l'80% dell'altezza e la pancia scende sotto di lei. Il
  controllo vale per tutte le espressioni (la bocca aperta di «felice» e «parla» compresa).
- Occhi su antenne: la bocca è più grande del 18% e porta sempre le guance rosa (più tenui), perché sotto le antenne
  resti un muso; in «parla», «pensa» ed «errore» le sopracciglia stanno sopra gli occhi sulle antenne.
- Piedi: ellissi 0.29a × 9.5 che sporgono sotto il corpo; braccia corte (0.44a, lunghe 0.66a) che escono dai fianchi.
- Cornini (`nubs`): coni tozzi e separati, ciascuno con il suo riflesso, che escono lungo la normale della testa
  (metà verso l'alto) e si aprono a corona su un arco di ±(34 + 4n)°.
- Coda a pennacchio: sagoma morbida che si arriccia verso la testa, bordo a ciuffi (archi con piccole tacche ogni
  0.26a) e punta tonda; le strisce chiare sono bande trasversali incurvate verso la punta, non venature.

## Espressioni
| Stato | Occhi | Bocca | Altro |
|---|---|---|---|
| idle | aperti, sguardo appena in basso | quella del genoma | braccia a riposo |
| talk | aperti | ovale aperto con lingua | un braccio che gesticola |
| think | in alto, dal lato opposto alla coda; un sopracciglio | piccola linea storta | tre bolle di pensiero, lontano dalla coda |
| happy | chiusi ad arco | grande sorriso aperto | guance rosa, braccia in alto |
| error | pupille piccole, sopracciglia preoccupate | linea a zig-zag | colore desaturato, goccia di sudore (lontano dalla coda), braccia aperte |
| sleep | chiusi ad arco (come happy) | quella del genoma | lo stato "fermo" delle creature a punti; nel lucido chiude solo gli occhi |

Le animazioni (respiro, ciglia, sguardo, parlare, saltelli) sono in `ANIMAZIONI.md`.

## Leggibilità
A 64 px il contorno vale circa 1.2 px e il mostro resta riconoscibile (sagoma, occhi, bocca, colore); a 32 px
restano sagoma, occhi e colore. Nessun dettaglio sotto 1.5 unità; marchi e righe sono decorazione, non informazione.

## Da non fare
Nero puro; più di una tinta dominante; contorni di colori diversi tra le parti; filtri SVG sui mostri; ricalcare o
usare come input il riferimento esterno.

## Creature a punti
Lo stesso genoma disegnato come creatura di LED su uno schermo nero (`renderDots`, `dotGrid`, `renderDotsText` in
`packages/monster-kit/src/dots/`). Nessuna modifica allo schema: ogni genoma esistente ha già la sua versione a
punti. Il foglio di riferimento è `punti.png` / `punti.html` / `punti.txt` (`pnpm --filter @monsters/monster-kit
dots-sheet`). Il renderer lucido (`renderMonster`) resta com'è.

### Griglia
- **17 × 15 punti, uguale per tutti**: larghezza dispari, così il viso ha una colonna centrale (8) e i mostri
  simmetrici lo sono al punto. 17 : 15 sta vicino al 60 × 52 della striscia del mostro; a 60 px un punto vale 3,5 px.
- Riga 14 = terra (i piedi); il corpo finisce sulla 13 (sulla 14 se non ha piedi). **La riga 0 resta libera** a
  riposo: serve al saltello, alle bolle di pensiero e alle "z".
- Passo 10 unità, LED di raggio 4,6 (92% del passo: il corpo legge come una massa, i buchi del viso spiccano).
  I punti spenti sono `rgba(255,255,255,.07)` in un unico `<pattern>`; quelli accesi un `<path>` per colore (ogni
  punto è un segmento nullo con l'estremità tonda). Un mostro con tutti i fotogrammi è ~25 nodi e ~5 KB; niente
  filtri né maschere.

### Regole d'arte (ottobre 2026)
Riferimenti: i migliori sprite a 1 bit o a pochi colori (Playdate, Tamagotchi, Space Invaders, i glifi di Nothing):
ogni punto è voluto. Le regole valgono per qualunque genoma, non solo per i sette del roster: il foglio
`punti.png` mostra anche 30 genomi casuali.
- **Meno blob, più carattere.** Sagome tonde con spazio negativo intorno: corona arrotondata (la prima riga è il
  40–60% della larghezza), l'ultima riga rientra di un punto così i **piedi sporgono** e restano separati, le
  **braccia pendono dalla più bassa delle righe larghe** con un punto di buio tra mano e corpo, orecchie e corna
  nascono dalle spalle con un vuoto tra l'una e l'altra.
- **Prima il viso.** Gli occhi sono la cosa più forte: ovali alti 2 × 3 di base (2 × 2 solo se il corpo è
  piccolo), 3 × 3 sui corpi larghi, sempre **almeno tre punti di distanza** tra loro (si stringono solo se
  nient'altro entra), con il riflesso bianco in alto a sinistra. Il ciclope ha un **bulbo bianco** con la pupilla
  scura (2 × 2 sull'occhio grande di Mimas, 1 punto sul 3 × 3) che si sposta quando pensa. Le bocche sono
  **piccole**: una "v", una D di tre punti, un punto; il canyon di Tethys è un sorriso sottile.
- **Denti bianchi e pochi.** Una zanna sola (a sinistra, in basso) sulle bocche piccole, due sulle bocche grandi:
  due punti bianchi vicini alla bocca sembrerebbero un secondo paio d'occhi.
- **Poco attenuato.** Il corpo è un colore pieno: niente bordo in ombra. L'attenuato resta per l'interno delle
  orecchie, le strisce e i segni, che sono pochi e chiari (2–4 lentiggini, 1–2 crateri a L, 3–6 pori raccolti su
  un fianco, mai buchi: sembrerebbero altri occhi).
- **Espressioni leggibili a 60 px**: felice con occhi `^ ^`, lingua rosa, guance e saltello; pensa con occhi in
  alto e **bolle d'accento** che salgono verso l'angolo (un punto, una coppia, una nuvola 2 × 2); dorme con
  palpebre chiuse e una **z vera** (3 × 4) che diventa una Z 4 × 4; parla con bocca aperta, chiusa (una riga),
  spalancata; errore con **occhi a X** (3 × 3, che crescono verso l'esterno; `> <` se non c'è spazio).
- **LED vivi.** Le tinte gialle e lime non diventano oliva: la luce sale verso la luminosità più satura della
  tinta.

### Dal genoma ai punti
| Genoma | Punti |
|---|---|
| `body.w` | semilarghezza 4–6 punti (`3,4 + 3,1·(w−0,7)/0,6`; `dome` +1, `bean` −1): Titan e Tethys 6 (13 punti), gli altri 5, Mimas 4 |
| `body.h` | 8–11 righe (`6,7 + 4,4·(h−0,7)/0,6`; `dome` −1, `bean` +1, almeno 9 per l'occhio grande del ciclope), ridotte se le parti sopra la testa non entrano |
| `body.shape` | profilo a superellisse per riga, larghezze sempre dispari: `blob` tondo, `egg` più stretto in alto, `pear` testa piccola e base larga, `bean` capsula alta e stretta, `dome` cupola tozza a base piatta, `lumpy` patata (ovale obliquo: la metà alta scivola da un lato, la bassa dall'altro, e una gobba sulla spalla alta, dal seme) |
| `body.lean` | le righe alte scorrono fino a 2 punti di lato |
| occhi `round` | ovali 2 × 3 (2 × 2 se non entrano, 3 × 3 sui corpi da 13 punti con `size ≥ 0,9`), riflesso bianco in alto a sinistra; distanza ≥ 3, più larga con `spacing` sui corpi grandi; `asym ≥ 0,4` alza e allunga l'occhio destro |
| `cyclops` | bulbo bianco con pupilla scura: 5 × 4 con gli angoli smussati se `size ≥ 1,15` (Mimas), altrimenti 3 × 3 |
| `stalk` | due bulbi 4 × 4 nel colore d'accento su steli, con un buco 2 × 2 e il riflesso; tre punti liberi tra i due (il geyser) |
| `trio` | due occhi più un terzo 1 × 2 (o 1 × 1) sulla fronte, con una riga di corpo in mezzo |
| bocca | sotto gli occhi con una riga di corpo in mezzo: `smile` una "v" (una U di 5 se `width > 1,1`), `grin` una D di 3 (di 5 se `width > 1,12`), `canyon` un sorriso sottile largo 7 con gli angoli in su, `tiny` un punto |
| denti (bianchi) | `fangs`: una zanna all'angolo basso sinistro della bocca piccola, due su quella grande, due sotto il sorriso del canyon; `row` riempie la riga alta; `buck` un dente al centro. La bocca `tiny` non ha denti |
| `horns` (accento) | `nubs` cornini che seguono la cupola, il centrale alto 2: la corona di Titan; `spike` 2–3 punti, l'ultimo piegato in fuori; `curved` fuori e poi su; `stripes` alterna accento pieno e attenuato |
| `ears` | dalle spalle: `long` 2 colonne alte 3–4 con l'interno attenuato (Rhea), `round` 2 × 2, `pointy` da gatto (riempiono l'angolo accanto alla corona e finiscono in punta), `fin` pinne sui fianchi |
| `tail` | sempre a destra in basso, il corpo si sposta per farle posto e la coda scivola fuori finché non tocca il corpo: `plume` pennacchio alto 7 che si piega verso la testa (strisce = righe d'accento), `spiky`, `curl` |
| `topper` | `tuft` germoglio, `antenna` stelo con pallina d'accento, `crest` cresta d'accento, `geyser` getto tratteggiato (Enceladus) |
| `arms` | spalla contro il corpo e mano che pende un punto più in basso (`long`: due), staccata dal corpo che si stringe; in su a `\o/` quando è felice, in fuori nell'errore, saluto mentre parla |
| `feet` | 2–3 punti a terra che sporgono oltre l'ultima riga, un vuoto in mezzo; `claws` aggiunge un artiglio d'accento all'esterno |
| `marks` (attenuati) | `spots` 2–4 lentiggini ben distanziate, `craters` 1–2 fossette a L di tre punti, `sponge` 3–6 pori raccolti su un fianco, `stripes` tacche dai fianchi sotto gli occhi |
| `belly` | `light`: una macchia chiara arrotondata in basso; `contrast`: la stessa con la tinta spostata. Solo se ci stanno due righe sotto la bocca, altrimenti niente |
| `seed` | posizione dei segni, verso della patata, ritmo e fase dell'animazione, battito singolo o doppio |

Regole fisse: occhi e bocca sono **buchi nel corpo**, sempre circondati da luce su quattro lati (anche la riga sopra
e quella sotto la bocca), mai a contatto tra loro; segni e pancia stanno lontani dal viso (nemmeno tra gli occhi:
sembrerebbe un naso). Le parti sulla testa si mettono in ordine (occhi su antenne, corna, orecchie, ciuffo) e una
parte che non entra intera si riduce o non si disegna: mai tagliata.

### Colori (OKLCH, poi sRGB esadecimale con riduzione del croma)
| Ruolo | Regola |
|---|---|
| Luce (`lit`) | L 0,78–0,82 (dalla `lightness` del genoma), C = `chroma`·1,35 + 0,03 entro 0,11–0,22, h del genoma; se lo schermo non arriva a quel croma, L sale (fino a 0,91) finché il croma possibile cresce: i gialli diventano limone, non oliva |
| Attenuato (`dim`) | L 0,55, C × 0,8 |
| Accento | crema 0,93 / 0,05 / 88, oro 0,87 / 0,17 / 82, analogo h + 38, complementare h + 180, tono 0,94 / C × 0,45 / h; attenuato a L 0,6 |
| Pancia | chiara 0,93 / ≤ 0,06 / h; a contrasto L + 0,06 / 0,11 / h + 55 |
| Guance e lingua (felice) | rosa 0,72 / 0,17 / 8; sui mostri rosa o rossi 0,9 / 0,08 / 350 |
| Riflesso, bulbo del ciclope, denti | bianco `#ffffff` |

Ogni colore acceso è **almeno 3:1** su `#0d0d0c` (se non ci arriva, la luminosità sale finché non ci arriva); luce e
attenuato distano almeno 1,6:1 tra loro. Il test lo verifica su tutto il roster e su 400 genomi casuali.

### Espressioni e fotogrammi
| Stato | Fotogrammi | Cosa fa |
|---|---|---|
| idle | 2 | occhi aperti; battito (gli occhi diventano una riga a metà altezza) |
| talk | 3 | bocca a "o" (il fermo immagine), chiusa (una riga di tre), spalancata (5 punti, con le zanne); il braccio destro saluta sul terzo |
| think | 3 | occhi in alto (riflesso e pupilla verso il pensiero), bocca "hmm" di lato, bolle d'accento che salgono verso l'angolo libero (a sinistra se c'è la coda): un punto, una coppia, una nuvola 2 × 2 |
| happy | 2 | occhi ad arco `^ ^`, bocca aperta con lingua rosa e zanne, guance rosa, braccia su; il secondo fotogramma è un saltello di una riga |
| error | 2 | occhi a X, bocca a zig-zag, braccia in fuori; il secondo è uno sfarfallio al 45% |
| sleep | 3 | palpebre chiuse (curve in giù sugli occhi larghi), boccuccia, tutto al 55%; una z 3 × 4 che sale e diventa una Z 4 × 4 nell'angolo in alto |
| confused | 3 | gira a vuoto (D-068): occhi aperti con il riflesso (o la pupilla del ciclope) di qua, poi di là, poi un battito; bocca a "~" storta verso il lato libero; un `?` d'accento 3 × 5 nell'angolo in alto (nell'altro se lì ci sono orecchie o creste) che sale di una riga sul secondo fotogramma |

Il fotogramma 0 di ogni espressione è anche il fermo immagine (movimento ridotto) e da solo dice lo stato.

### Tempi
I fotogrammi sono gruppi `<g data-frame>`; `dotCss` li accende e spegne con keyframe su `visibility` e `step-end`
(scatti, nessuna dissolvenza). Senza CSS, con `data-animated="off"`, con `prefers-reduced-motion` o con
`data-motion="reduced"` su un antenato resta il fotogramma 0 (gli altri hanno `visibility="hidden"` come attributo).

| Ciclo | Sequenza (ms, prima del tempo del mostro) |
|---|---|
| idle, battito singolo | aperti 4200 · chiusi 150 |
| idle, battito doppio | aperti 3300 · 120 · 170 · 130 · aperti 1500 |
| talk | sillabe irregolari da 110–260 ms, pausa di 420 a fine frase (ciclo 1,8 s) |
| think | 520 · 520 · 1100 |
| happy | due saltelli (240 · 170 · 200 · 170) e 1100 di pausa |
| error | fermo 1600, poi sfarfallio 80 · 90 · 70, fermo 700 |
| sleep | 1100 · 1100 · 1300 |
| confused | di qua 700 · di là 620 · di qua 520 · di là 680 · battito 140 |

Ogni mostro ha `--dk-t` (tempo, 0,82–1,22 × (1,15 − 0,3·speed)) e `--dk-phase` (sfasamento 0–1) dal seme, e il
seme sceglie tra battito singolo e doppio: due mostri vicini non battono le ciglia né parlano insieme.

### Terminale
`renderDotsText` stampa lo stesso disegno in 8 righe × 17 colonne con i mezzi blocchi `▀ ▄ █`: due righe della
griglia per riga di testo, colori ANSI a 24 bit (luce, attenuato, accento, riflesso e denti bianchi), occhi e bocca come spazi.
Con `color: 'none'` restano solo i blocchi (acceso / spento).
