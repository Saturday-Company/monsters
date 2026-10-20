# 06 · Abbonamenti consumer: verifica di apertura della Fase 2

> Ricerca del 14/10/2026, fatta per riverificare D-005 prima della Fase 2 (punto 2C). Le pagine sono state lette
> oggi. Legenda: **[V]** verificato su una fonte primaria letta oggi · **[T]** fonte di terzi · **[I]** nostra
> interpretazione. Nessuna pagina conteneva istruzioni rivolte agli agenti: c'erano solo i rimandi a `llms.txt` e
> alle versioni `.md` delle documentazioni di Anthropic e OpenAI, che sono indicazioni di navigazione.

## In sintesi

- **D-005 regge nella sostanza**, ma va precisata in sei punti (§5). Nessun cambio di politica rispetto a quanto
  sapevamo stamattina, tranne la **nuova Usage Policy di Anthropic** (pubblicata intorno all'8-9/10, **in vigore dal
  12/11/2026**), che vieta in modo esplicito i servizi che "route requests through consumer subscriptions".
- **Claude:** resta permesso che l'utente faccia il login nel **binario ufficiale non modificato** e che un'app lo
  esegua. Restano vietati il login Claude nella nostra app e la gestione dei token, compreso `setup-token`. L'Agent SDK
  ha una **licenza proprietaria** e va trattato come dipendenza opzionale.
- **ChatGPT:** la ChatGPT plan usage tramite Sign in with ChatGPT è **self-serve per le app open source e locali**
  (registrazione dinamica, nessuna approvazione). Funziona solo con **Plus e Pro**. Per un'app a pagamento o in
  hosting (Fase 4) serve la **waitlist** di OpenAI. Il **DevKit ufficiale ha una licenza non commerciale** e non va
  usato: l'implementazione la scriviamo noi a partire dai documenti.
- **Codex:** l'app-server accetta direttamente il token SIWC, quindi un solo login serve sia al provider "model" sia
  all'harness Codex. Il login proprio di Codex non è mai stato permesso per i servizi commerciali o in hosting.
- **Altri provider:** solo GitHub Copilot ha un accesso ufficiale per terzi (OpenCode, tramite partnership). Google
  lo vieta, Mistral non dice nulla.

---

## 1. Anthropic

### 1.1 Cosa dicono oggi le fonti ufficiali

