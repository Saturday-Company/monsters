# Design di Monsters · "Strumento"

> Riferimento unico per l'interfaccia (web, app desktop, terminale), dal 15/10/2026 sera (D-062, scelta del maintainer tra
> tre proposte). Sostituisce lo stile Apple con il vetro (D-056, D-061). Idea: **Monsters è uno strumento**, come un
> sintetizzatore di Teenage Engineering o un Nothing Phone. Lo chassis è serio e misurato; le uniche cose colorate e
> vive sono i mostri, **creature a punti luminosi** che abitano piccoli schermi neri. Fuori sembra un oggetto carino,
> dentro è preciso: chi inizia vede dei mostriciattoli vivi e dei tasti chiari, chi è esperto vede strumentazione,
> numeri e scorciatoie.

## Principi
1. **Chassis neutro, colore solo dai mostri.** Alluminio caldo (chiaro) o grafite (scuro). Un solo colore d'azione,
   l'**arancio segnale**; il rosso solo per Ferma e per gli errori. Ogni altro colore è la luce di un mostro sul suo
   schermo nero.
2. **Oggetti, non finestre.** Tasti che affondano, interruttori con la leva, campi incassati, schermi neri con i
   punti. Le giunture tra le parti sono **cuciture** (una riga scura e una chiara sotto), non bordi né ombre morbide.
3. **Due strati, una lingua.** Ogni cosa dice a parole cosa succede ("Scrive le didascalie"); sotto, in monospazio
   piccolo, c'è la strumentazione (strumenti, tempo, costo, modello). Nessuno strato tecnico sta in un posto diverso:
   "Dietro le quinte" è un altro schermo dello stesso strumento.
4. **Movimento a scatti.** Le animazioni sono a fotogrammi, come un display (`steps()`, un fotogramma = 40 ms),
   80-160 ms. Si muovono i mostri, le spie, le leve. Niente sfumature animate, niente sfocature. "Riduci movimento"
   lascia solo i cambi di stato. Ogni movimento dice qualcosa: la grammatica è nella sezione "Movimento".
5. **Scala generosa.** Corpo 15 px, chat 16 px, controlli da 40-44 px, righe dei mostri da 68 px. Il monospazio
   maiuscolo non scende sotto gli 11 px.
6. **Leggero per costruzione.** Colori pieni, nessun `backdrop-filter`, nessun `filter` sui mostri, nessun
   `will-change` permanente. Budget ≥ 55 fps (obiettivo 60) con `?mock=demo&vita=1` a 1440×900.
7. **Uguale ovunque.** Lo stesso mostro, dalla stessa griglia, nell'app, nel terminale (mezzi blocchi `▀▄█`), nella
   barra di sistema e su Telegram.

## Struttura della finestra
```
┌─ binario superiore 52 px = barra del titolo integrata (chassis) ────────────────────────────────────────────────┐
│ ● ● ●  monsters        │ Titolo vista  [tasti della vista]        ▐ ● 2 AL LAVORO · 1 DOMANDA   17:42 ▌  FERMA [▤] │ ← (— □ ✕ su Win/Linux)
├─ barra laterale 300 ───┼─ modulo del contenuto (pannello incassato, angolo in alto a sinistra raggio 14) ──────────┤
│ [ CERCA          ⌘K ]  │ ┌ monitor del mostro (schermo nero, 76 px) ──────────────────────────────────────────┐ │
│ SQUADRA PERSONALE · 4  │ │ [mostro]  TITAN   capo squadra · coordina 3 mostri      3 STRUMENTI · 4,1 S · GRATIS│ │
│ ▣ Titan   ● 1   17:41  │ └────────────────────────────────────────────────────────────────────────────────────┘ │
│   Ti chiede una cosa   │      messaggi …                                                                      │
│ ▣ Rhea    ▮▮▯   ora    │      [A] Foto del piatto     ● CONSIGLIATA                                           │
│ ▣ Dione                │      [B] Carosello                                                                   │
│ ─────                  │  [ Scrivi a Titan…                                              INVIA ↵ ]            │
│ AUTOMAZIONI  ⌘2        │                                                                                      │
│ NOTE         ⌘3        │                                                                                      │
│ FILE         ⌘4        │                                                                                      │
│ ATTIVITÀ     ⌘5        │                                                                                      │
│ IMPOSTAZIONI ⌘,        │                                                                                      │
│ ● QUESTO COMPUTER  ▾   │                                                                                      │
└────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘
```
- **Binario superiore (52 px)**: è la barra del titolo, ed è parte dello strumento, non una cornice di sistema. Una
  fascia sola di chassis su tutta la larghezza, trascinabile (`-webkit-app-region: drag`, controlli `no-drag`).
  Da sinistra: semafori di macOS (92 px riservati: finiscono a 76 px da macOS 26) e il marchio **monsters** (minuscolo) in Doto, larghi quanto la barra laterale;
  una cucitura verticale; il titolo della vista e i suoi tasti; a destra il **display di stato** (schermo nero con
  testo luminoso: stato della squadra e ora) e **Ferma**; su Windows e Linux poi lo spazio dei pulsanti di sistema
  (`env(titlebar-area-x/width)`), disegnati dal sistema nel colore dello chassis.
- **Barra laterale** (300 px): direttamente sullo chassis, senza pannello. La barra del Dio (è la sua chat, D-102), la
  ricerca incassata, poi le **squadre** (Squadra personale e progetti, D-100) con una **striscia per mostro** e "Nuovo
  progetto": solo questa parte scorre. In basso, fermi, Automazioni, Note, File, Attività, Impostazioni come righe con
  la scorciatoia e il selettore del computer (solo app desktop).
- **Modulo del contenuto**: un pannello un tono più chiaro dello chassis (più scuro in tema scuro), incassato: la
  cucitura lo separa dal binario e dalla barra laterale, l'angolo in alto a sinistra ha raggio 14 come un modulo
  inserito nel telaio. Tocca il bordo destro e quello in basso.
