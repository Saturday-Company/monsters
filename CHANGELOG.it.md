# Changelog

## 0.1.0-alpha.27 · 28 ottobre 2026

Una versione di stabilità: abbiamo passato tutta l’app cercando quello che poteva rompersi, e l’abbiamo corretto. Sul
Mac porta anche tutto quello che c’era nella alpha.26.

### Cosa si vede
- **I messaggi non si perdono più.** Un messaggio scritto mentre i mostri lavorano, o trattenuto mentre sono fermi,
  esce solo quando Monsters l’ha ricevuto; se l’invio fallisce dice «Non ancora inviato · Invia ora», e non parte mai
  due volte. Un messaggio con le stesse parole di uno precedente si vede in attesa come gli altri.
- **L’app si accorge di una connessione morta.** Dopo la sospensione o un cambio di Wi-Fi si ricollega da sola; se la
  sessione è scaduta ti porta al login invece di riprovare all’infinito.
- **Le bozze sopravvivono al riavvio dell’app**: Monsters tiene sempre lo stesso indirizzo locale (il primo avvio di
  questa versione riparte ancora da bozze vuote, un’ultima volta).
- **Dubbi e rifiuti più chiari.** Quando un mostro non può scrivere in una nota, una frase dice perché, con il link
  alle sue impostazioni; un lavoro «in dubbio» mostra il punto, le note consegnate e «Va bene così» o «Chiedi al capo
  di ricontrollare».
- **Un primo avvio che non si blocca**: chiede la password quando serve, puoi smettere di aspettare la proposta della
  squadra, e Indietro non mescola più due proposte.
- **Elenchi che riprovano**: un elenco che non si carica lo dice e ha «Riprova», invece di restare vuoto.
- **Modelli**: un’alternativa aggiunta prima che la sua lista arrivi si riempie e si salva; uno spazio incollato non
  rompe più la catena; Codex compare subito nei selettori.

### Più affidabile
- **I lavori lunghi tengono la risposta** nelle chat di Telegram e nelle automazioni (la storia non si ferma più ai
  primi mille eventi), e un messaggio letto da un turno poi fallito ha un run suo.
- **Ferma arriva dappertutto**: fermare un capo ferma anche i mostri a cui ha delegato; niente di nuovo parte mentre
  Monsters si chiude; una delega fermata finisce sempre nel registro.
- **I modelli di riserva ricevono quello che sanno leggere**: per un modello che non le legge le immagini diventano una
  nota e i PDF il loro testo, e questo non spegne più tutto l’account.
- **La quota gratuita di OpenRouter non si dimentica più a mezzanotte**, un tentativo interrotto è addebitato al
  modello giusto, e Ollama viene compattato sul contesto che ha davvero.
- **Il vault su Mac e Windows**: `Idee.md` e `idee.md` sono la stessa nota (niente doppioni né modifiche perse; il
  primo avvio ricostruisce l’indice una volta); i file enormi non bloccano più l’avvio, e le lettere accentate nelle
  risposte di Claude Code e Codex non si rompono più.
- **Più sicuro**: aggiungere o cambiare un programma avviato da un’app (MCP), o dare strumenti agli altri su un bot
  Telegram, chiede la password recente; una richiesta malformata non può più fermare Monsters.
- **Un solo Monsters per cartella di dati, anche dopo un crash** su Mac e Windows: un blocco rimasto viene riconosciuto
  e ripreso.

## 0.1.0-alpha.26 · 27 ottobre 2026

### Cosa si vede
- **La chat si legge come una conversazione.** Ogni risposta è un turno: mentre un mostro lavora una striscia viva
  dice cosa sta facendo; alla fine la striscia si chiude in una frase che puoi aprire. I file che ha fatto stanno
  dentro la sua risposta; le righe di servizio e la ricevuta nera escono dalla chat (restano in Dietro le quinte).
- **Ferma un solo mostro.** Mentre un mostro lavora, Invia diventa Ferma: ferma solo quel mostro (anche la sua parte
  nei lavori degli altri), non tutta l’app. Anche con ⌘/Ctrl+Maiusc+Backspace o `monsters stop <mostro>`.