| Fonte (data) | Cosa dice |
|---|---|
| Claude Code, *Legal and compliance* (senza data) [V] | Vieta: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." Permette: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Applicazione "without prior notice". |
| Stessa pagina, *Can customers offer Claude Code in their products?* [V] | Chi preinstalla o esegue Claude Code nei suoi prodotti deve accettare i **Commercial Terms**. Il binario non va modificato, nessun metodo di login va rimosso o disabilitato e l'uso non va pagato, rivenduto o intermediato: "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential". |
| Stessa pagina, uso del nome [V] | "You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product." |
| Agent SDK, *Overview* e *Quickstart* (senza data) [V] | "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods…". Branding consentito: "Claude Agent" (preferito nei menu a tendina), "Claude" dentro un menu già intitolato "Agents", "{YourAgentName} Powered by Claude". Vietati "Claude Code", "Claude Code Agent" e la grafica che imita Claude Code. L'SDK è regolato dai **Commercial Terms**. |
| Help Center, *Use the Claude Agent SDK with your Claude plan* (agg. **07/10/2026**) [V] | 07/10: "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits." 15/06: "We've paused the previously-announced changes… Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits." |
| *API credits for Max and Team plans* (platform docs) [V] | Max 5x 100 $, Max 20x 200 $, Team 20/100 $ a posto con un tetto di 500 $ al mese. Non sono idonei **Free, Pro ed Enterprise**. I crediti coprono API, Managed Agents e **Agent SDK**; **non coprono Claude Code**. Si ottengono collegando un'organizzazione Console e creando una chiave API. Scadono a fine ciclo. Finiti i crediti, le richieste si fermano. |
| Claude Code, *Authentication* (senza data) [V] | Ordine di priorità delle credenziali: cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → profili → login `/login`. In modalità `-p` la chiave API, se presente, **viene sempre usata**. `claude setup-token` emette un token OAuth che dura un anno, "for CI pipelines, scripts". Il **bare mode** non legge né l'OAuth né `CLAUDE_CODE_OAUTH_TOKEN`. Su Linux le credenziali sono in `~/.claude/.credentials.json`. |
| **Usage Policy, in vigore dal 12/11/2026** (la versione precedente è del 15/09/2025) [V] | Nuovo divieto: "Resell, proxy, or otherwise provide access to Claude through unauthorized means, **including services that route requests through consumer subscriptions or misrepresent the product or client being used**". Nella versione del 15/09/2025 non c'era. Il tracker di terzi ConductAtlas ha rilevato la modifica il 09/10/2026 [T]. |
| Consumer Terms (in vigore dall'08/10/2025) [V] | È vietato accedere ai servizi "through automated or non-human means… except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it". L'uso commerciale è vietato. Non si parla di OAuth né di Claude Code. |
| Trademark Guidelines (senza data) [V] | I marchi si usano solo "as specifically permitted by us and only in materials we approve beforehand". Non vanno usati in modo che suggerisca affiliazione o endorsement. |

### 1.2 Cronologia 2026 aggiornata
| Data | Evento | Fonte |
|---|---|---|
| 09/01 | Blocco lato server dei client che si spacciano per Claude Code: OpenCode, Cline, RooCode e OpenClaw perdono l'OAuth | [T] falcao.org |
| feb | I termini vietano i token OAuth dell'abbonamento nei tool di terzi | [T] alternativeto.net |
| 19/03 | OpenCode toglie l'OAuth di Anthropic (PR #18186) dopo le richieste legali | [T] falcao.org |
| 04/04 | Gli harness di terzi (OpenClaw per primo) non consumano più i limiti dell'abbonamento ma *extra usage* | [T] VentureBeat, TNW, Gigazine |
| 13/05 | Annunciato un credito mensile "Agent SDK" (Pro 20 $, Max 100/200 $) da attivare il 15/06 | [T] VentureBeat |
| 15/06 | **Sospeso**: Agent SDK, `claude -p` e app di terzi tornano sui limiti dell'abbonamento | [V] Help Center |
| 07/10 | Max e Team ricevono crediti API mensili; SDK, `claude -p` e app di terzi restano sui limiti dell'abbonamento | [V] Help Center, platform docs |
| ~08/10 → **12/11** | Nuova Usage Policy con il divieto di instradare richieste tramite abbonamenti consumer | [V] AUP · [T] data di rilevazione |

Il cambio del 04/04 ("extra usage per gli harness di terzi") non compare più nelle pagine di aiuto attuali: l'articolo
sui crediti d'uso, aggiornato l'08/10, non nomina terzi né harness. La frase del 07/10 sulle "third-party apps" lo
supera almeno per le app costruite sull'SDK ufficiale [I].

### 1.3 Le tre domande

**(a) Un'app terza può avviare `claude` o l'Agent SDK con il login che l'utente ha fatto nel terminale?** Sì, con
alcune condizioni [V + I].
- [V] La pagina legale lo permette in modo esplicito per il binario non modificato con l'abbonamento dell'utente, e
  l'Help Center (07/10) conferma che SDK, `claude -p` e app di terzi consumano i limiti dell'abbonamento.
- [V] Restano due condizioni: il binario non va modificato e nessun metodo di login va tolto o disabilitato. Chi
  "esegue Claude Code nei suoi prodotti" deve accettare i Commercial Terms, che regolano comunque l'uso dell'Agent SDK.
- [I] Zona grigia: la nota dell'SDK vieta di "offer claude.ai login **or rate limits** for their products" senza
  approvazione. La leggiamo come un divieto di presentare l'abbonamento Claude come una funzione nostra (login,
  quote nostre). Avviare il binario con il login dell'utente non rientra nel divieto: Conductor lo fa apertamente
  (la sua documentazione elenca "a Claude Pro or Max subscription connected to Claude Code") e nessuna fonte riporta
  azioni contro Conductor. Il rischio però non è zero.
