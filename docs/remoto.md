# Usare Monsters da lontano: SSH e Telegram

Il core di Monsters ascolta solo su `127.0.0.1` del tuo PC e non apre porte verso l'esterno (D-013). Da lontano ci
sono due strade, entrambe client dello stesso core, con lo stesso log e lo stesso kill switch (D-002):

- **SSH** (D-014): entri nel PC con il tuo SSH e usi la riga di comando `monsters`, oppure apri la UI web con un
  tunnel, oppure colleghi l'app desktop di un altro computer (il tunnel lo apre lei).
- **Telegram** (M2.6): scrivi al tuo bot dal telefono. Niente da installare, ma passa dai server di Telegram.

## SSH

### Collegarsi con una chiave
1. Sul computer da cui ti colleghi, crea una chiave (una volta sola) e copiala sul PC di Monsters:

   ```sh
   ssh-keygen -t ed25519
   ssh-copy-id utente@pc-di-monsters
   ```

2. Sul PC di Monsters togli l'accesso con password: in `/etc/ssh/sshd_config` metti `PasswordAuthentication no`
   (e `PermitRootLogin no`), poi `sudo systemctl reload ssh`. Prima prova che la chiave funzioni da un'altra
   finestra, così non resti chiuso fuori.
3. Se il PC non è raggiungibile da internet, non aprire la porta 22 sul router: usa una VPN come Tailscale o
   WireGuard e collegati al suo indirizzo privato.

### La chat nel terminale
Il core deve essere acceso sul PC (`monsters start`, per esempio dentro `tmux` così resta acceso quando chiudi la
sessione). Poi, dalla sessione SSH:

```sh
monsters chat
```

È una chat interattiva, senza browser:

- ogni riga è un messaggio alla squadra; `@Rhea …` all'inizio parla con un mostro preciso (oppure
  `monsters chat --to Rhea`);
- le risposte compaiono mentre il mostro le scrive; deleghe, note toccate ed errori in righe brevi;
- una domanda mostra le opzioni numerate: scrivi il numero per scegliere, `/risposta <testo>` per rispondere a
  parole (anche alle domande aperte);
- `/stop` ferma subito tutti i mostri (kill switch), `/riprendi` li fa ripartire dopo una conferma;
- `/nuova` (o `/nuova @Rhea`) inizia una nuova conversazione, `/stato` dice cosa sta girando, `/aiuto` elenca i
  comandi, `/esci` (o Ctrl+D) chiude la chat: i lavori in corso continuano.

Con l'input da un file o da una pipe (`echo "riassumi la settimana" | monsters chat`) la chat aspetta la fine dei
lavori che ha avviato e poi esce. Restano anche i comandi singoli: `monsters chat "<testo>"`, `monsters answer <id>
<n|testo>`, `monsters status`, `monsters kill`, `monsters resume`.

Il primo avvio (account, squadra, permessi) si fa nella UI web: da SSH usa il tunnel qui sotto.

### La UI web con un tunnel
```sh
ssh -N -L 4747:127.0.0.1:4747 utente@pc-di-monsters
```

Poi apri `http://127.0.0.1:4747` nel browser del computer da cui ti colleghi. Usa la **stessa porta** a sinistra e a
destra (`4747:…:4747`, o quella di `monsters start --port`): il core accetta solo le pagine aperte dalla sua
origine e rifiuta le altre. Il login è quello solito.

### Dall'app desktop
Con l'app desktop non serve aprire il tunnel a mano: aggiungi il PC come connessione e l'app usa il tuo `ssh` per
collegarsi al Monsters che gira lì (D-044, D-047).

0. Al primo avvio l'app chiede **Dove lavorano i tuoi mostri?**: "Su un altro mio computer" apre direttamente il
   modulo qui sotto, e il Monsters di questo computer non parte.
