# 01 · Concorrenti, politiche dei provider e licenza

Ricerca del 14/10/2026. Dove possibile cito fonti primarie: documentazione ufficiale e repository GitHub.
Le pagine openai.com e x.ai/bot rifiutano il download automatico (HTTP 403): per Dots i dati vengono dalla
stampa (TechCrunch, NBC, 9to5Google) e da blog. Le cifre non confermate da fonti ufficiali sono segnate con *(fonte secondaria)*.

## In breve

- **Dots** (OpenAI, 29/09/2026) e **Grok Bot** (xAI, 11/08/2026) sono la stessa idea: agenti "colleghi" sempre accesi,
  con un nome, un computer cloud proprio, memoria e canali di messaggistica. Sono costosi (Dots da 100 $/mese) e
  legati al cloud del loro provider. **Dots Pro non è disponibile in UE, Regno Unito e Svizzera.**
- **Conductor** non riusa i token: esegue i **binari ufficiali** di Claude Code e Codex (inclusi nell'app oppure
  quelli di sistema) con il login che l'utente ha già fatto. Dal 29/09/2026 è anche partner di **Sign in with ChatGPT**.
- **Politiche dei provider:** OpenAI oggi **permette ufficialmente** alle app open-source e locali di usare il piano
  ChatGPT dell'utente (Sign in with ChatGPT, versione open-source, senza approvazione). Anthropic **vieta** di prendere,
  conservare o inoltrare i token OAuth di Claude, ma **permette** di eseguire il binario `claude` non modificato con
  il login dell'utente stesso.
- **Concorrente open-source più vicino a Monsters:** **Hermes Agent** (Nous Research, MIT, circa 254k stelle), poi
  **OpenClaw** (MIT, circa 392k stelle). Entrambi hanno avuto molte CVE.
- **Licenza consigliata:** **Apache-2.0** per il core locale, una **policy sul marchio** "Monsters" e sui mostri, e il
  **backend cloud degli abbonamenti chiuso**, in un repository separato.

---

## 1. Dots (OpenAI)

| Aspetto | Dettaglio |
|---|---|
| Cos'è | Agenti "always-on" che portano avanti obiettivi in background, presentati al DevDay del 29/09/2026 e basati su GPT-6 Astra. Ogni Dot ha un **proprio computer cloud e un browser**. Su permesso dell'utente può usare anche il suo computer. |
| UX | Si parte da un **"primary dot"** a cui l'utente dà un nome e che può personalizzare. L'avatar è un pallino in stile cartoon, "bubbly", pensato per rendere l'AI più simpatica (TechCrunch). Si può parlarci in chat o in **chiamata vocale** e lo si può **guardare mentre lavora** sul suo computer cloud. |
| Agenti | Nel lancio c'è **un solo Dot per piano**; i "Dot specialisti" e i team di Dot che collaborano sono annunciati per il futuro. Gli specialisti ricevono identità, credenziali e strumenti dai sistemi esistenti. |
| Autonomia | Valgono gli stessi permessi di ChatGPT, più **regole personalizzate** che dicono quando il Dot agisce da solo e quando chiede approvazione. Quando non ha compiti fa **"ricerca proattiva"** con accesso in sola lettura agli strumenti collegati. |
| Memoria | Impara preferenze, stile di ragionamento e cosa l'utente considera un buon risultato, migliorando con il feedback. **Il funzionamento non è documentato pubblicamente.** |
| Canali | ChatGPT (desktop, web e mobile; il Dot si crea solo da desktop o web), **Slack, Microsoft Teams**, chat di gruppo; SMS "in arrivo". Più di 4.000 app collegabili tramite plugin. Integrazione con i controlli di sicurezza di Microsoft Agent 365. |
| Prezzo | Non si compra a parte: è incluso in **Pro 100/200/500 $ al mese** e in Business Premium (125 $ per utente al mese); per Enterprise ed Edu c'è una beta. Dot aggiuntivi e upgrade sono annunciati senza prezzo *(fonte secondaria)*. |
| Limiti | **Escluso dai piani Pro in UE, Regno Unito e Svizzera** (Business Premium invece è incluso). Le quote d'uso non sono ancora pubbliche; i compiti eseguiti in Codex o ChatGPT Work consumano le quote di quei prodotti. Il 30/10 Pro 200 passa da 20x a 10x la quota Plus *(fonte secondaria)*. Il keynote ha sollevato critiche sulla sicurezza (incidente di "scope" di un modello interno) e la demo vocale è fallita. |