- [I] La Usage Policy del 12/11 colpisce i proxy e chi falsifica il client, cioè l'approccio di OpenClaw con il
  token. L'esecuzione locale del binario ufficiale non rientra in questi casi. Lo diventerebbe se un nostro server
  inoltrasse richieste fatte con l'abbonamento dell'utente.

**(b) `claude setup-token` o token OAuth?** **No** [V + I]. Il token di `setup-token` è pensato per la CI e gli
script dell'utente. Se Monsters lo chiedesse, lo salvasse o lo passasse, finirebbe in "collect, store, or intermediate
Claude.ai credentials or session tokens". Lo stesso vale per la lettura di `~/.claude/.credentials.json` o per l'uso
del token sulle Messages API. Se l'utente ha già `CLAUDE_CODE_OAUTH_TOKEN` nel suo ambiente, il binario lo usa da
solo: noi non lo leggiamo, non lo salviamo e non lo suggeriamo.

**(c) Un pulsante "Accedi con Claude"?** **No** [V]. Il login Claude passa solo dal flusso di Anthropic: `claude`,
poi `/login` nel terminale. Funziona anche via SSH, dove il codice si incolla nel terminale. Al massimo la UI può
dire "apri un terminale ed esegui `claude`" o aprire un terminale che esegue il binario ufficiale [I].

### 1.4 Nome e logo
- [V] Nel testo è consentito scrivere "Monsters esegue Claude Code installato sul tuo PC".
- [V] Come etichetta del provider sono consentiti "Claude Agent", oppure "Claude" dentro un menu intitolato "Agenti".
  Non sono consentiti "Claude Code" come nome di una nostra funzione, il logo di Claude o di Anthropic (servono
  permesso scritto e approvazione preventiva) e qualsiasi cosa suggerisca una partnership.

### 1.5 Le altre app
- **Conductor** [V]: preinstalla Claude Code e ammette abbonamento Pro/Max, Console/API o cloud provider. Avvisa
  che con `ANTHROPIC_API_KEY` impostata si paga a consumo.
- **OpenCode** [T]: ha tolto l'OAuth di Anthropic a marzo e oggi usa le chiavi API (e Copilot, §3).
- **Cline, RooCode** [T]: bloccati il 09/01, hanno rifatto l'autenticazione. Non ho verificato su fonti primarie
  come gestiscono Claude oggi.
- **OpenClaw** [T]: la sua documentazione propone ancora `setup-token` da incollare. È proprio il caso vietato.

---

## 2. OpenAI

