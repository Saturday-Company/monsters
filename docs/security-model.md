# Modello di sicurezza

Le segnalazioni di vulnerabilità vanno fatte seguendo `SECURITY.md` (nella radice del repository), non con una issue
pubblica. Questo documento descrive il perimetro, il modello delle minacce e i rischi che abbiamo accettato.

## Nel perimetro

- Il **core locale** e le sue API: autenticazione, sessioni, token della CLI, controllo di `Host` e `Origin`, WebSocket
  `/api/stream`.
- Il **kill switch**: qualsiasi modo per far ripartire o continuare il lavoro degli agenti dopo un `kill`.
- Il **log delle azioni**: segreti (chiavi API, token, password) che finiscono nel log nonostante la redazione.
- Permessi dei file in `~/.monsters` e accesso ai dati di un altro utente dello stesso PC.
- Il vault (second brain), i permessi degli agenti sul vault e la reversibilità delle modifiche.
- Le **cartelle concesse** agli strumenti `fs_*`: qualsiasi modo di leggere o scrivere fuori da quelle cartelle
  (percorsi, collegamenti simbolici), di raggiungere con `fs_*` il vault o i dati di Monsters, o di scrivere in una
  cartella concessa in sola lettura.
- I **permessi degli agenti**: un agente che ottiene uno strumento che l'utente non gli ha concesso, o che continua a
  usarlo dopo che il permesso è stato tolto.
- I **segreti di Monsters** (chiavi in `secrets/`, token della CLI, variabili `MONSTERS_*`) che arrivano
  nell'ambiente dei comandi degli agenti o, in chiaro, al modello.

## Rischi noti

- **Il log delle azioni è append-only solo verso il core.** L'immutabilità della tabella `events` si regge su trigger
  SQLite che rifiutano `UPDATE` e `DELETE`. Chi può scrivere il file `~/.monsters/monsters.db` (lo stesso utente del
  sistema, quindi anche un agente con accesso a una shell) può eliminare i trigger, modificare il database o
  sostituirlo. Il log serve a ricostruire cosa è successo, non è una prova a prova di manomissione: un registro firmato
  o tenuto fuori dalla portata degli agenti è un lavoro futuro.
- **Processi orfani su Windows.** Su Linux e macOS i processi degli agenti stanno in un gruppo proprio, registrato in
  `~/.monsters/process-groups.json`: se il core va in crash, all'avvio successivo termina i gruppi rimasti, dopo aver
  verificato che siano ancora i suoi (orario di avvio dei processi). Su Windows i processi figli di un core andato in
  crash non vengono ancora ripuliti.
- **Il terminale vale quanto il tuo account.** Un agente con il permesso "Terminale" (`shell`, spento di default)
  esegue comandi con il tuo utente del sistema: può leggere e scrivere anche fuori dalle cartelle concesse, compresi
  `~/.monsters` (chiavi, token della CLI, `settings.json`, database) e il vault senza passare da git. È il perimetro
  che scegli concedendolo, per agente, e la UI lo dice in chiaro. Mitigazioni: l'ambiente dei comandi non contiene i
  segreti di Monsters (`MONSTERS_*`, chiavi dei provider, valori uguali a una chiave caricata); le chiavi, il token
  della CLI e il codice di avvio sono mascherati nell'output che arriva al modello e nel log; ogni comando e il suo
  risultato finiscono nel log; l'output arriva al modello come dato esterno; timeout (120 s, al massimo 600); il kill
  switch e la fine del lavoro fermano il comando con tutti i suoi discendenti; Monsters non usa mai `sudo` (un
  comando che lo chiede è rifiutato: è un dosso, non un confine, e non sostituisce i permessi del sistema).
- **Processi che escono dal gruppo.** Il kill switch raggiunge il gruppo di processi del comando. Un programma che se
  ne stacca di proposito (`setsid`, demoni, `systemd-run --user`, `launchctl`, attività pianificate) non viene
  fermato. Su Windows l'albero dei processi si chiude con `taskkill /T` finché il processo principale è vivo.