1. **Connessioni…** (menu Monsters, icona nella barra o pulsante delle pagine di stato) → **Aggiungi un computer**:
   il computer (indirizzo, nome Tailscale o un alias di `~/.ssh/config`, anche `utente@computer`) e, se vuoi, un nome
   ("PC di casa"; vuoto = l'indirizzo). Utente, porta, chiave, porta di Monsters e cartella dati stanno in **Opzioni
   avanzate**, con i valori che userebbe `ssh` già scritti in grigio: di solito non servono. **Prova** apre e chiude il
   collegamento senza cambiare computer e dice se funziona; poi **Salva e collega** (anche con Invio). Se l'indirizzo
   non si trova in rete l'app lo dice al primo "Salva"; un secondo "Salva" lo tiene comunque.
2. La prima volta l'app mostra l'impronta della chiave del PC: confrontala con quella che stampa, sul PC,
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` e premi **Mi fido, collegati** solo se coincide. L'app se la
   ricorda nel suo `known_hosts` (i tuoi `~/.ssh/known_hosts` li legge e non li tocca); se un giorno la chiave cambia,
   non si collega e te lo dice.
3. Con **Entra senza password** (acceso di default nelle connessioni nuove) l'app entra da sola: legge via SSH il
   token della riga di comando del PC e lo usa una volta per aprirti la sessione. Chi ha la tua chiave SSH può già
   comandare Monsters lì, quindi non dà accessi nuovi; spegnilo se preferisci che l'app non tocchi quel token, e
   allora entri con email e password del Monsters di quel PC (una volta sola). Se quel Monsters non è mai stato
   configurato, il codice di avvio lo legge l'app via SSH e scrivi solo email e password.

Da quel momento l'app riapre quella connessione a ogni avvio. **Usa** (menu o barra) passa da "Questo computer" a
un'altra connessione; con una connessione remota il Monsters di questo computer non gira, quindi se lì ci sono lavori
in corso l'app chiede prima di fermarli. Il titolo della finestra e l'icona nella barra dicono dove sei collegato.

- Servono una chiave SSH già funzionante (vedi sopra), o l'agente SSH, e il core acceso sul PC. Le password non sono
  supportate: se l'accesso viene rifiutato, `ssh-copy-id utente@pc` e, per una chiave con passphrase, `ssh-add`.
  Dalla pagina d'errore, **Correggi la connessione** apre il modulo sul campo da cambiare.
- La porta del core la trova da sola; non serve che sia uguale ai due lati.
- Prima di mostrarti il Monsters del PC, l'app controlla che sia proprio lui: il core scrive a ogni avvio una chiave
  in `server.json` e risponde a una sfida firmata con quella chiave. Per questo il PC deve avere una versione di
  Monsters uguale o più recente di quella dell'app (altrimenti l'app chiede di aggiornarlo), e per ora il PC remoto deve
  essere Linux o macOS.
- Se la rete cade o il computer va in sospensione, l'app si ricollega da sola: in basso nella finestra compare
  "Mi ricollego…", poi "Collegato a …". **Ricollega** nel menu prova subito.
- **Ferma tutto** e **Riprendi** del menu e della barra agiscono sul Monsters che stai guardando, anche se è remoto.
- Uscire dall'app chiude il tunnel; il Monsters sul PC resta acceso con i suoi mostri.

#### App e servizi con l'accesso (OAuth) da un altro computer
Collegare un servizio della galleria con "Accedi a …" (Notion, Linear, Sentry…) funziona anche quando il Monsters è su
un altro PC, senza tunnel a mano (D-072): la pagina del servizio si apre nel browser del computer da cui lavori e,
dopo l'accesso, torna all'indirizzo da cui l'app (o il browser) vede il Monsters, cioè il tunnel su questo computer.
Il tunnel la porta al Monsters del PC, che controlla lo `state` e completa l'accesso con il suo PKCE: codici e token
non passano da altre parti e restano sul PC.

- Con l'app desktop non serve niente: il tunnel è il suo.
- Con la UI web e `ssh -L` vale lo stesso, finché il tunnel resta aperto durante l'accesso.
- Se la pagina di ritorno non si apre (tunnel caduto, Monsters raggiunto in rete con `--allow-non-loopback`), nel
  pannello del servizio c'è "La pagina di ritorno non si apre?": copia l'indirizzo dalla barra del browser e
  incollalo lì. Vale una volta sola, per 10 minuti, e solo per l'accesso avviato da te.

#### Dal Mac a un PC con Tailscale (esempio)
Il PC si chiama `my-desktop` su Tailscale e accetta SSH solo con chiave, per l'utente `alice`; sul Mac c'è un alias
in `~/.ssh/config`:

```
Host my-desktop
  HostName 100.64.0.1   # l'indirizzo Tailscale del PC
  User alice
```

1. Sul PC il core deve essere acceso (`monsters start`, o l'app desktop aperta su "Questo computer" e lasciata lì).
2. Dal Mac, in un terminale, `ssh my-desktop true` deve rispondere senza chiedere password (la chiave è nell'agente o
   senza passphrase).
3. Nell'app sul Mac: **Connessioni…** → **Aggiungi un computer**, computer `my-desktop` (l'alias: utente, indirizzo e
   chiave vengono da `~/.ssh/config`), nome "Il mio PC", il resto vuoto → **Prova**, poi **Salva e collega**.
4. Confronta l'impronta con quella che stampa il PC (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), conferma,
   entra con l'account di Monsters del PC.
5. Prove: una chat, "Ferma tutto" dalla barra dei menu (si ferma il core del PC), Wi-Fi spento e riacceso o Mac in
   stop (banner e riconnessione), poi **Usa → Questo computer**.

Il server SSH del PC permette i tunnel (`AllowTcpForwarding` è al valore di default): non serve cambiare niente.

### Sicurezza
- Chi entra nel PC con il tuo utente ha Monsters in mano: la CLI usa il token in `~/.monsters/cli-token` (permessi
  600, rigenerato a ogni avvio del core). Proteggi l'accesso SSH come proteggeresti il PC.
- Non avviare il core con `--allow-non-loopback` per raggiungerlo da fuori: passa sempre da SSH o dal tunnel.
- Le azioni fatte da terminale finiscono nel log come quelle della UI (canale "riga di comando").
- La chat da terminale toglie i caratteri di controllo da tutto quello che stampa (testo dei mostri, domande,
  errori): un testo non può cancellare lo schermo, nascondere link o scrivere negli appunti del computer da cui
  ti colleghi.

## Telegram

### Collegare il bot
1. Su Telegram apri [@BotFather](https://t.me/BotFather), scrivi `/newbot`, scegli un nome: ti dà un token.
2. In Monsters, **Impostazioni → Collegamenti → Telegram**, incolla il token: Monsters lo verifica con Telegram e lo salva in
   `~/.monsters/secrets/` (cifrato col portachiavi del sistema, o file 600 dove non c'è). In alternativa si può usare la variabile
   `TELEGRAM_BOT_TOKEN`. Il token non compare più nella UI, nelle risposte dell'API né nel log.
3. **Collega un account**: la UI mostra un codice (vale una volta, per 10 minuti, 5 tentativi per ogni account
   Telegram: chi sbaglia non può bruciarlo agli altri). Dal telefono scrivi al bot `/start <codice>` o tocca "Apri
   in Telegram". Il tuo account entra nella lista di chi può comandare i mostri; lo togli dalla stessa pagina: da
   quel momento non riceve più niente, nemmeno le risposte dei lavori che aveva avviato.

### Cosa si fa dal telefono
- Scrivi un messaggio: va all'orchestratore (o a un mostro con `@Nome` all'inizio); la risposta arriva in chat.
  Con più account collegati, le risposte di un lavoro vanno a chi l'ha avviato; chi scrive mentre è in corso
  aggiunge il messaggio al lavoro.
- Le domande dei mostri arrivano con i pulsanti; per le domande aperte rispondi al messaggio. Se rispondi dalla UI
  o dal terminale, il messaggio su Telegram si aggiorna (e viceversa). Dopo un riavvio le domande vecchie perdono i
  pulsanti, e rispondere a una di loro non manda un messaggio nuovo alla squadra.
- `/stop` ferma subito tutto (conferma in chat), `/riprendi` chiede conferma e li fa ripartire, `/nuova` inizia una
  nuova conversazione, `/stato` dice cosa sta girando.
- Notifiche: lavoro finito (per quelli avviati da altrove), domanda in attesa, errore. Ognuna si spegne nelle
  impostazioni. Con **Silenzioso di notte** le notifiche aspettano la fine delle ore scelte; una domanda che blocca
  il lavoro arriva lo stesso, senza suono. Se stai scrivendo al bot in quel momento, le risposte arrivano subito.
  Le notifiche in attesa restano anche se Monsters si riavvia.

### Un bot per un mostro, in un gruppo (D-107)
Oltre al bot di sempre (tuo, in privato, parla col Dio) puoi dare a un mostro un bot suo, da mettere in un gruppo:
tutti quelli che ammetti ci parlano. Ogni bot ha il suo token e il suo mostro; se ne possono avere più di uno.
1. Con [@BotFather](https://t.me/BotFather) crea un bot **nuovo** (`/newbot`). Un token lo usa un programma alla volta:
   se il bot c'è già e lo usa un altro programma, crea un bot nuovo
   oppure ferma prima quel programma, altrimenti Telegram dà l'errore "un altro programma usa questo token".
2. Sempre a BotFather: `/setprivacy`, scegli il bot, **Enable**. Nei gruppi il bot riceve solo i messaggi che lo
   nominano, le risposte ai suoi messaggi e i comandi.
3. In Monsters, **Impostazioni → Collegamenti → Telegram → Bot dedicati a un mostro**: incolla il token e scegli il mostro
   (nome e progetto). Il Dio no: parla dal bot principale. Facoltativo: un limite di messaggi al giorno.
4. Aggiungi il bot al gruppo. Il gruppo compare in Monsters "da approvare" (te lo dice anche il bot principale):
   **Approva**. Chi vuole parlare col mostro scrive `/join` nel gruppo (o al bot in privato): lo approvi nella stessa
   pagina, oppure lo aggiungi con il suo ID di Telegram. Tu (l'account abbinato al bot principale) ci sei sempre.

Nel gruppo il mostro risponde quando lo nomini (`@nome_del_bot`), quando rispondi a un suo messaggio o con un comando
(`/stato`: solo quel mostro; `/join`; `/aiuto`). Ogni chat ha la sua conversazione col mostro, separata dalla chat
dell'app; nell'app vedi i messaggi nella chat del mostro con il nome di chi scrive e "da Telegram · <gruppo>". Le
domande normali del mostro arrivano nel gruppo e le risponde chi ha fatto la richiesta. Le cose che decidi solo tu (le
schede del freno, le bozze di mostri, progetti e automazioni, la spesa oltre il tetto) non si approvano mai nel gruppo:
arrivano a te sul bot principale e nell'app, e nel gruppo il mostro scrive "Serve l'ok di Alice: gliel'ho chiesto".
Le parole degli altri non sono tue: i loro link non diventano siti noti e, quando chiedono qualcosa, i controlli dei
dati in uscita sono accesi come dopo una pagina web. In queste chat il mostro non ha il tuo profilo e `Privato/` è
chiusa. Un bot che si rompe (token revocato, un altro programma sullo stesso token) si ferma da solo e lo dice nella
lista; gli altri e il bot principale vanno avanti. Con "Ferma tutto" i bot rispondono che i mostri sono fermi.

### Sicurezza
- Solo le chat private degli account collegati arrivano ai mostri (per i bot dedicati: le persone e i gruppi che hai
  approvato, sopra). I messaggi di altri account, dei gruppi e i
  messaggi inoltrati sono ignorati e finiscono nel log (id dell'account, motivo, al massimo l'inizio del testo).
- Il bot usa il long polling: è il core a chiamare Telegram, nessuna porta aperta sul PC. Se la rete cade riprova
  da solo, con attese crescenti; anche i messaggi che non riescono a partire aspettano (in ordine) e partono appena
  Telegram risponde, fino a 30 minuti.
- Un account sconosciuto che manda codici a caso riceve al massimo una risposta e finisce nel log una volta ogni
  10 secondi.
- I messaggi con un bot non sono cifrati end-to-end: passano dai server di Telegram. Non mandare password o chiavi
  in chat.
- Chi ha il tuo telefono sbloccato può comandare i mostri: in quel caso togli l'account dalle impostazioni, oppure
  premi "Ferma tutto" nella UI o `monsters kill` da SSH.