- **Un campo di scrittura migliore.** Un messaggio scritto mentre il mostro lavora aspetta e lo dice; una domanda
  aperta sta in una barra sopra il campo; `/` apre i comandi (`/new`, `/stop`, `/behind`, `/attach`).
- **Azioni sui messaggi.** Ogni bolla ha Copia, l’ultima tua anche Di nuovo e Modifica; i blocchi di codice hanno il
  linguaggio e Copia. Sul telefono le bolle dei mostri usano tutta la larghezza.
- **Conversazioni precedenti.** «Nuova conversazione» è un clic, e Conversazioni riporta quelle di prima da leggere.
- **Il contesto a parole.** Quando una conversazione si allunga, una nota sopra il campo ne propone una nuova; il
  metro dei token si vede solo con i dettagli tecnici.
- **Una sola In arrivo.** «Da rivedere» e «Novità» sono un solo ingresso, con lo stesso numero dappertutto: solo ciò
  che aspetta te. Gli avvisi stanno nella barra in alto e non coprono più il campo di scrittura.
- **Le chat lunghe restano veloci**: una chat di settimane si apre subito e le risposte scorrono fluide.
- **I mostri della squadra si chiedono le cose**: un mostro può fare una domanda veloce a un compagno invece di
  tirare a indovinare o fermarsi.

### Più affidabile
- **I mostri cercano prima di chiedere**: un dato che manca si cerca nel tuo lavoro passato (note, lavori di prima,
  cartella del progetto) prima di diventare una domanda.
- **Niente più tagli a un tetto di passi nascosto**: un lavoro ha i suoi limiti e, quando ne raggiunge uno, scrive
  prima il rapporto. Un seguito come «vai pure» tiene il livello del lavoro e quello che aveva letto.
- **Le app tornano a spiegarsi**: il controllo delle iniezioni toglie solo gli ordini che non vengono da te, non le
  istruzioni di un’app sui suoi strumenti; le immagini dei servizi non si toccano più e il mostro vede il suo lavoro.
- **Il server di Monsters funziona anche con i connettori di claude.ai.**

## 0.1.0-alpha.25 · 26 ottobre 2026

### Cosa si vede
- **Primo avvio in quattro schermate.** Account, modello, il tuo nome, poi la squadra con un solo «Va bene»: niente
  pause forzate. Che lavoro fai, cosa delegare, tono e lingua arrivano dopo, in una carta «Dimmi di più su di te»
  nella chat del capo, che puoi saltare.
- **Impostazioni più semplici, senza togliere niente.** Con tutte le righe aperte le impostazioni mostrano meno della
  metà dei controlli di prima (86 invece di 194); il resto è in «Avanzate». I modelli sono un modello principale e una
  riserva; la spesa è «al massimo X € al giorno / Y € al mese» più una rete di sicurezza Prudente / Normale / Largo,
  tutto in euro; le decisioni dei mostri sono Base o Più furbe; i permessi di ogni mostro sono un livello (note, web,
  eseguire comandi) con «Applica a tutti».
- **App e Telegram.** La scheda Collegamenti ora è «App e Telegram»: il tuo bot Telegram in tre passi, i bot dei
  gruppi in Avanzate, e una galleria con la ricerca che parte dalle app più comuni.
- **Progetti più leggeri.** Un progetto si crea con il solo nome e ha cinque schede: Chat, Squadra, Note,
  Automazioni, Impostazioni. Un progetto mostra quali mostri non possono cercare sul web e li abilita con un tocco.
- **Più calmo di default.** I dettagli tecnici sono spenti per tutti (si riaccendono in Impostazioni → Generale →
  Avanzate); Consumi parte da una frase in parole; le note hanno una sola casella di ricerca.
- **Non si perde niente.** Ogni chat tiene tutta la sua storia dopo un riavvio, con «Messaggi precedenti»; le bozze di
  messaggi e note sono salvate; una frase che inizia con A–D non risponde più per sbaglio a una domanda aperta; file
  eliminati e bozze scartate si possono recuperare per qualche secondo.
- **Nessun vicolo cieco.** «Da rivedere» e «Novità» sono su ogni pagina, ogni caricamento fallito ha «Riprova», le righe
  di Attività che ti aspettano hanno il loro tasto, ed Esc chiude un livello alla volta.
