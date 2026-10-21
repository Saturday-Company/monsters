# CI

Come si controlla Monsters prima e dopo un commit: GitHub Actions leggero sulle PR, la CI completa sui tre sistemi su
GitHub Actions a ogni push su `main` (D-152), che è anche il cancello di ogni release; la CI locale su Linux, Mac e
Windows resta come alternativa e ripiego (D-147), più la CI cloud facoltativa. I passi sono gli stessi ovunque
(`scripts/ci-local.ts`); cambia dove girano. Firma e pubblicazione restano sulle macchine dei manutentori: su GitHub non
c'è nessun segreto.

## GitHub Actions

`.github/workflows/ci.yml` ha due gruppi di job.

**Sulle pull request** (veloci, richiesti dal ruleset di `main`: `linux`, `unit (windows-latest)`,
`unit (macos-latest)`):

- **`linux`:** install (`pnpm install --frozen-lockfile`), typecheck, lint (compreso `scripts/check-public.ts`, il
  controllo che nel repo non ci siano dati privati), format check, test unitari (con `TZ=Pacific/Kiritimati`, D-148)
  ed e2e della UI (Playwright: flussi con core finto, UI contro un core vero, onboarding).
- **`unit (…)`, Windows e macOS:** typecheck e test unitari (timeout più lunghi su Windows, dove i test che avviano un
  core vero o git sono più lenti).

Le PR da un fork non ricevono segreti (non ce ne sono comunque) e non aprono il cancello: i loro job girano il file del
workflow del fork.

**A ogni push su `main` e a mano** (`workflow_dispatch`: `gh workflow run ci.yml --ref <branch>`, anche su un altro
branch): la CI completa, `full (linux)`, `full (windows)` e `full (macos)`, che è `node scripts/ci-local.ts --github`.
Gli stessi passi di `ci:local` pieno, nel checkout del runner (niente worktree), con l'uscita di ogni passo in un gruppo
richiudibile del log del job:

| Passo | Linux (`ubuntu-24.04`) | Windows (`windows-latest`) | macOS (`macos-latest`, arm64) |
|---|---|---|---|
| install, typecheck, check-public, lint, format, test | sì (test con `TZ=Pacific/Kiritimati`) | sì (timeout 30 s) | sì |
| build della UI, e2e (mock, core vero, onboarding) | sì (Chromium con `--with-deps`) | sì | sì |
| `build:core` + `smoke:bundle` (Node 24 ed Electron come Node) | sì | sì (senza lo stop con SIGTERM, che Windows non ha) | sì |
| `package` (`desktop:install-test`) | AppImage + deb, in Xvfb; il deb in un chroot Ubuntu 24.04 (sudo senza password del runner) | installer NSIS **non firmato** (`MONSTERS_WIN_SIGN=off`), installato per utente, registrazione dalla finestra, disinstallato (`install-test --win`, `test-windows.ps1` senza certificato) | dmg arm64 firmato ad-hoc, **mai notarizzato** |
| `update-e2e` (AppImage 0.0.1 → 0.0.2, firma del feed) | sì | no | no |

- Ambiente come in D-148: `MONSTERS_SECRETS=file`, `MONSTERS_EMBEDDINGS=off`, `TZ=Pacific/Kiritimati` per i test su
  Linux; `CSC_IDENTITY_AUTO_DISCOVERY=false` e `MONSTERS_MAC_NOTARIZE=0` perché non si cerchi mai un'identità di firma.
  Il lint gira con `--max-old-space-size=4096` (sul runner macOS da 7 GB il limite di default non basta).
- Cache: lo store di pnpm (`setup-node`), e con `actions/cache` legata a `pnpm-lock.yaml` i download di Electron e di
  electron-builder, il Chromium di Playwright e (Linux) l'immagine base di Ubuntu del test del deb.
- Artifact: `ci-results-<sistema>` (JSON e log nel formato di `ci:local`, `runner: "github"`, 14 giorni) e
  `packages-<sistema>` (AppImage e deb, exe, dmg; 3 giorni). Sono **build di prova** (feed su cui non risponde nessuno,
  `publish-update.ts` le rifiuta) e non firmate: servono a provarle a mano, non a distribuirle.
- Durata (ottobre 2026): circa 25 minuti su Linux e Windows, 32 su macOS (gli e2e con il core finto sono la parte più
  lunga: 9-17 minuti). Timeout del job 90 minuti; `concurrency` per ref: un push nuovo su `main` ferma la run del
  precedente.

I test non scaricano mai il modello di embedding (`MONSTERS_EMBEDDINGS=off`) e non toccano il portachiavi di sistema
(`MONSTERS_SECRETS=file`).

## CI locale: `pnpm ci:local`

Gli stessi passi dei job `full` di `ci.yml` su un checkout pulito del commit: in locale gli e2e girano solo su Linux, e
il passo `package` (M3.5, D-048: i pacchetti vengono installati da zero, registrati dalla finestra e disinstallati; per
il deb serve `sudo -n`) su Windows lo fa `ci:windows` nella VM. `smoke-bundle` prova il bundle sotto Node e sotto
Electron come Node; dove il binario di Electron non c'è (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`: la VM Windows, la CI
cloud) solo sotto Node. Su Windows lo stop con SIGTERM non esiste: lo smoke termina il processo e lo dice. Circa 5-6
minuti su una macchina a 16 core.