Fonti: [TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/) ·
[9to5Google](https://9to5google.com/2026/09/29/openai-dots-agent/) ·
[NBC News](https://www.nbcnews.com/tech/tech-news/openai-launches-dots-ai-agents-safety-questions-rcna600338) ·
[Betanews](https://betanews.com/article/openai-dots-agents-chatgpt/) ·
[Beam.ai, limiti Pro 200](https://beam.ai/agentic-insights/openai-dots-usage-limits-pro-200) ·
[MindStudio, prezzi](https://www.mindstudio.ai/blog/openai-dots-agent-pricing) ·
annuncio ufficiale (non scaricabile in automatico): https://openai.com/index/introducing-dots/

## 2. Grok Bot (xAI)

| Aspetto | Dettaglio |
|---|---|
| Cos'è | "Teammates" che entrano nei software aziendali e svolgono compiti in più passaggi. È in beta dall'11/08/2026; l'ambiente di calcolo è di **Cursor**, acquisito dal gruppo SpaceX/xAI. |
| Architettura | Un **unico computer cloud persistente per account** (browser, filesystem, terminale) **condiviso da tutti i Bot**, con file, sessioni del browser e login in comune. La documentazione stessa avverte che i Bot separati **non sono un confine di sicurezza** ("a real blast radius"). |
| Agenti | Ogni Bot ha un nome, un lavoro e un contesto e si crea descrivendo il compito in un messaggio. I Bot lavorano in parallelo, si scrivono tra loro, condividono il contesto nelle chat di gruppo e si passano i compiti. Possono **imparare un flusso da una dimostrazione**, salvarlo come *skill* e ripeterlo come *routine* programmata. |
| Memoria | Memoria, file e preferenze restano tra una sessione e l'altra; conversazioni e contesto appreso sono separati per Bot. La documentazione consiglia di far ricontrollare la fonte prima delle decisioni importanti. |
| Canali | App desktop (macOS, Windows, Linux) e mobile (iOS, Android), voce e memo vocali, **menzione `@bot` su X**. Telegram e iMessage non sono documentati. |
| Sicurezza e UX | Chiede **approvazione prima delle azioni importanti** (inviare, pubblicare, comprare, cancellare). Un **modello di revisione** controlla le chiamate agli strumenti prima che partano, ma l'opzione "Always Allow" disattiva tutto. Password, codici 2FA e pagamenti li inserisce l'utente e restano fuori dalla trascrizione. Il catalogo ha circa 220 plugin; dove non c'è un plugin, il Bot usa il browser. |
| Prezzo | Incluso in **SuperGrok (circa 30 $ al mese)** e nei piani superiori (Heavy circa 300 $), e in tutti i piani Cursor a pagamento. La quota d'uso si azzera ogni settimana. Enterprise dal 21/09/2026 *(prezzi da fonti secondarie)*. |
| Limiti | Ogni Bot esegue un solo compito "computer use" alla volta e alcuni siti bloccano l'automazione. La reputazione di Grok (deepfake) pesa sull'adozione in azienda. |

Fonti: [docs.x.ai/grok-bot](https://docs.x.ai/grok-bot) ·
[Reworked](https://www.reworked.co/collaboration-productivity/xai-launches-grok-bot-ai-agents-in-beta/) ·
[DigitalApplied](https://www.digitalapplied.com/blog/grok-bot-ai-teammates-launch-cloud-computer-2026) ·
[RoboRhythms, prezzi](https://www.roborhythms.com/is-supergrok-worth-it/) · pagina ufficiale: https://x.ai/bot

## 3. Conductor (conductor.build)

- **Cos'è:** un'app per Mac che esegue **in parallelo** Claude Code, Codex, Cursor e OpenCode. Ogni compito ha un
  **workspace isolato**, cioè un **git worktree** con branch, file, terminale, diff e revisione propri. Prima di creare
  il workspace fa `fetch` da `origin`, e l'agente rinomina il branch in base al compito. Una variabile `CONDUCTOR_PORT`
  separa le porte dei vari workspace. Ci sono script di setup e run, una vista diff, i check e le PR.
- **Come usa gli abbonamenti:** **include i binari ufficiali** di Claude Code e Codex ("so that we can ensure
  compatibility"), ma si può configurare anche il binario di sistema. *"By default, Conductor uses the auth tokens
  already saved on your machine"*: Conductor non gestisce gli account, esegue la CLI ufficiale che è già loggata
  (Claude Pro/Max, oppure API key, Bedrock o Vertex tramite variabili d'ambiente). Avverte che se è impostata
  `ANTHROPIC_API_KEY` si paga a consumo invece di usare l'abbonamento. Per Codex ci sono due opzioni: "CLI auth" oppure
  API key. **Dal 29/09/2026 (v0.89) offre "Continue with ChatGPT"**, da partner ufficiale di Sign in with ChatGPT.
  Nel cloud fa copiare il comando `claude setup-token`, quindi anche lì gira il binario ufficiale con un token
  dell'utente. **Non risulta che usi l'Agent SDK né che riusi i token OAuth al di fuori della CLI.**
- **Prompt di contesto:** inietta un prompt di sistema che spiega all'agente che si trova dentro Conductor e che cos'è
  un workspace.
- **Sicurezza:** *"Agents run directly on your system without sandboxing"*. L'isolamento dei workspace serve a
  organizzare il lavoro, non a proteggere.
- **Prezzo:** Free a 0 $ (locale, con abbonamenti e chiavi propri). **Pro a 50 $ al mese**: Conductor Cloud su microVM
  (sandbox Vercel), collaborazione multiplayer, API e app iOS (v0.90, 2/10/2026). Teams a 60 $ per utente al mese, poi
  Enterprise. È rimasto gratuito a lungo e ora monetizza su cloud e collaborazione, non sull'inferenza.

Fonti: [FAQ](https://www.conductor.build/docs/faq) ·
[Harness Claude Code](https://www.conductor.build/docs/reference/harnesses/claude-code) ·
[Harness Codex](https://www.conductor.build/docs/reference/harnesses/codex) ·
[Workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches) ·
[Changelog 0.89 Sign in with ChatGPT](https://www.conductor.build/changelog/0.89.0-sign-in-with-chatgpt) ·
[0.78 Conductor Cloud](https://www.conductor.build/changelog/0.78.0-introducing-conductor-cloud) ·
[Pricing](https://www.conductor.build/pricing)

## 4. Hub di agenti locali o self-hosted (i 6 più rilevanti)

Stelle e licenze lette dall'API GitHub il 14/10/2026.

| Progetto | Licenza | Stelle | Cosa fa bene | Punti deboli e problemi noti |
|---|---|---|---|---|
| **Hermes Agent** (Nous Research) | MIT | circa 254k | È il più vicino a Monsters. Un unico gateway per **Telegram, Discord, Slack, WhatsApp e Signal**, più CLI/TUI e un'app desktop. Ha memoria curata dall'agente, ricerca full-text (FTS5) nelle sessioni passate, modello dell'utente con Honcho, **skill che l'agente crea e migliora da solo** (standard agentskills.io), cron in linguaggio naturale, sottoagenti in parallelo, qualsiasi provider (OpenRouter, Nous Portal…) e 7 backend di esecuzione (locale, Docker, SSH, Modal…). È partner Sign in with ChatGPT. | Molte CVE nel 2026: RCE nel gateway TUI (CVE-2026-14625, con exploit pubblico), injection e bypass dell'autorizzazione (CVE-2026-9350, -9353, -9366, -10221…). In diverse segnalazioni il vendor **non ha risposto** alla disclosure. Si installa con `curl \| bash` e molte dipendenze (Python, Node, ffmpeg…). |
| **OpenClaw** (ex Clawdbot/Moltbot) | MIT | circa 392k | Gateway locale come piano di controllo, **più di 20 canali** (WhatsApp, Telegram, iMessage, Slack…), app native e "nodes" sui dispositivi. Memoria in **Markdown** (`MEMORY.md`). Modelli e harness (Claude CLI, Codex) sono plugin intercambiabili. **Pairing** obbligatorio per chi scrive in DM senza essere conosciuto. Lo gestisce una fondazione 501(c)(3) (OpenAI è donatore), senza tier a pagamento. | È il caso più noto di **crisi di sicurezza** degli agenti: CVE-2026-25253 (RCE con un clic tramite hijack del WebSocket, anche in localhost), CVE-2026-22172 e CVE-2026-32922 (CVSS 9.9). Decine di migliaia di istanze esposte senza autenticazione. Su ClawHub centinaia, poi più di 1.000, **skill malevole** con infostealer (campagna ClawHavoc); oggi c'è la scansione con VirusTotal. Gli strumenti girano sull'host se non si configura la sandbox. Pesante: richiede Node 24 o più recente, è un monorepo pnpm. |
| **Open WebUI** | BSD-3 **con clausola di branding** (non è OSI) | circa 156k | Il frontend di chat self-hosted più diffuso, per Ollama e qualunque API compatibile OpenAI; RAG, multiutente, pipeline. | **Ha cambiato licenza nel 2025** (obbligo di mantenere il marchio sopra i 50 utenti) e ha ricevuto critiche dalla community. CVE del 2026 su autorizzazione, XSS ed endpoint senza autenticazione (CVE-2026-45345, -45346, -45349, -45667). È pensato per la chat, non per agenti autonomi. Pesante (Python, Docker). |
| **goose** (Block, ora Agentic AI Foundation / Linux Foundation) | Apache-2.0 | circa 55k | Agente locale **agnostico rispetto al modello**: desktop (Electron), CLI e API su macOS, Linux e Windows. MCP nativo con le "extensions", *recipes* (flussi riutilizzabili e programmabili) e sottoagenti. Ha una governance neutrale. | È orientato agli sviluppatori. L'orchestrazione multi-agente è ancora "early". Non ha canali di messaggistica né una memoria tipo second brain. |
| **Letta** (ex MemGPT) | Apache-2.0 | circa 25k | Lo stato dell'arte della **memoria degli agenti**: memory blocks, memoria su git, Conversations API (una memoria per più chat parallele). Da aprile 2026 c'è anche l'app desktop di Letta Code. | È più una piattaforma/SDK che un prodotto per l'utente finale e richiede un server. Il repository principale è meno attivo (ultimo push 10/09/2026). |
| **AnythingLLM** (Mintplex Labs) | MIT | circa 67k | App desktop "tutto in uno", facile da usare: RAG su documenti, agenti, modelli locali e remoti; è stata la porta d'ingresso per molti non tecnici. | È centrato sul RAG e sulla chat. Gli agenti sono semplici e non c'è un vero multi-agente con orchestratore. |

Altri da tenere d'occhio: **LibreChat** (MIT, circa 46k), un ottimo frontend multi-provider con MCP e agenti ma
orientato alla chat; **Jan** (Apache-2.0, circa 45k), offline-first; **Khoj** (AGPL-3.0, circa 38k), un
"AI second brain" self-hosted molto vicino al nostro concetto di vault.

Fonti: [hermes-agent](https://github.com/NousResearch/hermes-agent) ·
[CVE Hermes, GitLab advisories](https://advisories.gitlab.com/pypi/hermes-agent/CVE-2026-9353/) ·
[SentinelOne CVE-2026-14625](https://www.sentinelone.com/vulnerability-database/cve-2026-14625/) ·
[openclaw](https://github.com/openclaw/openclaw) ·
[Sicurezza OpenClaw, DigitalOcean](https://www.digitalocean.com/resources/articles/openclaw-security-challenges) ·
[Hive Security](https://hivesecurity.gitlab.io/blog/openclaw-ai-agent-security-crisis-2026/) ·
[Fondazione OpenClaw, The New Stack](https://thenewstack.io/openclaw-foundation-nonprofit-status/) ·
[Licenza Open WebUI](https://docs.openwebui.com/license.txt) ·
[NVD CVE-2026-45349](https://nvd.nist.gov/vuln/detail/CVE-2026-45349) ·
[goose @ AAIF](https://aaif.io/blog/goose-doubles-down-on-open-in-latest-two-releases) ·
[Letta Code](https://www.letta.com/blog/letta-code) ·
[AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)

## 5. Politiche dei provider sugli abbonamenti consumer (CRITICO)

### Anthropic (Claude Pro/Max)

La fonte primaria è la pagina [Legal and compliance di Claude Code](https://code.claude.com/docs/en/legal-and-compliance), letta il 14/10/2026:

- **Vietato:** *"Anthropic does not permit third-party developers to offer Claude.ai login into their own applications,
  or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may
  not collect, store, or intermediate Claude.ai credentials or session tokens."* Chi sviluppa prodotti, anche con
  l'**Agent SDK**, deve usare le **API key**. Anthropic si riserva di intervenire "without prior notice": dal
  gennaio 2026 ha bloccato i client che fingevano di essere Claude Code e ha bannato alcuni account, e OpenCode ha
  tolto il supporto dopo richieste legali.
- **Permesso:** *"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own
  Claude subscription, including where a platform hosts Claude Code."*
- **Condizioni per chi esegue Claude Code dentro un prodotto:** serve accettare i **Commercial Terms**; il binario
  **non va modificato** e non si possono togliere metodi di login; è **vietato pagare, rivendere o fare da
  intermediari** per l'uso di Claude degli utenti finali, perché ogni utente si autentica con le proprie credenziali.
  Si può scrivere "runs Claude Code", ma **non si possono usare il nome o il logo Claude/Anthropic** nel nome del
  prodotto.
- **Fatturazione:** il 4-5/04/2026 Anthropic ha annunciato che gli abbonamenti **non coprono più gli harness di terze
  parti** come OpenClaw: si paga con "extra usage" o con un'API key
  ([Boris Cherny](https://x.com/bcherny/status/2040206440556826908), [TechCrunch](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/)).
  Però l'articolo ufficiale del centro assistenza, aggiornato il 15/06 e il 7/10/2026, dice che *Agent SDK, `claude -p`
  e app di terze parti "still draw from your subscription limits"*
  ([support.claude.com](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
  **Le fonti non sono allineate**: bisogna considerarla una politica instabile.
- **Novità del 7/10/2026:** Max 5x, Max 20x e Team includono **crediti API mensili** (100, 200 e fino a 500 $) su
  un'organizzazione Console collegata, utilizzabili con API, Agent SDK e Managed Agents
  ([platform.claude.com](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)). È un modo
  **pienamente conforme** perché l'utente Max usi i suoi crediti dentro Monsters: incolla un'API key sua.

### OpenAI (ChatGPT Plus/Pro)

- **Sign in with ChatGPT (SIWC):** il login è attivo da luglio 2026; l'uso del piano nelle app di terze parti è stato
  annunciato al DevDay del 29/09/2026. C'è una **versione per app open-source e ospitate in locale**: OAuth 2.0 con
  PKCE su `auth.openai.com`, scope `chatgpt.tokens.use.direct`, callback loopback su `127.0.0.1`, **senza client
  secret né partner key**, con il client registrato in modo dinamico (`dynamic_agent_client`). Si chiama la
  Responses API (`store:false`, `stream:true`) **oppure si esegue `codex app-server`** passando il token
  ([docs SIWC](https://developers.openai.com/siwc) ·
  [open-source](https://developers.openai.com/siwc/token-sharing-open-source) ·
  [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) ·
  [codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)).
- **App a pagamento o ospitate in remoto:** bisogna compilare un **modulo di interesse**: è una versione commerciale
  in trial limitato, aperta a partner selezionati. Nelle app commerciali l'uso del piano vale solo per **Plus e Pro**.
- **Per l'utente:** imposta un **tetto settimanale per ogni app** (dal 10 al 100%). Plus ha un'unica finestra di 5 ore
  condivisa tra tutte le app. Quando il tetto è raggiunto il servizio si ferma, senza passare in automatico al
  pagamento a consumo ([eesel](https://www.eesel.ai/blog/sign-in-with-chatgpt) *(fonte secondaria)*,
  [help OpenAI](https://help.openai.com/en/articles/20001542)).
- **Limiti della preview:** non sono supportati messaggi con ruolo system, `temperature`, `max_output_tokens`, gli
  strumenti ospitati e la Files API.
- **Termini:** si applicano i [SIWC Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) (29/09/2026): niente
  impersonificazione di OpenAI o di altre app, si usa il nome della propria app, OpenAI può sospendere l'accesso.
- In alternativa resta valido eseguire la **CLI `codex` ufficiale** con il login dell'utente, come fa Conductor.
  OpenAI aveva già approvato pubblicamente l'uso di Codex negli harness di terze parti
  ([The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)).

### Cosa può fare Monsters

| Approccio | Claude | ChatGPT |
|---|---|---|
| Eseguire la CLI ufficiale non modificata (`claude` / `codex`) con il login già fatto dall'utente | ✅ Permesso. Servono i Commercial Terms; i consumi vanno sull'abbonamento o sull'extra usage | ✅ Permesso |
| Login OAuth gestito da Monsters, con i token salvati e usati da Monsters | ❌ **Vietato** | ✅ Con SIWC, versione open-source (core locale); per la versione a pagamento serve il modulo |
| API key dell'utente | ✅ (anche con i crediti mensili di Max e Team) | ✅ |
| Rivendere a consumo nei pacchetti della Fase 4 | Solo tramite API o un router (OpenRouter), **mai** tramite gli abbonamenti dell'utente | Lo stesso |

## 6. Licenza open-source per un modello open-core

| Licenza | È OSI? | Pro | Contro per Monsters |
|---|---|---|---|
| **MIT** | Sì | Massima adozione, è la licenza di Hermes, OpenClaw, LibreChat, AnythingLLM e OpenCode | Non concede brevetti e non protegge dai fork commerciali |
| **Apache-2.0** | Sì | Permissiva, con una **concessione esplicita dei brevetti** e l'obbligo di notice e modifiche. È la licenza di goose (Linux Foundation), Letta, Jan, Supabase e Cline, ed è gradita alle aziende | Chiunque può rivendere un fork. La difesa sta nel **marchio** e nel cloud chiuso |
| **AGPL-3.0** | Sì | Obbliga chi offre il software come servizio di rete a rilasciare il codice. Redis (2025) ed Elastic (2024) l'hanno adottata come "ritorno all'open source"; la usano Grafana e Khoj | Per un'**app locale** la clausola di rete protegge poco. Spaventa aziende e contributori e complica le integrazioni e la distribuzione negli store. Per poter vendere licenze commerciali richiede una CLA |
| **FSL** (Sentry) / **BUSL** (MariaDB, HashiCorp) | **No**: "source-available", diventano Apache o MIT dopo 2-4 anni | Bloccano i concorrenti diretti | **Contraddicono il brief** ("software open-source"). Il cambio di HashiCorp ha prodotto il fork OpenTofu. **Rischio di perdere l'idoneità alla versione "open-source" di SIWC**, che OpenAI non definisce ma riserva alle app open-source (è una mia deduzione) |
| **Elastic License 2.0** / licenze custom (n8n Sustainable Use, Dify, LobeHub, branding di Open WebUI) | No | Vietano il SaaS concorrente o la rimozione del logo | Non sono open source, creano attrito con la community, e i cambi di licenza a metà strada hanno generato critiche (Open WebUI) |

**Raccomandazione: Apache-2.0** per tutto il core locale (app, orchestratore, vault, interfaccia, adapter dei provider), con:
1. una **policy sul marchio "Monsters"** e sui **design ufficiali dei mostri**: il codice è libero, il brand no
   (fanno così Mozilla e Grafana). Chi fa un fork deve cambiare nome e mascotte;
2. il **backend cloud della Fase 4** (account, pacchetti, chiavi già configurate, system one model ospitato)
   **proprietario, in un repository separato**: il valore a pagamento è il servizio, non il codice;
3. **DCO** (Developer Certificate of Origin) per i contributi, oppure una CLA leggera se vogliamo tenerci aperta la
   possibilità di una doppia licenza in futuro;
4. la licenza **si sceglie una volta e non si cambia**: la lezione di Open WebUI e di HashiCorp.

Perché non AGPL: Monsters gira sul PC dell'utente, quindi il rischio "SaaS che prende il codice" riguarda solo il
backend cloud, che resta comunque chiuso. AGPL frenerebbe l'adozione, che per Monsters è l'obiettivo principale.
Perché non FSL/BUSL: non è open source, va contro il brief, e mette a rischio la versione open-source di SIWC.

Fonti: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) · [AGPL-3.0](https://opensource.org/licenses/AGPL-3.0) ·
[FSL](https://fsl.software/) · [Fair Source](https://fair.io/) · [BUSL 1.1](https://mariadb.com/bsl11/) ·
[Elastic License](https://www.elastic.co/licensing/elastic-license) ·
[Elastic torna open source (AGPL)](https://www.elastic.co/blog/elasticsearch-is-open-source-again) ·
[Redis AGPL](https://redis.io/blog/agplv3/) · [OpenTofu](https://opentofu.org/) ·
licenze verificate su GitHub: n8n (Sustainable Use + `.ee`), Dify (Apache modificata: niente multi-tenant, logo
obbligatorio), LobeHub (Community License).

---

## Implicazioni per Monsters

### Cosa copiare
- **Da Dots:** il primo agente a cui **l'utente dà il nome** (il nostro orchestratore), poi gli agenti specialisti.
  Le **regole personalizzate su quando agire da solo e quando chiedere**. Poter **guardare l'agente mentre lavora**
  (il nostro terminale dedicato). L'avatar giocoso e simpatico: conferma che l'idea dei mostri è quella giusta.
- **Da Grok Bot:** **approvazione solo per le azioni irreversibili verso l'esterno** (inviare, pubblicare, comprare,
  cancellare) con un **modello di revisione** prima delle chiamate agli strumenti, che è il nostro "system one model".
  Le **skill imparate da una dimostrazione** e le routine programmate, la chat di gruppo tra agenti con il passaggio
  dei compiti. Credenziali e 2FA inserite dall'utente e tenute fuori dai log.
- **Da Conductor:** **eseguire le CLI ufficiali** (`claude`, `codex`) includendole o usando quelle di sistema, con
  il login dell'utente. Un **git worktree per ogni compito** di codice, con diff e revisione. Il pulsante
  **"Continue with ChatGPT"** (SIWC). Un prompt iniettato che spiega all'agente dove si trova. L'avviso esplicito su
  `ANTHROPIC_API_KEY` quando sostituisce l'abbonamento.
- **Da OpenClaw e Hermes:** un **gateway unico** per i canali, il **pairing obbligatorio** per chi scrive su Telegram
  senza essere in whitelist, la ricerca FTS5 nelle sessioni, le skill nel formato standard agentskills.io, cron in
  linguaggio naturale.

### Cosa evitare
- **Riusare i token OAuth di Claude**, mostrare un "login con Claude" dentro Monsters, usare "Claude" nel nome o nel
  logo: è il rischio di ban più concreto. Per Claude solo il binario ufficiale o l'API key.
- **Gli errori di sicurezza di OpenClaw:** un WebSocket o un'interfaccia locale senza token e senza controllo
  dell'Origin (CVE-2026-25253 colpiva anche istanze in localhost), il gateway esposto su `0.0.0.0` per default, un
  marketplace di skill senza scansione. **"Nessun blocco" per gli agenti non deve voler dire nessuna autenticazione
  sul piano di controllo.**
- **L'"unico computer condiviso" di Grok Bot:** se tutti gli agenti condividono login e file, una prompt injection
  in un agente compromette tutti. Servono almeno identità e cartelle separate per agente, log di ogni azione e il
  kill switch.
- **Le dimensioni di Hermes e OpenClaw** (installazione via `curl | bash`, Node e Python insieme, decine di
  dipendenze). E ignorare le segnalazioni di vulnerabilità: servono un `SECURITY.md` e risposte rapide fin dal
  primo giorno.
- **Cambiare licenza a metà strada.**

### Come differenziarsi
1. **Locale, agnostico e gratis per partire** (router free di OpenRouter), mentre Dots costa da 100 $ al mese e
   **non è disponibile per i Pro in UE**, e Grok Bot vive nel cloud xAI/Cursor. Per un utente italiano o europeo
   questo è un argomento forte, anche per il GDPR.
2. **Un second brain che appartiene all'utente:** un vault Obsidian in Markdown con wikilink e versioning git. Nessun
   concorrente offre un vault che l'utente apre in Obsidian (OpenClaw ha solo `MEMORY.md`, Dots e Grok Bot hanno
   una memoria opaca).
3. **UX per l'utente medio:** i mostri che camminano e le bubble in stile chat tra amici, mentre goose, Hermes e
   Conductor parlano agli sviluppatori. È lo spazio che Dots occupa nel cloud; noi lo portiamo in locale.
4. **Un onboarding che costruisce il team** (N agenti su misura): Dots per ora dà un solo agente per piano.
5. **Tutti gli abbonamenti dell'utente nello stesso posto, nel modo consentito:** SIWC per ChatGPT, la CLI ufficiale
   o i crediti API di Max per Claude, OpenRouter per il resto.

### Rischi aperti
- **Politica Anthropic instabile:** il centro assistenza dice che le app di terze parti consumano i limiti
  dell'abbonamento, l'annuncio di aprile dice che pagano con l'extra usage. Prima della Fase 2 va ricontrollata e,
  se serve, chiarita con il commerciale di Anthropic. Eseguire `claude` dentro Monsters richiede i Commercial Terms.
- **SIWC è in preview:** API ridotta (niente messaggi system, niente `temperature`), e per un'app *a pagamento*
  serve l'approvazione di OpenAI. Teniamolo nel core gratuito e compiliamo il modulo di interesse prima della Fase 4.
- **"Nessun blocco" contro sicurezza:** i concorrenti con più autonomia sono anche quelli con più CVE e più
  incidenti. È il rischio reputazionale più grande per un progetto open-source agli inizi.