- **Telefono (< 768 px)**: il binario resta (marchio o "Indietro", display ridotto alla spia e al numero, Ferma). La
  barra laterale è la schermata iniziale; ogni vista si apre a tutto schermo. "‹ Indietro" è l'unico indietro: con il
  pannello a destra o il foglio "Da rivedere" aperti chiude quello e basta; una vista dentro una vista (una nota sopra
  l'elenco) lo fa tornare un livello su e lo dice ("‹ Note", `useToolbarBack`); altrimenti torna alla barra laterale.
- Accesso e primo avvio: lo stesso binario in alto (senza display), sotto lo chassis con il loro contenuto.

## Barra del titolo integrata (app desktop)
- **macOS** (`inset`): `titleBarStyle: 'hidden'`, semafori centrati nella riga di 52 px a 16 px dal bordo
  (`trafficLightPosition` `{ x: 16, y: 18 }`: niente più pannello flottante con margine di 8 px).
- **Windows e Linux** (`overlay`): `titleBarOverlay` alto 52 px nel colore `--chassis` con simboli `--ink`; il colore
  si aggiorna col tema (IPC già esistente, solo `#rrggbb`). Non serve più che il contenuto tocchi il bordo: il binario
  è tutto chassis.
- Sul documento restano `data-chrome="inset" | "overlay"`; nel browser nessuno spazio riservato. Doppio clic sul
  binario: ingrandisci (lo fa il sistema).
- Finestre secondarie (Connessioni, pagina di stato) e `page-theme.ts`: stesse parti della UI (binario con monsters,
  tasti, campi, schermi, spie, dispositivo con le viti, Titan a punti) e stessi caratteri, che viaggiano dentro le
  pagine `data:` (`page-fonts.ts`, solo latino, `font-src data:`; D-089). La pagina di stato è il dispositivo
  dell'Accesso: schermo grande mentre si aspetta, la striscia del monitor quando c'è un problema.

## Colori (token in `apps/web/src/theme/tokens.ts`)
| Token | Chiaro | Scuro | Uso |
|---|---|---|---|
| `--chassis` | `#e3e1db` | `#151514` | finestra, binario, barra laterale |
| `--panel` | `#f2f1ec` | `#1c1c1a` | modulo del contenuto |
| `--raised` | `#fbfaf7` | `#252523` | bolle dei mostri, schede, menu, dialoghi, cappucci dei tasti |
| `--well` | `#d8d5ce` | `#0f0f0e` | campi e ricerca (incassati), binari degli interruttori |
| `--seam` | `rgba(0,0,0,.13)` | `rgba(0,0,0,.6)` | riga scura delle cuciture |
| `--seam-light` | `rgba(255,255,255,.65)` | `rgba(255,255,255,.05)` | riga chiara sotto la cucitura |
| `--key-edge` | `#b5b2a9` | `#0a0a09` | spessore dei tasti (ombra piena in basso) |
| `--lever` / `--lever-edge` | `#fbfaf7` / `#78756d` | `#64635e` / `#0a0a09` | leva degli interruttori: bordo (chiaro) o cappuccio (scuro) ≥ 3:1 sul binario |
| `--ink` | `#1a1a18` | `#ecebe5` | testo |
| `--ink-muted` | `#5c5a54` | `#a3a19a` | testo secondario (≥ 4.5:1 su chassis, pannello, raised, well) |
| `--ink-faint` | `#6b6963` | `#8d8b85` | etichette e ore solo su pannello e raised |
| `--signal` | `#ff4f00` | `#ff5e14` | l'azione principale e le spie "c'è da fare": un riempimento sotto testo scuro |
| `--on-signal` | `#170800` | `#170800` | testo sul segnale |
| `--signal-ink` | `#a83500` | `#ff8a4c` | il segnale come testo, link, anello del focus (≥ 4.5:1) |
| `--stop` / `--on-stop` | `#d8231a` / `#ffffff` | `#ff3b2f` / `#1a0302` | Ferma, errori gravi |
| `--stop-ink` | `#b51c14` | `#ff7b72` | testo rosso |
| `--ok` | `#1f8f4e` | `#4fd98a` | spia verde (collegato, fatto) |
| `--screen` | `#0d0d0c` | `#050505` | tutti gli schermi (uguale nei due temi, sono oggetti) |
| `--screen-ink` | `#efe9dc` | `#efe9dc` | testo principale sugli schermi |
| `--screen-muted` | `#8f8b81` | `#8f8b81` | testo secondario sugli schermi (≥ 4.5:1 sul nero) |
| `--screen-off` | `rgba(255,255,255,.07)` | `rgba(255,255,255,.07)` | punti spenti |

- La bolla dell'utente è `--ink` pieno con testo `--panel` (scura in chiaro, chiara in scuro): come lo strumento,
  la voce dell'utente è la più netta. Le bolle dei mostri sono `--raised` con una tinta del colore del mostro al 7-9%.
- Contrasto verificato da `test/contrast.test.ts`: testo ≥ 4.5:1 su ogni superficie dove può stare; luci dei mostri
  ≥ 3:1 sullo schermo (sono grafica); la leva di un interruttore ≥ 3:1 sul suo binario (WCAG 1.4.11, D-066). `--signal-ink` chiaro è `#a83500` (non `#b83a00`): serve per il 4.5:1 anche
  sullo chassis e nel pozzo.
- Token in più, nati nell'implementazione: `--signal-edge` (`#a33300` / `#8a2c00`, spessore dei tasti arancio),
  `--stop-soft` (`#f4dcd5` / `#2e1513`, la fascia "fermi" e gli errori), `--screen-stop` (`#ff5a4e` in tutti e due i
  temi: il rosso come testo sugli schermi, dove `--stop` chiaro non arriva al 4.5:1). Per le viste non ancora
  rifatte restano `--fill`, `--fill-strong`, `--separator` e i nomi Tailwind vecchi (`bg-content` → pannello,
  `bg-accent` → segnale, `text-on-danger-soft` → `--stop-ink`…), da togliere quando nessuno li usa più.

## Caratteri (in locale, con `@fontsource`, licenza OFL; nessun font da internet)
| Ruolo | Carattere | Uso |
|---|---|---|
| Testo | **Instrument Sans** (variabile) | tutto ciò che si legge: messaggi, campi, pulsanti, titoli |
| Etichette e strumentazione | **Martian Mono** | etichette maiuscole spaziate (`.label`: 11 px, +0.06em), righe di strumentazione, ore, scorciatoie, log |
| Display | **Doto** (a punti) | marchio, nomi dei mostri sui monitor, ora del display, numeri grandi. Mai sotto i 18 px, mai per frasi |

Scala (classi Tailwind già esistenti, stessi nomi): `micro` 12/16, `caption` 13/18, `footnote` 14/20, `body` 15/22,
`large` 16/24, `title3` 18/24, `title2` 22/28, `title1` 24/30, `display` 30/36. Numeri sempre `tabular-nums`.

## Materiali e componenti
- **Cucitura** (`.seam-*`): 1 px `--seam` + 1 px `--seam-light`, tra binario e contenuto, tra barra laterale e
  contenuto, tra gruppi. Mai bordi grigi intorno alle cose.
- **Tasto** (`Button`): cappuccio `--raised`, bordo 1 px `--key-edge`, spessore `box-shadow: 0 3px 0 var(--key-edge)`,
  raggio 10. Premuto: scende di 2 px (`translateY(2px)`, spessore 1 px), in 80 ms a due scatti; lasciato, torna su
  subito. Varianti:
  `primary` (segnale, testo scuro, spessore `#a33300`), `danger` (stop), `ghost` (senza cappuccio, per le icone nel
  binario), `key` con la lettera o la scorciatoia in un tassello monospazio. Altezze 40 / 44 / 48. Un `primary` che
  non si può ancora premere è un tasto normale (cappuccio `--raised`, parole `--ink-muted`): arancio solo quando c'è
  qualcosa da fare, e un solo tasto arancio per schermata.
- **Tasto con etichetta** (`LabeledKey`): un'icona da sola è un indovinello. Nel binario e nelle barre dei moduli le
  icone portano il nome in `.label`: accanto all'icona dove c'è posto, sotto l'icona sul telefono, solo tooltip dove
  non ci sta. Un numerino (tassello `--signal`) dice quante cose aspettano (Da rivedere).
- **Interruttore** (`Switch`): un binario incassato `--well` 52×30 con una leva (`.lever`, token `--lever`) che scorre a
  scatti e una spia (verde acceso, spenta grigia) accanto. La leva si vede nei due temi: in chiaro ha il bordo scuro,
  in scuro il cappuccio grigio; non cambia al passaggio del mouse. Segmenti e schede: una fila di tasti uniti; quello scelto è "premuto"
  (scende, cappuccio `--panel`, spia arancione sopra).
- **Campo**: incassato (`--well`, ombra interna di 1 px in alto), raggio 10, alto 44; focus: anello 2 px
  `--signal-ink`. Il segnaposto è testo normale.
- **Schermo** (`.screen`): `--screen`, raggio 8-12, riflesso interno di 1 px; dentro solo luce: punti, Doto o Martian
  Mono in `--screen-ink` / `--screen-muted` o nel colore di un mostro. Righe di scansione statiche (gradiente a 2 px,
  opacità 0.05) solo sugli schermi grandi.
- **Spie**: punti di 8 px. Verde = pronto, arancio = c'è una domanda o qualcosa da fare (lampeggia piano, 1 Hz a
  scatti, solo se non c'è "Riduci movimento"), rosso = fermo o errore. Il colore non è mai l'unico segnale: c'è sempre
  anche una parola o un numero.
- **Misuratore** (VU): 4 segmenti verticali da 3×10 px nel colore del mostro; quando il mostro lavora si accendono a
  scatti in sequenza, a riposo sono spenti.
- **Menu, popover, dialoghi**: `--raised`, cucitura come bordo, ombra piena corta `0 6px 0 -2px rgba(0,0,0,.12)` più
  una morbida leggera; raggio 14. Il foglio del terminale è uno schermo grande.

## Movimento (D-084)
Ogni animazione risponde a "cosa dice?". Se non dice niente, non c'è. Un fotogramma è 40 ms (un display a 25 fps);
tutto va a `steps()`, cambiano solo `transform`, `opacity` e `visibility`. Token in `styles.css` (`--dur-press` 80 ms,
`--dur-ui` 120 ms, `--dur-sheet` 160 ms, `--steps-*`, `--sink-*`, `--row-hover`, `--screen-hover`), le lunghezze per i
timer in `lib/motion.ts`. Nessuna libreria di animazioni.
- **Premere** ("ti ho sentito"): ogni tasto scende finché gli resta 1 px di spessore, in due fotogrammi (80 ms): i tasti
  (3 px) scendono di 2, i tasselli (2 px) di 1; i tasti senza cappuccio (ghost, tasti di luce sugli schermi, schede del
  pannello, la casa di Ferma) scendono di 1 px come una membrana, perché non hanno spessore da comprimere. Lasciato,
  torna su subito. Le righe (strisce, righe di elenchi e moduli, voci dei menu) sono superfici, non tasti: non si
  muovono, premute prendono subito il contorno della scelta. Le immagini premibili prendono un anello.
- **Passare sopra** ("questo si preme"): reagisce solo ciò che si preme, sempre accendendosi, mai muovendosi. Una riga
  prende il tono vicino della superficie su cui sta (`--row-hover`: chassis → pannello, pannello → raised, raised →
  pannello); un cappuccio cambia di un tono; su uno schermo le parole passano da spente ad accese con un velo di luce
  del 7%. La manina solo su ciò che si preme (mai sui disattivati). Su uno schermo touch non c'è passaggio
  (`@media (hover: hover)`): quello che altrove compare al passaggio (i tasti delle schede dei file, la freccia della
  strumentazione) lì è sempre visibile. Da tastiera l'anello del focus è uno solo: 2 px `--signal-ink`, `--signal`
  sugli schermi.
- **Comparire** ("è arrivato qualcosa"): quattro movimenti, tutti a scatti. `rise-in` (4 px in su, tre fotogrammi):
  quello che arriva nel flusso, cioè un messaggio, una domanda, una scheda, un passo, il menu @, un avviso. `drop-in`
  (6 px in giù): la palette, che pende dal binario. `slide-in` (24 px da destra, quattro fotogrammi, 160 ms): il pannello
  a destra e "Da rivedere". `light-on` (da spento ad acceso, tre fotogrammi, nessuno spostamento): una parte di uno
  schermo che si accende, cioè una scheda, una riga della guida, una lineetta del contesto, "Salvato", il file caricato,
  la domanda messa in pausa. **Sparire** è più veloce o istantaneo: solo il pannello a destra esce in tre fotogrammi,
  tutto il resto se ne va subito.
- **Attenzione** ("serve te"): una spia arancio che lampeggia a 1 Hz, solo per ciò che aspetta l'utente (una domanda,
  il passo del primo avvio in cui sei, Ferma armata). Nient'altro lampeggia. L'orologio del display batte i secondi a
  0,5 Hz: è un orologio, non una chiamata.
- **Attesa e lavoro** ("ci sto lavorando"): le lineette del misuratore che si accendono in sequenza, o le 10 lineette
  dell'avanzamento; il cursore che lampeggia mentre un mostro scrive; i mostri che pensano. Mai rotelle. Un collegamento
  o una verifica in corso sono un'attesa, non una chiamata: lineette, non spia che lampeggia.
- **Stato che cambia** ("adesso è così"): cambio istantaneo o un solo passo; mai colori che sfumano. Le leve (gli
  interruttori, la leva di Ferma) scattano in due fotogrammi; la copertura di Ferma si alza in quattro e ricade subito; il
  triangolino di un cassetto gira in due. Il nome sul monitor sfarfalla (520 ms) quando un mostro comincia a lavorare.
- **Scorrere**: lo scorrimento verso una domanda o i nuovi messaggi è quello del sistema (liscio), istantaneo con
  "Riduci movimento".
- **Riduci movimento** (del sistema o dell'app, `data-motion="reduced"` su `<html>`): ogni cambio diventa un cambio di
  stato. Le animazioni non partono, ogni transizione dura 0 (un tasto premuto è giù, senza viaggio), i mostri stanno sul
  primo fotogramma, le spie e le lineette sono accese ferme.
- **Prestazioni**: nessuna animazione di layout, nessun `will-change` permanente; i mostri fuori vista restano sul primo
  fotogramma (`data-offscreen`). Misura del 16/10/2026 (`?mock=demo&vita=1`, 1440×900): 60 fps scorrendo la chat,
  aprendo e chiudendo il pannello e passando sulle righe e sui file. `e2e/movimento.e2e.ts` controlla che tutto vada a
  scatti, che giri in tondo solo ciò che può (spie, lineette, mostri, cursori) e che con "Riduci movimento" non resti
  niente in corsa.

## Il binario superiore
- **Marchio**: "monsters", minuscolo, in Doto 20 px, spaziatura 0.08em. Sul telefono a casa resta il marchio; dentro una vista
  diventa "‹ Indietro".
- **Titolo della vista**: Instrument Sans 17 px semibold. Nella chat il titolo è solo per i lettori di schermo (il
  nome sta sul monitor del mostro). I tasti della vista sono `ghost` con icona 20 px e tooltip; quelli con un'etichetta
  usano la `.label`.
- **Display di stato** (`StatusDisplay`): schermo nero alto 32 px, largo 240-340 px. Testo Martian Mono 11 px
  maiuscolo e ora in Doto 18 px (con le cifre spente `88:88` dietro, come un display vero). Mostra il primo stato
  vero in quest'ordine: `FERMI` (rosso) · `NON COLLEGATO` (rosso) · `MI RICOLLEGO…` (spia arancio fissa e un
  misuratore: è un'attesa) · `● TITAN CHIEDE` (una domanda: il nome prima, è l'informazione utile) o `● N DOMANDE ·
  TITAN` (la spia arancio lampeggia: aspetta te; se intanto qualcuno lavora, accanto il misuratore) · `N AL LAVORO`
  (con un misuratore; `RHEA CAMBIA STRADA` se un mostro al lavoro gira a vuoto, D-068) · `TUTTO TRANQUILLO`. Sotto i
  300 px di display il misuratore lascia il posto alle parole. Lo stato del collegamento viene prima delle domande e
  del lavoro (che senza collegamento sono vecchi), e "tranquillo" è l'ultimo. Clic: va alla chat che aspetta,
  altrimenti ad Attività. Sotto 1100 px solo spia e numero; sul telefono solo la spia.