| Opzione | Effetto |
|---|---|
| `--quick` | senza e2e né pacchetto |
| `--no-package` | senza il passo `package` |
| `--keep` | tiene la cartella di lavoro (utile per capire un rosso) |
| `--commit <rev>` | prova quel commit invece di `HEAD` |
| `--github` | modalità dei job `full` (sopra): nel checkout stesso, e2e e `package` su tutti e tre i sistemi, pacchetti copiati in `MONSTERS_CI_ARTIFACTS` |

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

Non c'è più una CI serale (D-147). La CI completa sui tre sistemi deve essere verde **sul commit che esce**, e la release
non parte senza. Da D-152 la fonte predefinita sono i job `full (…)` di GitHub Actions; i risultati locali restano come
ripiego, sistema per sistema.

- `pnpm release:ci [--commit <rev>] [--no-probe] [--no-wait]` (predefinito, GitHub): il commit deve essere su origin.
  Se c'è già una run del workflow per quel commit avviata da un push o a mano, la segue (`gh run watch`); se non c'è,
  la avvia (`gh workflow run ci.yml --ref <branch>` su un branch di origin che ha il commit in testa: un avvio a mano
  parte da un branch, non da un hash); se l'ultima è rossa lo dice con il comando per rilanciare i job falliti
  (`gh run rerun <id> --failed`). `--no-wait` la avvia o la indica e si ferma lì.
- `pnpm release:ci --local [--commit <rev>] [--no-probe] [--no-status]`: come prima di D-152, lancia in fila
  `ci:local`, `ci:windows` e `ci:mac` (con l'hash intero del commit) e si ferma al primo rosso. Mac con exit 75
  (spento, irraggiungibile o occupato) è detto chiaramente e non è un rosso del codice: lo si accende e si rilancia.
- In coda, in tutti e due i modi, gira sulla macchina locale la **sonda degli strumenti degli harness** (D5 della review del 19/10, D-127, `packages/core/test/fixtures/probe-harness-tools.ts`): avvia il vero
  `claude` (e `codex`, se c'è) come lo avvia Monsters e controlla che ogni strumento che vede sia uno che può eseguire;
  nessuna richiesta al modello, pochi secondi; senza `claude` (exit 3) è saltata, non rossa. `--no-probe` la salta; a
  mano: `pnpm exec node packages/core/test/fixtures/probe-harness-tools.ts`.
- **Stati su GitHub (solo `--local`).** I job `full (…)` sono già check run del commit; dopo una CI locale, in coda
  (anche se un sistema è rosso) `release:ci --local` pubblica il risultato come *commit status* sul commit, così GitHub mostra la verifica fatta in locale: `local-ci/linux`, `local-ci/windows`, `local-ci/macos`
  (success, failure o pending, con una descrizione corta tipo `ci:local full + package, 4m31s`) e `local-ci/release-gate`
  (success solo se i tre sono verdi). Lo fa `pnpm ci:status [--commit <rev>] [--dry-run]` (`scripts/ci-status.ts`, la
  mappatura è pura e testata), con `gh api -X POST repos/<owner>/<repo>/statuses/<sha>`; owner e repo vengono da
  `git remote get-url origin` (predefinito `Saturday-Company/monsters`). Pubblica solo se il commit è su origin
  (altrimenti spiega di fare prima il push e rilanciare `pnpm ci:status`). Nessun `target_url` e nessun percorso,
  host o dato personale nelle descrizioni. `--dry-run` stampa i comandi `gh` senza eseguirli; `pnpm release:ci
  --no-status` salta la pubblicazione. `pnpm ci:status` da solo non pubblica nulla se il commit ha già i tre job
  `full (…)` verdi su GitHub (`--force` pubblica comunque).
- `pnpm release:check [--commit <rev>] [--source auto|github|local]` (`scripts/release-gate.ts`) stampa lo stato del
  cancello per quel commit ed esce 0 se è aperto, 1 se è chiuso. Un sistema conta se una delle due fonti lo ha verde
  (`auto`, il predefinito; `MONSTERS_CI_GATE=github|local` o `--source` ne tiene una):
  - **GitHub:** il check run `full (<sistema>)` del commit (`gh api repos/<owner>/<repo>/commits/<sha>/check-runs`),
    concluso `success`, fatto da GitHub Actions in una run di `.github/workflows/ci.yml` avviata da un push o a mano in
    questo stesso repo (letta con `gh api repos/<owner>/<repo>/actions/runs/<id>`). Una run di una pull request non
    conta mai: la PR di un fork gira il workflow del fork, che può chiamare un job come vuole. Se GitHub non risponde
    lo dice e resta il ripiego locale.
  - **Locale:** in `ci-results/` un risultato dell'**hash intero** del commit con `mode: full`, `status: passed`, non
    fatto su un checkout sporco e con il passo `package` passato (quindi né `--quick` né `--no-package`; su Windows il
    passo `package` lo scrive `ci-windows.sh` nel risultato).

  Se manca qualcosa dice cosa, per le due fonti, e quale comando lanciare. Un rosso più recente non cancella un verde
  pieno dello stesso commit.
- `pnpm desktop:publish` (feed `desktop` e GitHub Release) controlla il cancello su `HEAD` (le due fonti, come
  `release:check`) e **rifiuta** di pubblicare se è chiuso. `--skip-ci-gate` lo scavalca con un avviso ben visibile; `--dry-run` lo mostra ma non si
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