### 2.1 Sign in with ChatGPT e la ChatGPT plan usage
| Voce | Stato al 14/10/2026 |
|---|---|
| Chi può usarla | "ChatGPT plan usage is available to all open-source partners and selected private clients"; "At launch, ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps." [V] Non c'è una definizione di "open source" né un elenco di licenze ammesse [V]. |
| Approvazione | Per l'open source nessuna: si registra in modo dinamico con `client_id=dynamic_agent_client`, senza client secret né chiave partner [V]. "Request a client ID" vale per il login sui siti web: "offered to a select group of commercial partners" tramite waitlist [V]. |
| App a pagamento o in hosting | "If you're building a paid or remotely hosted app, join the waitlist to request access **before offering it to users**." [V] |
| Piani | "Eligible ChatGPT Plus and Pro users" [V]. Free e Go no. Business ed Enterprise non sono citati: l'errore `subscription_sharing_user_not_eligible` copre utente, workspace o policy [V]. |
| Limiti | L'utente imposta per ogni app un **tetto settimanale dal 10 al 100%** e decide se l'app può usare i crediti oltre i limiti del piano [V]. Su Plus il **limite di 5 ore è condiviso tra tutte le app**; su Pro il limite di 5 ore non c'è [V]. ChatGPT Work e Codex hanno gli stessi limiti [V]. |
| Protocollo | Invariato rispetto alla nota 02: PKCE, loopback `127.0.0.1` (non `localhost`), `ext_agent_host_id` persistente e opaco, scope `offline_access resource.invoke chatgpt.tokens.use.direct`, `POST /v1/responses` con `store:false` e `stream:true`, tool in namespace o in `additional_tools`, refresh token di 30 giorni con rotazione [V]. |
| UI obbligatoria | Pulsante **"Continue with ChatGPT"** con il branding approvato da OpenAI, modale al primo uso ("You're using your ChatGPT plan"), indicatore "Using ChatGPT plan" vicino al composer, link "Manage usage" a `chatgpt.com/settings/usage`, gestione del limite d'uso con "Manage usage" come azione principale [V]. Per le app con piani propri: "Your app must clearly show which of its plans support ChatGPT plan usage" [V]. |
| Token | Vanno in un file locale `0600`, mai nei log o nei telemetry. In caso di compromissione l'utente scollega l'app nelle impostazioni di ChatGPT [V]. |
| Stato | "Preview": la pagina *Preview limitations* elenca i campi e i tool non supportati [V]. |
| **DevKit** | `openai/sign-in-with-chatgpt-devkit` (creato il 29/09/2026) è sotto la **"Sign-in with ChatGPT DevKit Noncommercial License v1.0"**, che esclude lo sviluppo e la distribuzione "by or for a business… whether or not a fee is currently charged" [V]. **Saturday non può usarlo né copiarlo** [I]. |

### 2.2 Codex come harness
- [V] La sezione *Auth endpoints* dell'app-server dice: "If you've built a local or open-source application using
  Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with
  ChatGPT… **App-server authentication has never been permitted for commercial or hosted services.**"
- [V] La pagina SIWC *Codex app-server* documenta come avviare `codex app-server --listen stdio://` con il provider
  `openai_chatgpt_plan` e `env_key="ACCESS_TOKEN"` (il token SIWC), senza un login Codex separato. `clientInfo.name`
  deve coincidere con `agent_name_hint`. Il refresh lo gestisce l'app, poi riavvia il processo e usa `thread/resume`.
- [V] Esiste anche la modalità sperimentale `chatgptAuthTokens`, per le app che gestiscono già il ciclo di vita dei
  token ChatGPT.
- [V] `@openai/codex` e `@openai/codex-sdk` 0.162.1 (09/10/2026) sono **Apache-2.0**: si possono includere.
- [V] Per l'automazione in CI la documentazione di Codex consiglia la chiave API: "Don't expose Codex execution in
  untrusted or public environments".

### 2.3 Termini generali
I Terms of Use vietano di "automatically or programmatically extract data or Output" e di aggirare i rate limit
[T: estratti da ricerca; le pagine `openai.com/policies` rispondono 403 al fetch]. La ChatGPT plan usage è
l'eccezione documentata e passa dall'API pubblica, non da `backend-api`. La documentazione SIWC lo dice chiaramente:
"do not point it at ChatGPT's `backend-api` endpoints" [V].

### 2.4 Cosa serve a Monsters
- **Oggi (core Apache-2.0, locale):** nessuna richiesta a OpenAI. Basta seguire il protocollo e le linee guida della
  UI [V+I].
- **Fase 4 (Plus/Pro a pagamento, backend cloud):** prima di offrire la ChatGPT plan usage agli utenti paganti serve
  la **waitlist o l'approvazione partner**. La pagina dei prezzi deve dire quali piani la supportano. Il backend cloud
  non deve mai fare inferenza con il token SIWC dell'utente [V+I]. È un'interpretazione, da confermare con OpenAI:
  se il core resta gratuito e il piano a pagamento vende servizi diversi dall'inferenza (backup, System 1, relay),
  l'app potrebbe essere considerata "paid" in ogni caso. Conviene compilare il modulo **subito**, perché le attese non
  sono note.