- **Ferma** (`KillSwitch`): un interruttore con la **copertura di sicurezza**, come in uno studio di registrazione o
  in una cabina di pilotaggio. A riposo la copertura (strisce diagonali arancio, bordo segnale) è chiusa sulla leva
  rossa, con l'etichetta "FERMA" accanto. Primo clic (o Invio): la copertura si alza (rotazione di 68° in 160 ms,
  quattro scatti) ed è "armata" per 5 s, l'etichetta `.label` dice "DI NUOVO" (la frase intera, "Premi di nuovo per
  fermare tutti i mostri", è nel tooltip e nell'annuncio per i lettori di schermo). Secondo clic: la leva scatta giù,
  suono di leva se i suoni sono accesi, tutti i mostri si fermano. Fermo: la leva resta giù, la copertura alzata, spia
  rossa, etichetta "RIPRENDI"; un clic la riporta su. Quando almeno un mostro lavora la spia è accesa arancio, fissa
  (c'è qualcosa da fermare: è uno stato, non una chiamata); lampeggia solo da armata, quando aspetta il secondo clic.
  Sta accanto alla parola, non sulla copertura, così si vede anche a copertura alzata. Sempre visibile e raggiungibile
  da tastiera,
  nome accessibile "Ferma tutti i mostri" / "Riprendi". `⌘.` / `Ctrl+.` (o "Ferma tutti i mostri" nella palette)
  alza la copertura (anche senza nessuno al lavoro) e porta lì il fuoco; Esc la richiude: niente ferma i mostri con
  un gesto solo. Sul telefono solo la copertura e la spia; la parola compare solo da armata ("DI NUOVO"): da fermi
  "Riprendi" sta nella fascia, una volta sola.
- Sotto il binario, quando i mostri sono fermi, una fascia (`HaltBanner`) "I mostri sono fermi", con quello che lo
  stop ha lasciato a metà ("In sospeso: la domanda di Titan e il lavoro di Rhea", `haltedWork`) e i tasti "Riprendi"
  (solo riprendere: Ferma è un interruttore di sicurezza, niente riparte da solo) e, quando c'è qualcosa da far
  ripartire, "Riprendi e continua" (arancio): il core riprende e fa ripartire, per ogni lavoro fermato, la richiesta
  che l'aveva avviato (il mostro legge "Riprendi il lavoro che avevo fermato: «…»"). In chat non torna il messaggio
  dell'utente: una riga di stato "RIPRESO IL LAVORO FERMATO: «…»" con la spia verde, solo nella chat di quel mostro
  (D-072; lo stesso per "Chiedimelo di nuovo"). Gli schermi dei mostri passano a "dorme" (solo la parola: il
  perché lo dice la fascia).

## La barra laterale
- **Ricerca**: un tasto incassato alto 40 come un campo, "Cerca mostri e note" e il tassello `⌘K` a destra: apre la
  palette (sotto). La squadra non si filtra mai: i mostri restano al loro posto.
- **Squadre** (D-100): sotto la barra del Dio e la ricerca, una per gruppo: la `.label` "SQUADRA PERSONALE · 4" o il nome del
  progetto ("SOCIAL DI SATURDAY · 3", un link alla sua pagina: scelto, il contorno `--ink` della striscia), con un
  triangolino da 32 px che piega la squadra (si ricorda in questo browser). Dentro, le strisce del capo per primo e
  degli altri nell'ordine della squadra. Dopo l'ultima squadra la riga "Nuovo progetto" (+) e, piegati sotto "PROGETTI
  ARCHIVIATI · N", i progetti archiviati. Le frecce su e giù passano tra la barra del Dio (la prima fermata) e le
  strisce aperte di tutte le squadre.
- **Il piede**: Automazioni, Note, File, Attività, Impostazioni e il computer non scorrono con le squadre (una
  cucitura sopra): restano a portata anche con tante squadre e su una finestra bassa.
- **Striscia del mostro** (riga alta 68, raggio 12, padding 8/10): a sinistra lo **schermo** 60×52 con il mostro a
  punti animato; poi nome (16 semibold) e una riga di stato in Instrument Sans 13.5 `--ink-muted` (una riga, puntini
  alla fine); a destra l'ora (Martian Mono 11) e sotto, a seconda dello stato: la spia arancio e il numero delle
  domande, il misuratore se lavora, il numero dei non letti in un tassello `--ink` pieno. Al passaggio: `--panel`.
  Scelta: `--panel` con un contorno interno di 1.5 px `--ink`. In errore lo stato è in `--stop-ink`.
- **Automazioni, Note, File, Attività, Impostazioni**: righe da 44 con icona 20 px e la `.label` della scorciatoia
  a destra (`⌘2`, `⌘3`, `⌘4`, `⌘5`, `⌘,`; D-096). Scelta: come la striscia. Su Automazioni la spia arancio e il numero
  dei giri che aspettano una risposta.
- **Selettore del computer** (solo desktop): una riga con la spia (verde pronto, arancio mi collego, grigio non
  raggiungibile), "QUESTO COMPUTER" o il nome della connessione in `.label`, e il triangolino. Apre Connessioni.

## La barra del Dio (D-101)
- **Dove**: in cima alla barra laterale, sopra la ricerca e le squadre (margini 12, come le strisce); sul telefono in
  cima alla schermata iniziale, a tutta larghezza. È la **chat del Dio** (l'orchestratore, a capo della Squadra
  personale e dei progetti) nella barra laterale: un link alla sua chat, e il Dio non ha una striscia sua (D-102).
- **Come una striscia** (D-102): con la sua chat aperta (anche la casa sui finestroni, `⌘1`) ha il contorno della
  striscia scelta, 1.5 px `--ink` fuori dallo schermo dopo 2 px di chassis; a destra della riga, la spia arancio che
  lampeggia e il numero delle domande che aspettano nella sua chat (`--signal` come testo), altrimenti i non letti in
  un tassello di luce (`--screen-ink` pieno, testo nero). È la prima fermata delle frecce della barra laterale e, con
  la sua chat aperta, quella nell'ordine del Tab. Nome accessibile come le strisce: "Titan, al lavoro, ti chiede: …, 2
  da leggere. A capo di tutte le 2 squadre: <la riga>. <la `.label`>"; `aria-keyshortcuts` con `⌘1`.
- **Com'è**: uno schermo nero (`.screen` con le righe di scansione, raggio 12) nei due temi; intorno lo chassis del
  tema. In alto il **nastro**: 4 righe di punti (passo 5 px, punti all'80%) con i colori di tutti i mostri di tutte le
  squadre, ognuno una banda arrotondata di 6 colonne nella sua luce (`dotPalette`) attraversata da strisce diagonali
  del suo secondo colore; una colonna spenta tra due mostri, tre tra due squadre; prima il Dio, poi la Squadra
  personale, poi i progetti. Sotto, il Dio sul suo schermo (46×40, la faccia del suo stato), il nome in Doto 20 nella
  sua luce, a destra la `.label` con la spia, e una riga in Martian Mono 11 (`--screen-ink` quando c'è lavoro o una
  domanda, altrimenti `--screen-muted`).
- **Stati**: al lavoro il nastro scorre verso sinistra a scatti di una colonna, 6 colonne al secondo con un mostro e
  +2 per ognuno in più (al più 20); i mostri al lavoro sono a piena luce, gli altri attenuati; la `.label` "2 AL
  LAVORO" con la spia verde. Una domanda aperta: deriva lenta (1,5 colonne al secondo) e "1 DOMANDA" con la spia
  arancio che lampeggia. Appena finito (meno di 90 s): deriva lenta, "5 MOSTRI" spento. Tutto tranquillo: fermo.
  Fermi (Ferma) o non collegato: fermo, luci al 45%, nome spento, "FERMI" / "NON COLLEGATO" in rosso schermo, il Dio
  che dorme.
- **Riga**: quello che fa il Dio ("Aspetto Rhea", "Aspetta una tua risposta"), altrimenti chi lavora ("Al lavoro: Rhea
  e Dione"), chi aspetta una risposta ("Rhea aspetta una tua risposta"), "Tutto tranquillo" (o "… in 3 squadre"),
  "I mostri sono fermi", "Non collegato al computer". Una riga, puntini alla fine.
- **Movimento e prestazioni**: un canvas, un `drawImage` per passo, mai più di 20 passi al secondo, niente quando è
  fermo, con la scheda nascosta o fuori vista. "Riduci movimento": il nastro sta fermo con tutti i colori in fila.
  Al passaggio il velo di luce degli schermi (`--screen-hover`); premuto scende di 1 px; focus 2 px `--signal` a 5 px
  (fuori dal contorno della scelta).

## La palette (⌘K)
`⌘K` / `Ctrl K` da ovunque, o il tasto di ricerca della barra laterale (anche sul telefono): un popover `--raised`
largo fino a 640 px, sotto il binario (Ferma resta scoperto), senza velo sul resto. In cima un campo incassato con il
tassello "esc"; sotto i risultati in gruppi con la `.label`: **Mostri** (nome o ruolo, sul loro piccolo schermo),
**Note** (la ricerca delle note, dopo 2 lettere), **Messaggi** (le chat che contengono le parole, i più recenti),
**Comandi** (Automazioni `⌘2`, Nuova automazione, Nuova nota, Note `⌘3`, File `⌘4`, Attività `⌘5`, Da rivedere, Pannello a destra `⌘J`, Ferma `⌘.`, Impostazioni e
le sue schede, Tema chiaro / scuro / come il computer). Righe da 44 come il menu @, quella scelta con il contorno `--ink` e il tassello ↵,
la scorciatoia a destra. Frecce, Invio, Esc (prima svuota il campo, poi chiude); in fondo "↑↓ scegli · ↵ apri · esc
chiudi". Si apre a scatti (120 ms) e si chiude cambiando pagina.

## La chat
- **Monitor del mostro** in cima alla chat, fisso (non scorre), alto 76: schermo nero a tutta larghezza (margini 16),
  con il mostro a punti grande (altezza 60), il nome in Doto 26 nel colore del mostro, sotto il ruolo e cosa sta
  facendo in Martian Mono 11 `--screen-muted`; a destra, sugli schermi larghi, il riassunto della conversazione
  (`N STRUMENTI · TEMPO · COSTO`: i run di quel mostro dall'ultima "Nuova conversazione", da 1180 px di chat), il
  tasto **CONTESTO** (vedi "Consumi") e i
  tasti "Dietro le quinte" e "Nuova conversazione" (tasti ghost chiari sullo schermo, con la `.label` da 860 px di
  chat, sotto solo l'icona): lo stato del mostro ha la precedenza e non si taglia. Quando il
  mostro comincia a lavorare il nome sfarfalla come uno schermo che si accende (520 ms a scatti) e parte il
  misuratore; una domanda in attesa accende la spia arancio. Il titolo nel binario è solo per i lettori di schermo.
- **Bolle**: dei mostri `--raised` con la tinta del mostro, raggio 4/14/14/14, cucitura come bordo; dell'utente
  `--ink` con testo `--panel`, raggio 14/4/14/14. Avatar: un piccolo schermo 34×30 col mostro, solo sul primo messaggio
  di un gruppo, fermo sul primo fotogramma (parla solo mentre scrive). Colonna di lettura fino a 760 px. Quello che
  arriva con la chat aperta (una bolla, una domanda, una ricevuta, un file) sale in tre fotogrammi (4 px e opacità);
  aprendo una chat le righe che c'erano stanno ferme, e il tuo messaggio sale una volta sola, quando lo mandi.
- **Strumentazione**: sotto l'ultima bolla di ogni turno di un mostro, una riga in Martian Mono 10.5 maiuscolo
  `--ink-muted`: `TITAN › DELEGA ×2 · RICERCA WEB ×3 · 4,1 S · GRATIS · LLAMA 3.3 70B`. Si costruisce dagli eventi del
  turno (`tool_call`, `tool_result`, `provider_usage`, durata del run): gli strumenti sono quelli di tutto il run,
  anche dei mostri a cui ha delegato; il tempo c'è solo a run finito; "GRATIS" quando ogni richiesta è andata a un
  modello gratuito o il costo riportato è 0; il modello manca col router gratuito di OpenRouter (non dice quale ha
  scelto). Le ricerche web dicono tra parentesi il motore che ha risposto per ultimo (`RICERCA WEB ×3 (OPENROUTER)`,
  `(WIKIPEDIA)` quando la ricerca gratuita si è bloccata); il costo di una ricerca a pagamento entra nel costo, non è
  il modello del turno (D-071). Funzioni pure in `store/derive.ts` (`runStatsIndex`, `instrumentationLine`). Clic: apre "Dietro le quinte"
  su quel turno (la prima riga del run, segnata da una barra nel colore del mostro).
  Si può spegnere in Impostazioni > Generale ("Mostra i dettagli tecnici", acceso di default).
- **Eventi tra mostri**: una riga `.label` centrata tra due trattini di cucitura della stessa lunghezza ("RHEA HA
  FINITO · 3 DIDASCALIE"); l'ora dopo un punto ("HAI FERMATO TUTTI I MOSTRI · 00:02"). Sotto i 480 px niente
  trattini e la riga va su due righe invece di tagliarsi. Più eventi di fila si raggruppano in una riga che si apre.
  Un compito passato: "TITAN → RHEA · IL COMPITO"; la frase intera, in minuscolo normale, è il nome accessibile e il
  tooltip (le maiuscole della `.label` i lettori di schermo le compitano).
- **Messaggio scritto da un altro mostro** (D-102): quello che il Dio manda al capo di un progetto con `project_send`
  sta nella chat del capo dalla parte dei mostri, non come una bolla tua: la `.label` "DA TITAN" sopra, il piccolo
  schermo del Dio come avatar e la bolla nella sua tinta; per i lettori di schermo "Da Titan, 10:32:". Nell'elenco la
  striscia del capo dice "Titan: …", non "Tu: …".
- **Messaggio da Telegram** (D-107): quello che una persona scrive al bot dedicato a un mostro sta nella chat del mostro
  dalla parte dei mostri, mai come una bolla tua (anche se l'hai scritto tu nel gruppo): la `.label` "BOB · DA
  TELEGRAM · TEAM" (in privato "da Telegram · in privato", "(tu)" per il tuo account), il segno di Telegram
  come avatar e una bolla neutra. Le risposte del mostro di quel lavoro hanno sopra la `.label` "SU TELEGRAM · TEAM". Nell'elenco la striscia dice "Bob: …".
- **Rapporto del capo** (D-102): nella chat del Dio, quando il capo finisce il lavoro di `project_send`
  (`project_report`), come un compito ricevuto: la `.label` "RAPPORTO DI IAPETUS · SOCIAL DI SATURDAY · 10:41" tra le
  cuciture, sotto la spia e l'esito in grassetto ("Iapetus ha finito", verde; "si è interrotto: Monsters si è chiuso
  mentre ci lavorava", rosso; "fermato prima di cominciare", spenta; "aspetta una tua risposta", arancio; "non ce l'ha
  fatta", rosso) con il riassunto in `--ink-muted` (al più 280 caratteri), e il link `.label` arancio-testo "Apri la
  chat del progetto →". La risposta intera è nella chat del capo.
- **Errore in fondo alla chat**: al posto dei primi suggerimenti due tasti, "Riprova" (rimanda la richiesta del lavoro
  fallito, o il compito con cui era partito) e "Dietro le quinte" su quel lavoro.
- **Domanda con opzioni** = **tastierino**: scheda `--raised`, la domanda in 16 semibold, le opzioni come tasti a
  tutta larghezza con il tassello della lettera (A, B, C…) a sinistra; la consigliata ha a destra la spia arancio e
  "CONSIGLIATA". Con il campo di scrittura vuoto, premere la lettera sulla tastiera preme quel tasto (si vede
  affondare, clic se i suoni sono accesi). Solo la domanda a cui risponde il campo di scrittura (la più vecchia aperta)
  prende le lettere, e il suggerimento delle lettere compare solo con una tastiera vera (non su uno schermo touch). La risposta
  libera resta dal campo di scrittura.
- **Domanda chiusa senza risposta**: mai la spunta di "fatto". Una spia (rossa se l'ha chiusa Ferma, spenta
  altrimenti) e il perché a parole ("Non hai risposto: hai fermato i mostri"); quando il lavoro non è ripartito, il
  tasto "Chiedimelo di nuovo" (rimanda la richiesta del lavoro, o chiede al mostro di rifare la domanda). Da fermi non
  c'è: lo fa "Riprendi e continua".
- **Campo di scrittura**: incassato, raggio 14, alto almeno 52; a destra il tasto "INVIA ↵" (`.label`), un tasto
  normale finché il campo è vuoto e `primary` (arancio) appena c'è qualcosa da mandare; sul telefono solo "↵".
  Menu `@` come popover. Con una domanda aperta, appena ci sono parole vere (non solo una menzione in corso), sopra il
  campo "↳ Risposta alla domanda di Titan"; se la domanda non blocca il lavoro, un piccolo ✕ la trasforma in un
  messaggio normale ("È una risposta" torna indietro). Il segnaposto suggerisce i tasti quando c'è una domanda ("Scrivi a Titan, oppure premi A, B
  o C").
- **Chat vuota**: il mostro su uno schermo grande che parla per un momento e il saluto in Martian Mono con un cursore
  che lampeggia, con parole sue (più vivace se il genoma ha `bounce` alto); il nome in Doto sta solo sul monitor,
  una volta basta. Sotto, i primi suggerimenti come tasti.
- **Da rivedere** (le domande che aspettano e le note toccate, con Annulla): un tasto nel binario della chat (icona
  `Tray` con "DA RIVEDERE" e il numero di cose che aspettano). Da 1280 px è una colonna accanto alla chat (si
  ricorda); sotto è un foglio a destra, a tutto schermo sul telefono; Esc o Indietro lo chiudono. A destra sta una
  cosa sola: con il pannello a destra aperto la colonna si fa da parte sotto i 1600 px (il tasto la riporta e chiude
  il pannello), da 1600 px stanno insieme; il foglio e il pannello si chiudono a vicenda.
- **Suoni** della chat aperta (se accesi): `question` quando arriva una domanda nuova, `done` quando il mostro finisce.
- **Ricevuta** (D-068): alla fine di un turno con una richiesta dell'utente e qualcosa da rendere conto (incarichi,
  note, azioni verso fuori, testi tolti), un **display** nero sotto l'ultima bolla, rientrato come le domande: in alto
  la `.label` "RICEVUTA" con il riassunto ("2 INCARICHI · 1 IN DUBBIO · 1 NOTA · GRATIS") e l'ora; aperto mostra la
  richiesta, gli incarichi con il mostro nella sua luce, l'esito (`✓ finito davvero` verde schermo, `? in dubbio`
  arancio, `✗ incompleto / non riuscito` rosso schermo) e i criteri ✓/✗ con il perché, le note toccate (link), cosa è
  uscito dal computer, la sicurezza; in fondo, dopo una riga di luce, costo, passi e durata (e le domande
  dell'istinto se "Mostra i dettagli tecnici" è acceso) e il tasto di luce **"Annulla tutto il lavoro"**: primo tocco
  "DI NUOVO" (bordo rosso, 5 s, come Ferma), secondo tocco annulla e il display dice "ANNULLATO · N MODIFICHE
  RIPORTATE INDIETRO" con le note e gli eventuali errori. L'ultima ricevuta della chat è aperta, le altre sono una
  riga. Token nuovo `--screen-ok` (`#4fd98a` nei due temi, ≥ 4.5:1 sul nero).
- **Righe dell'istinto**: come gli eventi tra mostri, una `.label` centrata tra le cuciture con `◇` ("◇ CI PENSA
  DIONE"); in arancio-testo quello che va controllato, in rosso un'azione rifiutata o un testo con ordini tolto. Quello
  che l'istinto dice di un compito ("Dione non aveva finito il lavoro: ho chiesto di completarlo", "in dubbio") sta
  sotto il compito stesso, in minuscolo. In chat solo suggerimento, promemoria, dubbio, cambio di strada, freno e
  testi tolti; il resto in Attività. Clic: Dietro le quinte su quel lavoro.
- **Mostro che gira a vuoto**: con un evento `stuck_*` dell'istinto il mostro al lavoro fa la faccia **confusa**
  (espressione `confused`: guarda di qua e di là, bocca storta, un `?` d'accento nell'angolo, 3 fotogrammi, solo
  `visibility`); il monitor dice `? STA CAMBIANDO STRADA` ("CAMBIA STRADA" se stretto), la striscia "Sta cambiando
  strada", il display di stato "RHEA CAMBIA STRADA" al posto di "N AL LAVORO". Resta almeno 4 s, poi torna normale
  alla prima azione nuova (strumento o parole); "Riduci movimento" lascia il primo fotogramma. Lo stato lo tiene il
  core (`AgentSummary.confusedSince`, D-072): dopo un ricaricamento la faccia confusa resta, con lo stesso inizio.

## Pannello a destra (Anteprima, Dietro le quinte, Consumi; D-075)
- **Uno schermo solo a destra**, nero, incassato nello chassis come i monitor, con tre schede in alto (tasti di luce
  `.label`, quella scelta accesa in `--screen-ink`, frecce ← → tra le schede) e ✕. Al posto dei fogli che si
  sovrapponevano: Anteprima, **Dietro le quinte** (il terminale) e **Consumi**. "Dietro le quinte", la riga di
  strumentazione e il tasto CONTESTO aprono la loro scheda; le schede del mostro seguono la chat che apri (il pannello
  non si chiude cambiando chat: è l'ispettore di quella accanto).
- **Dove**: da 1100 px è una colonna della finestra a destra del modulo (8 px sotto il binario, 12 dal bordo), e il
  contenuto si stringe, mai coperto; tra 768 e 1099 px è un foglio sopra il contenuto (top 60, ombra piena corta); sul
  telefono tutto lo schermo sotto il binario, e cambiare pagina o chat lo chiude. Ferma e il binario non sono mai
  coperti.
- **Larghezza**: si trascina dalla **maniglia** nella cucitura a sinistra (una lineetta incisa, `col-resize`), o con
  le frecce quando ha il fuoco (Maiusc: ×4, Home/Fine); 380 px al minimo, al massimo ~60% della finestra lasciando al
  contenuto almeno 400 px; 520 di partenza, doppio clic la riporta lì. Si ricorda per chi guarda (`dockWidth` nelle
  preferenze del browser).
- **Tastiera**: `⌘J` / `Ctrl J` apre e chiude (anche dalla palette, "Pannello a destra"); Esc chiude (prima esce
  dallo zoom di un'immagine); il fuoco va nel pannello solo quando l'hai chiesto tu.
- **Anteprima**: in cima la **striscia** di quello che è aperto (al più 12: icona del tipo, nome, ✕; l'ultimo ✕ chiude
  il pannello), poi la testata: nome (15 semibold), sotto in `.label` `TIPO · DIMENSIONE · DA TITAN` ("da te" per i
  file tuoi), e i tasti di luce **Apri nel sistema** e **Mostra nella cartella** (solo app desktop, solo sul computer
  dei mostri; mai per le pagine HTML: fuori dalla scatola girerebbero libere), **Copia** (testo, codice, pagine,
  immagini come PNG) e **Scarica**. Una nota ha **Apri nelle Note** e Copia.
- **Per tipo**: *immagine* adattata su una scacchiera statica (la trasparenza), un clic la porta a grandezza reale
  (il doppio se è già intera) e si sposta trascinando, un clic o Esc la riadatta, in basso `ADATTATA · 52% ·
  960×640`; *PDF* disegnato da pdf.js su fogli bianchi (le pagine si disegnano quando si avvicinano, `PAGINA 1 / 2`);
  *nota* sul suo foglio `--raised` con il lettore delle Note (i collegamenti si aprono qui, `⌘` clic va alle Note);
  *testo, codice, JSON, CSV* in Martian Mono 12.5 con i numeri di riga in un margine spento e pochi colori di luce
  (stringhe, numeri, commenti, parole chiave), il JSON rientrato, il CSV come tabella (o testo); *pagina HTML* di un
  mostro su bianco in una **scatola chiusa** (sotto: "in una scatola chiusa: niente rete, niente accesso a
  Monsters"); se il mostro l'ha fatta dopo aver letto contenuti esterni arriva con gli script spenti, una riga sopra
  ("Pagina con script disattivati: è stata creata dopo aver letto contenuti esterni") e il tasto **Attiva gli
  script**, che chiede una seconda volta ("Sì, attivali" / "Lascia spenti"), e non si apre mai da sola; *altro* (archivi, documenti Office): icona, nome, tipo, dimensione e cosa farne.
- **Da dove si apre**: le schede degli allegati, le immagini in chat (quelle del computer si vedono nella bolla, fino a
  320 px di altezza; quelle da internet restano una scheda con l'indirizzo e "Mostra immagine": si caricano solo al
  clic, senza referrer), i link ai file, le note citate (`[[nota]]`), i file fatti dagli strumenti in Dietro le quinte
  (uno screenshot è una miniatura sulla riga dello strumento), e un mostro con `preview_show`: in chat una scheda
  ("TITAN TI MOSTRA · PAGINA", nome, la sua riga, "APRI"; "IN ANTEPRIMA" quando è aperto) e, se quella chat è sullo
  schermo (non sul telefono), il pannello si apre da solo senza prendere il fuoco.
- **Movimento**: entra da destra in quattro fotogrammi (160 ms, 24 px e opacità), esce in tre (120 ms); il cambio di
  scheda è un'accensione in tre fotogrammi (120 ms). Con "Riduci movimento" compare e sparisce e basta. Niente
  sfocature: un'ombra piena corta solo da foglio.

## Dietro le quinte (terminale del mostro)
Una scheda del pannello a destra che è uno **schermo grande**: fondo `--screen`, righe di
scansione statiche, testo Martian Mono 12.5 in `--screen-ink`, i nomi degli strumenti nel colore del mostro, gli
errori in rosso chiaro, i tempi in `--screen-muted`. In alto il mostro a punti piccolo e il nome in Doto. Si apre da
"Dietro le quinte" e dalla riga di strumentazione (su quel turno). Ogni riga comincia con un segno in monospazio
(`▸` strumento, `→`/`←` compiti, `✕` errore, `·` pensiero, `─` inizio e fine del lavoro); i filtri sono tasti di luce
sullo schermo (sul telefono vanno a capo: tutti e cinque in vista, nessuno tagliato al bordo). Sul telefono va a tutto
schermo sotto il binario (Ferma resta scoperto). Un'altra chat gli fa mostrare quel mostro; Esc, ✕ o `⌘J` chiudono il
pannello.

## Consumi (contesto e spesa di un mostro, D-075)
- **Tasto CONTESTO** sul monitor del mostro, prima di "Dietro le quinte": 20 lineette come quelle del misuratore
  (3×10 px, una ogni 5% della finestra del modello) e la percentuale in Martian Mono 11; la parola "CONTESTO" solo da
  1320 px di chat, le lineette fino a 520 px (sotto resta la percentuale). Prima del primo passo della conversazione
  "–"; senza finestra nota i token ("38K") e nessuna lineetta. Dalla soglia di compattazione (75%) la percentuale è in
  arancio. Nome accessibile: "Contesto e consumi di Titan: 31% della finestra del modello".
- **Luci delle parti** (dentro lo schermo solo luce): la luce del mostro a cinque intensità, dalla più stabile alla più
  recente come il prompt (istruzioni 46%, memoria e profilo 60%, strumenti 74%, conversazione 87%, risultati degli
  strumenti 100%), la base dell'harness (Claude Code, Codex: non è nostra) in `--screen-muted`, il messaggio di adesso
  in `--screen-ink`; lo spazio libero `--screen-off`. Il colore non è mai da solo: le parti stanno sempre in
  quest'ordine, uno spazio più largo segna dove ne finisce una, la legenda dice nome e token. Una tacca di luce
  `--screen-muted` più alta della barra segna la soglia del 75%.
- **Pannello** (clic sul tasto; `components/usage/UsagePanel.tsx`, un componente a sé: la scheda Consumi del
  pannello a destra). Uno schermo:
  in alto il mostro e "CONSUMI"; **Contesto** con il numero grande in Doto 44 (nella luce del mostro, arancio dalla
  soglia), token usati / finestra e modello, la barra grande (40 lineette alte 22 su tutta la larghezza) con sotto
  "0 · 75% · QUI SI COMPATTA · 64K", la legenda (lineetta campione, nome, a cosa serve, token e quota); **Questa
  conversazione** (token in/out, cache letta e scritta, chiamate, durata, costo in $ e €, per modello, ricerche web,
  istinto); **Oggi · questo mese** contro il tetto della squadra (10 segmenti come in Modelli) e il tasto "Tetto di
  spesa · Impostazioni → Modelli". Su un abbonamento al posto dei soldi "incluso nell'abbonamento" e una riga che lo
  dice. Valori in Martian Mono 14, etichette `.label` 11. Segue la chat che apri; Esc o ✕ chiudono il pannello.
- **Movimento**: una lineetta che si accende (o cambia parte) lo fa in tre fotogrammi (120 ms, `steps(3)`); con
  "Riduci movimento" cambia e basta. Dati dal vivo: l'anteprima legge `provider_usage.context` dallo stream, il
  pannello rilegge `GET /api/agents/:id/usage` quando arriva un evento del mostro.

## Utilizzo del piano (limiti di Claude e di ChatGPT, D-111)
- **Blocco** (`components/usage/PlanLimitsBlock.tsx`): uno schermo piccolo (`.screen`, nero in tutti e due i temi) con una
  riga per finestra del piano. Sopra, a sinistra il nome in `.label` ("SESSIONE", "SETTIMANA", "OPUS SETTIMANA"; per
  ChatGPT la lunghezza: "5 ORE", "SETTIMANA"), a destra la percentuale in 14 tabulare; sotto una barra di **20 lineette**
  (una ogni 5%, alte 14, che si dividono tutta la larghezza, quindi anche sul telefono) e una riga da 12 in
  `--screen-muted`: "si azzera tra 1 h 32" (entro il giorno), "si azzera mer 16:00" (dopo), oppure, a finestra già
  passata, "azzerato · si aggiorna al prossimo uso" a 0%. In fondo "Aggiornato 20 min fa. Si aggiorna solo quando un
  mostro lavora con questo piano." Senza dati: "Ancora nessun dato: compare dopo il primo lavoro di un mostro col piano
  Claude."
- **Soglie:** sotto l'80% luce `--screen-ink`; da 80% lineette e percentuale in `--signal` con la parola "in esaurimento";
  da 95% in `--stop` con "quasi al limite", al 100% "limite raggiunto". Il colore non è mai da solo: la parola, la
  percentuale e il nome accessibile (`role="meter"`, "Sessione: 9% usato") dicono lo stesso.
- **Dove:** in Impostazioni → Modelli sotto la riga "Abbonamento Claude" (quando l'accesso è pronto) e sotto quella di
  ChatGPT, con il titolo `.label` "UTILIZZO DEL PIANO"; nel pannello Consumi di un mostro sul piano, come sezione
  "Utilizzo del piano · Claude" tra "Questa conversazione" e "Oggi · questo mese" (senza lo schermo di mezzo: la
  scheda è già uno schermo). Un mostro su un modello gratuito o a chiave non ha la sezione.
- **Orologio:** il blocco ricalcola ogni 30 s con l'ora della pagina: una finestra che si azzera mentre guardi passa a
  "azzerato" e "aggiornato 20 min fa" invecchia.

## Allegati e File (D-075)
- **Graffetta** nel campo di scrittura, a sinistra: un tasto ghost da 40 con l'icona (nome "Allega un file"). Anche
  incolla (un'immagine dagli appunti) e trascina sulla chat: un velo `--panel` con il bordo tratteggiato
  `--signal-ink` dice "LASCIA QUI I FILE PER ALLEGARLI".
- **Scheda di un file** (`FileChip`): un cappuccio `--raised` con la cucitura, raggio 12, alto 56, largo 180-280.
  A sinistra la miniatura 40×40 (raggio 8) o, per i documenti, un **piccolo schermo** nero con l'icona del tipo in
  luce; poi il nome (14 medium, puntini alla fine) e sotto la `.label` "PDF · 240 KB". Nel campo di scrittura c'è
  la ✕ per toglierla e, mentre carica, **10 lineette** 3×10 in `--signal-ink` che si accendono con l'avanzamento e
  la percentuale (mai una rotella); un errore è una riga `--stop-ink` corta ("Troppo grande: al massimo 25 MB",
  "Le foto HEIC non si leggono ancora: esportala in JPEG"). "Invia" resta un tasto normale finché un file carica.
  Al massimo 10 allegati, 25 MB l'uno.
- **Nella chat**: gli allegati stanno sopra la bolla dell'utente, allineati a destra; le immagini come riquadri
  (raggio 14, larghi 140-260 secondo le proporzioni), gli altri come schede. Un messaggio di soli file non ha bolla.
  I file dei mostri sono una riga tra le cuciture ("RHEA HA SALVATO UNO SCREENSHOT · 18:01", "DIONE HA CREATO UNA
  PAGINA: WEEKEND A LISBONA") con il file sotto. Ogni file si apre nell'Anteprima a destra; uno eliminato è "FILE
  ELIMINATO".
- **Sezione File** (`#/file`, `⌘4`): in alto i filtri come fila di tasti uniti (Tutti, Immagini, Documenti, Dai
  mostri; sul telefono quattro colonne uguali) e il campo "Cerca nei file" (nome e testo estratto; un file trovato dal testo mostra il pezzo intorno alle parole), il conteggio in `.label`. Sotto, una
  cucitura e la griglia di schede (`--raised`, raggio 14, colonne da 200 px, due sul telefono): in alto la
  miniatura 4:3 su `--well` (o il piccolo schermo del tipo con l'estensione in luce), sotto il nome (o il titolo
  della pagina) in 15 semibold, "IMMAGINE · 240 KB", chi l'ha fatto ("Da te", il mostro sul suo schermino con
  "Screenshot di Rhea" / "Pagina di Dione") e la data. Scarica ed Elimina sono tasti da 36 nell'angolo, accesi al
  passaggio (sempre visibili su uno schermo touch); Elimina chiede conferma come Ferma: primo tocco "DI NUOVO"
  (bordo rosso, 5 s), secondo tocco elimina. Vuoto: uno schermo con il capo squadra e due righe ("ANCORA NESSUN
  FILE" e come aggiungerne).

## Note, Attività, Impostazioni
- **Note**: elenco a sinistra con titolo, data in `.label` (maiuscola, come le ore della barra laterale) e tag come
  piccoli tasselli; la nota aperta su `--raised`, Instrument Sans 17/28, colonna di 68 caratteri, i
  `[[collegamenti]]` in `--signal-ink` sottolineati (tratteggiati se la nota non esiste ancora). Chi l'ha scritta è un
  piccolo schermo col mostro. I tasti (Grafo, Nuova nota nel binario; Modifica, Cronologia, Attività, Cestino sulla
  nota) hanno il nome: accanto all'icona da 1280 px, sotto l'icona sul telefono, tooltip in mezzo. Sul telefono c'è un
  solo indietro, nel binario ("‹ Note"). Il **grafo** è uno schermo nero: le note sono punti luminosi (luce
  `dotPalette(genome).lit` del mostro che le ha scritte, `--screen-ink` per le altre), i collegamenti linee sottili
  `--screen-muted`, etichette in Martian Mono, legenda e conteggi dentro lo schermo. Al primo disegno si adatta allo
  schermo (con il margine per le etichette); un'etichetta si disegna solo se non tocca quelle già disegnate (prima la
  nota aperta e le più collegate, `placeLabels`), le altre al passaggio o con lo zoom. Il colore dice solo chi ha
  scritto. La cronologia di una nota (le differenze) è anche lei un piccolo schermo, righe verdi e rosse, con in cima
  "‹ Torna alla nota": i salti sono "· riga N ·", le proprietà della nota cambiate stanno piegate sotto "Proprietà
  cambiate", niente hash (solo nel tooltip della data).
- **Attività e istinto** (D-068): tra gli "Importanti" i testi con ordini ai mostri tolti e il freno sulle azioni
  che escono dal computer (sì, no, fatte da controllare); il resto dell'istinto (suggerimenti, promemoria, cambi di
  strada, le sue singole risposte) sotto "Tutto" e nel filtro "Istinto". La spia è quella del mostro di cui si parla.
- **Attività** (nastro): righe in Martian Mono con l'ora a sinistra (tabellare), la spia nella luce del mostro (la
  stessa dei suoi punti), la frase in Instrument Sans, sotto il tipo in `.label`. In testa un segmento "Importanti |
  Tutto" (di default solo quello che ha avuto un effetto), poi i filtri come fila di tasti ("Chi" è un menu incassato,
  allineato in alto con i tasti) e "Altri filtri" (Messaggi, Lavori dei mostri, Compiti passati, Strumenti, Sistema;
  il periodo "Da sempre"); sul telefono un solo tasto "Filtri" apre un cassetto. Una domanda ancora aperta ha
  "Rispondi", che porta alla sua chat. I dettagli si aprono in un piccolo schermo, valori in Martian Mono 12.5 (i codici
  interni solo sotto "Dati tecnici"). "Annulla" e "Rifai" sono tasti (nelle colonne strette un tasto da 32 px con ↺,
  il nome in tooltip e per i lettori di schermo). Le parole col trattino (una data) non vanno a capo.
- **Impostazioni**: cinque schede, una idea ciascuna (D-066), come fila di tasti in cima: **Squadra** (chi c'è, e chi
  sei tu: nome, capo squadra, tono, lingua, stile; la nota Profilo), **Modelli** (con cosa pensano: chiavi e
  abbonamenti; il modello dei mostri, uno per tutta la squadra finché non scegli "Scegli per ogni mostro"; un solo
  modello non ha frecce né ✕, e il nome si legge in parole, "Gratuito, scelto da OpenRouter"; il modulo "Ricerca sul
  web" con la leva "Ricerca a pagamento" e, accesa, il segmento Economica / Precisa col costo ogni 1.000 ricerche,
  D-071), **Permessi** (prima "Te
  lo chiedono sempre", poi cosa può usare ogni mostro, in fondo "Avanzate"), **Collegamenti** (le strade da e verso
  fuori: Telegram, la ricerca sul web, altri programmi), **Generale** (Aspetto, Accesso, la cartella delle note, le
  chiavi). In Collegamenti, sotto il bot principale di Telegram, il gruppo **"Bot dedicati a un mostro"** (D-107): una
  voce per bot (@username, il tassello "N DA APPROVARE", mostro · progetto o "Squadra personale", la spia dello stato,
  "Rimuovi bot"), con i gruppi (Approva / Rifiuta, poi Togli), "Chi può parlargli" (il tuo account con "tu" e nessun
  tasto, gli altri Approva / Rifiuta / Togli, "Aggiungi con l'ID di Telegram") e "Messaggi di oggi"; "Aggiungi un bot
  per un mostro" apre i quattro passi (BotFather, privacy, un programma per token, gruppo e `/join`), il token, il
  menu del mostro (mai il Dio) e il limite al giorno. Sotto il modulo una riga dice che le cose che decidi tu non si
  approvano mai nel gruppo. Sotto i 680 px di larghezza le schede dividono la riga, parole più piccole e niente icone. Ogni gruppo è un
  **modulo** (`--raised`, raggio 14, cucitura) con la `.label` in alto a sinistra, righe da 52 con interruttori a
  leva; una riga aperta mostra un cassetto più scuro. I mostri compaiono sempre sul loro piccolo schermo
  (`AgentMark`). In Generale: Tema (Chiaro / Scuro / Sistema), **Suoni** (spenti di default), Riduci movimento ("I
  mostri restano fermi e le animazioni diventano semplici cambi di stato"), Mostra i dettagli tecnici; solo dentro l'app desktop il modulo
  "App" con la leva **Apri all'accesso** (D-095: spenta di default; dove non si può, leva spenta e il motivo al posto
  della descrizione); la cartella delle note si legge su un piccolo schermo. Le chiavi "nel portachiavi del sistema" (il nome tecnico solo nel
  tooltip).
- **Istinto** (scheda Squadra, D-068): un modulo con la `.label` "ISTINTO" e la frase di `INSTINCT_DESCRIPTION`; la
  riga "Chi decide" con il segmento Solo regole / Modello piccolo / Jev e sotto, sempre, la descrizione del motore
  scelto (cambia col segmento). Jev senza chiave: il core risponde 409 `no_key`, il modulo lo dice a parole sopra il
  campo della chiave, che prende il fuoco; con la chiave una riga "Chiave di TypeSafe · Attiva". Il cassetto **"Cosa
  fa"** ha una leva per uso (nome, descrizione) e tasselli `.label`: "IN PROVA" (la scorciatoia: accesa vuol dire che
  annota soltanto), "SOLO ANNOTA" (un uso messo così a mano), "SERVE JEV" / "SERVE JEV O IL MODELLO PICCOLO" / "SERVE
  LA CHIAVE DI TYPESAFE" in arancio-testo quando l'uso è acceso ma col motore scelto non fa niente. Sotto il modulo,
  piccolo, "Cosa esce dal computer" si apre e dice per uso cosa va a TypeSafe. Mai "System 1", "gate", "shadow",
  "soglia" o probabilità.
- **Pagella dei mostri** (scheda Squadra, sotto Istinto): una riga per mostro e modello con il mostro sul suo schermo,
  il modello in monospazio, "14 lavori · 10 finiti davvero · gratis a lavoro riuscito · 6,5 passi in media" e a destra
  (sotto, sul telefono) un piccolo schermo con 10 segmenti nella luce del mostro e "10/12". Quando la catena è stata
  riordinata, una riga con la spia verde: "Ora Rhea usa prima llama 3.3 70b: finisce più lavori e costa meno." Sotto,
  lo stato onesto: quanti lavori controllati servono ancora.
- **Tetto di spesa** (scheda Modelli, D-070): un modulo con la `.label` "TETTO DI SPESA"; le righe "Oggi" e "Questo
  mese" dicono a parole quanto è stato speso e su quanto ("Spesi 0,42 € oggi su 10 € (4%)"), a destra un piccolo
  schermo con 10 segmenti in `--screen-ink` che diventano `--signal` all'80% e `--stop` al 100%, e "0,42 € / 10 €" in
  Martian Mono. Sotto, i due campi "Al giorno (€)" e "Al mese (€)" (vuoto: nessun tetto) con "Salva", arancio solo
  se qualcosa è cambiato; il cassetto "Per mostro" per i mostri con modelli a pagamento. Al tetto una riga dice che i
  lavori a pagamento sono fermi e "Alza il tetto" (il doppio, arrotondato a 5 €) li fa ripartire. In fondo, piccolo,
  cosa non conta (modelli gratuiti, abbonamenti) e il cambio fisso. In chat l'80% e il tetto sono righe tra le cuciture
  (`--signal`, `--stop`), il lavoro fermato ha "Alza il tetto" al posto di "Riprova"; anche un avviso in basso.
- **Strumenti in pausa** (scheda Collegamenti, D-070): un modulo che c'è solo quando serve, sopra "App e servizi":
  "GitHub ha cambiato uno strumento: i mostri non lo usano finché non lo accetti", il nome dello strumento in
  monospazio con un tassello ("DESCRIZIONE CAMBIATA", "NUOVO", "ARGOMENTI CAMBIATI"), la descrizione di prima barrata
  e quella di adesso su due piccoli schermi, una frase sul perché leggerla, poi "Scollega" (con conferma) e "Accetta".
- **App e servizi** (scheda Collegamenti, D-063): ogni servizio è un tasto con il suo marchio su un piccolo schermo
  nero (il colore del marchio come luce, ≥ 3:1 sul nero; i marchi neri prendono `--screen-ink`), il nome, una frase e lo
  stato in `.label` con la spia. Il pannello chiede solo il necessario e lascia scoperto il binario (Ferma).
  Da collegato con un token, accanto a Prova e Scollega c'è **"Cambia il token"** (D-072): apre sotto un campo
  (password) con "Crea il token", "Salva e prova" e "Annulla"; cambia solo il token, poi la prova parte da sola. Lo
  stesso tasto c'è in "Altri programmi" per i programmi con valori nascosti (con più valori, un segmento per sceglierlo).
  Durante un accesso in attesa, sotto il pannello "La pagina di ritorno non si apre?" (un cassetto come "Dettagli")
  apre il campo "Indirizzo della pagina di ritorno" con "Completa l'accesso"; quando il core sa che la pagina non si
  aprirà (core raggiunto in rete) il campo è già aperto.

## Automazioni (D-094, D-096)
- **Sezione** `#/automazioni` (`⌘2`), sopra Note nella barra laterale. Colonna fino a 920 px, tre livelli che sul
  telefono si aprono uno sopra l'altro (il binario dice "‹ Automazioni", "‹ Giri"): elenco, automazione, giro. Nel
  binario "Nuova automazione".
- **Elenco per squadra**: la `.label` "SQUADRA PERSONALE · 1" (poi una per progetto, campo `project`), un modulo con
  una riga per automazione: i mostri (il capo per primo) su **un solo schermo nero**, il nome (16 semibold), "ogni
  domenica alle 23:00 · Titan con Dione e Mimas", sotto la spia e lo stato dell'ultimo giro (Fatto verde, In corso e
  Aspetta una risposta arancio, Errore rosso, Saltato spento) e il prossimo giro; a destra la leva che la mette in
  pausa. Una bozza ha il tassello "BOZZA" al posto della leva.
- **Automazione**: in testa un monitor (schermo nero: la squadra, il nome in Doto 24, quando e il prossimo giro in
  Martian Mono, "ATTIVA / IN PAUSA / BOZZA" con la spia), poi i tasti "Esegui ora" (l'unico arancio; da fermi è un
  tasto normale e, premuto, dice che i mostri sono fermi con "Riprendi i mostri"), "Metti in pausa"/"Riprendi",
  "Modifica", "Elimina" (conferma nella pagina, bordo rosso, mai un dialogo del browser). Subito dopo i **giri**
  (lo stato, quando, perché è partito, la durata, `4 PASSI · 16.480 TOKEN · GRATIS`), poi i moduli Obiettivo,
  Quando (con i prossimi tre giri), Chi la fa (il capo con "CAPO"), Risultati e avvisi. Una bozza proposta da un
  mostro ha in cima la fascia "Bozza: conferma" (bordo arancio, Scarta e Conferma, con `/api/drafts` di D-098).
- **Giro**: lo stato su un piccolo schermo, le domande che aspettano (si risponde qui: un messaggio nella chat del
  capo non risponde a un giro), la risposta finale, "Cosa ha fatto" (le note portano alle Note, i file al pannello e
  a File), poi la conversazione in sola lettura con le bolle della chat: l'obiettivo come bolla scura, il capo e i
  mostri a cui ha chiesto (rientrati, "per il capo").
- **Modulo**: nome e obiettivo, il capo e chi partecipa come tasti con il mostro sul suo schermo, "Quando" come fila
  di tasti (Ogni giorno, Ogni settimana con i giorni, Ogni mese con il giorno, Avanzato con la regola cron), l'ora,
  il fuso (di default il tuo), e uno schermo che dice la regola in italiano e i prossimi tre giri (calcolati con
  croner, come il core); poi cartella, tetto per giro (passi, token, euro) e le due leve degli avvisi. Una nuova si
  può salvare come bozza.
- **Nella chat** il capo che lavora a un giro non mostra quel lavoro (è dell'automazione): sopra il campo di
  scrittura una riga con la spia, "Sta facendo l'automazione «Post della settimana»: il tuo messaggio parte appena
  finisce" e "Vedi il giro". A fine giro un avviso in basso ("giro finito", "aspetta una tua risposta") con "Vedi".

## Progetti (D-097, D-098, D-100)
- **Pagina** `#/progetto?id=…` (titolo del binario: il nome del progetto). Sotto il binario una fila di tasti uniti:
  **Chat · Squadra · Note · Cartella · Collegamenti · Automazioni · Spesa** (sul telefono scorre di lato, la scheda
  scelta resta in vista). Colonna fino a 920 px per le schede che non sono la chat.
- **Chat**: la chat del capo com'è a casa (monitor, bolle, campo), con nel binario il nome del progetto, "Ferma
  progetto" e "Da rivedere". `@Nome` arriva ai mostri del progetto (nel menu @ vengono per primi).
- **Ferma progetto**: un tasto ghost del binario con la mano aperta e la `.label` ("FERMA" sul telefono). Primo tocco:
  "DI NUOVO" in `--stop-ink` con il bordo rosso per 5 s; secondo tocco: ferma il lavoro dei mostri del progetto (non
  degli altri, il kill switch resta su) e un avviso dice cosa ("1 lavoro", "non lavorava nessuno").
- **Squadra**: un modulo con una riga da 52 per mostro (lo schermo 52×46 nel suo stato, nome 16 semibold, "CAPO" in
  `--signal-ink` per il capo, il ruolo), "Scrivi" e "Togli" (conferma nella riga; il capo non si toglie). In fondo
  "Copia un mostro" (i mostri delle altre squadre, ognuno con "Copia": sotto la riga il nome proposto, "Rhea ·
  Saturday", in un campo, e "Copia nel progetto") e "Nuovo mostro" (il modulo di Impostazioni → Squadra). Poi il
  modulo "ARCHIVIA IL PROGETTO".
- **Note**: le note dell'area `Progetti/<nome>/` come righe (titolo, il percorso dentro l'area in Martian Mono, da
  quanto), che aprono le Note. **Cartella**: il percorso su un piccolo schermo con "Copia", "Cambia cartella" (Una che
  c'è / Una nuova) e "Togli la cartella"; se la cartella non c'è più lo dice. **Collegamenti**: la leva della ricerca
  sul web, poi una leva per server o servizio dato a tutta la squadra; quelli di un mostro solo, a parole.
  **Automazioni**: le sue automazioni come nella sezione, "Nuova automazione" (già nella squadra del progetto) e
  "Tutte le automazioni". **Spesa**: "TETTO DEL PROGETTO" (Oggi, Questo mese con lo schermo a 10 segmenti, i due
  campi), il tetto della squadra a parole sotto, "PER MOSTRO" con i campi dei mostri a pagamento.
- **Nuovo progetto** (`#/progetto?vista=nuovo`, dalla riga della barra laterale): moduli "IL PROGETTO" (nome, dove
  andranno le note), "CARTELLA" (Nessuna / Una che c'è / Una nuova; la nuova segue il nome in `~/Monsters
  Progetti/<nome>`), "CAPO DEL PROGETTO" (Uno nuovo con il nome facoltativo / Copia un mostro: i mostri come tasti col
  loro schermo, e il nome che avrà), "PRIMI MOSTRI" (tasti da accendere). "Crea il progetto" è arancio quando c'è un
  nome; poi si apre la chat del capo.
- **Bozza** (proposta dal Dio): la pagina "Bozza: <nome>" con il modulo dal contorno arancio ("Bozza: conferma", chi
  l'ha proposta, la squadra che sarà su un piccolo schermo alto 52, il piano, Scarta e Conferma), poi i moduli che si possono cambiare prima. **Archiviato**: un modulo con
  la spia spenta, "ARCHIVIATO IL …", dove sono note e cartella, "Ripristina".
- **Da rivedere**: in cima, solo quando c'è qualcosa, "DA CONFERMARE · N" (spia arancio che lampeggia) con una scheda
  per bozza (`--raised`, la `.label` "TITAN PROPONE UN PROGETTO", i mostri sul loro schermo (il capo per primo:
  nuovo, con l'aspetto che il suo nome gli darà, D-102), il titolo, una riga di
  riassunto; per un progetto il piano in righe `.label` + testo: Capo, Mostri, Cartella, Dopo) e i tasti Conferma
  (arancio solo nella prima), Modifica, Scarta.
- **Proposta per le istruzioni** (D-113): la stessa scheda ("IAPETUS PROPONE UNA MODIFICA ALLE ISTRUZIONI", il mostro
  sul suo schermo, "CLAUDE.md di <progetto>", il riassunto col motivo), poi la riga `.label` File (nome e cartella in
  Martian Mono), gli avvisi con il triangolo in `--signal-ink` (testo di terzi; file cambiato dopo la proposta),
  "COSA CAMBIA · +N −M" e la differenza sul piccolo schermo dei diff delle note (righe tolte e aggiunte colorate,
  "· riga N ·" tra i pezzi, alto al massimo 360 e scorre da solo). Tasti **Applica** (arancio solo nella prima scheda,
  spento con il file cambiato) e **Lascia stare**; niente Modifica. Le stesse schede nella scheda Cartella del
  progetto, sotto "PROPOSTE PER LE ISTRUZIONI · N".

## Accesso e primo avvio
- **Accesso**: in alto (non centrato: un errore o un pannello nuovo crescono verso il basso, niente salta) un
  "dispositivo" (`.device`: cappuccio `--raised` con quattro viti negli angoli): in alto la `.label` "ACCESSO" (o
  "PRIMA ACCENSIONE") e una spia con la parola di stato (in attesa, controllo, rifiutato, sveglio; durante il controllo
  al posto della spia corrono le lineette); poi uno schermo
  grande con il capo squadra **che dorme** e una riga di luce ("LA SQUADRA DORME"); sotto il titolo, i campi incassati
  e il tasto "Entra". L'ultima email usata si ricorda (in questo browser) e allora il fuoco va sulla password. Quando
  l'accesso riesce il mostro si sveglia (felice, 600 ms, suono "compito finito" se i suoni sono accesi) e si entra
  (`login`/`setup` accettano `beforeEnter`). Una password rifiutata o un campo mancante: il mostro fa la faccia
  d'errore per 1,4 s, poi si riaddormenta. "Ho dimenticato la password" apre un pannello incassato con le due strade
  (app, terminale), che scorre in vista e prende il fuoco.
- **Primo avvio** (sequenza di accensione): sotto il binario (marchio in Doto, una fila di spie per i passi: verde
  fatto, arancio che lampeggia piano quello in corso, anello tratteggiato per il modello lasciato a dopo; sul telefono
  solo le spie; a destra un piccolo "ESCI") ogni passo sta in un modulo grande (`--panel`, raggio 18, cucitura)
  ancorato in alto, con la `.label` del passo e `01 / 04` in testa. Quattro passi: **Modello**, **Su di te** (le
  domande), **Cosa possono fare** (i permessi), **Squadra**. Un solo tasto arancio per passo: la chiave di OpenRouter
  ha "Verifica e continua" (verifica e va avanti), "Lo faccio dopo" sparisce appena c'è un modello. La guida parla da
  uno schermo con il suo mostro: la frase in Martian Mono `--screen-ink` con il cursore a blocco, il suggerimento sotto
  in `--screen-muted`. Opzioni come tasti con la spia, avanzamento come una striscia di segmenti in un pozzo, i mostri
  proposti sui loro schermi con le azioni in fondo alla scheda, ognuna col suo nome sotto l'icona (Compiti, Nome,
  Aspetto, Togli). Alla nascita della squadra ogni mostro **si accende punto per punto** sul suo schermo (`DotReveal`:
  `dotGrid` + `dotPalette`, ordine casuale dal seme, ~700 ms, uno dopo l'altro, prima il capo squadra), con un "tic" a
  ogni mostro e il suono "compito finito" all'ultimo se i suoni sono accesi; "ACCENSIONE n/N" conta (con le lineette che
  corrono, poi la spia verde) e ogni mostro
  acceso è "SVEGLIO". Con "Riduci movimento" i mostri sono già accesi. Poi il capo squadra saluta.

## Suoni (spenti di default)
Sintetizzati con WebAudio, nessun file: clic del tasto (rumore filtrato 8 ms), leva (due clic più gravi), spia della
domanda (due toni brevi 880/1320 Hz), compito finito (tre toni ascendenti piani). Volume basso, niente suoni se la
finestra non è in primo piano, mai più di un suono ogni 120 ms.

## I mostri a punti
Il disegno lo genera `packages/monster-kit` (`renderDots`) dallo **stesso genoma** di oggi: i mostri già creati
cambiano aspetto senza migrazioni. Regole in numeri nella sezione "Creature a punti" di `docs/mostri/STILE.md`.
- Una griglia di punti (dimensione fissa per tutti, larghezza dispari per avere una colonna centrale), tre livelli di
  luce: pieno, attenuato (pancia, macchie, ombre), spento. Gli occhi sono "buchi" spenti con un punto di riflesso
  bianco. Parti con un secondo colore (corna, creste) da `palette.accent`.
- Colore: la luce del mostro da `palette.hue` (OKLCH chiaro e saturo, convertito in esadecimale), ≥ 3:1 sullo
  schermo; i punti spenti sono `--screen-off`.
- **Espressioni a fotogrammi**: riposo (con battito di ciglia), parla (bocca a 2-3 fotogrammi), pensa (occhi in alto,
  punti di pensiero che salgono), felice (occhi ad arco, un saltello di un punto), errore (occhi a X, sfarfallio),
  **dorme** (occhi chiusi, luce al 50%, "z" che salgono: quando i mostri sono fermi). Animazioni CSS a `steps()` sui
  gruppi dei fotogrammi; ritmo e ritardi dal seme, così due mostri non battono le ciglia insieme.
- Prestazioni: un SVG per mostro, cerchi senza filtri; i mostri fuori vista e gli avatar dei messaggi non si animano
  (le strisce sì: a riposo battono le ciglia, sono solo cambi di `visibility`);
  "Riduci movimento" lascia il primo fotogramma.
- Nel terminale: `renderDotsText` stampa lo stesso mostro con i mezzi blocchi e i colori ANSI a 24 bit.

## Glossario dei testi
Una parola per concetto, ovunque (UI, messaggi del core, notifiche dell'app desktop):
| Concetto | Si dice | Non si dice |
|---|---|---|
| Chi coordina | **capo squadra** ("Il tuo capo squadra") | orchestratore, coordinatore |
| Cronologia di ciò che succede | **Attività** | Log, Log delle azioni, registro |
| Memoria dell'utente | **note** (Obsidian solo come compatibilità) | vault, second brain |
| Lo stop | **Ferma** / **Riprendi** | Stop, Ferma tutto, kill |
| Dove gira Monsters | **computer** ("Questo computer", "PC di casa") | PC, core, motore, server |
| Abbonamento Anthropic | **Abbonamento Claude** (Claude Code nei dettagli) | Claude Agent |
| Il terminale di un mostro | **Dietro le quinte** (tooltip "terminale") | Terminale come etichetta |
| Il modello che pensa | **modello** | provider, LLM |
| Le decisioni veloci della squadra (System 1) | **istinto** ("l'istinto della squadra"; modulo "Istinto" in Squadra) | System 1, DecisionGate, gate, classificatore |
| Il resoconto di un lavoro | **ricevuta** ("Annulla tutto il lavoro") | report, receipt, log del run |
| I risultati dei mostri per modello | **pagella** ("Pagella dei mostri") | scorecard, benchmark |
| Un uso dell'istinto che per ora annota soltanto | **in prova** | trial, beta, shadow |
| Un uso che guarda e scrive cosa avrebbe fatto, senza cambiare nulla | **solo annota** | shadow, modalità ombra |
| Un lavoro controllato e completo | **finito davvero** | verified, verificato |
| Un mostro che ripete le stesse azioni | **gira a vuoto** / **sta cambiando strada** | stuck, loop |
| Le azioni che escono dal computer fermate per chiedere | **freno** (in Attività) | outbound, gate |
| Annullare ogni nota toccata da un lavoro | **Annulla tutto il lavoro** | undo run, rollback |
| Quanto possono spendere i mostri | **tetto di spesa** ("Alza il tetto") | budget, cap, limite di costo |
| Quanto della memoria di lavoro del modello occupa la conversazione | **contesto** ("Contesto", "qui si compatta") | context window, token budget |
| Token, costi e tetto di un mostro | **consumi** ("Consumi di Titan") | usage, metriche |
| Strumenti di un programma cambiati e fermi | **in pausa** ("Strumenti in pausa", "Accetta") | rug pull, quarantena, pin |
| Lo spazio a destra con anteprima, terminale e consumi | **pannello a destra** (schede "Anteprima", "Dietro le quinte", "Consumi") | dock, inspector, sidebar destra |
| Una pagina HTML fatta da un mostro, chiusa | **pagina** "in una scatola chiusa" | artifact, sandbox, iframe |
| Un lavoro che la squadra fa da sola a un'ora fissa | **automazione** ("Nuova automazione") | routine, job, cron |
| Una squadra con capo, cartella, note e tetto suoi | **progetto** ("Nuovo progetto", "Ferma progetto") | workspace, team |
| Chi guida un progetto | **capo** ("Capo del progetto") | lead, orchestratore |
| Quello che un mostro propone e aspetta un tocco | **bozza** ("Da confermare", "Conferma", "Scarta") | draft, proposta in sospeso |
| Una volta che un'automazione gira | **giro** ("Esegui ora", "i giri") | run, esecuzione |
| Immagini e documenti mandati o creati | **file**, **allegati** ("Allega un file", sezione "File") | upload, attachment, asset |

"Jev" e "TypeSafe" compaiono solo come nome del motore nella riga "Chi decide" e nei dettagli tecnici (D-067).

I testi di "Sign in with ChatGPT" restano quelli ufficiali (D-005). Le etichette maiuscole in monospazio sono
brevi (1-3 parole); le frasi restano in minuscolo normale.