- **Parole più chiare e indirizzi in inglese.** Una parola per ogni cosa in tutta l’app («Eseguire comandi», «piano»,
  «Tutti i mostri», «Stop»); gli indirizzi nella barra sono in inglese e i vecchi link funzionano ancora.
- **Limiti che si spiegano.** Un lavoro fermato a un limite scrive prima il suo rapporto e dice quale limite e dove
  cambiarlo; i piani hanno limiti propri, più larghi.

### Più affidabile
- **Un freno più solido.** Il terminale di Claude Code e quello di Monsters condividono un solo controllo contro le
  scritture nella configurazione dei mostri, con meno rifiuti sbagliati sui comandi di tutti i giorni.
- **Stop lascia un registro pulito**: ogni chiamata a uno strumento ha il suo risultato prima della fine del lavoro, su
  ogni sistema.
- **Numeri come li scrivi**: «1.000» e «1,000» si leggono nella tua lingua, e un numero ambiguo viene rifiutato invece
  che indovinato.
- **Più veloce nelle sessioni lunghe**: l’app tiene in memoria un numero limitato di eventi e il grafo delle note non
  si ricostruisce più a ogni tasto.

## 0.1.0-alpha.24 · 24 ottobre 2026

### Cosa si vede
- **Impostazioni più semplici.** Le decisioni e la pagella dei mostri stanno in «Avanzate», chiusa di default. Programmi,
  servizi, browser e programmi tuoi sono un solo gruppo, e la ricerca web gratuita e a pagamento una sola voce. Bot
  Telegram e notifiche sono righe chiuse con un riepilogo: la scheda Collegamenti è circa un terzo più corta.
- **Contatori onesti.** «Token in» non conta più come input nuovo quello che si rilegge dalla cache (lo mostra a
  parte, «+ N dalla cache»), e il contesto di una chat su Claude Code non conta più strumenti che non vengono mandati.
- **Piccoli ritocchi.** L’etichetta NEWS è arancione solo quando c’è qualcosa di nuovo; un progetto eliminato offre
  «Torna alle chat».
- **I piani di Claude Code e Codex durano di più.** Ogni messaggio non paga più di nuovo 8-17k token di istruzioni
  fisse: la conversazione ora viaggia nel messaggio e la parte fissa si rilegge dalla cache.
- **Gli strumenti di Monsters sono caricati subito** (note, domande, delega), senza un giro in più per trovarli.
- **Il modello più forte solo quando serve.** Un lavoro conta come difficile solo se il capo ne è abbastanza sicuro,
  non a caso.
- **Riassunti senza ragionamento esteso**, e con le tue chiavi API la cache dei prompt ora regge da un turno
  all’altro.

### Più affidabile
- **Meno rifiuti sbagliati nel terminale.** Leggere i file di configurazione (`ls .claude`, `grep … CLAUDE.md`) non è
  più bloccato, e un rifiuto non segna più come fallito un lavoro finito. I comandi che sembrano letture ma lanciano un
  altro programma restano fermati.
- **Niente più errore «write EPIPE»** quando si chiude il terminale del core.

## 0.1.0-alpha.23 · 24 ottobre 2026

### Cosa si vede
- **I servizi collegati funzionano subito.** Collegato un programma o un servizio (Anteiku, GitHub, Notion…), i mostri
  ne conoscono tutti gli strumenti e usano subito quello giusto: non ti chiedono più indirizzi, chiavi o accessi che
  hanno già, e gli elenchi lunghi arrivano in pochi pezzi invece che in decine di letture.
- **Ogni servizio arriva a tutti i mostri.** Un servizio che colleghi è a disposizione di tutta la squadra e di ogni
  progetto, anche di quelli che esistono già. Se un progetto non deve usarlo, lo spegni nella scheda Collegamenti del
  progetto.
- **Meno conferme.** Le scritture normali nei tuoi servizi (creare una task, aggiornare un cliente) non ti chiedono
  più il permesso; cancellare, inviare, pubblicare e pagare sì.
- **Accesso con un tocco.** Quando un capo chiede un servizio per il suo progetto, basta il tuo «Sì»: riparte da solo
  con gli strumenti nuovi, senza un altro messaggio.

