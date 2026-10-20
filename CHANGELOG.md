# Changelog

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