- **Il controllo dei dati che escono è una regola, non un confine** (D-070). Dopo una pagina o un risultato di terzi,
  un indirizzo, una ricerca o un comando che ripete una nota privata, o pezzi lunghi di note verso un sito mai visto nel
  lavoro, si fermano con la scheda; poche parole si segnano nella ricevuta. Dati cifrati, riassunti con parole proprie
  o spezzati in tante richieste piccole non si riconoscono; sugli abbonamenti (Claude Agent) le pagine lette con gli
  strumenti del piano non contaminano ancora il lavoro. I caratteri invisibili (Unicode tag, zero-width, bidi) si tolgono da ogni testo esterno. Il controllo vale anche per gli argomenti di ogni strumento MCP, letture comprese; le note scritte dopo testo di terzi restano segnate: chi le rilegge ha le difese accese.
- **La memoria dopo testo di terzi.** In un tuo lavoro che ha letto pagine o risultati di terzi, le righe «Da
  ricordare:» si scrivono da sole con il segno «⟨da testo di terzi⟩»; aspettano la tua conferma (Da rivedere) solo
  quelle che contengono un indirizzo web, una mail o un ordine («manda», «carica», «usa sempre», «ignora»…), e tutte
  quelle di un lavoro chiesto da un'altra persona o di un gruppo Telegram. Le righe segnate arrivano al mostro dentro
  il blocco dei dati esterni, non come «La tua memoria», e un lavoro che le legge ha le difese accese. Nella nota della
  memoria (Note → Agenti) «È mia» toglie il segno da una riga; solo tu di persona, non il token. È una regola a parole,
  non un modello: una frase che non sembra un ordine («L'utente preferisce le fonti di X») si scrive da sola, segnata,
  e il mostro la legge come dato. Oltre 5 bozze aperte per mostro la più vecchia scade, con una riga in Attività.
- **Impronta degli strumenti MCP** (D-070). Al primo collegamento di un server si fida di quello che vede; da lì uno
  strumento nuovo o con descrizione o argomenti cambiati resta in pausa finché non lo accetti (i servizi della
  galleria aggiungono strumenti senza pausa, ma una descrizione cambiata si ferma comunque). Un server che cambia il
  comportamento senza cambiare nome, descrizione e schema non si vede.
- **Trascrizioni di Claude Code.** I run con l'abbonamento Claude lasciano la sessione in `~/.claude/projects`
  (serve a `--resume`, quindi `--no-session-persistence` non si può usare; `CLAUDE_CONFIG_DIR` sposterebbe anche il
  login). Contengono prompt, memoria e note lette. Quella cartella è chiusa a `fs_*` e al terminale dei mostri (dosso,
  come il resto) e la memoria automatica di Claude Code è spenta nei run; ma chi ha il terminale può sempre aggirare un
  dosso, e ogni altro programma dell'utente le legge.
- **Il cookie dell'app desktop.** La sessione dell'app sta nella sua cartella dati (`~/.config/Monsters`,
  `~/Library/Application Support/Monsters`, `%APPDATA%\Monsters`). Il pacchetto ha il fuse
  `EnableCookieEncryption`, ma la chiave è alla portata di ogni processo dell'utente: su macOS è nel Portachiavi (e con
  RunAsNode acceso un processo che usa il binario dell'app eredita il «Consenti sempre»), su Windows è protetta da DPAPI
  dell'utente, su Linux sta nel portachiavi (libsecret o kwallet), che non ha controlli per applicazione. **Su Linux
  senza portachiavi** (server, sessioni senza D-Bus, `--password-store=basic`) Chromium usa una chiave fissa e nota:
  i cookie sono in pratica in chiaro; senza fuse (avvio dai sorgenti) lo sono su tutti i sistemi. La cifratura
  protegge da una copia del disco o dei backup, non da un mostro con il terminale. Per questo: in modalità locale il
  cookie di proprietario è di sessione (non va su disco, a ogni avvio si rientra dal bridge) e un cookie limitato
  rimasto da una sessione agganciata viene sostituito; la cartella dati dell'app è chiusa al terminale, a `fs_*` e agli
  harness dei mostri (dosso, come le trascrizioni). Le sessioni agganciate, via SSH e del browser tengono il cookie
  7 giorni, ma le azioni più sensibili vogliono la password degli ultimi 15 minuti (vedi sotto, «Conferma recente»).
- **Server della galleria e dipendenze.** Shopify gira da un pacchetto installato una volta con `npm ci` su un
  lockfile nostro (integrity di ogni pacchetto, niente script, registry pubblico), come il browser. Blender gira da un ambiente Python
  dedicato (`~/.monsters/mcp-packages/blender`): `uv pip install --require-hashes --only-binary :all:` su requisiti
  nostri (versione e sha256 di ogni file di ogni pacchetto, indiretti compresi, per Linux, macOS e Windows; niente
  build), poi il server dal tarball del suo commit con il suo sha256 (uv rifiuta un archivio diverso), `--no-deps`,
  senza configurazione di uv/pip dell'utente; parte dal Python dell'ambiente, mai `uvx`. Resta: i requisiti li
  abbiamo generati alla data 18/10, quindi una versione già compromessa prima non si ferma; il tarball viene da
  projects.blender.org (se Gitea cambia il modo di comprimere gli archivi, l'installazione si ferma finché non
  aggiorniamo lo sha256).
- **Il cookie di sessione nel browser arriva a tutti i servizi su `127.0.0.1` (S-B13).** I cookie non distinguono
  le porte: con la UI aperta in un browser, un altro server su `127.0.0.1:<porta>` che visiti (un dev server con
  codice scritto da un mostro, il servizio di un altro utente del PC) riceve `monsters_session`. Da solo non basta
  più: una sessione aperta nel browser è legata a un **segreto della scheda**, che il core dà alla UI all'accesso
  (nella risposta, mai in un cookie) e che la UI tiene in memoria e in `sessionStorage` (di quell'origine, porta
  compresa: un altro servizio locale non lo legge). La UI lo manda nell'intestazione `X-Monsters-Session` di ogni
  richiesta e nel primo messaggio del WebSocket (non nell'URL, che finisce nei log e nella cronologia); il core
  accetta una richiesta col cookie solo se il segreto è quello della sessione (salvato come hash), altrimenti 401.
  Le anteprime e i download (`<img>`, `<iframe>` delle pagine in sandbox, link «Scarica») non portano
  intestazioni: passano con un **gettone** nell'URL (`?ticket=`), chiesto dalla UI con il segreto, legato alla
  sessione, a quel file e a quella parte (contenuto o miniatura), valido 2 minuti e per 16 richieste, tenuto solo in
  memoria, con un massimo di gettoni per sessione (quelli di un'altra sessione non spingono fuori i suoi). Fanno
  eccezione le miniature: un gettone vale per le miniature di tutti i file della sessione (2.048 richieste), così una
  lista lunga ne chiede uno solo. Nel browser «Scarica» è un pulsante che chiede il gettone al clic, non un link: un
  indirizzo senza gettone, aperto in una scheda nuova o copiato, risponderebbe 401. Il recupero del segreto con un endpoint protetto da intestazioni (`Sec-Fetch-Site`, anti-CSRF) non regge:
  un server che ha il cookie le scrive da Node come vuole. Per questo **una scheda nuova chiede il segreto alle schede
  già aperte** sulla stessa origine (`BroadcastChannel`, che un'altra porta non raggiunge); un ricaricamento lo
  ritrova in `sessionStorage`; **senza schede aperte il browser chiede di nuovo la password**. **L'app desktop non
  cambia:** tiene il cookie in una sessione sua per ogni destinazione (D-044), dove nessun altro sito lo riceve, e
  apre le sessioni senza segreto (accesso automatico, e `partitioned` quando si scrive la password nella finestra);
  lo stesso per il tunnel SSH dell'app. La CLI usa il token, come prima. Restano: un programma del tuo utente che legge
  il profilo del browser su disco (cookie e `sessionStorage` salvati per il ripristino delle schede) ha entrambi, come
  aveva il cookie; e le sessioni aperte prima di questa versione sono state chiuse (si rientra una volta).
- **Conferma recente per le azioni più sensibili** (rischio residuo di M1). Una sessione confermata con la password
  resta tua per 7 giorni, ma dare il Terminale a un mostro, abbinare un account Telegram o cambiare il bot principale
  e accendere «Strumenti per gli altri» di un bot dedicato vogliono la password scritta in quella sessione negli
  ultimi 15 minuti (lato server, `confirmed_at`); altrimenti il core risponde `confirm_required` e la UI chiede la
  password («Conferma che sei tu», `POST /api/auth/confirm`, nella stessa sessione). Il cambio di password chiede già
  quella attuale. La sessione che l'app desktop apre da sola sul suo core (dal canale dell'app, cookie mai su disco,
  nuova a ogni avvio) conta sempre come recente: l'esperienza della modalità locale non cambia. Dura quanto il core
  che l'ha aperta: al riavvio del core le sessioni dell'app si chiudono e l'app ne chiede una nuova da sola, così una
  copia del suo cookie non resta «recente» per una settimana. Ripristinare dall'archivio un mostro (o un progetto
  con i suoi mostri) che aveva il Terminale chiede la stessa conferma di darglielo.
- **Aggancio al core locale.** L'app desktop e la CLI mandano il token della CLI solo a un core che prova di essere
  quello della cartella dei dati (HMAC con la `proofKey` di `server.json`, come il tunnel); un core senza `proofKey` non
  si aggancia. L'IPC dell'app riconosce la pagina del core dall'origine del frame, non dall'URL.
- **Cestino dei file.** `fs_delete` e le sovrascritture di `fs_write`/`fs_move` spostano o copiano i file in
  `~/.monsters/trash/files/`: si recuperano da lì, ma il cestino non si svuota da solo.
- **Scrivere un file può valere quanto il terminale.** Alcuni file fanno eseguire comandi al computer più tardi:
  cartelle `.git` (hook, `core.fsmonitor` in `config`), `.husky`, profili della shell (`.bashrc`, `.profile`,
  `.zshrc`…), `.envrc`, `.npmrc`, `.yarnrc.yml`, `.vimrc`, `.ssh/`, `.vscode/`, avvio automatico
  (`~/.config/autostart`, `~/Library/LaunchAgents`, cartella Esecuzione automatica di Windows, profili di
  PowerShell). Un agente **senza** il permesso "Terminale" non può scriverli né spostarci file o cartelle con
  `fs_write`/`fs_move`, in nessuna cartella concessa; con il terminale il blocco non avrebbe senso e non c'è.
  L'elenco non è esaustivo (un programma può leggere configurazioni ovunque): concedere la scrittura su una cartella
  che contiene progetti o file di configurazione resta una scelta da fare con attenzione, e la UI lo ricorda.
  Dalla review del 18/10 l'elenco copre anche i file di un repo che lanciano comandi al prossimo test o commit
  (`Makefile`, `justfile`, `Taskfile`, `.pre-commit-config.yaml`, `lefthook`, `conftest.py`, `tox.ini`, `noxfile.py`,
  `setup.py`, `build.rs`, `.pnpmfile.cjs`, `.devcontainer/`, `.idea/`, `.cargo/config.toml`, `.github/workflows/`) e
  `~/.local/bin` e `~/.local/share/applications`. Il `package.json` si scrive, ma senza cambiare `scripts`, `husky`,
  `simple-git-hooks`, `lint-staged` e `bin` (si guarda il contenuto prima e dopo, anche negli spostamenti). **Non è un
  confine**: chi scrive il sorgente di un progetto (un `.ts`, un `.py`, una configurazione di test) fa partire codice
  al prossimo `pnpm test` o `git commit` comunque. Per questo la scheda del progetto dice che tutti i suoi mostri
  scrivono nella cartella, e in un lavoro che ha letto testo di terzi ogni scrittura (`fs_write`, `fs_move`,
  `fs_delete`) nella cartella di un progetto è una scheda del freno, anche con il terminale, a prescindere dalle regole
  di "Chiedi sempre". Un percorso relativo conta come dentro la cartella. Non vale per gli agenti di Claude Code o
  Codex con i loro strumenti: lì restano i controlli dei loro hook.
- **Cartelle dei progetti.** Un progetto non può avere come cartella la home, la radice di un disco, una cartella che
  le contiene, una cartella nascosta della home (`~/.ssh`, `~/.config`…), `Library` o `AppData`, né una cartella che
  contiene o sta dentro le note, i dati di Monsters o la cartella dove è installata l'app. Vale per proposte e per
  creazione, sul percorso dato e su quello reale, e di nuovo al tocco di "Conferma". La scheda della bozza (app e
  Telegram) dice che tutti i mostri del progetto potranno leggere e scrivere lì e porta l'avviso di testo di terzi; da
  Telegram una cartella già esistente fuori da `~/Monsters Progetti` si conferma solo nell'app.
- **Cartella d'installazione dell'app.** L'app desktop passa al core dove è installata (`resources/` e la cartella
  dell'eseguibile, variabile `MONSTERS_INSTALL_DIRS`): `fs_*` non ci entra, anche passando da una cartella concessa che
  la contiene (su Windows l'installazione è per utente, nella home). Il core sta fuori dall'ASAR, in
  `resources/core`: il pacchetto porta dentro `app.asar` l'elenco sha256 di tutti i suoi file per piattaforma e
  architettura (`core-manifests/`, generato dal core preparato e ricontrollato sul pacchetto finito), e l'app lo
  confronta con `resources/core` prima di ogni avvio del core, anche dopo un crash: un file cambiato, in più o mancante
  e il core non parte, la finestra lo dice (S-M9; ~60 ms per 150 file e 21 MB). Il core di sviluppo indicato con
  `MONSTERS_DESKTOP_CORE` vale solo fuori dal pacchetto. Su macOS i moduli nativi (`.node`) si firmano dopo il
  pacchetto: se ne controlla la presenza, il contenuto lo garantisce la library validation.
  - **Niente moduli da fuori (review del 19/10, n. 1).** I pacchetti facoltativi che il codice cerca dentro un
    try/catch (`bufferutil`, `utf-8-validate`, `supports-color`, `encoding`) sono nel bundle come moduli che falliscono
    come un pacchetto assente: il core non li cerca mai su disco. L'app avvia il core con `MONSTERS_CORE_CONFINE=1`,
    senza `NODE_PATH`: un hook di risoluzione (`module.registerHooks`, in testa a ogni file del bundle) rifiuta ogni
    `require` o `import()` che finisce fuori da `resources/core`, così un pacchetto messo in `resources/node_modules` o
    più su non gira nel core. Gli import statici (`@node-rs/argon2`) si risolvono prima dell'hook, ma nella
    `node_modules` più vicina, quella di `resources/core`, coperta dall'elenco.
  - **Cosa copre l'elenco, sistema per sistema (n. 4).** Su macOS e Windows l'elenco sta in un `app.asar` coperto dal
    fuse di integrità (l'hash dell'asar è dentro l'eseguibile firmato). **Su Linux Electron non verifica l'asar**: chi
    può scrivere nella cartella d'installazione riscrive insieme `app.asar`, l'elenco e il core, e la verifica non lo
    ferma. Su Linux il controllo vale quindi solo dove l'utente non può scrivere lì: il `.deb` (in `/opt`, di root) e
    l'AppImage (in sola lettura); una cartella estratta nella home (`--dir`, un archivio) non è protetta. Legare
    l'elenco alla firma degli aggiornamenti non cambierebbe niente: chi riscrive l'asar riscrive anche il codice che
    la controlla.
  - **Tra controllo e uso passa tutta la sessione, non un istante (n. 12).** Il controllo è all'avvio del core; dopo,
    il core legge altri file anche ore più tardi: `embed-worker.js` ed `extract-worker.js` quando servono, i file
    della UI (`web/`) a ogni pagina, il `.node` di argon2 al primo uso. Chi può scrivere in `resources/core` con altri
    mezzi (per esempio un mostro con il terminale, su un'installazione scrivibile dall'utente) può cambiarli dopo il
    controllo. Il binario del portachiavi, che gira con l'identità dell'helper dell'app, si ricontrolla invece a ogni
    chiamata: l'helper ne rilegge lo sha256 dall'elenco subito prima di caricarlo (su Linux e Windows; su macOS c'è la
    library validation), e uno diverso non si carica.
- **Il binario dell'app non fa da Node.** Il fuse `RunAsNode` dell'app desktop è spento (review del 18/10, S-M8):
  nessun programma dell'utente può avviare il binario firmato come un Node qualsiasi per ereditarne l'identità (su
  macOS il "Consenti sempre" del portachiavi sulla chiave dei segreti e i permessi TCC dati all'app; su Ubuntu il
  profilo AppArmor che gli permette i namespace utente). Le chiamate al portachiavi girano in un processo dell'app
  (l'helper) il cui JavaScript sta tutto nell'`app.asar`, coperto dal fuse di integrità su macOS e Windows: di
  `@napi-rs/keyring` carica solo il binario nativo della piattaforma (`process.dlopen`, nome del file fisso), mai il
  suo `index.js` in `resources/core`. L'helper (e prima ancora l'app) accetta solo le voci di Monsters: servizio `Monsters`, account
  `home-` più 24 cifre esadecimali; ogni altra voce, per esempio quella di un'altra app che macOS mostrerebbe a nome di
  Monsters, è rifiutata. Il binario nativo resta fuori dall'asar, in `resources/core` (un `.node` dentro l'asar
  Electron lo estrarrebbe in una cartella temporanea, scrivibile dall'utente): su macOS lo protegge la library
  validation del runtime rinforzato (deve essere firmato con il Team ID dell'app), mentre su Windows (installazione
  per utente) chi può scrivere in `resources/core` può sostituirlo e farlo girare con l'identità dell'helper, come può
  già sostituire il core (gli hash del core controllati dall'asar, M9, lo fermano all'avvio, e l'helper ricontrolla
  lo sha256 del binario subito prima di caricarlo: resta solo l'istante tra le due cose). Su Windows e Linux il
  portachiavi non distingue comunque i programmi. I figli JavaScript del core (browser, server MCP della galleria, Codex, npm)
  usano un `node` del PATH, come già facevano per installarsi, e non hanno l'identità dell'app: il core lo cerca una
  volta all'avvio e ne tiene il percorso assoluto, saltando le voci relative del PATH, le cartelle in cui i mostri
  possono scrivere (cartella dati con le loro home, vault, cartella dei progetti e cartelle concesse in scrittura),
  su Windows tutto ciò che non è `node.exe` (niente `.cmd` o `.bat`) e i Node più vecchi della 20. Un `node` messo dopo
  in una cartella del PATH non cambia quello dei figli fino al riavvio; resta dirottabile un `node` in una cartella del
  PATH scrivibile dall'utente con altri mezzi (per esempio con il terminale). Resta vero che chi esegue
  programmi come te può chiedere al portachiavi la chiave dei segreti dove il portachiavi non distingue i programmi
  (Secret Service su Linux) e leggere i file dei dati (vedi "Il terminale vale quanto il tuo account").
- **Aggiornamenti dell'app desktop** (review del 18/10, S-A4 e S-A5; dettagli in `docs/signing.md`). Dalla prima alpha
  con la verifica, ogni file di canale del feed (`alpha*.yml`, con lo sha512 dei pacchetti) ha una firma Ed25519
  nostra (`.sig`), verificata dall'app con le chiavi pubbliche che porta con sé prima di scaricare; per il deb la
  ricontrolla root, con le chiavi di `/opt/Monsters/resources`, insieme al nome del pacchetto e a una versione più alta
  di quella installata. Chi scrive nel bucket R2 o controlla l'account Cloudflare non basta più per far installare
  qualcosa: serve la chiave privata, che non sta su Cloudflare. L'app legge il file di canale e la sua firma una volta
  sola, dal suo provider, e dà a electron-updater proprio l'oggetto firmato: niente seconda lettura, niente campi legacy
  (`path`, `sha2`) che portino a un altro download; lo sha512 del file scaricato si ricontrolla contro il file firmato.
  La chiave privata, nell'utente che fa girare core e agenti, sta solo cifrata (scrypt N=2^20 e AES-256-GCM, con
  `node:crypto`: nessun altro programma la vede); la passphrase si digita sul terminale a ogni pubblicazione, mai in
  una variabile d'ambiente. **Non è vero che la chiave sia fuori dalla portata degli agenti:** la pubblicazione esegue
  codice del repo con la chiave decifrata in memoria, quindi un commit o un `node_modules` manomesso in questo utente
  può portarla via mentre si pubblica (per questo si pubblica da un checkout pulito di un commit rivisto; un firmatario
  separato che non esegue codice del repo non c'è ancora). Lo script di root del deb verifica con `/usr/bin/openssl`
  3.0 o più recente (Depends e controllo della versione). Una build di prova (`--test-build`, chiavi `test-`) non si
  può pubblicare. Restano: le alpha già installate fino alla 0.1.0-alpha.13 non verificano (si aggiornano una volta
  senza firma); un feed compromesso può ancora non dare aggiornamenti o fermarsi all'ultima versione firmata; chi ha
  la chiave privata pubblica come noi. Sul Mac i segreti di firma Apple non devono essere dell'utente della CI
  (nel disegno `monsters-ci`, che esegue install con gli script delle dipendenze, build e test di ogni commit): la
  build firmata la fa un utente separato (`monsters-sign`), via sudo, con uno script fisso installato da root fuori dal
  repo, su un checkout suo del commit verificato per sha e un suo `pnpm install --ignore-scripts`, con la chiave
  Developer ID non estraibile nel suo portachiavi (vedi `docs/signing.md`, "Mac: utente di firma"). Se i passi di
  quella sezione non sono stati fatti, i file dei segreti restano leggibili dall'utente della CI, e lo script di CI lo
  segnala a ogni run. Resta vero, anche con la separazione, che il packaging firmato esegue codice
  del commit con il portachiavi aperto: un commit malevolo può far firmare qualcos'altro, quindi si firmano solo commit
  di `main` già rivisti.
- **File speciali e corse in `fs_*`.** I file si aprono senza seguire un link nell'ultimo elemento e senza bloccarsi
  (`O_NOFOLLOW|O_NONBLOCK`); sul descrittore si controlla che sia un file normale (una FIFO o un dispositivo si rifiutano
  senza bloccare il core), si rilegge il percorso reale (`/proc/self/fd` su Linux) e si ripetono i controlli delle
  cartelle concesse, delle istruzioni e dei file di avvio. Un file con più nomi (hardlink) non si scrive. Le cartelle
  mancanti si creano un livello alla volta, e spostamenti e cancellazioni passano dalla cartella che contiene la voce:
  su Linux aperta come descrittore (`/proc/self/fd/<n>/<nome>`, Node non ha `renameat`/`mkdirat`) dopo aver
  controllato che sia proprio la cartella controllata, così una cartella intermedia sostituita con un link dopo i
  controlli non porta l'operazione fuori; su macOS e Windows si rilegge il percorso reale della cartella subito prima
  (la finestra si stringe, non sparisce). Una cartella spostata, sostituita o cancellata dentro la cartella di un
  progetto, o che ne contiene una, si guarda dentro (al massimo 10.000 voci, oltre si rifiuta): le istruzioni di un
  progetto non entrano, non escono e non vanno nel cestino neanche dentro una cartella e neanche con il terminale.
  Senza terminale si guarda dentro anche ogni cartella spostata, ovunque arrivi: nessun file che lancia comandi e
  nessuna istruzione arrivano a destinazione. Una cartella grande lontana dai progetti (un `node_modules`) si cancella,
  e con il terminale si sposta, senza guardarci dentro.

- **Il token della CLI non è l'utente di persona.** `~/.monsters/cli-token` è un file che ogni processo del tuo
  utente può leggere, compreso un agente con il terminale. Con il token si possono vedere lo stato, usare il kill
  switch, riprendere, scrivere in chat e lanciare le automazioni; non si possono rispondere alle schede del freno,
  cambiare permessi, regole "Chiedi sempre", tetto di spesa, decisioni dei mostri, Telegram (bot principale,
  abbinamento, bot dedicati), confermare bozze e progetti, aggiungere, togliere o accettare server MCP e connettori,
  cambiare chiavi, indirizzi e modelli dei provider e gli abbonamenti, accendere gli script di una pagina, ripristinare
  un mostro o un progetto archiviato, togliere mostri e progetti, annullare modifiche del vault, né scrivere la memoria
  di un mostro, il profilo o `Privato/` (si scriverebbero senza segno). Un test elenca tutte le route che cambiano lo
  stato: una nuova route non classificata lo fa fallire. Lo stesso vale per la
  sessione che l'app desktop apre da sola con il token (core avviato dal terminale o raggiunto via SSH): per quelle
  azioni l'app chiede la password. La password senza quella vecchia (`monsters password`) si cambia solo a core
  fermo. Un messaggio scritto con il token conta ancora come parola tua: un agente con il terminale può scrivere
  in chat al tuo posto. Un token fuori dalla portata degli agenti (portachiavi) è un lavoro futuro.
- **Bot dedicati: chi non sei tu lavora con meno strumenti.** In una chat di un bot dedicato (un gruppo, o il
  privato con una persona ammessa), quando scrive qualcuno che non è l'account abbinato al bot principale, il
  mostro non ha il terminale (né quello di Claude Code o Codex), non scrive, sposta o cancella file, usa gli altri
  programmi (MCP e connettori) solo dopo una scheda a te, anche per una lettura (mail, Notion, calendari) o una bozza,
  e nel vault vede solo l'area del suo progetto, la propria area e `Inbox/`; `file_read` legge solo i file di quella
  chat. La risposta che va nella chat, e ogni domanda del mostro alla chat, passa dal controllo dei dati in uscita
  (anche senza testo di terzi): una chiave, una nota privata, la memoria ripetuta o un tratto di seguito di almeno 120
  caratteri uguale a una nota non partono; le note dell'area del progetto del bot non contano (sono il materiale del
  gruppo). La chat ne riceve una riga, tu un avviso con «Manda comunque» (su Telegram e in Attività), tranne per una
  chiave. Gli strumenti completi si riaccendono bot per bot (Impostazioni → Collegamenti →
  Telegram → "Strumenti per gli altri"), con un avviso; restano comunque chiusi `Privato/` e il profilo. È una
  regola, non un confine: un riassunto con parole proprie o una risposta spezzata non si riconoscono.

## Fuori dal perimetro

- Azioni compiute da un agente dentro i permessi che l'utente gli ha concesso, anche a seguito di prompt injection: è
  un rischio dichiarato del principio "nessun blocco" (vedi `docs/ARCHITECTURE.md` §5.8). Con il terminale il perimetro
  è l'intero account dell'utente (vedi sopra). Segnalaci però i modi per **uscire** da quei permessi.
- Esporre volutamente il core in rete con `--allow-non-loopback`.
- Vulnerabilità dei provider AI o dei servizi esterni collegati.

## Rischio accettato: `sudo` senza password (D-119)
Se l'utente che fa girare core e mostri ha `sudo` senza password, un mostro col Terminale (o Claude Code/Codex con i
loro strumenti di sistema) può fare qualsiasi cosa come root: leggere i dati di Monsters e di altri utenti, cambiare il
sistema, installare programmi. Le difese di Monsters (cartelle protette, freno, dati in uscita) restano un confine per
i mostri senza Terminale e un freno per quelli che ce l'hanno. Su un'installazione normale l'utente non ha `sudo`
senza password e questo rischio non c'è: se ce l'ha, concedere il Terminale equivale a concedere root.

## Rischio accettato: la passphrase della chiave degli aggiornamenti nel portachiavi (D-126)
Per pubblicare i rilasci senza che nessuno sia al terminale, chi pubblica può tenere la passphrase della chiave di
firma degli aggiornamenti nel portachiavi della sessione (per esempio con `MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD`
che la legge da lì). Chi controlla quell'utente (anche un mostro col Terminale) può allora firmare un aggiornamento che
le app installano. La firma resta una difesa piena contro un server degli aggiornamenti violato (storage, CDN, Worker),
non più contro la macchina di pubblicazione violata. Per tornare a prima: togliere la passphrase dal portachiavi e
pubblicare scrivendola al terminale; se la macchina fosse compromessa, generare una nuova chiave
(`update-signing-key.ts generate`) e passare dal ponte di firma descritto in `docs/signing.md`.