### Più affidabile
- **Una connessione caduta si ricollega** invece di lasciare il servizio fermo fino a un riavvio.
- **I mostri su Codex raggiungono tutti gli strumenti** di un servizio collegato, non solo i primi 40.
- **I modelli gratuiti funzionano di nuovo**: il primo modello gratuito della catena è stato tolto dal suo fornitore
  e viene sostituito da solo.

## 0.1.0-alpha.22 · 23 ottobre 2026

### Cosa si vede
- **Risposte che si leggono al volo.** Quando i dati si leggono meglio disegnati, i mostri li mostrano direttamente in
  chat: numeri chiave, tabelle, grafici a barre, a linee e a ciambella, confronti a colonne con l’opzione consigliata,
  passi, checklist e date. Il testo intorno resta com’è, e funziona in chiaro, in scuro e sul telefono.
- **Risposte suggerite.** Sotto alcune risposte trovi i bottoni con i passi successivi («Approfondisci Metricool»): un
  tocco manda esattamente quel testo come tuo messaggio. Su Telegram sono tasti sotto il messaggio.
- **Telegram e il terminale** ricevono le stesse risposte in testo: tabelle allineate, valori in righe e una nota che
  il grafico è nell’app.

## 0.1.0-alpha.21 · 23 ottobre 2026

### Cosa si vede
- **Il terminale è acceso di default.** I mostri possono lanciare comandi da subito: una squadra agentica senza i suoi
  strumenti ha poco senso. Se usi già Monsters, il terminale si accende una volta; puoi rispegnerlo in Impostazioni →
  Permessi, e quella scelta poi resta.
- **I mostri leggono i siti che nomini.** Se chiedi di guardare un prodotto o un sito, il capo lo legge da solo invece
  di chiederti una stampa o una presentazione. Anche le pagine fatte in JavaScript ora restituiscono la loro
  descrizione.
- **Consumi del piano ChatGPT.** Con un abbonamento ChatGPT, i consumi del piano compaiono nelle Impostazioni quando
  OpenAI li manda; altrimenti il riquadro dice che non ci sono dati invece di mostrare 0.

### Più affidabile
- **«Al lavoro» vuol dire al lavoro.** L’app non mostra più al lavoro mostri fermi (scorrendo in su in una chat
  tornavano stati vecchi).
- **Niente più stop a metà.** Rileggere il contesto in cache non conta più nel limite di token di un mostro, così le
  ricerche lunghe non si interrompono.
- **Meno rifiuti sbagliati nel terminale.** I comandi di sola lettura non vengono più bloccati; solo le scritture vere
  sui file di configurazione.
- **I mostri Codex arrivano alla rete**, chiedendo prima a Monsters con gli stessi controlli del terminale di Claude, e
  usano tutti gli strumenti di Monsters.
- **«Gli strumenti della squadra non hanno risposto» ha una causa.** Se gli strumenti di Monsters non si collegano, il
  lavoro riparte una volta o si ferma dicendo perché; una delega fermata dice chi l’ha fermata e perché.

## 0.1.0-alpha.20 · 21 ottobre 2026

### Cosa si vede
- **Monsters parla inglese.** Tutta l’app ora è in inglese, con l’italiano come scelta: schermate, messaggi, Telegram,
  la chat da terminale e i menu dell’app desktop. La lingua si sceglie in Impostazioni → Generale o sulla prima
  schermata. Se usi già Monsters non cambia niente: la tua app resta in italiano.
- **I mostri scrivono nella tua lingua.** Quando crei una squadra nuova, la lingua in cui scrivono i mostri parte da
  quella dell’app, e puoi sempre sceglierne un’altra.
- **Note in inglese per un’installazione nuova.** Un’installazione nuova in inglese ha le cartelle delle note in
  inglese (`Agents`, `Private`, `profile.md`, la cartella `Monsters Notes`). Le note che hai già tengono i loro nomi:
  non si rinomina niente.
- **Comandi di Telegram in inglese** (`/stop`, `/resume`, `/new`, `/status`, `/help`); quelli italiani funzionano
  ancora.
- **L’installer di Windows** parla inglese e italiano.

### Più affidabile
- **Note più protette.** La memoria di un mostro e la cartella privata sono protette allo stesso modo in qualunque
  lingua sia la tua cartella delle note, e le impostazioni nascoste della cartella delle note non si possono più
  cambiare con gli strumenti delle note.

