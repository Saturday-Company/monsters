# CI

Come si controlla Monsters prima e dopo un commit: GitHub Actions a ogni push e PR, la CI locale su Linux, Mac e Windows
come cancello di ogni release (D-147) e la CI cloud facoltativa. I passi sono gli stessi ovunque (`scripts/ci-local.ts`); cambia dove girano.

## GitHub Actions

`.github/workflows/ci.yml` gira a ogni push su `main` e a ogni pull request.

- **Linux (completo):** install (`pnpm install --frozen-lockfile`), typecheck, lint (compreso
  `scripts/check-public.ts`, il controllo che nel repo non ci siano dati privati), format check, test unitari ed e2e
  della UI (Playwright: flussi con core finto, UI contro un core vero, onboarding).
- **Windows e macOS:** typecheck e test unitari (timeout più lunghi su Windows, dove i test che avviano un core vero
  o git sono più lenti).

I test non scaricano mai il modello di embedding (`MONSTERS_EMBEDDINGS=off`) e non toccano il portachiavi di sistema
(`MONSTERS_SECRETS=file`).

## CI locale: `pnpm ci:local`

Gli stessi passi di `ci.yml` su un checkout pulito del commit, più il passo `package` (M3.5, D-048: i pacchetti
vengono installati da zero, registrati dalla finestra e disinstallati; per il deb serve `sudo -n`). Circa 4-5 minuti
su una macchina a 16 core.

| Opzione | Effetto |
|---|---|
| `--quick` | senza e2e né pacchetto |
| `--no-package` | senza il passo `package` |
| `--keep` | tiene la cartella di lavoro (utile per capire un rosso) |
| `--commit <rev>` | prova quel commit invece di `HEAD` |

Esito in `ci-results/<data>-<commit>-<os>.json` + `.log` (cartella ignorata da git; il formato `CiResult` è in
`scripts/ci-local.ts`).

**Hook facoltativo:** `git config core.hooksPath scripts/git-hooks` attiva un pre-push che lancia `ci:local --quick`.

## Un Mac raggiungibile via SSH: `pnpm ci:mac`

Lancia `ci-local.ts` del commit su un Mac come utente `monsters-ci` (nel disegno, un utente senza privilegi che non
vede i segreti di firma: vedi `docs/signing.md`), tutto in `~/monsters-ci` sul Mac; i risultati tornano nello stesso
`ci-results/`. Anche qui c'è il passo `package` (dmg arm64, sempre firmato ad-hoc), saltabile con
`--quick` / `--no-package`. `pnpm desktop:dist:mac` usa lo stesso script per i pacchetti firmati.

Il Mac si configura da variabili d'ambiente oppure da `scripts/ci.local.env` (ignorato da git, righe `CHIAVE=valore`):

```sh
# scripts/ci.local.env
MONSTERS_MAC_HOST=100.64.0.1          # indirizzo del Mac (LAN, VPN, Tailscale…)
MONSTERS_MAC_USER=alice               # utente SSH sul Mac
MONSTERS_MAC_KEY=~/.ssh/id_ed25519    # chiave SSH
```

**Exit 75** = il Mac è spento, irraggiungibile o occupato da un'altra run: riprova più tardi, non è un rosso del
codice.

## Una VM Windows locale: `pnpm ci:windows`

`pnpm ci:windows [--keep] [--fresh] [--no-package] [--commit <rev>]` lancia `ci:local` in una VM Windows locale
(QEMU/KVM) e riporta l'esito in `ci-results/`. La VM sta fuori dal repo, in `$MONSTERS_WINVM_DIR` (default
`~/.local/share/monsters/winvm`: ISO di Windows, disco, risposte dell'installazione automatica) e riparte ogni volta
dallo snapshot `ci-base`. Il passo `package` costruisce l'installer su Linux prima di accendere la VM e lo prova nella
stessa accensione dopo `ci:local`.