---

## 3. Altri provider (in breve)
- **Google:** la pagina dei termini di Gemini CLI (agg. 10/04/2026) dice che "using third-party software… (for example,
  using OpenClaw with Gemini CLI OAuth) is a violation… grounds for suspension or termination" [V]. Dal 18/06/2026
  Gemini CLI è stato sostituito da Antigravity CLI per i livelli gratuiti e Google One [V]; secondo fonti di terzi
  Antigravity CLI non è open source [T]. **Da escludere**; Gemini solo con la chiave API.
- **GitHub Copilot:** dal 15/01/2026 i piani Copilot a pagamento si autenticano in **OpenCode** "through a formal
  partnership" [V]. Non c'è un programma aperto a tutte le app terze. Per noi serve un accordo: **da escludere** in
  Fase 2.
- **Mistral:** Le Chat Pro e Team includono Mistral Vibe (CLI) [T]. Non ho trovato regole sull'uso da parte di app
  terze. In Fase 2 solo la chiave API La Plateforme.

---

## 4. Raccomandazione per 2C

**Da implementare**
1. **Provider `chatgpt` (model, SIWC)** scritto da noi a partire dai documenti, **senza codice del DevKit**. Il
   riferimento è pi-ai, che è MIT (va verificato al momento dell'uso). Comprende:
   - `ext_agent_host_id` generato una volta come `urn:uuid:` in `~/.monsters/`;
   - `agent_name_hint="Monsters"`, `client_id` `oaiapp_…` salvato per ogni account;
   - token in un file `0600`, poi nel portachiavi del sistema in Fase 3;
   - adattatore Responses (`store:false`, `stream:true`, niente parametri non supportati, tool in un namespace) e
     refresh serializzato;
   - tutti gli elementi di UI richiesti (§2.1) e la gestione degli errori `subscription_sharing_*` senza mai passare
     da soli a un'altra forma di pagamento.
   - **Core remoto via SSH**: il callback va su `127.0.0.1` della macchina con il browser. Si usa un tunnel
     `ssh -L 1455:127.0.0.1:1455` oppure la procedura documentata per le VM self-hosted (OAuth in locale, poi copia
     delle credenziali via SSH).
2. **Harness `codex`** con `@openai/codex` (incluso, Apache-2.0), avviato con il **token SIWC** (`env_key`) e non con
   `codex login`. Così c'è un solo login ChatGPT, Codex lo riconosce come "Monsters" e quando arriverà il commerciale
   non serve rifare nulla.
3. **Harness `claude-code`** con `@anthropic-ai/claude-agent-sdk`:
   - L'SDK va come **dipendenza opzionale installata su richiesta**, quando l'utente attiva Claude, perché ha una
     licenza proprietaria ("SEE LICENSE IN README.md", Commercial Terms). In alternativa `pathToClaudeCodeExecutable`
     punta al `claude` già installato dall'utente.
   - **Controllo del login** tramite il binario (`claude` e `/status`, o l'errore "Not logged in" dell'SDK), mai
     leggendo il file delle credenziali. Se l'utente non è autenticato, la UI dice "apri un terminale ed esegui
     `claude`", senza pulsanti di login.
   - **Pulizia dell'ambiente del processo figlio:** in modalità "abbonamento" si tolgono `ANTHROPIC_API_KEY`,
     `ANTHROPIC_AUTH_TOKEN` e `CLAUDE_CODE_OAUTH_TOKEN` messi da noi, perché in `-p` la chiave API vince sempre e farebbe
     pagare l'utente a consumo. In modalità "chiave API" si passa solo la chiave. Niente `--bare` con l'abbonamento.
   - Gli strumenti di Monsters si passano via MCP, come nella nota 02.
   - Nella UI l'etichetta è **"Claude Agent"**, con la riga di testo "usa Claude Code installato sul tuo PC e il tuo
     abbonamento". Nessun logo.
4. **Provider `anthropic` (model, chiave API)** sempre disponibile. Per chi ha Max o Team, una guida al collegamento
   dell'organizzazione Console ai crediti mensili. Questi crediti coprono anche l'Agent SDK, ma non Claude Code
   interattivo.

**Da evitare**
- Qualsiasi pulsante o login Claude nella nostra UI, `setup-token`, la lettura di `~/.claude/*`, l'uso dei token
  OAuth di Claude su API diverse dal binario, la modifica o il wrapping del binario che tolga metodi di login.
- L'uso del DevKit SIWC o di codice copiato dal DevKit.
- `codex login` come percorso consigliato: va bene solo come ripiego locale.
- Qualsiasi relay o backend nostro che faccia passare inferenza con abbonamenti consumer, sia Claude sia ChatGPT.
- OAuth di Gemini CLI o Antigravity, Copilot senza accordo, pulsanti o loghi "Claude".

**Criterio di 2C da aggiornare:** "un lavoro con l'abbonamento ChatGPT (SIWC, sia model sia Codex) e uno con Claude
Code (login fatto dall'utente nel terminale), con test automatici che verifichino l'ambiente del processo figlio
(nessuna chiave non voluta) e che nessun file in `~/.claude` venga letto".

---

## 5. Cosa cambia rispetto a D-005
D-005 **regge**: lo schema resta quello di Conductor, cioè ChatGPT via SIWC, Claude come harness con il login
dell'utente oppure via chiave API. Propongo di aggiornarla così:
1. **SIWC scritto da noi** a partire dai documenti: il DevKit ha una licenza non commerciale.
2. **Codex usa il token SIWC** (`env_key`), non `codex login`.
3. **L'Agent SDK è una dipendenza opzionale** (licenza proprietaria, Commercial Terms che Saturday deve accettare).
   Gli SDK di Codex sono Apache-2.0.
4. **Nessun `setup-token` né `CLAUDE_CODE_OAUTH_TOKEN`** gestito da noi; ambiente del processo figlio ripulito.
5. **Branding:** "Claude Agent" o "Claude" in un menu "Agenti", nessun logo; per ChatGPT il pulsante ufficiale
   "Continue with ChatGPT" e le schermate d'uso richieste.
6. **Fase 4:** iscrizione subito alla waitlist SIWC (decide il maintainer, perché è una comunicazione a terzi); nessuna
   inferenza con abbonamenti consumer dal cloud (Usage Policy di Anthropic dal 12/11/2026, regole SIWC per
   l'hosting). La dicitura "da riverificare" resta: va ricontrollata a ogni rilascio che tocca i provider.

## 6. Rischi aperti
| Rischio | Peso | Mitigazione |
|---|---|---|
| Anthropic interpreta "offer… rate limits" contro le app che avviano l'SDK con l'abbonamento (5 cambi di politica nel 2026) | medio | Percorso con chiave API sempre pronto; nessun token toccato; eventualmente una **richiesta di conferma scritta** ad Anthropic (decide il maintainer) |
| La Usage Policy del 12/11 è più ampia di quanto pensiamo | basso-medio | Rileggerla quando entra in vigore e prima del rilascio della Fase 2 |
| SIWC è in preview: parametri, piani e limiti possono cambiare | medio | Adattatore isolato, errori mostrati così come arrivano, versione dei documenti annotata |
| "Open source" per OpenAI non è definito; un core con piani a pagamento potrebbe valere come "paid app" | medio | Waitlist subito; ChatGPT plan usage spenta nelle build commerciali finché non c'è l'approvazione |
| Gli utenti Plus esauriscono il limite di 5 ore condiviso con ChatGPT e Codex | alto per l'esperienza d'uso | RateBudget che legge gli errori `subscription_sharing_usage_limit_exceeded`; catena di fallback (verso un altro provider solo con il consenso dell'utente, perché OpenAI non vuole cambi silenziosi di pagamento) |
| La licenza dell'Agent SDK cambia, oppure l'SDK smette di leggere il login dell'abbonamento | basso | Ripiego su `claude -p --output-format stream-json` con il binario dell'utente |

---

## Fonti
**Anthropic**
- Legal and compliance (Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview · quickstart: https://code.claude.com/docs/en/agent-sdk/quickstart
- Authentication (setup-token, priorità delle credenziali): https://code.claude.com/docs/en/authentication
- Help Center, SDK e abbonamento (agg. 07/10/2026): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Help Center, Claude Code con Pro/Max: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan · crediti d'uso (agg. 08/10/2026): https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans
- Crediti API Max/Team: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- Usage Policy (in vigore dal 12/11/2026): https://www.anthropic.com/legal/aup · versione precedente (15/09/2025): https://www.anthropic.com/legal/archive/22742366-2ef0-4c7a-a833-6523f10d3944 · rilevazione della modifica [T]: https://conductatlas.com/change/2026-10-09-anthropic-anthropic-api-usage-policy-5491/
- Consumer Terms (08/10/2025): https://www.anthropic.com/legal/consumer-terms · Trademark Guidelines: https://www.anthropic.com/legal/trademark-guidelines
- Cronologia [T]: https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch (13/05/2026) · https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/ (24/05/2026) · https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use · https://thenextweb.com/news/anthropic-openclaw-claude-subscription-ban-cost/ · https://gigazine.net/gsc_news/en/20260405-anthropic-claude-code-need-pay-extra-openclaw
- Conductor: https://www.conductor.build/docs/reference/harnesses/claude-code · OpenClaw (mirror della documentazione) [T]: https://docs.claw.so/engine/providers/anthropic/
- npm `@anthropic-ai/claude-agent-sdk` 0.3.299 e `@anthropic-ai/claude-code` 2.1.299: licenza "SEE LICENSE IN README.md" (registry consultato il 14/10/2026)

**OpenAI**
- SIWC: https://developers.openai.com/siwc · quickstart: https://developers.openai.com/siwc/quickstart · request client ID: https://developers.openai.com/siwc/request-client-id
- Open source: https://developers.openai.com/siwc/token-sharing-open-source · sign-in: https://developers.openai.com/siwc/token-sharing-open-source/sign-in · account e limiti: https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions · errori: https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery · preview: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations · VM: https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms · Codex app-server: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- UI/UX: https://developers.openai.com/siwc/ui-ux-guidelines · cookbook: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt · waitlist: https://openai.com/form/sign-in-with-chatgpt-interest/
- DevKit e licenza: https://github.com/openai/sign-in-with-chatgpt-devkit (LICENSE, letto via API GitHub)
- Codex auth: https://developers.openai.com/codex/auth · app-server: https://developers.openai.com/codex/app-server · SDK: https://developers.openai.com/codex/sdk · prezzi e limiti: https://developers.openai.com/codex/pricing
- Help Center "Using your ChatGPT plan in other apps and sites" (403 al fetch, riassunto da ricerca) [T]: https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- Terms of Use (403 al fetch, estratti da ricerca) [T]: https://openai.com/policies/terms-of-use/

**Altri**
- Gemini CLI, termini (agg. 10/04/2026): https://www.geminicli.com/docs/resources/tos-privacy · ban segnalati [T]: https://discuss.ai.google.dev/t/gemini-api-access-disabled-403-tos-after-using-openclaw-agent-appeal-pending/122810
- GitHub Copilot e OpenCode (15/01/2026): https://github.blog/changelog/2026-01-15-github-copilot-now-supports-opencode/
- Mistral Vibe 2.0 [T]: https://mistral.ai/fr/news/mistral-vibe-2-0 · https://mistral.ai/pricing