## 0.1.0-alpha.19 · 21 ottobre 2026

### Cosa si vede
- **Monsters è open source.** Il codice è su GitHub (github.com/Saturday-Company/monsters) con licenza Apache-2.0, e
  il sito è getmonsters.dev. Da questa versione i pacchetti si scaricano anche dalle Release di GitHub.

### Più affidabile
- **Windows, file e terminale.** Se il percorso della tua cartella utente compariva nella forma corta di Windows (per
  esempio `MARIOR~1`), i mostri potevano trovarsi bloccati la cartella di lavoro: file, comandi e Telegram si
  fermavano. Ora la cartella si riconosce in tutte e due le forme, e un percorso senza lettera di unità resta sul disco
  giusto.
- **Chiavi al sicuro anche con cartelle collegate.** Se la cartella dei dati di Monsters sta dietro un collegamento,
  la chiave nel portachiavi si ritrova sempre.
- **Lettura delle pagine web** più solida, e aggiornamenti di Electron e delle altre librerie con le loro correzioni di
  sicurezza.

## 0.1.0-alpha.18 · 19 ottobre 2026

### Cosa si vede
- **I mostri chiedono un accesso con un tocco.** Se a un progetto manca qualcosa (il web per un mostro, un servizio
  già collegato come Canva, il browser), il capo te lo chiede con una scheda «Sì, concedi / No», nell'app e su
  Telegram. Risponde solo il proprietario.
- **I progetti nuovi partono con i tuoi collegamenti.** I servizi dati a tutta la squadra (per esempio Canva) sono già
  spuntati quando crei un progetto; li togli se non servono.
- **Il web segue il permesso.** Con il web acceso in Permessi ogni mostro può cercare e leggere pagine, anche se non
  fa ricerche di mestiere.

### Più affidabile
- **Niente più «il web mi è stato negato» falso.** I mostri vedono solo gli strumenti che possono usare davvero, e
  quando qualcosa non va dicono la causa vera: un sito che rifiuta, un'impostazione spenta, un servizio non dato al
  progetto. Un «no» lo attribuiscono a te solo se l'hai detto tu.
- **Pubblicare chiede sempre conferma.** Con il browser, il clic su «Condividi» di Instagram ora si ferma e aspetta il
  tuo sì, come gli altri modi di pubblicare.
- **Memorie più pulite.** I mostri non si ricordano più conclusioni sbagliate sugli accessi, e quando cambi un permesso
  lo sanno al lavoro dopo.

## 0.1.0-alpha.17 · 19 ottobre 2026

### Più affidabile
- **Telegram, l'ultimo passo.** Dopo aver incollato il token la pagina restava su «Mi collego a Telegram…» anche
  quando il bot era già collegato. Ora si aggiorna da sola e mostra subito il codice per collegare il tuo account:
  finché non lo mandi al bot, il bot ignora tutti i messaggi, anche i tuoi.

## 0.1.0-alpha.16 · 19 ottobre 2026

### Cosa si vede
- **I mostri dei progetti si modificano.** Nella scheda Squadra di un progetto ogni mostro ha le stesse possibilità
  della Squadra personale: cambi nome, aspetto, ruolo e compiti. Il capo del progetto cambia nome e aspetto.

### Più affidabile
- **Telegram si collega dall'app.** Il collegamento del bot falliva sempre con «Non riesco a raggiungere
  api.telegram.org», anche con la rete a posto: era un difetto di come è costruita l'app, ora corretto.

## 0.1.0-alpha.15 · 19 ottobre 2026

Correzioni dalle segnalazioni di chi prova Monsters, e le novità della versione dentro l'app.

### Cosa si vede
- **Novità.** Accanto a «Da rivedere» c'è una chiave che apre questo elenco: cosa è cambiato a ogni aggiornamento. Si
  accende quando arriva una versione nuova.
- **Ogni progetto ha i suoi mostri.** Quando chiedi al tuo capo di creare un progetto, propone mostri nuovi, con nomi
  e aspetto loro. Se gli chiedi di portare un mostro che hai già, la copia ha il suo ruolo e le sue regole, ma un nome
  e un aspetto nuovi: non trovi più lo stesso mostro in due progetti.