| Variabile | Default | Cosa fa |
|---|---|---|
| `MONSTERS_WINVM_DIR` | `~/.local/share/monsters/winvm` | cartella della VM |
| `MONSTERS_WINVM_SSH_PORT` | 22522 | porta locale inoltrata all'SSH della VM |
| `MONSTERS_WINVM_CPUS` | 6 | processori |
| `MONSTERS_WINVM_MEM` | 6G | memoria (non lanciare build pesanti insieme alla VM) |

`scripts/ci-windows.sh` contiene i comandi per creare e aggiornare la VM (`scripts/ci-windows.autounattend.xml` e
`scripts/ci-windows.setup.ps1` per l'installazione automatica).

## Il cancello di ogni release: `pnpm release:ci` e `pnpm release:check`

Non c'è più una CI serale (D-147). Il controllo di tutti i giorni sono gli Actions su push e PR; la CI locale completa
sui tre sistemi gira **prima di ogni release** e la release non parte senza.

- `pnpm release:ci [--commit <rev>] [--no-probe]` lancia in fila, per `HEAD`, `ci:local`, `ci:windows` e `ci:mac`
  (con l'hash intero del commit) e si ferma al primo rosso. Mac con exit 75 (spento, irraggiungibile o occupato) è
  detto chiaramente e non è un rosso del codice: lo si accende e si rilancia. In coda, la **sonda degli strumenti degli
  harness** (D5 della review del 19/10, D-127, `packages/core/test/fixtures/probe-harness-tools.ts`): avvia il vero
  `claude` (e `codex`, se c'è) come lo avvia Monsters e controlla che ogni strumento che vede sia uno che può eseguire;
  nessuna richiesta al modello, pochi secondi; senza `claude` (exit 3) è saltata, non rossa. `--no-probe` la salta; a
  mano: `pnpm exec node packages/core/test/fixtures/probe-harness-tools.ts`.
- **Stati su GitHub.** In coda (anche se un sistema è rosso) `release:ci` pubblica il risultato come *commit status*
  sul commit, così GitHub mostra la verifica fatta in locale: `local-ci/linux`, `local-ci/windows`, `local-ci/macos`
  (success, failure o pending, con una descrizione corta tipo `ci:local full + package, 4m31s`) e `local-ci/release-gate`
  (success solo se i tre sono verdi). Lo fa `pnpm ci:status [--commit <rev>] [--dry-run]` (`scripts/ci-status.ts`, la
  mappatura è pura e testata), con `gh api -X POST repos/<owner>/<repo>/statuses/<sha>`; owner e repo vengono da
  `git remote get-url origin` (predefinito `Saturday-Company/monsters`). Pubblica solo se il commit è su origin
  (altrimenti spiega di fare prima il push e rilanciare `pnpm ci:status`). Nessun `target_url` e nessun percorso,
  host o dato personale nelle descrizioni. `--dry-run` stampa i comandi `gh` senza eseguirli; `pnpm release:ci
  --no-status` salta la pubblicazione.
- `pnpm release:check [--commit <rev>]` (`scripts/release-gate.ts`) stampa lo stato del cancello per quel commit ed
  esce 0 se è aperto, 1 se è chiuso. Per ogni sistema cerca in `ci-results/` un risultato dell'**hash intero** del
  commit con `mode: full`, `status: passed`, non fatto su un checkout sporco e con il passo `package` passato (quindi
  né `--quick` né `--no-package`; su Windows il passo `package` lo scrive `ci-windows.sh` nel risultato). Se manca
  qualcosa dice cosa e quale comando lanciare. Un rosso più recente non cancella un verde pieno dello stesso commit.
- `pnpm desktop:publish` (feed `desktop` e GitHub Release) controlla il cancello su `HEAD` e **rifiuta** di
  pubblicare se è chiuso. `--skip-ci-gate` lo scavalca con un avviso ben visibile; `--dry-run` lo mostra ma non si
  ferma; i prefissi di prova (`desktop/e2e-<run>`) non sono release e non lo passano.

## CI cloud (facoltativa)

Un secondo parere su macchine pulite che non dipendono dalla tua. Gira **solo a orario e a mano, mai a un push**, per
non consumare i crediti dei piani gratuiti. Le configurazioni sono `.circleci/config.yml` e `.gitlab-ci.yml`; ogni job
lancia `scripts/ci-cloud.sh`:

- `setup`: Node 24 ufficiale (scaricato da nodejs.org e controllato con `SHASUMS256.txt` se il runner non lo ha),
  pnpm alla versione di `packageManager`, su Linux le librerie di sistema di Chromium per Playwright;
- `run`: `node scripts/ci-local.ts --no-package` (install, typecheck, lint, format, test, build della UI, e2e solo su
  Linux). Il passo `package` non gira nel cloud: vuole sudo, chroot, firma o VM.

Il risultato è nello stesso formato della CI locale e resta tra gli artifact del job. Il binario di Electron non si
scarica (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`) e lo store di pnpm va in cache legata a `pnpm-lock.yaml`.

- **CircleCI:** tre workflow (`linux`, `windows`, `macos`), ognuno acceso da un suo parametro `run-linux` /
  `run-windows` / `run-macos`, falso per default. Li accendono solo le pianificazioni e i lanci a mano o via API;
  inoltre ogni workflow si spegne se l'evento è `push` o `pull_request`. Conviene disattivare anche il trigger dei
  push del progetto. Le pianificazioni sono in UTC (con fino a 10 minuti di ritardo casuale) e, per i progetti con la
  GitHub App, si creano solo dal sito (Project Setup).
- **GitLab.com:** `workflow:rules` crea una pipeline solo per `schedule`, `web` e `api`; la variabile
  `CLOUD_CI_PLATFORMS` (`linux`, `windows` o `linux windows`) sceglie i job. Se il progetto GitLab è un mirror,
  il push non crea pipeline. La variabile richiede che il ruolo minimo per usare le variabili di pipeline permetta
  di impostarla.

**Esiti:** `pnpm ci:cloud-status` (`scripts/ci-cloud-status.ts`) legge le API dei servizi con i token del `.env` (ignorato
da git) e stampa l'ultima run di `main` per servizio e sistema: esito, cosa l'ha lanciata, commit, ora, link. Con
`--json` dà i dati grezzi. Esce con 1 se un'ultima run è rossa e con 2 se ci sono errori di API o di configurazione.

```sh
# .env
CIRCLECI_TOKEN=...
CIRCLECI_PROJECT_SLUG=circleci/<org>/<progetto>
CIRCLECI_DEFINITION_ID=...
GITLAB_TOKEN=glpat-...        # scope read_api (api per creare le pianificazioni)
GITLAB_PROJECT=<gruppo>/monsters
```

Una run a mano su CircleCI si lancia dall'API con i parametri del workflow voluto (senza parametri non parte nulla):

```sh
curl -X POST "https://circleci.com/api/v2/project/$CIRCLECI_PROJECT_SLUG/pipeline/run" \
  -H "Circle-Token: $CIRCLECI_TOKEN" -H 'content-type: application/json' \
  -d '{"definition_id":"'"$CIRCLECI_DEFINITION_ID"'","config":{"branch":"main"},
       "checkout":{"branch":"main"},"parameters":{"run-windows":true}}'
```

Su GitLab: Build > Pipelines > **Run pipeline** e scegli `CLOUD_CI_PLATFORMS`.

**Limiti noti.** Il passo `package` non gira nel cloud (i pacchetti sono provati dalla CI locale). Il lint usa più
memoria del default di Node: `ci-cloud.sh` passa `--max-old-space-size=4096`. I minuti e i crediti dei piani gratuiti
sono pochi: tieni le pianificazioni rade (CircleCI macOS costa molto più di Linux) e la conservazione di cache e
artifact a pochi giorni.
