# Architettura di Monsters

> Stato: **approvata il 14/10/2026**. Le scelte sono motivate in `DECISIONS.md`, le fonti in `research/`.

## 1. L'idea in una figura

```
                ┌──────────────────────── canali ────────────────────────┐
                │  Web UI (React)   CLI/TUI via SSH   Telegram   Desktop │
                └───────┬───────────────┬───────────────┬──────────┬─────┘
                        │ HTTP + WebSocket su 127.0.0.1, token + controllo Origin
┌───────────────────────▼─────────────────────────────────────────────────────────┐
│ CORE  (un solo processo Node 24, "monsters")                                    │
│                                                                                 │
│  Gateway ── Auth (utente locale, sessioni, token CLI, whitelist Telegram)       │
│     │                                                                           │
│  Orchestratore ──delega (agents-as-tools)──▶ Agenti (Rhea, Dione, …N)          │
│     │   ▲  ask_user (opzioni)                    │                              │
│     │   └── DecisionGate (regole + System 1)     │                              │
│     │                                            ▼                              │
│  Runtime agente: loop AI SDK 7 ── Strumenti: vault_*, web, shell, MCP, CLI      │
│     │                              │                                            │
│  Provider: OpenRouter free → API a consumo → abbonamenti (ChatGPT, Claude Code) │
│     │                                                                           │
│  Event log append-only (SQLite) = log delle azioni, stream per la UI, ripresa   │
│  Kill switch: AbortController globale + stato persistito                        │
│     │                                                                           │
│  VaultService ── file .md (Obsidian) + git + indice SQLite FTS5 (+ vettori)     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Un solo processo "core" possiede stato, agenti e vault. Tutti i canali sono client dello stesso core: la web UI, la
CLI usata via SSH, il bot Telegram e, in Fase 3, l'app desktop (che può collegarsi a un core remoto tramite tunnel SSH).
Così c'è un solo scrittore del vault, un solo log e un solo kill switch.

## 2. Principi

1. **Locale e dell'utente.** Tutto gira sul suo PC; i dati sono file leggibili (Markdown, YAML, SQLite).
2. **Agnostico sul provider.** Ogni chiamata a un modello passa dall'interfaccia `Provider`; nessun modulo conosce
   un provider specifico.
3. **Nessun blocco per gli agenti, protezione per l'utente.** Gli agenti non chiedono conferme per usare strumenti:
   i permessi si concedono una volta all'onboarding. L'utente è protetto da autenticazione sul piano di controllo,
   log di ogni azione, reversibilità del vault e kill switch. Si chiede all'utente solo per le scelte che spettano a
   lui (vedi §6).
4. **Lo stato vive nei file e nel log**, non nel contesto dei modelli. Un agente può ripartire da zero leggendo
   memoria e log.
5. **Togliere più che aggiungere.** Istruzioni brevi, pochi strumenti ben descritti, harness semplice da potare a
   ogni modello nuovo.

## 3. Stack

| Livello | Scelta |
|---|---|
| Runtime | **Node 24 LTS**, TypeScript strict, ESM. Monorepo **pnpm** |
| Server | **Hono** (HTTP + WebSocket) su `127.0.0.1` |
| Loop agentico e provider | **Vercel AI SDK 7** (`ai`), `@openrouter/ai-sdk-provider`, provider ufficiali `@ai-sdk/*`, client MCP `@ai-sdk/mcp` |
| Abbonamenti (Fase 2) | ChatGPT con *Sign in with ChatGPT*; Claude con il binario ufficiale tramite `@anthropic-ai/claude-agent-sdk`; Codex con `@openai/codex-sdk` |
| Database | **SQLite** via `node:sqlite` (FTS5 incluso) dietro un piccolo adapter |
| Vault | file `.md`, `yaml` + `remark` per il parsing, **isomorphic-git** (git di sistema se presente), `chokidar` 5 |
| Ricerca semantica (Fase 2) | `@huggingface/transformers` 4 + granite-embedding-97m-multilingual-r2 (quint8), vettori in SQLite, fusione RRF |
| Validazione | **zod 4**, schemi condivisi da strumenti interni, API e server MCP |
| UI | **React 19 + Vite 8 + Tailwind 4**, componenti shadcn/ui, animazioni in CSS a fotogrammi (D-084), Zustand |
| Mostri | **SVG parametrico** ("genoma" JSON + kit di parti), componente `<Monster>` |
| Telegram (Fase 2) | **grammY** |
| MCP server del vault (Fase 2) | `@modelcontextprotocol/server` v2 |
| Test | **Vitest** (unità e integrazione, provider finto di AI SDK), **Playwright** (e2e della UI) |
| Desktop (Fase 3) | **Electron** (Chromium ovunque: serve per il vetro con rifrazione; core in un `utilityProcess`, electron-builder), D-015 riverificata il 15/10/2026 |

## 4. Struttura del repository

```
monsters/
├── CLAUDE.md  AGENTS.md  LICENSE  SECURITY.md
├── docs/                         # memoria dello sviluppo (non è il second brain del prodotto)
├── packages/
│   ├── core/                     # gateway, auth, event log, kill switch, orchestratore, runtime agenti
│   ├── providers/                # interfaccia Provider, OpenRouter, RateBudget, provider finto per i test
│   ├── vault/                    # VaultService, indice, git, strumenti vault_*
│   ├── tools/                    # web_search, web_fetch, shell, MCP client, CLI (Fase 2)
│   ├── monster-kit/              # genoma, parti SVG, generatore, animazioni (usato da UI e Telegram)
│   ├── shared/                   # tipi ed eventi condivisi (schemi zod)
│   ├── db/                       # adapter SQLite e migrazioni (usato da core e vault)
│   └── cli/                      # comando `monsters` (avvio, stato, kill, chat da terminale)
├── apps/
│   ├── web/                      # la UI React
│   └── desktop/                  # app Electron: core in un utilityProcess, finestra sul core (D-045)
└── e2e/                          # test end-to-end e demo registrate
```

## 5. Componenti del core

### 5.1 Event log
Tabella `events` append-only in `~/.monsters/monsters.db`: `{id ULID, ts, agent, run_id, parent_id, type, data}`.
Tipi principali: `message`, `delegation`, `tool_call`, `tool_result`, `decision`, `question`, `answer`,
`question_expired`, `vault_change` (con SHA del commit e, per un annullamento, l'azione annullata), `provider_usage`,
`error`, `kill`. È insieme:
- il **log delle azioni** consultabile dalla UI (filtri per agente, tipo, periodo);
- lo **stream** che alimenta chat, terminali degli agenti e mostri (via WebSocket);
- la **fonte per riprendere** un lavoro dopo un riavvio.
I segreti non entrano mai nel log (redazione per chiave e per pattern prima della scrittura).

**Archivio** (`packages/core/src/log/archive.ts`): gli eventi voluminosi più vecchi di 90 giorni (`settings.json` →
`logArchive.{enabled,days}`, minimo 30) escono dal db e vanno in un file gzip al mese,
`~/.monsters/archive/events-AAAA-MM.jsonl.gz` (mese UTC di `ts`, un evento per riga come lo dà l'API, permessi 600).
Si spostano solo: `provider_usage`, `tool_result`, `tool_call` (tranne quelli che leggono testo di terzi: per i log
prima di D-103 sono il segno del taint di un run), i `message` parziali dello streaming e i messaggi dei sotto-agenti
dentro un giro di automazione chiuso. Tutto il resto resta per sempre; il taglio non va mai oltre l'inizio del mese
precedente (la spesa del mese e del precedente è sempre intera). Ordine: file scritto in `.tmp`, fsync, riletto e
confrontato (righe e SHA-256), rinominato, fsync della cartella; solo dopo, in transazioni che tolgono e rimettono il
trigger `events_no_delete`, la cancellazione. Un giro interrotto non perde niente: al successivo gli eventi già nel
file si cancellano soltanto. Prima del primo archivio una copia del db (`monsters.db.before-archive`, `VACUUM INTO`),
tolta quando un giro successivo sposta di nuovo eventi senza errori. Il core fa un giro al massimo una volta al giorno
(controllo un minuto dopo l'avvio e poi ogni ora; prima se il db è cresciuto di 256 MB), il `VACUUM` solo senza mostri
al lavoro e con almeno 64 MB liberi; a mano `monsters log archive` (con `VACUUM`), `monsters log read --month
AAAA-MM`, `GET/POST /api/log/archive`. Ogni giro lascia un evento `log_archive`; l'Attività, finita la storia, dice
dove sono gli archivi.

### 5.2 Kill switch
Un `AbortController` globale da cui derivano quelli di ogni run, agente e chiamata a strumento. `kill` interrompe
le chiamate ai modelli, termina i processi figli (shell, CLI, harness) con SIGINT e poi SIGKILL, svuota le code,
scrive l'evento `kill` e mette il core in stato **fermo**: non parte nulla finché l'utente non riattiva. Raggiungibile
da UI (pulsante sempre visibile), CLI (`monsters kill`) e Telegram (`/stop`, Fase 2).

### 5.3 Runtime degli agenti
Un agente è una cartella in `~/.monsters/agents/<id>/`:
```
AGENTS.md        # ruolo e regole essenziali (meno di 40 righe), generato da template
agent.yaml       # nome, colore, provider e catena di fallback, strumenti, permessi sul vault, limiti
genome.json      # aspetto del mostro
skills/          # procedure ricorrenti in formato SKILL.md (standard agentskills.io)
```
La memoria di lungo periodo dell'agente sta nel vault, in `Agenti/<Nome>/MEMORY.md`, così l'utente la vede e la
corregge in Obsidian. A ogni run il prompt di sistema è: AGENTS.md + MEMORY.md + profilo utente essenziale + brief
del compito. Il loop è `ToolLoopAgent` di AI SDK con limite di passi, AbortSignal e callback che scrivono nel log.
Quando un agente gira su un harness (Claude Code, Codex) la sua cartella di lavoro riceve AGENTS.md (Codex lo legge da
lì) e gli strumenti di Monsters arrivano come server MCP. Claude Code non legge file di impostazioni né CLAUDE.md dalla
cartella (`--setting-sources ""`, D-079): AGENTS.md gli arriva nel prompt di sistema aggiunto, e la configurazione degli
harness eventualmente scritta nella cartella (`.claude/`, `.mcp.json`, CLAUDE.md, `.codex/`) si toglie a ogni run.

### 5.4 Orchestratore
È un agente come gli altri, con il nome scelto dall'utente, più tre strumenti:
- `delegate({agent, goal, why, context_links, constraints, output_format, done_when})`: avvia un sottoagente con
  contesto mirato e restituisce il suo riassunto (massimo ~1.500 token) più i percorsi delle note create. Più
  `delegate` nello stesso passo partono **in parallelo**.
- `ask_user({question, options[2-4], recommended, blocking})`: manda all'utente una domanda con opzioni su tutti i
  canali attivi. Il lavoro che non dipende dalla risposta continua.
- `team_*` (Fase 1 per l'onboarding): proporre, creare e modificare agenti.
- `access_request({access: web|service|browser, monster?, service?, project?, why})` (anche i capi dei progetti,
  D-130): chiede all'utente un accesso che manca a un mostro della squadra. È una domanda del negozio delle domande
  (app e Telegram, parcheggiata come `ask_user`) con «Sì, concedi» e «No», a cui risponde solo l'utente in persona;
  al sì il core applica il cambio (Permessi, Collegamenti del progetto, browser) e scrive `access_grant` in Attività.
Qualsiasi richiesta non rivolta a un agente preciso arriva a lui. Le richieste semplici le esegue da solo: delegare
costa token (il multi-agente ne consuma molte volte di più) e va fatto solo quando conviene.

### 5.5 DecisionGate e System 1
Un'unica interfaccia `DecisionPort` con il contratto `/v1/systemone` (stato + domande tipizzate `choice`/`noul`/`score`
→ risposta + confidenza), così Jev, Laya o un LLM piccolo sono intercambiabili. Usi:
1. **chiedo o procedo?** prima di un'azione o di una scelta di un agente;
2. **a chi smisto?** una richiesta generica tra gli agenti del team;
3. **notifico ora o dopo?** (Fase 2, Telegram).

Il gate è prima a regole, poi a modello:
- **procede da solo**: azioni locali, reversibili, dentro l'obiettivo (leggere, cercare, scrivere bozze e note);
- **chiede sempre**: pubblicare, scrivere a terzi, spendere, cancellare in modo irreversibile, cambiare obiettivo,
  scelte di gusto (tono, design) quando le preferenze note non bastano;
- **zona grigia**: decide il modello; sotto la soglia di confidenza diventa una `ask_user` con l'opzione consigliata.
Ogni decisione si registra (stato, opzioni, scelta, chi ha scelto): è il dataset per addestrare Laya in Fase 2.
Le regole sono modificabili dall'utente ("puoi pubblicare senza chiedere").

Dal 16/10 (D-067) il System 1 è l'**istinto** della squadra (`packages/core/src/team/instinct/`): un servizio solo che
fa le domande di ogni momento in una chiamata, con una modalità per uso (`off`, `shadow`, `on`), due soglie per uso e un
ripiego a regole. Oltre al gate: "finito davvero?" dopo ogni delega (sui fatti del log), "gira a vuoto?", la domanda
lasciata nel testo, la radiografia della richiesta (suggerimento, strumenti, livello del modello), il freno sulle azioni
che escono dal computer, le iniezioni nei dati esterni, la memoria e la pagella dei mostri. A fine turno il core scrive la
ricevuta del lavoro, con "Annulla tutto".

Dal 16/10 (D-070) il freno passa da **ogni** chiamata dei mostri nativi (anche quelle in sola lettura: `web_fetch`,
`web_search`, il browser) e le sue regole valgono con qualunque motore e modalità; l'istinto giudica solo i casi dubbi.
Ogni run ha una **contaminazione** (`RunTaint`, `instinct/taint.ts`) condivisa dai suoi agenti: dal primo risultato di una
fonte di terzi, i dati che escono (indirizzi, ricerche, pagine del browser, comandi del terminale) si confrontano con le
note lette nel run, il profilo e la memoria. I testi esterni perdono i caratteri invisibili prima di arrivare al
modello (`agents/invisible.ts`). Il **tetto di spesa** (`team/spend.ts`) somma i `costUsd` di `provider_usage` per
giorno e mese, squadra e mostro, e ferma i mostri con modelli a pagamento (`RunBudget.spendCheck` e all'avvio del
turno). Il gestore MCP tiene l'**impronta** degli strumenti di ogni server (`mcp_pins:<nome>` nello stato) e mette in
pausa quelli nuovi o cambiati.

### 5.6 Provider
Due tipi dietro la stessa interfaccia (bozza in `research/02-provider-e-motore.md`):
- **model**: il loop è nostro (OpenRouter free e a consumo, Mistral, Anthropic/OpenAI/Google via API, ChatGPT via
  SIWC, Ollama/LM Studio);
- **harness**: il loop è di un agente esterno ufficiale (Claude Code, Codex) e noi ne leggiamo gli eventi. Gli
  strumenti di Monsters gli arrivano via MCP (`/api/harness/mcp`) col freno del core; quelli suoi (terminale,
  ricerca web del piano, servizi tramite Claude) passano dagli hook HTTP di Claude Code (`/api/harness/hook`), con lo
  stesso `InstinctGuard` e lo stop hook del mostro (D-069). Dal D-073 anche `PostToolUse` sulla ricerca del piano e sui
  servizi tramite Claude: il risultato contamina il run, perde i caratteri invisibili e passa dal controllo delle
  iniezioni (un blocco tolto torna a Claude Code con `updatedToolOutput`). Dal D-074 il run si contamina già nel
  `PreToolUse` e gli errori dei servizi arrivano da `PostToolUseFailure` (contaminano e ricevono l'avviso).

Ogni agente ha una **catena di fallback**. Con `openrouter/free` il modello scelto al primo turno si **fissa per la
sessione**. Un `RateBudget` per provider, condiviso da tutti gli agenti, legge gli header di rate limit e mette in
coda invece di fallire (con 50 richieste al giorno senza crediti è indispensabile). Nell'onboarding si spiega che
una ricarica una tantum di 10 $ su OpenRouter porta il limite gratuito a 1.000 richieste al giorno, e che alcuni
provider dei modelli free possono usare i prompt per l'addestramento.

### 5.7 Strumenti
| Gruppo | Strumenti | Fase |
|---|---|---|
| Vault | `vault_search`, `vault_read`, `vault_list`, `vault_write`, `vault_edit`, `vault_move`, `vault_delete`, `vault_links`, `vault_tags`, `vault_history`, `vault_restore`, `vault_undo`, `vault_propose` | 1 |
| Web | `web_search` (catena di motori: a pagamento via OpenRouter quando è accesa e la chiave ha credito, Brave se configurato, poi DuckDuckGo e Wikipedia; più domande insieme con `queries`, D-071), `web_fetch` (pagina → Markdown, più pagine con `urls`, passaggi con `find`) | 1 |
| Team | `delegate`, `ask_user`, `team_propose`, `team_create`, `design_monster` | 1 |
| Sistema | `shell` (con timeout, cwd per agente, output troncato, log), `fs_*` fuori dal vault | 2 |
| Integrazioni | client MCP (qualsiasi server), installazione ed uso di CLI, browser (Playwright/CDP) | 2 |

Ai modelli piccoli o free si espone un sottoinsieme ridotto di strumenti, per non confonderli.

### 5.8 Auth e sicurezza
- **Utente locale** con email e password (argon2id) creato al primo avvio; sessione con cookie `HttpOnly`,
  `SameSite=Strict`. La CLI usa un token in `~/.monsters/` (permessi 600).
- Il server ascolta **solo su 127.0.0.1**; WebSocket con token e **controllo dell'Origin** (l'errore che ha colpito
  OpenClaw). L'accesso remoto passa da SSH (tunnel o CLI sul PC), mai da una porta aperta.
- Segreti (chiavi API, token) in `~/.monsters/secrets/`: cifrati (AES-256-GCM, `<nome>.enc`) con una chiave
  principale nel portachiavi del sistema (Keychain, Gestione credenziali, Secret Service); dove il portachiavi non c'è
  o non risponde, file 600 come ripiego dichiarato nella UI e in `monsters secrets` (D-042). Su Linux senza sessione
  D-Bus o senza schermo per la richiesta di sblocco il ripiego è immediato (30-90 ms); con un portachiavi bloccato su
  un desktop (GNOME dopo un riavvio con accesso automatico) il core mostra la richiesta della password e la aspetta
  fino a 20 s (`MONSTERS_SECRETS_TIMEOUT_MS`) prima di ripiegare: è il caso di chi è davanti allo schermo, non si
  accorcia. Prove, smoke ed e2e girano con `MONSTERS_SECRETS=file` (D-086).
- **Telegram (Fase 2):** whitelist di ID utente, pairing con codice mostrato nella UI per aggiungerne uno nuovo,
  `/stop` come kill switch.
- `SECURITY.md` e canale di segnalazione dal primo rilascio pubblico.
- Rischio accettato e dichiarato: con "nessun blocco" un agente vittima di prompt injection può fare danni nel
  perimetro concesso. Mitigazioni: perimetro scelto dall'utente all'onboarding, contenuti esterni marcati come dati,
  regole "chiedi sempre" del DecisionGate per le azioni verso l'esterno, log e kill switch.

### 5.9 Automazioni (D-094)
Un'automazione è un file in `~/.monsters/automations/<id>.yaml` (nome, capo, mostri che partecipano, regola cron con
fuso, obiettivo, cartella dei risultati, tetto per giro, avvisi, stato `draft`/`active`/`paused`), letto con lo schema
di `shared/src/automations.ts`. Il pianificatore (`core/src/automations/service.ts`, orari calcolati con croner)
calcola il prossimo giro all'avvio e dopo ogni giro; ogni giro sta nel log (`automation_run_started`, `_finished`,
`_skipped`, `automation_change`). Un giro apre un run suo per il capo (`Dispatcher.startAutomation`, canale
`automation`) e non entra mai nel lavoro dell'utente: se il capo lavora aspetta (al massimo un'ora, poi "saltato:
occupato"), e un messaggio scritto durante il giro aspetta la sua fine in un run suo. La chat del capo non vede i run
delle automazioni (`recentConversation`, indice `automations/run-index.ts`); il giro legge solo la propria storia. Una
domanda parcheggia il giro (`waiting_user`) e la risposta lo continua in un nuovo run dello stesso giro. Kill switch e
stato fermo saltano i giri; i giri persi a core spento: uno all'avvio se è passato meno di metà intervallo, altrimenti
"saltato". API in `/api/automations`, CLI `monsters automations list|run <id>`.

### 5.10 Progetti (D-097)
Un progetto è una squadra con il suo perimetro: `~/.monsters/projects/<id>/project.yaml` (nome, cartella, area delle
note `Progetti/<nome>/`, capo, tetto di spesa, collegamenti, ricerca web, stato `draft`/`active`, archiviato), schema
in `shared/src/projects.ts`. I mostri restano in `~/.monsters/agents/` con `project: <id>` nell'agent.yaml (assente =
Squadra personale): nessuna colonna nuova negli eventi, il progetto di un evento è quello del suo agente. Un solo
`TeamService` (`members(project)`, `lead(project)`, `projects()`) e un solo `TeamManager` (capo, copie con memoria
propria, mostri nuovi, archivio). Il capo è `kind: lead`: dentro il progetto fa l'orchestratore (`delegate`,
`ask_user`, `team_propose_monster`, suggerimenti di smistamento solo sui mostri del progetto), ma per il vault è un
mostro come gli altri (legge tutto tranne `Privato/`, scrive e cancella in `Progetti/<nome>/**`); `orchestrator()`
resta il solo orchestratore in cima. Un messaggio generico va all'orchestratore; uno al progetto
(`POST /api/projects/:id/messages`, `to` con l'id o il nome del progetto, `@Progetto`) va al capo.
L'orchestratore passa lavoro con `project_send` (messaggio nella chat del capo, canale `system`, `from`), il capo lo
fa in un run suo e il suo ultimo messaggio torna come evento `project_report`, che l'orchestratore legge al turno dopo
o con `project_status` (strumenti che si caricano con la ricerca degli strumenti quando sono tanti). I mostri del
progetto lavorano nella sua cartella (`cwd` di terminale, file e harness, cartella concessa in scrittura); CLAUDE.md e
AGENTS.md della cartella arrivano nella sezione "## Progetto" del prompt come dati, mai come istruzioni, e l'harness
non legge né scrive la configurazione della cartella (D-079). Nessun mostro scrive CLAUDE.md o AGENTS.md della
cartella; i mostri del progetto, il capo e l'orchestratore ne propongono il testo nuovo con `project_docs_propose`
(evento `project_docs_proposal`, bozza `docs` in "Da rivedere" con la differenza): il core scrive il file quando
l'utente lo applica, solo se è ancora quello su cui è stata scritta la proposta (D-113). Tetto di spesa a tre livelli (squadra, progetto,
mostro); un collegamento assegnato a `*` arriva ai mostri della Squadra personale e a quelli dei progetti che lo hanno
scelto. API in `/api/projects`.

## 6. Second brain

Dettagli completi in `research/04-second-brain.md`. In sintesi:
- **Fonte di verità**: file `.md` del vault, apribile in Obsidian. L'indice SQLite (FTS5, tag, link, proprietà;
  vettori in Fase 2) sta in `~/.monsters/index/` e si ricostruisce da zero.
- **Struttura iniziale**: `Inbox/ Diario/ Progetti/ Aree/ Risorse/ Persone/ Archivio/ Agenti/<Nome>/ Modelli/
  Allegati/ LEGGIMI.md` (PARA semplificato, nomi localizzati). Si può anche collegare un vault Obsidian esistente.
- **Convenzioni**: nomi file leggibili e unici, frontmatter minimo (`id`, `type`, `tags`, `created`, `updated`,
  `author`), tag minuscoli gerarchici, wikilink brevi. Le note create a mano senza frontmatter si accettano così come
  sono.
- **Permessi**: l'orchestratore ovunque; i sottoagenti leggono tutto (tranne `private: true`) e scrivono nella
  propria area, in `Inbox/`, nelle note di cui sono autori e nelle aree concesse; fuori usano `vault_propose`.
  Nessuno tocca `.obsidian/`, `.git/`, `.trash/`.
- **Reversibilità**: un commit git per ogni azione, con agente e id dell'azione; snapshot delle modifiche fatte
  dall'utente in Obsidian prima che un agente scriva; cancellare sposta in `.trash/`; `vault_undo` annulla
  un'azione intera con un nuovo commit. Ogni operazione è nel log con il link al commit.
- **Concorrenza**: hash ottimistico (`base_hash`), scrittura atomica, modifiche chirurgiche, watcher che reindicizza
  le modifiche esterne.

## 7. Onboarding e generazione del team

1. Creazione dell'utente locale (email e password).
2. Prima chiave: OpenRouter (link per crearla, verifica, avviso su limiti e privacy). Senza chiave si può provare
   con un modello locale se c'è Ollama.
3. Compare un solo mostro, l'agente iniziale, che fa 5-7 domande una alla volta (opzioni cliccabili più testo libero):
   nome dell'orchestratore, di cosa ti occupi, obiettivi, attività da delegare, strumenti usati, cosa non devono
   mai fare senza chiedere, tono e lingua.
4. **Permessi**: una schermata unica con cosa potranno fare gli agenti (vault, web, cartelle, shell, browser, account),
   tutto concesso in un colpo e modificabile dopo.
5. Le risposte vanno in `profilo.md` nel vault. L'orchestratore propone il team (2-5 agenti, una frase di ruolo
   ciascuno); l'utente conferma o modifica.
6. Per ogni agente un LLM produce un JSON validato (ruolo, contesto, strumenti, area del vault, colore, genoma) e il
   codice lo rende con un template fisso: file brevi e coerenti.
7. L'agente iniziale diventa l'orchestratore con il nome scelto; i mostri del team "nascono" sulla dashboard.

## 8. Interfaccia

- **Layout** (D-056, `docs/design.md`): barra laterale a tutta altezza (i mostri, una riga per chat con mostro,
  stato, anteprima, ora, non letti e domande in evidenza; poi Note, Attività e Impostazioni) e contenuto con una
  barra strumenti da 52 px (titolo, azioni, kill switch sempre visibile) che fa da barra del titolo nell'app desktop.
  Bolle dei mostri con una tinta leggera del loro colore, quelle dell'utente nell'accento. Sul telefono la barra
  laterale è la schermata iniziale e le viste si aprono a tutto schermo con Indietro. Terminale dell'agente in un
  pannello laterale.
- **Stile**: superfici neutre e opache, un solo accento, niente vetro (`backdrop-filter`) né sfondi animati: con
  il vetro l'app scendeva a 15 fps. Contrasto almeno 4.5:1 verificato da `apps/web/test/contrast.test.ts`, "Riduci
  movimento" e `prefers-reduced-motion`, animazioni dei mostri fuori vista sospese. Tema chiaro e scuro.
- **Terminale dell'agente**: log strutturato e leggibile (pensiero, strumenti, risultati, errori, sezioni
  ripiegabili); xterm.js solo per la shell vera (Fase 2).
- **Lingua**: frasi brevi e amichevoli, niente gergo.

## 9. I mostri

- **SVG parametrico**: un genoma JSON (corpo, occhi, bocca, corna, orecchie, coda, zampe, macchie, ciuffo, tinta,
  personalità) combina parti vettoriali disegnate una volta, con ancoraggi e pivot. I colori derivano dalla tinta in
  OKLCH (contorno scuro della stessa tinta, ombre, pancia). Stesso nome → stesso mostro.
- **Animazioni condivise** su tutti i mostri: idle (respiro, ciglia), parla, pensa, festeggia, errore; camminata in
  Fase 2 con un piccolo motore di steering nostro. La personalità modula ampiezza e velocità.
- **Generatore** `design_monster`: per ogni nuovo agente l'LLM produce un genoma vincolato allo schema, il codice lo
  valida e lo distanzia dalle tinte già usate.
- **I 7 mostri** prendono un tratto dalla loro luna di Saturno (es. Mimas ciclope come il cratere Herschel, Enceladus
  con il ciuffo-geyser). I concept li sceglie il maintainer.
- Il riferimento di stile esterno (non incluso nel repo) è **solo riferimento**: niente img2img, niente asset
  derivati.

## 10. Come sviluppiamo (il sistema agentico applicato a noi)

Lo stesso schema del prodotto: orchestratore, sottoagenti con contesto mirato, memoria su file.

- **Orchestratore** (la sessione principale): pianifica dal ROADMAP, scrive il brief di ogni task, delega, verifica,
  integra, aggiorna il registro di avanzamento interno e `DECISIONS.md`.
- **Sottoagenti per area**: core, vault, provider, UI, mostri, test. Ognuno riceve: obiettivo, file e documenti da
  leggere, vincoli, criterio di completamento. Restituisce: fatto, file toccati, decisioni, problemi aperti.
- **Lavoro in parallelo** su worktree git separati quando i task non si toccano; mai due agenti sugli stessi file.
- **Chi fa non giudica**: ogni milestone passa da un agente revisore diverso (correttezza, sicurezza) e dai test
  automatici. La UI si verifica con screenshot reali (chrome-devtools) in tema chiaro e scuro.
- **Definizione di finito** per ogni task: typecheck, lint e test verdi in CI; per le funzioni visibili, una demo
  e2e registrata.