- **Note.** Nei filtri le opzioni non escono più dal riquadro quando la finestra è stretta.

### Più affidabile
- **VPN e proxy aziendali.** Monsters usa il proxy e i certificati del computer, come il browser: Telegram, OpenAI e
  gli altri servizi funzionano anche dietro una VPN aziendale.
- **Errori più chiari.** Se un servizio non si raggiunge, Monsters dice perché (indirizzo non trovato, connessione
  intercettata, tempo scaduto…) e cosa provare.
- **Token di Telegram.** Puoi incollare anche tutto il messaggio di BotFather: Monsters prende il token da solo.
- **OpenAI dopo una pausa.** Alla riaccensione del computer Monsters riprova da solo per qualche secondo prima di
  dare errore, e un problema di rete non ti scollega mai da ChatGPT.

## 0.1.0-alpha.14 · 19 ottobre 2026

Una versione di consolidamento verso la beta: una review completa della piattaforma (funzionalità, connettori,
interfaccia, sicurezza) e la correzione di quello che ha trovato.

### Cosa si vede
- **Nomi più chiari.** Titan è «il tuo capo», chi guida un progetto è il «capo del progetto». Al posto di «Istinto»
  ci sono le «Decisioni dei mostri», e il tecnico (CLAUDE.md, regole cron, token, ID dei modelli) è sotto, come
  dettaglio.
- **Chat più pulita.** Il saluto della chat vuota è scritto bene, le righe di servizio hanno un solo stile e si
  raggruppano, gli avvisi non coprono più il campo di scrittura né le risposte delle domande.
- **Monsters non risponde?** Ora lo dice in un posto solo («Non collegato»), con «Riprova adesso», e non dà più per
  tranquilla una situazione che non lo è.
- **Barra laterale e finestre piccole.** A 1024 px i progetti restano visibili, le note si aprono con l'elenco in un
  cassetto, "Da rivedere" è più larga e mostra le proposte di progetto per intero, con la cartella che concedono.
- **Spesa.** In cima a ogni vista c'è la catena «Mostro ≤ Progetto ≤ Tutta la squadra», con un avviso se un tetto è
  più alto di quello che lo contiene. Il costo è stimato anche dove il provider non lo dice, ed è scritto.
- **Impostazioni.** Tutte le squadre in un posto, i modelli scelti per nome, la ricerca a pagamento in Collegamenti,
  interruttori e schede scelte che si distinguono anche senza colori.

### Più affidabile
- Le automazioni non restano più ferme dopo una pausa, e un giro interrotto da un aggiornamento riparte da solo.
- I messaggi scritti mentre un mostro è occupato non si perdono con Ferma o con un riavvio.
- I modelli che ragionano a lungo non vengono più interrotti dopo un minuto; le risposte tagliate lo dicono («Scrivi
  "continua" per il resto»); un limite momentaneo del modello non fa fallire il lavoro.
- Claude Code e Codex non restano più appesi in silenzio; su Windows, fermandoli, si chiudono anche i loro processi.
- I servizi collegati con OAuth (Notion e gli altri) non si scollegano più da soli; se l'accesso scade, la galleria
  dice «Serve l'accesso» e arriva un avviso.
- La ricerca web passa al motore successivo quando uno risponde vuoto o rifiuta.
- Telegram: rispetto dei limiti di Telegram, gruppi che diventano supergruppi, bot tolti dai gruppi, cambio del token
  di un bot dedicato senza perdere gruppi e persone.
- Il registro degli eventi non cresce più all'infinito: dopo 90 giorni le parti voluminose vanno in archivi mensili
  compressi (`monsters log archive`).

### Più sicuro
- Gli aggiornamenti dell'app sono firmati con una chiave nostra: l'app installa solo aggiornamenti veri, anche se
  qualcuno mettesse le mani sul server degli aggiornamenti.
- Nei gruppi Telegram, chi non è il proprietario non usa il terminale, non modifica file, non usa servizi collegati
  senza conferma, e le risposte non portano fuori note private o chiavi.
- Il controllo sui dati che escono dal computer vale per tutti i servizi collegati; la memoria dei mostri non può più
  essere avvelenata da una pagina web o da un gruppo.
