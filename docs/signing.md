# Firma dei pacchetti e aggiornamenti

Come si costruiscono, si firmano e si aggiornano i pacchetti dell'app desktop (M3.4, D-040, D-046). I comandi di
build sono in `AGENTS.md`. Questo documento serve a chi mantiene un fork o vuole pubblicare i propri pacchetti: le
identità, i certificati e le chiavi sono sempre i tuoi, qui non ce ne sono.

## macOS: firma e notarizzazione

Servono un account Apple Developer, un certificato **Developer ID Application** (sub-CA G2) e una chiave API di App
Store Connect con accesso **Developer** (il minimo che `notarytool` accetta). L'identità si passa da ambiente, per
esempio `MONSTERS_MAC_SIGN_IDENTITY="Developer ID Application: Jane Doe (ABCDE12345)"` e
`MONSTERS_MAC_NOTARY_KEY_ID=<Key ID della chiave API>` per lo script di preparazione dell'utente di firma; la build
usa `MONSTERS_MAC_IDENTITY` (o `CSC_NAME`) e il profilo di notarizzazione.

`pnpm desktop:dist:mac` costruisce dmg e zip firmati e notarizzati (arm64 e x64) su un Mac raggiungibile via SSH (lo
stesso della CI, `docs/ci.md`) e li riporta in `apps/desktop/release/mac/`. Controllo sul Mac:
`codesign --verify --deep --strict -vv Monsters.app`, `spctl -a -vv Monsters.app` ("Notarized Developer ID"),
`xcrun stapler validate Monsters-….dmg`.

Senza lo script di firma installato la build è firmata **ad-hoc** (nome del file con `-adhoc`; con lo script ma senza
il suo `signing.env` la build si ferma): parte solo sul Mac dove è stata fatta o dopo
`xattr -dr com.apple.quarantine Monsters.app`, e non si aggiorna da sola. La CI (`pnpm ci:mac`, compreso il suo
passo `package`) è sempre ad-hoc.

**Cambiare identità o account.** La firma si può cambiare in qualsiasi versione. Ma Squirrel.Mac accetta un
aggiornamento solo se soddisfa il requisito designato dell'app installata, che contiene il Team ID: con un Team ID
nuovo l'aggiornamento automatico fallisce una volta e chi ha l'app la reinstalla dal dmg; da lì si aggiorna di nuovo.
Possono anche ricomparire la richiesta di accesso al portachiavi (le voci di `safeStorage` sono legate alla firma) e i
permessi di Privacy (TCC). Si evita convertendo l'account (per esempio da individuale a organizzazione) invece di
crearne uno nuovo: il Team ID resta lo stesso. Lo stesso vale per cambiare l'editore Windows.