- Il token della riga di comando non può più approvare il freno, cambiare permessi, tetti, password o Telegram.
- Le cartelle dei progetti non possono essere la home o cartelle di sistema; le istruzioni (CLAUDE.md, AGENTS.md) sono
  protette a ogni profondità; i file che lanciano comandi in un repo sono protetti.
- Nel browser la sessione è legata a un segreto della scheda: un altro servizio locale non può usarla.
- L'app controlla all'avvio che il proprio core non sia stato modificato; Shopify e Blender della galleria si
  installano con dipendenze verificate.

### Da sapere
- **macOS:** firmata e notarizzata come sempre. Al primo avvio dopo l'aggiornamento macOS chiede di nuovo l'accesso al
  portachiavi per «Monsters Helper»: rispondere «Consenti sempre».
- **Windows:** l'installer non è ancora firmato con un certificato (arriverà dopo la beta): al primo avvio Windows
  mostra un avviso, si procede con «Ulteriori informazioni» → «Esegui comunque».
- **Browser:** dopo l'aggiornamento serve accedere di nuovo; una scheda nuova senza altre schede aperte chiede la
  password.
- **Azioni delicate:** nel browser, o con l'app collegata al core di un altro computer, dare il terminale a un
  mostro o abbinare Telegram chiede la password se non è stata scritta negli ultimi 15 minuti. Con l'app in locale
  non cambia nulla.

## 0.1.0-alpha.13 · 18 ottobre 2026

### Cosa si vede
- **I mostri propongono le istruzioni del progetto.** Chi lavora in un progetto con una cartella può proporre come
  cambiare il CLAUDE.md o l'AGENTS.md della cartella: la proposta arriva in «Da rivedere» con le differenze, e il file
  cambia solo se la confermi. I mostri continuano a non poterli scrivere da soli.
- **«Scegli…» per le cartelle.** Nel nuovo progetto e nella scheda Cartella si sceglie la cartella dalla finestra del
  sistema, invece di scrivere il percorso a mano (nell'app desktop).
- **Ritocchi.** Il marchio è «monsters» in minuscolo; nel tetto di spesa «Al giorno» e «Al mese» sono allineati.

## 0.1.0-alpha.12 · 17 ottobre 2026

### Cosa si vede
- **Quanto resta del tuo piano.** Per i mostri sul piano Claude o ChatGPT, Monsters mostra i limiti veri (sessione e
  settimanale, con quando si azzerano), come il pannello «Utilizzo» di Claude Desktop. I numeri si aggiornano quando un
  mostro lavora su quel piano.
- **Automatica più sensata.** Il lavoro ordinario (post, mail, ricerche, analisi brevi) va su Sonnet con impegno
  Medio, i problemi difficili e la pianificazione su Opus con impegno Alto. Ogni incarico delegato ha il suo livello.
- Sul piano Claude i mostri nuovi partono in Automatica.

## 0.1.0-alpha.11 · 17 ottobre 2026

### Cosa si vede
- **Bot di Telegram dedicati a un mostro.** In Impostazioni → Collegamenti → Telegram puoi dare a un mostro un bot
  suo, da mettere in un gruppo: chi è nel gruppo parla con quel mostro. Il bot principale resta tuo e del tuo capo.
- **Su Linux l'app installata dal pacchetto .deb si aggiorna da sola** dal menu, chiedendo la password del computer.

### Più affidabile
- Un mostro non risponde più solo «OK» alla fine di un lavoro: la risposta è sempre quella vera.

## 0.1.0-alpha.10 · 17 ottobre 2026

### Cosa si vede
- **Progetti.** Un progetto è una squadra sua: un capo del progetto, fino a quattro mostri, le sue note, la sua
  cartella, i suoi collegamenti e un tetto di spesa. Nella barra laterale ogni progetto ha la sua squadra; la pagina
  del progetto ha le schede.
- **Il tuo capo propone, tu decidi.** Il tuo capo può proporre un progetto intero o un'automazione: la proposta arriva
  in «Da rivedere» (e su Telegram) e diventa vera solo con la tua conferma.
- **Automazioni.** I lavori che si ripetono (ogni lunedì, ogni sera…) hanno un menu loro, con le proposte e le bozze.
- **La barra in alto** mostra i colori di tutti i mostri al lavoro.