**Rifare il certificato.** Chiave privata RSA 2048 generata con `openssl` sul Mac, nell'utente di firma; richiesta
(`.certSigningRequest`) caricata su developer.apple.com (solo l'Account Holder può creare il certificato); `.cer`
scaricato e convertito in PEM; `.p12` con chiave, certificato e intermedio G2 (LibreSSL, cifratura 3DES che
`security import` legge); prova in un portachiavi usa e getta (`security find-identity -v -p codesigning`,
`codesign -o runtime --timestamp` su un binario qualsiasi) e `xcrun notarytool history` con la chiave API. Le copie
in chiaro si cancellano.

### Mac: utente di firma

**Dove stanno i segreti.** Mai nell'utente della CI. Nel disegno l'utente `monsters-ci` esegue `pnpm install` con gli
script delle dipendenze, la build e i test di qualsiasi commit: tutto quello che può leggere, lo può leggere anche il
codice del commit. Per questo la build firmata la fa un secondo utente, `monsters-sign`, che `monsters-ci` non può
leggere e che non esegue mai il `node_modules` della CI:

- `pnpm desktop:dist:mac` (`ci-mac.sh --package`) entra come `monsters-ci`, mette il commit in un bundle git in
  `/Users/Shared/monsters-sign/inbox/<run>.bundle` e lancia
  `sudo -n -u monsters-sign -H /usr/local/libexec/monsters/sign-build.sh <sha> <run> [--version <v>] [--feed <feed>]`.
  sudoers permette a `monsters-ci` quel solo script, come `monsters-sign`; lo script controlla gli argomenti prima di
  tutto (sha di 40 cifre, run di quel commit, solo `--version` e il feed ufficiale) e sudo azzera l'ambiente.
- Lo script è **fisso**: chi amministra il Mac ne installa da root una copia letta (`scripts/mac-sign/sign-build.sh`)
  in `/usr/local/libexec/monsters/` (root, 755). Non viene dal commit, e `monsters-ci` non lo può modificare. Ogni
  modifica nel repo si reinstalla allo stesso modo, dopo averla letta: il Mac non la prende mai da solo.
- Come `monsters-sign`, nella sua home (700): il suo Node (tarball ufficiale con sha256 fissato), un suo repo dove
  scarica il commit dal bundle e controlla che sia proprio quello sha, un checkout pulito, `pnpm install
  --frozen-lockfile --ignore-scripts` con il suo store, `package.ts --mac --build-only` col portachiavi chiuso, poi
  sblocca il portachiavi di firma, `package.ts --mac --no-build` con identità e profilo di notarizzazione (mai la
  password del portachiavi nell'ambiente), richiude il portachiavi anche se qualcosa fallisce.
- I pacchetti vanno in `/Users/Shared/monsters-sign/outbox/<run>/` (leggibile da `monsters-ci`, che li riporta);
  `~monsters-sign/signed.log` tiene data, sha, oggetto del commit e sha256 di dmg e zip di ogni build firmata.
- Se in `monsters-ci` c'è ancora una cartella `secrets/`, ogni run lo scrive (`WARNING`) e non la legge. Lo controlla
  `scripts/ci-mac.test.ts`.

**Preparazione.** `sudo bash scripts/mac-sign/setup-monsters-sign.sh` (con `sign-build.sh` accanto) crea l'utente
(non amministratore, senza accesso SSH, home 700, `Library/LaunchAgents` di root per non lasciare agenti di login),
le cartelle condivise `inbox` (di `monsters-ci`) e `outbox` (di `monsters-sign`), installa lo script fisso e la regola
sudoers (`monsters-ci ALL=(monsters-sign) NOPASSWD: /usr/local/libexec/monsters/sign-build.sh`, 440, `visudo -c`).
Legge l'identità da `MONSTERS_MAC_SIGN_IDENTITY` e l'id della chiave API da `MONSTERS_MAC_NOTARY_KEY_ID`.
Poi, come `monsters-sign`:

1. portachiavi dedicato (`security create-keychain -P …/monsters-signing.keychain-db`, password casuale, chiusura
   automatica dopo 15 minuti con `set-keychain-settings -lut 900`);
2. import del `.p12` con `-x -T /usr/bin/codesign`: la chiave privata **non si può esportare**; poi
   `set-key-partition-list -S apple-tool:,apple:` e import dell'intermedio G2;
3. profilo di notarizzazione: `xcrun notarytool store-credentials monsters-notary --key AuthKey_<id>.p8 --key-id <id>
   --issuer <Issuer ID> --keychain …/monsters-signing.keychain-db`;
4. `~/secrets/signing.env` (600, righe `CHIAVE=valore`, lo script lo legge senza eseguirlo) con `CSC_NAME`,
   `CSC_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE=monsters-notary` e `MONSTERS_SIGNING_KEYCHAIN_PASSWORD`;
5. prove: `security find-identity -v -p codesigning` mostra l'identità; `security export -t identities -f pkcs12`
   **fallisce**; poi si cancellano i file importati (`rm -P`) e si tiene una copia cifrata di `.p12`, password e `.p8`
   nel proprio gestore di password, mai in chiaro sul Mac;
6. la chiave di App Store Connect ha l'accesso **Developer** e nessun'altra chiave attiva ha ruoli più alti;
7. pulizia di `monsters-ci`, subito dopo l'import dei segreti: `secrets/` cancellata, nessun portachiavi di firma né
   intermedio nella sua lista di ricerca. Controllo: `sudo -u monsters-ci ls /Users/monsters-sign` dà "Permission
   denied" e il prossimo `pnpm ci:mac` non scrive più `WARNING … secrets`.

Un `ci-mac.sh --package` interrotto (Ctrl-C) ferma la parte di `monsters-ci`; la build di `monsters-sign` finisce da
sola, richiude il portachiavi e libera il suo lock.

**Il rischio che resta.** Il packaging firmato esegue comunque **codice del commit** (`package.ts`, `build-core`,
electron-builder, `after-pack.ts`, le dipendenze) come `monsters-sign`, e il passo `--no-build` lo esegue con il
portachiavi aperto. La chiave Developer ID non si può esportare e la usa solo codesign, ma un commit malevolo può far
firmare a codesign qualcos'altro mentre il portachiavi è aperto, o leggere la password del portachiavi dal file di
`monsters-sign`. Quindi su `desktop:dist:mac` vanno solo commit già rivisti (meglio un tag), e `signed.log` dice cosa
è stato firmato. Quello che la separazione toglie è il resto: install con script, build e test di qualsiasi commit
girano come `monsters-ci`, che dei segreti non vede niente.

### La prova d'installazione su macOS (`ci:mac`, passo `package`)
L'utente della CI entra via SSH e di solito non ha una sessione grafica. In quella situazione macOS **non finisce di
avviare un'app con interfaccia**: Electron non arriva mai a `ready` e l'app non avvia il core. `install-test.ts` se ne
accorge in 30 s (nessuna riga "Monsters desktop … (Electron …)" in `desktop.log`), lo scrive, chiude l'app e prova
quello che si può provare del pacchetto installato: il core di `Contents/Resources/core` avviato col Node della CI
(Node 24: stessa N-API dei moduli nativi del pacchetto), versione, primo avvio e registrazione via API. Il passo
resta verde, ma la nota dice "app e finestra NON verificate". Se invece l'utente ha una sessione grafica e l'app non
arriva a `ready`, il passo fallisce subito. Prima di avviare qualsiasi cosa il passo rilegge i fuse del binario
installato (`RunAsNode` spento).

### Fuse `RunAsNode` spento e portachiavi (S-M8)
Il binario firmato dell'app non parte mai come Node (`ELECTRON_RUN_AS_NODE` non fa niente): nessun programma
dell'utente può usarlo per ereditare il "Consenti sempre" del portachiavi o i permessi TCC dell'app. `after-pack.ts`
rilegge i fuse dopo averli scritti e ferma la build se non sono quelli di `src/fuses.ts`. Le chiamate al portachiavi
del core girano in un utility process dell'app (`Monsters Helper.app`, `dist/keychain-helper.cjs` dentro `app.asar`
firmato); gli altri figli JavaScript del core (Playwright MCP, server MCP della galleria, Codex, npm) usano il `node`
del PATH. Dopo un aggiornamento la prima lettura della chiave dei segreti può chiedere di nuovo il permesso, perché
l'identità che legge la voce è l'helper e non `Contents/MacOS/Monsters`.

## Windows

- **Senza firma (default, D-040).** `MONSTERS_WIN_SIGN=off`. File `Monsters-Setup-<v>-x64-unsigned.exe`; Windows
  mostra "Windows ha protetto il PC" → *Ulteriori informazioni* → *Esegui comunque*.
- **Prova della catena di firma.** `bash apps/desktop/scripts/setup-signing.sh --test-cert` (jsign e Java in
  `~/.local/opt/monsters-signing`, checksum fissati; CA e certificato di prova in `apps/desktop/.signing/`, ignorata da
  git), poi `MONSTERS_WIN_SIGN=test pnpm desktop:dist --win`. `signtool verify /pa` e Windows non si fidano: per
  `Get-AuthenticodeSignature` lo stato è `UnknownError` (catena non attendibile). Firma presente e intatta si verifica
  con `osslsigncode verify -CAfile apps/desktop/.signing/test-ca.crt` ("Succeeded") o nella VM di CI, dove
  `test-windows.sh` aggiunge la CA di prova alle radici: lo stato diventa `Valid`.
- **Certificato vero.** `MONSTERS_WIN_SIGN=jsign` con qualsiasi keystore che jsign supporta (file PKCS#12, token o
  servizio cloud via PKCS#11):
  - `MONSTERS_JSIGN_STORETYPE` (per esempio `PKCS12`, `PKCS11`);
  - `MONSTERS_JSIGN_KEYSTORE` (file o configurazione PKCS#11);
  - `MONSTERS_JSIGN_STOREPASS` (password o PIN, passata a jsign come variabile, mai sulla riga di comando);
  - `MONSTERS_JSIGN_ALIAS` e `MONSTERS_JSIGN_CERTFILE` (facoltativi);
  - `MONSTERS_JSIGN_TSAURL` (server di marcatura temporale; ha un default che puoi cambiare);
  - `MONSTERS_WIN_PUBLISHER_NAME` (il CN del certificato, usato dall'aggiornamento per riconoscere l'editore).

  Strumenti: `MONSTERS_JSIGN_JAR` e `MONSTERS_JAVA`, per default quelli installati da `setup-signing.sh`.

## Linux

Nessuna firma del pacchetto: AppImage e deb non hanno un meccanismo che l'utente controlli davvero. Gli
aggiornamenti invece sono firmati da noi (sotto, "Firma degli aggiornamenti"). Il deb installa il profilo AppArmor che
tiene accesa la sandbox di Chromium su Ubuntu 24.04+; l'AppImage non può averlo e lo dice all'avvio.

## Aggiornamenti: cosa viene verificato

L'app scarica da un feed generico (`--feed <url>` in build, canale `alpha`, file `alpha*.yml`). Su ogni sistema il file
scaricato deve avere lo **sha512** scritto nel `.yml`, e il `.yml` deve avere una **firma Ed25519** valida
(`alpha*.yml.sig`), verificata con le chiavi pubbliche dentro l'app prima di scaricare qualsiasi cosa. In più:

| Sistema | Firma controllata dall'aggiornamento | Con pacchetti non firmati o di prova |
|---|---|---|
| Tutti | firma del `.yml` (S-A4) prima del download, sha512 del pacchetto dopo | chiave di prova della sola esecuzione dell'e2e |
| Linux (AppImage) | nessun'altra (sha512 firmato) | uguale |
| Linux (deb) | firma del `.yml` ricontrollata da root con le chiavi di `/opt/Monsters/resources/update-keys`, sha512 della copia di root nel `.yml` firmato, pacchetto `monsters` di versione più alta (`dpkg-deb -f`); chiede la password del computer (D-105) | uguale |
| Windows | Authenticode e nome dell'editore (`publisherName`) | non firmato: solo sha512 firmato; firma di prova: passa solo dove la CA di prova è attendibile |
| macOS | Squirrel.Mac: la nuova app deve avere la stessa firma (requisito designato) | ad-hoc: **non si aggiorna** (il requisito è l'hash del binario) |

**Il deb (D-105).** L'app installata dal `.deb` si aggiorna da sola:
- electron-updater (DebUpdater) scarica il `.deb` elencato in `alpha-linux.yml` dal feed scritto nella build (o da
  `MONSTERS_UPDATE_URL`, con la stessa regola dell'https) e ne controlla lo sha512. Il download è sempre completo.
- "Riavvia per aggiornare" apre prima un dialogo che dice che verrà chiesta la password del computer. Poi un solo
  `pkexec --disable-internal-agent /bin/sh -c <script>`: l'agente polkit del desktop chiede la password. Lo script,
  da root, copia il pacchetto, il `.yml` verificato dall'app e la sua firma in una cartella sua
  (`/var/tmp/monsters-update.*`, 0700), ricontrolla sulla copia lo sha512, la firma (openssl, chiavi di root in
  `/opt/Monsters/resources/update-keys`), che lo sha512 sia nel `.yml` firmato, che il pacchetto sia `monsters` e che
  la versione sia più alta di quella installata (`dpkg --compare-versions`); poi dice "pronto" e aspetta. Firma o
  pacchetto sbagliati: niente "pronto", il dialogo dice che può essere un pacchetto manomesso.
- Solo allora l'app ferma il suo core e dà il via: `dpkg -i` della copia, poi l'app si riavvia nella versione nuova.
- Mai `apt` né `apt-get install -f` da root, mai `--allow-unauthenticated`: l'installazione non passa dal `doInstall`
  di electron-updater (che ripiega su apt), che non installa nemmeno all'uscita (`autoInstallOnAppQuit` spento).
- Password annullata o rifiutata, nessun agente polkit (sessione SSH o remota), pkexec assente, pacchetto che non
  corrisponde: il core non si ferma, l'app resta com'è e un dialogo dice cosa è successo con il comando da copiare
  (`sudo apt install <pacchetto scaricato>`). Tutto anche in `desktop.log` (`updates: …`).
- Prova: `pnpm desktop:update-e2e --deb` (chroot di Ubuntu 24.04 pulito, `apps/desktop/scripts/test-deb-update.sh`).

## Firma degli aggiornamenti

**Perché.** Lo sha512 sta nel `alpha*.yml` dello stesso bucket dei pacchetti: chi può scrivere nel bucket
pubblicherebbe un pacchetto che ogni app installa (e il deb lo installa da root). Per questo serve anche una chiave
privata di firma, che non sta sul servizio che ospita il feed.

**Cosa si firma.** Ogni file di canale (`alpha-linux.yml`, `alpha-linux-arm64.yml`, `alpha-mac.yml`, `alpha.yml`):
elenca ogni pacchetto con il suo sha512, quindi la firma copre anche i pacchetti. La firma è `<file>.sig` accanto al
file, pubblicata con lui:

```
monsters-update-signature-v1
key <id della chiave> <firma Ed25519 in base64>
```

Il messaggio firmato è `monsters-update-signature-v1\n<nome del file>\n<byte del file>`: la firma vera di
`beta-linux.yml` o di `alpha-mac.yml` non vale come firma di `alpha-linux.yml`. Più righe `key` sono ammesse (cambio
di chiave). Codice in `apps/desktop/src/main/update-signature.ts`.

**Cosa fa l'app (una sola lettura).** electron-updater legge il feed solo attraverso il provider
`src/main/signed-provider.ts` (provider `custom`): scarica `<canale>.yml` e `.sig` **una volta**, verifica la firma con
le chiavi di `resources/update-keys/` e passa a electron-updater proprio l'oggetto firmato già parsato. Il parse è
stretto: si rifiuta un `.yml` senza `files` o con `files` vuoto, una voce senza sha512, `sha2` ovunque, `packages`, un
`path`/`sha512` di primo livello che non è una voce di `files`. electron-updater non scarica da solo (`autoDownload`
spento): l'app accetta l'info di `update-available` solo se è quello stesso oggetto, poi scarica. A download finito
calcola lo sha512 del file scaricato e lo cerca nel `.yml` firmato: se non c'è non lo offre. Firma mancante, sbagliata,
di un'altra chiave o di un altro file: niente download, il menu dice «Aggiornamento non riuscito» e `desktop.log` ha
`updates: version … refused: <motivo>`; un `invalid` o `mismatch` si riprova una volta dopo un minuto. Un `.pem` rotto
in `resources/update-keys` si salta (e si scrive nel log): le altre chiavi valgono.

**Le chiavi.** Le pubbliche di cui le build si fidano stanno in `apps/desktop/build-resources/update-keys/*.pem`
(nel repo, solo pubbliche: un test controlla che non ci sia una privata). `package.ts` le mette in
`resources/update-keys/` e scrive i loro id in `build-info.json`; **una build con il feed senza nessuna chiave si
rifiuta**, perché non potrebbe più accettare un aggiornamento. Le build dell'e2e (`--test-build`) si fidano in più di
`--update-test-key <pem>`: l'e2e genera una coppia nuova a ogni esecuzione e firma con quella. Una build pubblicata
non può fidarsi di una chiave di prova (`--update-test-key` senza `--test-build` si rifiuta). In un fork la cartella
parte dalle chiavi del progetto: sostituiscile con le tue prima di pubblicare.

**Generare la chiave.**
1. Scegli dove vive la privata: mai in chiaro nell'utente che fa girare core e agenti, né nel repo. La strada
   semplice è un file cifrato con una passphrase che sai solo tu (nel tuo gestore di password, almeno 12 caratteri,
   meglio 4-5 parole), che digiti a ogni pubblicazione:
   `pnpm desktop:update-key generate --out <percorso>/monsters-update.key --install`. La passphrase si chiede due
   volte sul terminale (`/dev/tty`, senza eco; mai da variabile d'ambiente né da stdin) e la cifratura la fa
   `node:crypto`: nessun altro programma vede la chiave. Meglio ancora fuori dalla macchina di sviluppo (un altro
   utente, un altro computer): lo script va lanciato lì e qui si copia solo il `.pub`.

   Il formato del file (`scripts/signing-key-file.ts`) è un JSON: `format: monsters-update-key-v1`, `kdf: scrypt` con
   `N` = 2^20, `r` = 8, `p` = 1 (1 GiB di memoria e qualche secondo per tentativo), `salt` (16 byte), `cipher:
   aes-256-gcm`, `iv` (12 byte), `ciphertext` (la privata PKCS#8 DER) e `tag`. Chiave = scrypt(passphrase NFC, salt);
   l'AAD di GCM è il JSON dei campi prima di `ciphertext`, quindi nessun parametro si cambia senza che il tag fallisca.
   Un file con un costo più basso di quello di un file nuovo non si apre. Una chiave già esistente in chiaro si cifra
   con `pnpm desktop:update-key encrypt --in <privata.pem> --out <file>` (poi si distrugge il file in chiaro).
2. Una seconda coppia **di riserva**, generata allo stesso modo e tenuta offline: anche la sua pubblica va in
   `build-resources/update-keys/`. Se la prima si perde o si compromette, si firma con la riserva e le app già
   installate la accettano.
3. `--install` copia la pubblica in `apps/desktop/build-resources/update-keys/<id>.pem`: si fa il commit.
4. Controllo: `MONSTERS_UPDATE_SIGNING_KEY_FILE=<file> pnpm desktop:update-key public` chiede la passphrase e dice
   l'id e se è tra le chiavi del repo.

**Pubblicare firmato.** `publish-update.ts` (`pnpm desktop:publish`) legge la privata da
`MONSTERS_UPDATE_SIGNING_KEY_FILE` (il file cifrato qui sopra, leggibile solo dal proprietario: chiede la passphrase
sul terminale; un file in chiaro si rifiuta) oppure da `MONSTERS_UPDATE_SIGNING_KEY_CMD`, un comando che stampa la
chiave, in PEM o come file cifrato (allora chiede la passphrase lui): per esempio `/usr/bin/ssh firma@altro-pc cat …`
o `/usr/bin/security find-generic-password -w …`. Il comando gira con `/bin/sh` e un PATH fisso di cartelle di sistema
(`/usr/bin:/bin:/usr/sbin:/sbin`): un `ssh` o un `openssl` messi in `~/.local/bin` non sono quelli che partono. La
chiave non viene scritta da nessuna parte. Lo script si ferma se manca, se non è Ed25519, se la build non si fida di
quella chiave (id in `build-info.json`), se è una build di prova (`testBuild` o una chiave `test-`) o se l'app
rifiuterebbe il `.yml` (lo stesso parse stretto). Firma ogni `.yml` e verifica la firma appena fatta. Poi, per ogni
`.yml`: carica un `.sig` "ponte" con la firma del `.yml` che il feed ha adesso (le righe `key` del `.sig` di adesso,
solo se lo verificano: lo script non firma mai quello che trova sul feed) più quella del nuovo, lo rilegge dal
server del feed (uno che non serve i `.sig` ferma tutto qui, prima di toccare un `.yml`), carica il `.yml`, poi il
`.sig` con la sola firma nuova. Alla fine rilegge dal server file e firme verificandole di nuovo. Durante il
caricamento il `.sig` ponte vale per il `.yml` vecchio e per il nuovo, quindi un controllo che cade lì trova sempre
una coppia valida.

La passphrase si può dare anche con `MONSTERS_UPDATE_SIGNING_PASSPHRASE_CMD`, un comando che la stampa (per esempio
`secret-tool lookup …`): comodo per pubblicare senza qualcuno al terminale, ma allora chi controlla quell'utente può
firmare (vedi «Rischio accettato» D-126 in `docs/security-model.md`).

**Rischi che restano.**
- Chi ha la chiave privata (o la passphrase e il file) pubblica come te: va custodita come la chiave Developer ID.
- La pubblicazione esegue codice del repo (`publish-update.ts`, `yaml`, `node_modules`) con la chiave decifrata in
  memoria: un commit o un `node_modules` manomesso nell'utente che pubblica può portarla via. La cifratura protegge il
  file a riposo, non questo. Si pubblica solo da un checkout pulito di un commit già rivisto
  (`pnpm install --frozen-lockfile`); la soluzione vera è un firmatario minimo su un altro utente o un'altra macchina,
  che riceve solo gli `alpha*.yml`, mostra versione e sha512, firma e restituisce i `.sig` senza eseguire codice del
  repo: non c'è ancora.
- La passphrase si digita in un terminale dell'utente: chi controlla quell'utente mentre la digiti (un programma che
  legge la tastiera della sessione grafica, un terminale manomesso) può leggerla.
- Un feed compromesso può ancora **non** dare aggiornamenti, o servire per sempre l'ultima versione firmata (niente
  scadenza delle firme): non può far installare una versione più vecchia (electron-updater non torna indietro, il deb
  lo controlla da root) né una non firmata.
- Su Windows non firmato e su AppImage la firma degli aggiornamenti è l'unico controllo; con un certificato Windows
  si aggiunge Authenticode.
- Lo script di root del deb arriva dall'app (che è di root in `/opt/Monsters`), le chiavi da
  `/opt/Monsters/resources`: chi può già scrivere lì è già root.
- Lo script di root verifica con `/usr/bin/openssl` (percorso assoluto, PATH fisso), che deve essere la 3.0 o più
  recente: Ed25519 con `pkeyutl -rawin` non esiste nella 1.1.1. Il deb lo chiede nei Depends (`openssl (>= 3.0.0)`) e
  lo script controlla `openssl version` prima di tutto: con una versione vecchia esce con un codice suo (96) e il
  dialogo dice che serve OpenSSL 3, non che il pacchetto è manomesso.

**Le build di prova nella CI.** `pnpm ci:local` costruisce i pacchetti di `install-test` come build di prova col feed
(`--feed http://127.0.0.1:9/ --test-build --update-test-key <pubblica di una chiave della run>`): controlla che
`resources/update-keys` arrivi nell'AppImage e in `/opt/Monsters` del deb. Poi il passo `update-e2e`
(`pnpm desktop:update-e2e --scenario ok,badsig`, solo Linux): aggiornamento vero 0.0.1 → 0.0.2 da un feed locale
firmato con una chiave effimera, e rifiuto con la firma di un'altra chiave. Le build di prova stanno in `.package/` e
`publish-update.ts` le rifiuta.

## Pubblicare un aggiornamento (D-050)

Il feed è un server HTTP che serve in sola lettura i file dei rilasci. Nella configurazione di riferimento
(`apps/update-server`) è un Worker di Cloudflare davanti a un bucket R2 privato, con gli intervalli multipli che
servono al download differenziale; il bucket non ha accesso pubblico diretto. Un fork può usare qualsiasi hosting
statico che serva anche i `.sig` e le richieste con intervalli, e indicarlo con `--feed`.

1. Versione nuova in `apps/desktop/package.json` (sempre più alta: `0.1.0-alpha.N`).
2. Build col feed: `pnpm desktop:dist --linux --win --feed <url del feed>/desktop/` (macOS: `pnpm desktop:dist:mac`,
   pacchetti in `apps/desktop/release/mac`). Serve almeno una chiave in `apps/desktop/build-resources/update-keys/`.
3. `MONSTERS_UPDATE_SIGNING_KEY_FILE=<chiave cifrata>` (o `…_KEY_CMD`), poi `pnpm desktop:publish --dry-run` e
   `pnpm desktop:publish` (`--dir apps/desktop/release/mac` per macOS).

`desktop:publish` si ferma se: un file non ha la dimensione o lo sha512 scritti nel `.yml`, la build punta a un altro
feed (o a nessuno), la versione non è più alta di quella già pubblicata (`--force` per ripubblicare la stessa), c'è una
build con firma di prova o ad-hoc o una build di prova (`--test-build`, mai pubblicabili), o una non firmata/non
notarizzata senza `--allow-unsigned`, manca la chiave di firma o la build non si fida di lei. Firma i `.yml` (`.sig`
accanto, anche col `--dry-run`), carica prima pacchetti e blockmap, poi per ogni `alpha*.yml` il `.sig` ponte, il
`.yml` e il `.sig` finale, e rilegge tutto dal server verificando le firme. Con la configurazione di riferimento serve
la CLI di Cloudflare con un login valido; il Worker si ripubblica con
`pnpm --filter @monsters/update-server deploy:worker` (`--dry-run` per provarlo) e **va ripubblicato prima** della
prima versione firmata, perché serva i `.sig`.
