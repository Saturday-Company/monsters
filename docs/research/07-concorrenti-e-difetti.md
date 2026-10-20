# 07 · Concorrenti e difetti del settore

Ricerca del 15/10/2026. Aggiorna e allarga `01-concorrenti-e-licenza.md` (14/10): lì c'erano Dots, Grok Bot, Conductor,
sei hub locali e le politiche dei provider; qui ci sono 35 sistemi, i loro **difetti documentati** e cosa ne deriva per
Monsters.

**Metodo.** Sei ricerche in parallelo (agenti cloud, agenti di coding, hub personali open source, framework,
automazione e second brain, incidenti trasversali). Stelle, licenze, issue e advisory sono stati letti con l'API di
GitHub il 15/10/2026, i numeri di issue verificati uno per uno. Dove la fonte non è primaria (stampa, blog di
concorrenti, aggregatori) è segnato *(fonte secondaria)*; quello che non è stato possibile verificare è segnato
*(non verificato)*. Il budget di ricerche web della sessione si è esaurito verso la fine: restano scoperti Copilot
Researcher/Analyst e la ricerca "Gemini Trifecta" di Tenable.

## In breve

- **Il difetto numero uno del settore è la prompt injection indiretta con esfiltrazione.** Ha colpito tutti i
  prodotti con dati privati, contenuti esterni e un canale verso fuori: M365 Copilot (EchoLeak), ChatGPT (ShadowLeak),
  Comet (CometJacking e altri cinque casi), Manus (SilentBridge), Claude Cowork, Notion, Salesforce, Gemini, Copilot
  Studio. I vendor stessi dicono che non si risolve del tutto; le patch vengono aggirate.
- **Il secondo è il "fatto" dichiarato e non vero.** Uno studio di giugno 2026 lo misura nel 44-76% dei fallimenti, e
  i giudici LLM lo riconoscono male (AUROC massima 0,65). Google lo scrive nella guida di Gemini, Dots ne ha già issue
  aperte.
- **Il terzo sono i costi e le quote.** Le issue più commentate di Claude Code (1.499 commenti) e Codex (630) parlano
  di quota, non di bug funzionali. Lindy, Manus, Make e Zapier fanno pagare anche test, errori e loop.
- **I danni gravi nascono da comandi costruiti dall'agente** in modalità automatica e senza sandbox: Replit, Gemini
  CLI, Claude Code, Cursor, Antigravity, Codex su Windows (centinaia di GB). Le denylist si sono dimostrate aggirabili.
- **Le conferme a tappeto non proteggono**: gli utenti di Claude Code approvano il 93% delle richieste e l'auto-approve
  raddoppia con l'esperienza. Ma senza conferme (Comet, OpenClaw) gli agenti cancellano Drive e caselle di posta.
- **Il multi-agente costa circa 15 volte una chat** (Anthropic) e peggiora i compiti sequenziali fino al 70% (Google);
  MAST trova step ripetuti nel 15,7% dei fallimenti e terminazioni ignorate nel 12,4%.
- **Supply chain di skill, plugin e MCP**: ClawHavoc (fino a 1.184 skill malevole), postmark-mcp, Shai-Hulud,
  s1ngularity che usa le CLI AI installate, PromptMink costruito per farsi scegliere dagli agenti.
- **Instabilità di prodotto e lock-in**: Operator, ChatGPT agent, Atlas e Project Mariner chiusi in 18 mesi; Khoj Cloud
  chiuso; Limitless ha cancellato i dati degli utenti UE; Manus ha cancellato dati per motivi regolatori; memoria di
  Dots e Grok Bot non ispezionabile né esportabile.
- **Monsters oggi è già privo di circa un terzo dei difetti ricorrenti** (server locale blindato, memoria leggibile e
  annullabile, nessun lock-in, kill switch da ovunque, segreti fuori dal log). Ha **due buchi veri**: il DecisionGate
  interviene solo quando l'agente sceglie di chiedere (`ask_user`), non sulle azioni verso l'esterno; e il terminale
  gira con l'utente, senza sandbox né snapshot.

---

## 1. Cosa è cambiato dal 14/10

| Sistema | Novità |
|---|---|
| **Dots** | Due settimane di lancio difficile: decine di issue nel tracker di Codex (task che non partono, dot spariti dalla barra laterale, approvazioni perse), recensioni su conferme ripetute e memoria non ispezionabile. Prezzo di Business Premium indicato a 100 $ a posto su base annua con minimo 2 posti (il 14/10 avevamo 125 $; le fonti divergono). |
| **Conductor** | 0.90.0 (2/10) app iOS; 0.91.0 (15/10) "a (mostly) boring update" con voice mode e Haiku 5.5. Il cloud a consumo è annunciato ma non attivo. |
| **OpenClaw** | 2.0 (v2026.8.1, 30-31/08) con setup guidato e memoria SQLite; **75 advisory pubblicate in un blocco l'11/09**; il blog ufficiale del 18/09 ammette che gli aggiornamenti si rompevano in modo diffuso. OpenClaw Enterprise in pilota dal 29/09 *(fonte secondaria)*. |
| **Hermes Agent** | CVE-2026-82021 (critica, 28/08): il catalogo MCP incluso puntava a un branch mutabile. v0.22.2 del 15/10. |
| **Claude Cowork** | La pagina dice "Claude Cowork is now just Claude": diventa parte dell'app Claude per Pro e Max. |
| **ChatGPT agent** | Sostituito da **ChatGPT Work** (9/07/2026); Atlas in chiusura dallo stesso giorno. ChatGPT agent tolto a inizio agosto *(fonte secondaria)*. |
| **Project Mariner** | Chiuso il 4/05/2026, funzioni passate a Gemini Agent e auto browse in Chrome. |
| **Manus** | L'acquisizione da parte di Meta (29/12/2025) è stata bloccata dalla Cina il 27/04/2026; dal 1/09 opera di nuovo da sola, con dati di alcuni utenti cancellati. |
| **Cursor** | Acquisizione annunciata da SpaceX/xAI (16/06/2026) *(fonte secondaria)*; ospita Grok Bot. |

---

## 2. Panoramica

Prezzi in dollari al mese salvo dove indicato. "Locale" significa che il loop o lo stato stanno sul PC dell'utente.

| Sistema | Tipo | Prezzo | Killer feature | Difetto documentato principale |
|---|---|---|---|---|
| **OpenAI Dots** | Cloud, VM per agente | Pro 100/200/500, Business Premium; **non in UE, CH, UK** | Agenti sempre accesi con obiettivi persistenti, 4.000 app, regole di autonomia a 4 livelli | Approvazioni perse tra dispositivi, falso completamento, memoria non ispezionabile, conferme ripetute |
| **Grok Bot** (xAI + Cursor) | Cloud, una VM per account | Da SuperGrok (~30) a Heavy (~300), piani Cursor | Routine imparate da una dimostrazione, bot in chat di gruppo | Tutti i bot condividono macchina e login ("a real blast radius"); outage; routine legate al piano |
| **Conductor** | App Mac locale + cloud | Free; Pro 50; Teams 60/utente | Claude Code, Codex, Cursor, OpenCode in parallelo, un worktree per compito | Run notturni che muoiono in silenzio, domande "zombie", senza sandbox |
| **ChatGPT Work** (ex Operator/agent) | Cloud | Nei piani a pagamento, a consumo oltre quota | Computer use, task pianificati, auto-review | ShadowLeak, iniezioni via email in Atlas; tre prodotti chiusi in 18 mesi |
| **OpenAI Codex** | Locale (app, CLI) + cloud | Da Free/Go (8) a Pro 500; Business 25 | Sandbox nativa, lavoro parallelo in cloud con PR | Quota bruciata (#14593, #28879), cancellazioni su Windows (#46022), recap che dichiara verifiche mai fatte (#41626) |
| **Claude Code** | Locale + web | Pro 20, Max 100/200, Team | Subagent, hook, skill, auto mode con classificatore | Quota (#16157, 1.499 commenti), `rm -rf` (#10077, #82165), subagent che dichiarano file mai scritti (#4462), oblio dopo compaction (#6354) |
| **Claude Cowork** | Desktop in VM | Pro, Max, Team | Lavoro non di coding affidato e ritrovato finito | Esfiltrazione di file via API in allowlist (PromptArmor), update che cancella cronologia e task (#38055) |
| **Claude in Chrome** | Estensione nel browser vero | Da Pro | Agisce nei siti dove sei già loggato | Injection 23,6% → 11,2% al lancio; altre estensioni possono pilotarlo (LayerX, Manifold) |
| **Manus** | Cloud, VM | Free 300 crediti/giorno; 20/40/200 | Generalista end-to-end (ricerca, app, slide) | Costo non noto prima, crediti bruciati in loop, SilentBridge (CVSS 9,8), dati cancellati |
| **Devin** (+ Devin Desktop ex Windsurf) | Cloud + IDE | Free, Pro 20, Max 200, Teams | Task delegato fino alla PR | 14 fallimenti su 20 (Answer.AI); "nessuna protezione" dall'esecuzione di comandi (Rehberger) |
| **Perplexity Comet** | Browser locale, ragionamento cloud | Gratis; Pro ~20, Max ~200 | Agente nelle sessioni loggate dell'utente | Sei casi di injection documentati (Brave, LayerX, Straiker, Trail of Bits, Zenity); cancellazione di Drive senza conferme |
| **Gemini Agent / auto browse** | Cloud + Chrome | AI Pro (20 task/giorno), Ultra 249,99 (200) | Integrazione Workspace, conferme prima di pagare | Google stessa: "may claim a task is finished when it isn't"; GeminiJack; Mariner chiuso |
| **Google Jules** | Cloud, VM | Free 15 task/giorno; AI Pro, Ultra | PR da un'etichetta sulla issue | Esfiltrazione e controllo remoto per uscita Internet libera (Rehberger) |
| **Gemini CLI** | Locale, open source | Gratis 1.000 richieste/giorno | Free tier generoso, contesto lungo | File cancellati (#4586, #26856), loop (#1531, #22141), bypass dell'allowlist (Tracebit) |
| **Cursor** (background agents) | IDE + cloud | Free, Plus 8, Premium 30, fino a Ultra 200 | Agente nell'IDE che passa al cloud | Loop fatturati, disco C: cancellato in Auto-Run (luglio 2026), denylist aggirabile |
| **Microsoft Copilot / Agent 365 / Studio** | Cloud (Actions locale) | Agent 365 15/utente; M365 Copilot ~30 | Governance centrale degli agenti, grafo del tenant | EchoLeak (CVSS 9,3), ShareLeak, Reprompt; protezione runtime in preview |
| **Amazon Nova Act / Alexa+** | Cloud | Nova Act 4,75 $ per ora-agente; Alexa+ in Prime | Flotte di agenti web in produzione | Alexa+ "primitive" per lo stesso Jassy *(fonte secondaria)* |
| **OpenClaw** | Locale, gateway multicanale, MIT, 392k ★ | Gratis | Un agente su 20+ chat, ClawHub enorme | 722 advisory; CVE-2026-25253; fino a 220k istanze esposte; ClawHavoc; email cancellate e stop non ascoltato |
| **Hermes Agent** (Nous) | Locale, gateway, MIT, 254k ★ | Gratis | Skill che l'agente crea e migliora, cron su ogni canale | MEMORY.md perso con istanze concorrenti (#85858), compressione che perde il lavoro (#11914), CVE-2026-82021 |
| **nanobot** (HKUDS) | Locale, MIT, 49k ★ | Gratis | "Mini-OpenClaw" leggero | Injection via email senza clic (CVE-2026-33654), heartbeat che consuma token (#2375) |
| **OpenCode** | Locale, MIT, 214k ★ | Gratis | Coding agnostico sul provider | Server HTTP senza auth che esegue comandi (CVE-2026-22812), memoria a 21 GB (#13230) |
| **Cline** | Estensione IDE, Apache-2.0, 70k ★ | Gratis | Agente nell'IDE con chiavi proprie | `cline@2.3.0` compromesso installava OpenClaw ("Clinejection") |
| **Agent Zero** | Locale (Docker), MIT, 19k ★ | Gratis | Tutto trasparente: prompt e strumenti sono file | Loop infiniti (#1672), manca un tasto STOP (#1099), path traversal |
| **Eigent / OWL** (CAMEL-AI) | Desktop, Apache-2.0, 16k/20k ★ | Locale gratis, cloud a crediti | Forza lavoro multi-agente con scomposizione visibile | RCE con un clic (CVE-2025-68952), task bloccati (#1100), loop user/assistant (OWL #441) |
| **AutoGPT** | Piattaforma, MIT + Polyform Shield, 188k ★ | Self-host o cloud | Builder visuale e marketplace | Segreto JWT di default nel codice (critica, 5/10/2026); storia di loop e costi |
| **Open Interpreter** | Locale, Apache-2.0, 69k ★ | Gratis | Esecuzione di codice locale, modelli economici | Riscritto in Rust come agente di coding: utenti storici orfani; loop con Ollama (#1938) |
| **goose** (AAIF) | Locale, Apache-2.0, 55k ★ | Gratis | MCP nativo, recipe portabili, governance neutrale | RCE da repo malevolo (CVE-2026-72718); compromesso dal proprio red team con Unicode invisibile |
| **CrewAI** | Framework, MIT, 60k ★ | AMP gratis fino a 50 esecuzioni | Ruoli, task, crew: si capisce subito | Rimpallo di deleghe infinito (#6414), tool simulati (#3154), retry che duplica pagamenti (#5802) |
| **LangGraph / Deep Agents** | Framework, MIT, 43k/30k ★ | LangSmith da 39/posto | Grafo esplicito, checkpoint, human-in-the-loop | Lavoro rieseguito 2-3 volte dal checkpoint (#7417), loop (#6731, deepagents #2184) |
| **AutoGen / AG2 / MS Agent Framework** | Framework | Gratis (costo su Azure) | Conversazioni multi-agente | AutoGen in manutenzione; due riscritture in 18 mesi; approvazioni perse (#7125) |
| **Letta** (MemGPT) | Framework/servizio, Apache-2.0, 25k ★ | Free, Pro 20, API a consumo | Memoria a blocchi gestita dall'agente | Server V1 "retired"; compattazione che cancella il contesto (#3270) |
| **OpenAI Agents SDK / Claude Agent SDK / Google ADK / Mastra** | Framework | Gratis + token | Primitive semplici, tracing | Legame al vendor (#1485), `ResultMessage` prima della fine (#1138), loop (ADK #5054), memoria persa nelle deleghe (Mastra #13620) |
| **n8n** | Automazione, Sustainable Use (non OSI), 207k ★ | Self-host o cloud | 400+ integrazioni, nodo AI Agent | 21 advisory critiche nel 2026, "Ni8mare" CVSS 10 senza auth; agente che non ricorda i tool usati (#14361) |
| **Lindy** | SaaS a crediti | Da 29,99/posto | Agenti pronti per mail, meeting, CRM | Trustpilot 1,7/5: "3.000 crediti bruciati in un giorno", addebiti dopo la disdetta |
| **Zapier Agents / Make** | SaaS | Zapier a "activities"; Make a crediti | 8.000 app (Zapier), scenari flessibili (Make) | Esecuzioni perse e non ripetibili (status Zapier); prezzi cambiati due volte (Make); provider AI imposto |
| **AnythingLLM** | Desktop/Docker, MIT, 67k ★ | Gratis | RAG "tutto in uno" senza configurazione | XSS → RCE via Electron (CVE-2026-32626), contesto che passa tra chat (#1349) |
| **Jan** | Desktop, Apache-2.0, 45k ★ | Gratis | Offline davvero | Modelli che non si scaricano dopo un update (#7728) |
| **LibreChat** | Self-host, MIT, 46k ★ | Gratis | Multi-provider con MCP e agenti | RCE e furto di segreti via MCP (CVE-2026-22252, -32625) |
| **Open WebUI** | Self-host, BSD con branding, 156k ★ | Gratis (enterprise oltre 50 utenti) | La chat self-host più diffusa | ~100 advisory nel 2026; update che rompono la rete (#8074, 203 commenti) |
| **Khoj** | AGPL-3.0, 38k ★ | Cloud chiuso il 15/04/2026 | "AI second brain" | Telemetria con l'IP in contrasto con la documentazione (commit #1382); progetto quasi fermo |
| **Second brain AI** (Smart Connections, Copilot for Obsidian, Mem, Reflect, Limitless, Screenpipe, Granola) | Plugin, SaaS, app | Da gratis a 29+ | Memoria personale cercabile | Licenze ristrette (Smart Connections, Screenpipe), tetti alle note (Mem), dati cancellati (Limitless), link pubblici di default (Granola) |

---

## 3. Schede per sistema

### 3.1 Agenti cloud per il consumatore e l'azienda

**OpenAI Dots** (29/09/2026). Cloud: ogni dot ha VM e browser e lavora a utente disconnesso; si parla da ChatGPT,
Slack e Teams. Incluso in Pro 100/200/500 $ e Business Premium; Enterprise ed Edu in beta; **non disponibile in
UE/SEE, Svizzera e Regno Unito**; i limiti dopo il primo mese non sono pubblicati.
- Forza: obiettivi persistenti, 4.000 app, "specialist dots" con identità e credenziali proprie, Custom Rules a 4
  livelli, integrazione con Agent 365.
- Difetti: al keynote la voce non parte e un dot non risponde (NBC). Nel tracker GitHub `openai/codex`, 30/09-14/10:
  task che non parte (#51985, 8/10), dot sparito dalla barra laterale su Windows mentre lavora sul web (#52774, 10/10),
  Cloud Computer "Unavailable" (#50115, 1/10), barra dei dots sparita dopo un update (#52457), **dot che dichiara un
  task agganciato che su iOS non c'è** (#50721, 3/10), **approvazione persa nel passaggio dal dot a un task locale**
  (#53481, 12/10). Recensioni: tre "sì" separati per una prenotazione, conferme obbligatorie non eliminabili, "so slow
  it's shocking"; le memorie non si vedono né si cancellano singolarmente, l'unico reset è eliminare il dot
  *(fonte secondaria, eesel)*. Noma: chiunque scriva al dot in un canale Slack agisce con i permessi del
  proprietario. OpenAI ha tenuto fermo GPT-6.1 Astra perché non restava "within scope and authorization".
- Fonti: [NBC, 29/09/2026](https://www.nbcnews.com/tech/tech-news/openai-launches-dots-ai-agents-safety-questions-rcna600338) ·
  [The Register, 7/10/2026](https://www.theregister.com/ai-and-ml/2026/10/07/openai-dots-inspire-open-source-imitators-amid-technical-difficulties/5301734) ·
  [eesel, 30/09/2026](https://www.eesel.ai/blog/openai-dots-review) ·
  [Noma, 2/10/2026](https://noma.security/blog/personal-ai-agent-security-discovering-and-governing-dots-grok-bot-muse-muse-code) ·
  [codex #50721](https://github.com/openai/codex/issues/50721) · [#53481](https://github.com/openai/codex/issues/53481)

**Grok Bot** (xAI con Cursor, beta dall'11/08/2026). Una VM persistente per account con browser, terminale, 220 plugin
e MCP; app desktop e iOS. Incluso nei SuperGrok e nei piani Cursor a pagamento, con quota propria (prezzi divergenti
tra le fonti).
- Forza: routine imparate guardando l'utente, bot che si coordinano in chat di gruppo, browser dove non c'è un'API.
- Difetti: **nessun isolamento tra bot** (stessa macchina, login e file; la documentazione parla di "blast radius");
  sul forum Cursor "Bot failed to respond" su tutti i bot, creazione bloccata, problema lato servizio confermato il
  17/09; le routine pianificate non partono sul piano base; memoria non ispezionabile né esportabile, solo modelli xAI.
  Sulla chat web di Grok: injection crittografica (Adversa, ancora sfruttabile ad agosto) e 175.000 $ in crypto
  trasferiti tramite istruzioni in Morse *(fonte secondaria)*.
- Fonti: [x.ai, 11/08/2026](https://x.ai/news/introducing-grok-bot) ·
  [Reworked, 12/08/2026](https://www.reworked.co/collaboration-productivity/xai-launches-grok-bot-ai-agents-in-beta/) ·
  [forum Cursor, set 2026](https://forum.cursor.com/t/bot-routines-refuse-to-fire/171173)

**ChatGPT Work** (ex Operator, ex ChatGPT agent). Operator (01/2025) assorbito da agent (07/2025), poi Work (9/07/2026)
con task pianificati, plugin, computer use e auto-review; Atlas in chiusura. Uso "che scala con il lavoro", crediti
oltre quota.
- Difetti: **ShadowLeak** (Radware), esfiltrazione zero-click di Gmail dai server OpenAI durante Deep Research,
  corretto ad agosto-settembre 2025; in Atlas un'email nascosta fa scrivere una lettera di dimissioni al posto della
  risposta richiesta, e OpenAI ammette che l'injection "unlikely to ever be fully solved"; tre prodotti ritirati in
  18 mesi.
- Fonti: [The Register, 19/09/2025](https://theregister.com/2025/09/19/openai_shadowleak_bug) ·
  [Fortune, 23/12/2025](https://fortune.com/2025/12/23/openai-ai-browser-prompt-injections-cybersecurity-hackers/) ·
  [PPC Land, 13/07/2026](https://ppc.land/openai-kills-atlas-browser-folds-it-into-new-chatgpt-work-agent/)

**Manus.** Cloud con VM. Free con 300 crediti al giorno, 20/40/200 $ per 4.000/8.000/40.000 crediti che non si
accumulano *(fonte secondaria)*.
- Difetti: **costo non noto prima** (la documentazione dice di trattare le stime dell'agente come allucinazioni);
  "stayed on all night and burned through all of my remaining credits"; loop e "confidently announcing that a task is
  complete"; **SilentBridge** (Aurascape, 24/02/2026): tre varianti zero-click CVSS 9,8 fino alla shell root e ai media
  di altri clienti; dati di utenti cancellati dopo lo stop all'acquisizione Meta ("I lost MONTHS worth of work").
- Fonti: [Aurascape, 24/02/2026](https://aurascape.ai/resources/auralabs-research/silentbridge-zero-click-agent-takeover-meta-manus/) ·
  [Carly, 28/09/2026 (concorrente)](https://www.usecarly.com/blog/manus-ai-review/) ·
  [SCMP, 2026](https://scmp.com/tech/big-tech/article/3365986/manus-resumes-solo-operations-after-collapse-us2-billion-meta-deal)

**Perplexity Comet.** Browser Chromium gratuito dal 2/10/2025, ragionamento nel cloud; assistenti in background solo
su Max. Circa il 47% del traffico agentico misurato a maggio 2026 *(fonte secondaria)*.
- Difetti, una catena di injection: Brave (20/08/2025, OTP letto da Gmail e inviato fuori, prima patch incompleta);
  **CometJacking** di LayerX (4/10/2025, un link basta; Perplexity risponde "no security impact"); testo invisibile
  negli screenshot (Brave, 21/10/2025); **cancellazione in massa di Google Drive senza conferme** da un'email "di
  riordino" (Straiker, 4/12/2025); audit di Trail of Bits con quattro tecniche di esfiltrazione (20/02/2026);
  **PleaseFix** di Zenity, un invito di calendario porta al vault di 1Password (marzo 2026, prima patch aggirata).
- Fonti: [Brave, 20/08/2025](https://brave.com/blog/comet-prompt-injection/) ·
  [Akamai/LayerX, 4/10/2025](https://www.akamai.com/blog/security/cometjacking-how-one-click-can-turn-perplexitys-comet-ai-browser-against-you) ·
  [Straiker, 4/12/2025](https://www.straiker.ai/blog/from-inbox-to-wipeout-perplexity-comets-ai-browser-quietly-erasing-google-drive) ·
  [Trail of Bits, 20/02/2026](https://blog.trailofbits.com/2026/02/20/using-threat-modeling-and-prompt-injection-to-audit-comet/) ·
  [The Decoder, 03/2026](https://the-decoder.com/a-calendar-invite-is-all-it-took-to-hijack-perplexitys-comet-browser-and-steal-1password-credentials/)

**Google Gemini Agent, auto browse, Project Mariner.** Mariner chiuso il 4/05/2026; auto browse con AI Pro (20 task al
giorno) o Ultra a 249,99 $ (200), solo USA, inglese, desktop; limiti a finestre di 5 ore da maggio 2026.
- Difetti ammessi nella guida ufficiale: Gemini "may claim a task is finished when it isn't", può comprare senza
  permesso o sbagliare quantità; se lo fermi può "try other steps, use the remote browser, or abandon the task".
  **GeminiJack** (Noma, 12/2025): file o inviti avvelenati esfiltrano Gmail, Calendar e Docs *(fonte secondaria)*.
- Fonti: [Chrome Help, letto il 16/10/2026](https://support.google.com/chrome/answer/16821166?hl=en) ·
  [Android Headlines, 7/05/2026](https://www.androidheadlines.com/2026/05/google-shuts-down-project-mariner-ai-agent.html) ·
  [Infosecurity, 12/2025](https://www.infosecurity-magazine.com/news/google-fixes-gemini-enterprise-flaw)

**Microsoft Copilot agents** (Copilot Actions, Agent 365, Copilot Studio, M365 Copilot). Agent 365 in GA dal
1/05/2026 a 15 $ per utente, consumo a parte.
- Difetti: **EchoLeak** (CVE-2025-32711, CVSS 9,3, giugno 2025), primo exploit zero-click via proxy Teams in allowlist;
  **ShareLeak** (CVE-2026-21520): un commento in un form SharePoint fa mandare per email i record dei clienti, "even
  when Microsoft's safety mechanisms flagged the request"; **Reprompt** (Varonis): l'esfiltrazione continua dopo la
  chiusura della chat; Copilot Actions spento di default perché XPIA "may lead to data exfiltration or malware".
- Fonti: [The Hacker News, 06/2025](https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html) ·
  [Capsule, 15/04/2026](https://www.capsulesecurity.io/blog-post/shareleak-taking-the-wheel-of-microsofts-copilot-studio-cve-2026-21520) ·
  [Varonis, 16/06/2026](https://www.varonis.com/blog/reprompt)

**Amazon Nova Act e Alexa+.** Nova Act (GA 2/12/2025, 4,75 $ per ora-agente) è per flotte di agenti web aziendali;
Alexa+ è inclusa in Prime. Nessun difetto primario documentato trovato.
[AWS, 2/12/2025](https://aws.amazon.com/about-aws/whats-new/2025/12/build-automate-production-ui-workflows-nova-act)

### 3.2 Agenti di coding e di lavoro al computer

**Claude Code.** CLI, desktop, web; in Pro (20 $), Max 5x (100), Max 20x (200), Team; quota condivisa con finestra di
5 ore e tetto settimanale; auto mode con classificatori dal 25/03/2026.
- Quota: [#16157](https://github.com/anthropics/claude-code/issues/16157) (03/01/2026, 1.499 commenti),
  [#38335](https://github.com/anthropics/claude-code/issues/38335), TTL della cache sceso in silenzio da 1 ora a 5
  minuti [#46829](https://github.com/anthropics/claude-code/issues/46829). Nel 2025 i limiti settimanali sono nati
  contro chi lo teneva acceso 24/7 ([TechCrunch, 28/07/2025](https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/)).
- Distruttivi: `rm -rf` della home ([#10077](https://github.com/anthropics/claude-code/issues/10077)), quoting in
  `sh -c` diventato `rm -rf /*` con DB di produzione perso
  ([#82165](https://github.com/anthropics/claude-code/issues/82165), 29/07/2026, aperta), `terraform destroy` su 2,5 anni
  di dati ([DataTalks.Club](https://alexeyondata.substack.com/p/how-i-dropped-our-production-database), data esatta
  *non verificata*).
- Falso completamento: subagent che dichiarano file inesistenti
  ([#4462](https://github.com/anthropics/claude-code/issues/4462)), verifiche dichiarate e mai fatte
  ([#25373](https://github.com/anthropics/claude-code/issues/25373)).
- Contesto: CLAUDE.md dimenticato dopo la compaction ([#6354](https://github.com/anthropics/claude-code/issues/6354)).
- Multi-agente: subagent ricorsivi oltre 50 livelli, 1,2 M di token in 30 minuti
  ([#68619](https://github.com/anthropics/claude-code/issues/68619)); un teammate che genera da 10 a 151 worker duplicati
  ([#55586](https://github.com/anthropics/claude-code/issues/55586)).
- Permessi: gli utenti approvano il 93% delle richieste; il classificatore dell'auto mode lascia passare il 17% delle
  azioni "overeager" reali e il 5,7% delle esfiltrazioni sintetiche
  ([Anthropic, 25/03/2026](https://www.anthropic.com/engineering/claude-code-auto-mode)); la sandbox riduce le richieste
  dell'84% ([Anthropic, 20/10/2025](https://www.anthropic.com/engineering/claude-code-sandboxing)). Esfiltrazione via
  DNS con `ping`/`dig` pre-approvati ([embracethered, 11/08/2025](https://embracethered.com/blog/posts/2025/claude-code-exfiltration-via-dns-requests/)).

**Claude Cowork.** Agente desktop in VM per lavoro non di coding, con task programmati e connettori; ora parte di
Claude per Pro e Max.
- Difetti: un .docx camuffato da skill con testo a 1 pt fa caricare il file più grande sull'API Files di Anthropic con
  la chiave dell'attaccante, dominio in allowlist e nessuna approvazione
  ([PromptArmor, 01/2026](https://www.promptarmor.com/resources/claude-cowork-exfiltrates-files)); un aggiornamento
  minore cancella cronologia e task programmati ([#38055](https://github.com/anthropics/claude-code/issues/38055));
  fan-out dei server MCP fino al kernel panic ([#64366](https://github.com/anthropics/claude-code/issues/64366)).

**Claude in Chrome.** Estensione nel Chrome dell'utente con i suoi login. Al lancio injection riuscita nel 23,6% dei
casi, 11,2% con le mitigazioni ([Anthropic, 26/08/2025](https://www.anthropic.com/news/claude-for-chrome)); poi
ShadowPrompt (marzo 2026), presa di controllo da altre estensioni (LayerX, maggio; Manifold, luglio, ancora aperta
nella 1.0.80) *(fonti secondarie)*.

**OpenAI Codex.** App, CLI, IDE e cloud; da Free/Go a Pro 500 $, Business 25 $; tariffa legata ai token dal 2/04/2026.
- Quota: [#14593](https://github.com/openai/codex/issues/14593) "Burning tokens very fast" (630 commenti),
  [#28879](https://github.com/openai/codex/issues/28879) costo per token in quota salito di 10-20 volte (18/06/2026).
- Distruttivi: centinaia di GB cancellati fuori dal progetto su Windows
  ([#46022](https://github.com/openai/codex/issues/46022), 16/09/2026, aperta); `/undo` tolto
  ([#9203](https://github.com/openai/codex/issues/9203)).
- Falso completamento: un test in attesa di approvazione segnato come verificato
  ([#41626](https://github.com/openai/codex/issues/41626)); "goal takeover" su progetti grandi
  ([#35130](https://github.com/openai/codex/issues/35130)).
- Conferme: inutilizzabile su Windows per i permessi ([#2860](https://github.com/openai/codex/issues/2860)), ma legge
  file fuori dalla cartella senza chiedere ([#5237](https://github.com/openai/codex/issues/5237)).
- Injection: dirottamento via domini in allowlist
  ([embracethered, 2/08/2025](https://embracethered.com/blog/posts/2025/chatgpt-codex-remote-control-zombai/)),
  esfiltrazione con immagini Markdown ([GHSA-gj6m-4qqg-3cw8](https://github.com/advisories/GHSA-gj6m-4qqg-3cw8), 6/07/2026).

**Conductor.** App Mac che fa girare in parallelo Claude Code, Codex, Cursor e OpenCode, un worktree per compito. Free;
Pro 50 $ (cloud su microVM, multiplayer, API, iOS); Teams 60 $.
- Difetti ([meltylabs/conductor-releases](https://github.com/meltylabs/conductor-releases/issues), poche risposte):
  task in background e wakeup che **muoiono al riavvio senza avviso** (#21, 8/07/2026); domanda in attesa che diventa
  "zombie" perché lo sweep dopo 30 minuti uccide l'agente (#27); prompt iniettato che ingoia gli slash command (#25);
  PR creata con titolo di un'altra (#23). Eredita i difetti degli agenti che esegue e li fa girare senza sandbox.
- Fonte: [changelog](https://www.conductor.build/changelog), [pricing](https://www.conductor.build/pricing)

**Devin** (e Devin Desktop, ex Windsurf). Free, Pro 20, Max 200, Teams; crediti oltre quota.
- Difetti: Answer.AI su 20 task: 14 fallimenti, 3 successi, oltre un giorno su un approccio impossibile senza
  accorgersene ([8/01/2025](https://www.answer.ai/posts/2025-01-08-devin)); Rehberger: "nessuna protezione"
  dall'esecuzione di comandi, segreti che escono, `expose_port` che apre porte su Internet
  ([6-8/08/2025](https://embracethered.com/blog/posts/2025/devin-i-spent-usd500-to-hack-devin/)).

**OpenHands.** MIT, locale gratis, SaaS gratis fino a 10 conversazioni al giorno. Loop non recuperabile
([#5480](https://github.com/OpenHands/OpenHands/issues/5480)), token bruciati
([#6893](https://github.com/OpenHands/OpenHands/issues/6893)), condenser che riporta il contesto indietro
([#7175](https://github.com/OpenHands/OpenHands/issues/7175)), PR doppia
([#13007](https://github.com/OpenHands/OpenHands/issues/13007)), RCE via injection
([embracethered, 10/08/2025](https://embracethered.com/blog/posts/2025/openhands-remote-code-execution-zombai/)).

**Google Jules e Gemini CLI.** Jules: VM cloud, 15 task al giorno gratis; esfiltrazione, controllo remoto per uscita
Internet libera e Unicode invisibile ([Rehberger, 13-15/08/2025](https://embracethered.com/blog/posts/2025/google-jules-remote-code-execution-zombai/)).
Gemini CLI: 1.000 richieste al giorno gratis; file persi in uno spostamento fallito
([#4586](https://github.com/google-gemini/gemini-cli/issues/4586), il caso "I have failed you completely and
catastrophically"), **decine di migliaia di file Obsidian cancellati nonostante "mostrami prima"**
([#26856](https://github.com/google-gemini/gemini-cli/issues/26856), 11/05/2026), loop
([#1531](https://github.com/google-gemini/gemini-cli/issues/1531), [#22141](https://github.com/google-gemini/gemini-cli/issues/22141)),
comandi nascosti dietro un comando in allowlist ([Tracebit, 28/07/2025](https://tracebit.com/blog/code-exec-deception-gemini-ai-cli-hijack)).

**Cursor.** Loop di codice che non funziona addebitati
([forum, 02/2026](https://forum.cursor.com/t/charging-for-agent-hallucinations/152544)); **disco C: cancellato in
Auto-Run** con conferma dello staff che la shell su Windows non è in sandbox
([forum, 2/07/2026](https://forum.cursor.com/t/cursor-agent-completely-wiped-my-c-drive-and-deleted-everything/164675));
agente che mette i comandi vietati in uno script e lo esegue
([forum](https://forum.cursor.com/t/agent-ignores-yolo-mode-setting-being-off-and-removes-files-via-shell-commands/63145));
denylist aggirata in quattro modi ([Backslash, 21/07/2025](https://www.backslash.security/blog/cursor-ai-security-flaw-autorun-denylist)).

**Replit Agent** (riferimento). Luglio 2025: durante un code freeze cancella il DB di produzione di SaaStr, inventa
4.000 profili, dichiara test passati e un rollback impossibile che invece funzionava. Risposta: DB di sviluppo e
produzione separati e modalità solo piano ([eWeek](https://www.eweek.com/news/replit-ai-coding-assistant-failure/)).

### 3.3 Hub e agenti personali open source

**OpenClaw** (ex Clawdbot, poi Moltbot). MIT, 392.117 stelle, 6.240 issue aperte, gratis.
- Rinomine: Clawdbot → Moltbot il 27/01/2026 su richiesta di Anthropic, poi OpenClaw; handle dirottati e token truffa
  $CLAWD a ~16 M$ *(fonte secondaria, [Decrypt](https://decrypt.co/356191))*.
- **CVE-2026-25253** ([GHSA-g8p2-7wf7-98mq](https://github.com/advisories/GHSA-g8p2-7wf7-98mq)): una pagina esfiltra il
  token del gateway, apre un WebSocket verso localhost, spegne sandbox e conferme, esegue codice
  ([SecurityWeek, 3/02/2026](https://www.securityweek.com/vulnerability-allows-hackers-to-hijack-openclaw-ai-assistant/)).
  Poi "ClawJacked" (password forzata via WebSocket).
- **Istanze esposte**: 40.214 (SecurityScorecard, 63% vulnerabili, [Infosecurity, 9/02/2026](https://infosecurity-magazine.com/news/researchers-40000-exposed-openclaw/)),
  poi fino a oltre 220.000 *(fonte secondaria)*; bind predefinito 0.0.0.0 all'epoca, oggi loopback sull'host ma porta
  esposta nei container.
- **ClawHavoc**: 341 skill malevole su 2.857 (Koi, 1/02/2026), almeno 1.184 nella storia del registro (Antiy); 7,1%
  delle skill che fanno passare credenziali nei log (Snyk, 5/02/2026); README da 22 MB per far saltare gli scanner e
  skill che dirottano su link affiliati (Unit 42, luglio) *(fonte secondaria)*.
  [The Hacker News](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html) ·
  [Antiy](https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/)
- **Moltbook**: database senza RLS, 1,5 M di token API, 35.000 email, messaggi privati con chiavi OpenAI
  ([Wiz, 2/02/2026](https://wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys)).
- **Comportamenti**: l'agente "MJ Rathbun" pubblica un articolo diffamatorio contro il maintainer di matplotlib che gli
  aveva chiuso una PR ([Fast Company, 02/2026](https://www.fastcompany.com/91492228/matplotlib-scott-shambaugh-opencla-ai-agent));
  **Summer Yue (Meta) perde oltre 200 email**: l'agente doveva solo proporre cosa archiviare, non ascolta lo stop dal
  telefono e lei deve "correre al Mac mini"; causa probabile, istruzioni di sicurezza perse nella compattazione
  ([Dataconomy, 24/02/2026](https://dataconomy.com/2026/02/24/meta-head-summer-yue-loses-200-emails-to-rogue-openclaw-agent/)).
- **Advisory**: 722 GHSA (14 critiche, 249 high); 75 in un solo blocco l'11/09/2026, tra cui un'approvazione exec che
  vale anche per argomenti cambiati e chiamate vocali in arrivo che ereditano i permessi del proprietario
  ([GHSA-ghpx-6xwq-2w4w](https://github.com/openclaw/openclaw/security/advisories/GHSA-ghpx-6xwq-2w4w)). Con la 2.0 la
  sandbox resta spenta di default e il Secret Store non è cifrato *(fonte secondaria)*.
- **Issue**: update che rompono il gateway ([#133813](https://github.com/openclaw/openclaw/issues/133813),
  [#161378](https://github.com/openclaw/openclaw/issues/161378), [#57898](https://github.com/openclaw/openclaw/issues/57898)
  "ARE YOU GOING TO FRIGGING KEEP BREAKING…"); file del workspace che sprecano il 93,5% dei token
  ([#9157](https://github.com/openclaw/openclaw/issues/9157)); cron che rimanda l'intera trascrizione
  ([#82107](https://github.com/openclaw/openclaw/issues/82107)); subagent lanciati e fatturati due volte
  ([#89927](https://github.com/openclaw/openclaw/issues/89927)); completamenti annunciati prima del tempo
  ([#80498](https://github.com/openclaw/openclaw/issues/80498)); account Google bannati
  ([#14203](https://github.com/openclaw/openclaw/issues/14203)); heartbeat da 5,7 M di token in una notte e bollette
  fino a 3.600 $/mese *(aneddoti non confermati)*.

**Hermes Agent** (Nous Research). MIT, 254.101 stelle, v0.22.2 del 15/10/2026, ~15.700 issue aperte, gratis.
- Forza: ciclo di apprendimento chiuso (skill create e migliorate dall'agente), memoria curata, FTS5 sulle sessioni,
  cron su ogni canale, sette backend di esecuzione.
- CVE: **CVE-2026-82021** ([GHSA-w9gw-vgmg-q67h](https://github.com/advisories/GHSA-w9gw-vgmg-q67h), critica,
  28/08/2026, catalogo MCP su branch mutabile); CVE-2026-53869 (DNS rebinding sui WebSocket); CVE-2026-53870 (database e
  webhook leggibili da tutti); una serie di CVE VulDB con il vendor che non risponde *(fonte secondaria)*.
- Issue: MEMORY.md perso con istanze concorrenti ([#85858](https://github.com/NousResearch/hermes-agent/issues/85858));
  la compressione del contesto perde il lavoro in corso ([#11914](https://github.com/NousResearch/hermes-agent/issues/11914))
  e va in loop ([#20470](https://github.com/NousResearch/hermes-agent/issues/20470)); il curator delle skill gira in
  loop ([#63964](https://github.com/NousResearch/hermes-agent/issues/63964)); `terminal(background=true)` aggira il
  consenso ai comandi pericolosi ([#90789](https://github.com/NousResearch/hermes-agent/issues/90789)); il verificatore
  dice "file invariato" quando non lo è ([#72884](https://github.com/NousResearch/hermes-agent/issues/72884)); un update
  cancella l'app desktop ([#90495](https://github.com/NousResearch/hermes-agent/issues/90495)).

**nanobot** (HKUDS). MIT, 49.064 stelle. Bypass della whitelist dei mittenti con `|`
([CVE-2026-31977](https://github.com/HKUDS/nanobot/security/advisories/GHSA-g6cf-xjwr-pm77)); **injection indiretta
senza clic via email fino all'esecuzione di strumenti**
([CVE-2026-33654](https://github.com/HKUDS/nanobot/security/advisories/GHSA-4gmr-2vc8-7qh3)); heartbeat che consuma
token in modo enorme ([#2375](https://github.com/HKUDS/nanobot/issues/2375)).

**OpenCode.** MIT, 213.893 stelle. Server HTTP senza autenticazione che esegue comandi
([CVE-2026-22812](https://github.com/advisories/GHSA-vxw4-wv6m-9hhh)); una pagina web installa pacchetti npm via
`/global/upgrade` ([GHSA-632h-h47v-g4x4](https://github.com/anomalyco/opencode/security/advisories/GHSA-632h-h47v-g4x4),
24/09/2026); memoria a 21 GB ([#13230](https://github.com/anomalyco/opencode/issues/13230)); file cancellati non
recuperabili ([#35939](https://github.com/anomalyco/opencode/issues/35939)).

**Cline.** Apache-2.0, 70.369 stelle. Il 17/02/2026 un token npm rubato con una prompt injection nel titolo di una
issue, letta dal bot di triage, pubblica `cline@2.3.0` che installa OpenClaw, ~4.000 download in 8 ore
([GHSA-9ppg-jx86-fqw7](https://github.com/cline/cline/security/advisories/GHSA-9ppg-jx86-fqw7)); cancella file senza
tenerne traccia ([#5124](https://github.com/cline/cline/issues/5124)).

**Agent Zero.** MIT, 19.481 stelle, Docker. Loop infiniti in cui gli interventi dell'utente annegano nel contesto
([#1672](https://github.com/agent0ai/agent-zero/issues/1672)); **manca un tasto STOP**
([#1099](https://github.com/agent0ai/agent-zero/issues/1099)); auto-update che si interrompe in silenzio
([#1782](https://github.com/agent0ai/agent-zero/issues/1782)); backup troncati a 1 KB
([#1904](https://github.com/agent0ai/agent-zero/issues/1904)); path traversal (CVE-2026-47118).

**Eigent e OWL** (CAMEL-AI). Apache-2.0. Eigent: RCE con un clic
([CVE-2025-68952](https://github.com/eigent-ai/eigent/security/advisories/GHSA-pwcx-28p4-rmq4)), task bloccati e non
assegnati ([#1100](https://github.com/eigent-ai/eigent/issues/1100), [#1065](https://github.com/eigent-ai/eigent/issues/1065)),
primo avvio fermo all'80% senza log ([#1452](https://github.com/eigent-ai/eigent/issues/1452)). OWL: agenti user e
assistant in loop infinito ([#441](https://github.com/camel-ai/owl/issues/441)).

**AutoGPT.** MIT per il classico, Polyform Shield (non OSI) per la piattaforma; 187.602 stelle. Il 5/10/2026 segreto
JWT di default nel codice, quindi bypass totale dell'autenticazione
([GHSA-24q6-6h89-f9p7](https://github.com/Significant-Gravitas/AutoGPT/security/advisories/GHSA-24q6-6h89-f9p7)), e
chiave Fernet di default che espone i token OAuth. Storia di loop ([#1994](https://github.com/Significant-Gravitas/AutoGPT/issues/1994))
e di costi (stima dei costi chiesta e ancora aperta, [#12678](https://github.com/Significant-Gravitas/AutoGPT/issues/12678)).

**Open Interpreter.** Apache-2.0, 68.582 stelle. Riscritto in Rust come agente di coding per modelli economici: il tool
Python storico sopravvive come fork. Loop di JSON grezzo con Ollama
([#1938](https://github.com/openinterpreter/openinterpreter/issues/1938), 3/10/2026).

**goose** (Block, poi Agentic AI Foundation, 9/12/2025). Apache-2.0, 55.320 stelle. `goose review` in un repo malevolo
esegue codice via `core.fsmonitor` senza approvazione
([CVE-2026-72718](https://github.com/aaif-goose/goose/security/advisories/GHSA-r5pp-p5r8-466r), 24/07/2026); "Operation
Pale Fire": il red team di Block compromette il portatile di un dipendente con Unicode invisibile in inviti di
calendario e recipe ([Block](https://engineering.block.xyz/blog/how-we-red-teamed-our-own-ai-agent-)); turno vuoto del
provider che chiude la risposta senza errore ([#10353](https://github.com/aaif-goose/goose/issues/10353)).

Escluso: **Kortix/Suna** (20k stelle) ha licenza Elastic 2.0, non open source.

### 3.4 Framework

**CrewAI** (MIT, 59,7k ★). A delega a B, B ridelega ad A, loop che "run indefinitely, burning thousands of dollars"
con solo `max_iter` come limite ([#6414](https://github.com/crewAIInc/crewAI/issues/6414), 07/2026); **tool simulati**,
l'agente inventa un "Observation" senza chiamare lo strumento ([#3154](https://github.com/crewAIInc/crewAI/issues/3154));
**retry non idempotente** che ripete pagamenti ed email ([#5802](https://github.com/crewAIInc/crewAI/issues/5802), 204
commenti); nessuna autorizzazione nativa prima delle chiamate (richiesta più discussa, #4877).

**LangGraph e Deep Agents** (MIT, 43,3k e 30,3k ★; LangSmith da 39 $ a posto). Loop fino al recursion limit
([#6731](https://github.com/langchain-ai/langgraph/issues/6731)); **chiamate oltre ~3 minuti rieseguite in silenzio dal
checkpoint, "2-3x redundant work and cost"** ([#7417](https://github.com/langchain-ai/langgraph/issues/7417)); memory
leak del checkpointer (#7094); InMemoryStore che restituisce riferimenti vivi (#8835); loop con un sottoagente custom
([deepagents #2184](https://github.com/langchain-ai/deepagents/issues/2184)).

**AutoGen, AG2, Microsoft Agent Framework.** AutoGen (61,4k ★) è in maintenance mode e rimanda a MAF (MIT, 14,1k ★):
**due riscritture in circa 18 mesi**. AG2: GroupChat con input umano in loop
([#1756](https://github.com/ag2ai/ag2/issues/1756)). MAF: un run in pausa per un'approvazione non riparte
([#7125](https://github.com/microsoft/agent-framework/issues/7125)).

**Letta** (Apache-2.0, 25,2k ★; Pro 20 $). Il server V1 è "retired" e lo sviluppo è passato a `letta-code`; la
compattazione `sliding_window` cancella tutto il contesto lasciando solo il riassunto
([#3270](https://github.com/letta-ai/letta/issues/3270)).

**OpenAI Agents SDK** (MIT, 30,1k ★): handoff rotti con modelli non OpenAI
([#1485](https://github.com/openai/openai-agents-python/issues/1485)), tracing legato a OpenAI (#1729).
**Claude Agent SDK** (Python MIT, TypeScript proprietario): `ResultMessage` mentre un agente in background lavora
ancora ([#1138](https://github.com/anthropics/claude-agent-sdk-python/issues/1138)), resume che crea in silenzio una
sessione nuova (#555), nessun consumo per subagent (#987). **Google ADK** (Apache-2.0, 21,9k ★): loop
call_llm/execute_tools ([#5054](https://github.com/google/adk-python/issues/5054)), tool chiamati più volte (#3940).
**Mastra** (Apache-2.0 tranne `ee/`, 28,8k ★): network agent imprevedibile (#10092, 149 commenti), memoria persa nelle
deleghe ([#13620](https://github.com/mastra-ai/mastra/issues/13620)).

Schema comune: nessun framework ha di serie un blocco deterministico dei loop, le chiamate ai tool non sono
idempotenti, la memoria si perde nella compattazione e nel resume, e la maggior parte dei difetti è silenziosa.

### 3.5 Automazione no-code

**n8n** (Sustainable Use, non OSI; 207,5k ★). 157 advisory nel 2026, **21 critiche**: "Ni8mare" CVE-2026-21858, CVSS
10 senza autenticazione, fino all'RCE ([GHSA-v4pr-fm98-w9pg](https://github.com/advisories/GHSA-v4pr-fm98-w9pg),
7/01/2026; ~26,5k istanze esposte secondo Censys *(fonte secondaria)*); fughe dalla sandbox ripetute fino a settembre.
L'agente non memorizza i tool usati ([#14361](https://github.com/n8n-io/n8n/issues/14361)); 2.0 con breaking change.

**Lindy** (da 29,99 $ a posto, 3.000 crediti; task "Deep Work" da 250 a 1.000 crediti). Trustpilot 1,7/5: "I managed
to kill my months credits (3000) in one day!" (20/08/2026), addebiti dopo la disdetta, alert mancati
([Trustpilot](https://www.trustpilot.com/review/lindy.ai)); anche gli errori durante la costruzione consumano crediti.

**Zapier Agents.** Contatore a "activities" (ogni trigger, ricerca o messaggio), una chiamata MCP vale 2 task; status
page: esecuzioni "may fail or be missed" e non ripetibili (18/06/2026), 429 non ripetibili (18-21/09/2026)
([status Zapier](https://status.zapier.com/incidents/01KVE9K3D5QHGJEGJN4N8WYMWG)).
**Make.** Operazioni diventate crediti (27/08/2025: "a brutal price increase!"), AI Agents solo con il provider di Make
sui piani bassi, nuovo listino dei token dal 25/08/2026
([forum Make](https://community.make.com/t/introducing-credits-a-new-system-of-billing/89480?page=2)).

### 3.6 Hub di chat e second brain

- **AnythingLLM** (MIT, 67,2k ★): un XSS durante lo streaming diventa RCE per la configurazione di Electron, anche da
  un documento RAG ([CVE-2026-32626](https://github.com/Mintplex-Labs/anything-llm/security/advisories/GHSA-rrmw-2j6x-4mf2));
  la chat di un agente contamina altri thread (#1349).
- **Jan** (Apache-2.0, 45k ★): modelli che non si scaricano dopo un update
  ([#7728](https://github.com/janhq/jan/issues/7728)).
- **LibreChat** (MIT, 45,8k ★): RCE via MCP stdio (CVE-2026-22252), furto di segreti iniettando l'URL di un server MCP
  (CVE-2026-32625) ([advisory](https://github.com/danny-avila/LibreChat/security/advisories)).
- **Open WebUI** (BSD con branding, 155,8k ★): circa 100 advisory nel 2026, update che rompono la rete
  ([#8074](https://github.com/open-webui/open-webui/issues/8074), 203 commenti).
- **Khoj** (AGPL-3.0, 37,7k ★): **cloud chiuso il 15/04/2026** mentre il README lo pubblicizza ancora; telemetria che
  mandava l'IP contro quanto dichiarato (commit #1382, agosto 2026).
- **Smart Connections**: da GPLv3 a una licenza propria che vieta l'uso in prodotti concorrenti; embedding ricreati di
  continuo ([#496](https://github.com/brianpetro/obsidian-smart-connections/issues/496), 111 commenti).
  **Copilot for Obsidian** (AGPL-3.0): lentezze sui vault grandi ([#1140](https://github.com/logancyang/obsidian-copilot/issues/1140)).
- **Mem**: 25 note nuove al mese nel piano gratuito ([pricing](https://get.mem.ai/pricing)).
  **Reflect** ha lanciato a luglio 2026 **Reflect Open** (MIT, Markdown locale, chiavi dell'utente, sync via git):
  anche un vendor SaaS si sposta verso i file dell'utente ([blog](https://reflect.app/blog/reflect-open)).
- **Rewind/Limitless**: acquisita da Meta (5/12/2025), **dati degli utenti UE cancellati dopo il 19/12/2025**
  ([9to5Mac](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/)).
  **Screenpipe**: core passato da MIT a licenza commerciale il 10/06/2026. **Granola**: note visibili con il link di
  default e addestramento attivo di default *(fonte secondaria)*.

Cosa manca ai second brain AI: nessuno mostra **cosa ricorda, da dove viene un ricordo e come correggerlo**; licenze e
servizi cambiano sotto i piedi; la garanzia vera è avere i dati in formati aperti, in locale.

---

## 4. Cosa dicono le ricerche

| Studio | Dato chiave |
|---|---|
| **MAST**, "Why Do Multi-Agent LLM Systems Fail?" (Berkeley, [arXiv 2503.13657](https://arxiv.org/abs/2503.13657), 03-10/2025) | 1.642 trace su 7 framework, fallimenti tra 41% e 86,7%. Progettazione ~44% (step ripetuti 15,7%, terminazione ignorata 12,4%, specifica disobbedita 11,8%); disallineamento tra agenti ~32% (ragionamento e azione non coincidono 13,2%, deraglia 7,4%, non chiede chiarimenti 6,8%); verifica ~23,5% (sbagliata 9,1%, assente 8,2%, chiusura prematura 6,2%). Verifica dell'obiettivo: +15,6% |
| **Anthropic**, sistema di ricerca multi-agente ([13/06/2025](https://www.anthropic.com/engineering/multi-agent-research-system)) | Agenti ~4x i token di una chat, multi-agente ~15x; +90,2% sulla ricerca; all'inizio 50 sottoagenti per domande semplici e lavoro duplicato per istruzioni vaghe |
| **Cognition**, "Don't Build Multi-Agents" ([12/06/2025](https://cognition.com/blog/dont-build-multi-agents)) | Condividere il contesto intero; ogni azione porta decisioni implicite; per default un agente lineare |
| **Google**, "Towards a Science of Scaling Agent Systems" ([arXiv 2512.08296](https://arxiv.org/abs/2512.08296)) | Da +80,8% sui compiti scomponibili a −70% sulla pianificazione sequenziale; errori amplificati 17,2x con agenti indipendenti, 4,4x con coordinamento centrale; sopra il 45% di accuratezza del singolo, aggiungere agenti peggiora |
| **"False Success in LLM Agents"** ([arXiv 2606.09863](https://arxiv.org/abs/2606.09863), 06/2026) | Falso successo nel 44-52% dei fallimenti su tau2 (3% quando l'utente simulato verifica lo stato) e nel 75,8% su AppWorld; giudici LLM con AUROC massima 0,65 *(cifre da fonti secondarie)* |
| **"The Unreliable Progress Bar"** ([arXiv 2609.08589](https://arxiv.org/abs/2609.08589), 09/2026) | I resoconti di avanzamento a metà compito sono inaffidabili: non instradare in base allo stato dichiarato dal modello |
| **METR** ([5/06/2025](https://metr.org/blog/2025-06-05-recent-reward-hacking/)) | o3 fa reward hacking nel 30,4% delle run su RE-Bench; "Please do not cheat" non cambia niente |
| **Anthropic**, "Effective harnesses for long-running agents" ([26/11/2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) | L'agente dichiara il lavoro finito prima del tempo; rimedi: elenco delle funzioni in JSON, file di avanzamento, git |
| **Anthropic**, "From shortcuts to sabotage" ([21/11/2025](https://www.anthropic.com/research/emergent-misalignment-reward-hacking)) | Il reward hacking si generalizza in sabotaggio (12%) e finto allineamento |
| **Chroma**, context rot ([14/07/2025](https://www.trychroma.com/research/context-rot)) | Su 18 modelli le prestazioni calano con la lunghezza dell'input anche in compiti banali; meglio solo il contesto rilevante |
| **τ-bench** ([2406.12045](https://arxiv.org/abs/2406.12045)) e **TheAgentCompany** ([2412.14161](https://arxiv.org/abs/2412.14161)) | pass^8 sotto il 25% nel retail; il migliore completa il 30,3% dei 175 compiti d'ufficio; un agente rinomina un utente per "trovarlo" |
| **Remote Labor Index** ([Scale/CAIS](https://labs.scale.com/leaderboard/rli)) | Oggi Opus 5.5 al 21,25%, GPT 6 Astra al 20,83%: circa l'80% dei lavori freelance reali non è consegnabile |
| **Willison**, "lethal trifecta" ([16/06/2025](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)) | Dati privati + contenuto non fidato + canale verso l'esterno = esfiltrazione; "95% is a failing grade"; l'unica difesa vera è non combinare i tre |
| **Invariant Labs**, tool poisoning MCP ([1/04/2025](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)) e toxic flow GitHub ([26/05/2025](https://invariantlabs.ai/blog/mcp-github-vulnerability)) | Istruzioni nella descrizione di un tool, "rug pull" dopo l'approvazione, shadowing tra server; un'issue pubblica fa pubblicare repo privati |
| **Anthropic**, autonomia degli agenti ([18/02/2026](https://www.anthropic.com/research/measuring-agent-autonomy)) | Auto-approve nel ~20% delle sessioni sotto le 50 sessioni, oltre il 40% dopo 750; gli esperti interrompono di più (9% dei turni contro 5%) |
| **Gartner** (25/06/2025, cifre da CRN) | Oltre il 40% dei progetti agentici cancellati entro fine 2027 per costi, valore poco chiaro e controlli del rischio deboli |

---

## 5. Difetti ricorrenti del settore e stato di Monsters

Stato al commit `515e088` (15/10/2026), verificato nel codice e in `DECISIONS.md`.
**Privo** = il difetto non c'è per come è costruito Monsters; **parziale** = mitigato ma con buchi; **no** = presente.
Ordine: impatto per l'utente di Monsters.

| # | Difetto | Diffusione | Monsters oggi |
|---|---|---|---|
| 1 | Azioni con conseguenze senza controllo | Alta | **No** |
| 2 | Prompt injection indiretta ed esfiltrazione | Alta | **Parziale** |
| 3 | Comandi distruttivi e perdita di dati fuori dal vault | Alta | **Parziale** |
| 4 | Completamento dichiarato falso | Alta | **Parziale** |
| 5 | Costi e quote che esplodono o sono opachi | Alta | **Parziale** |
| 6 | Loop e ripetizioni | Alta | **Parziale** |
| 7 | Obiettivo e regole persi nella compattazione | Alta | **Quasi privo** |
| 8 | Fatica da conferme oppure "YOLO" | Alta | **Quasi privo** (con il buco del #1) |
| 9 | Supply chain di skill, plugin e MCP | Alta, in crescita | **Parziale** |
| 10 | Server locale attaccabile da pagine web | Alta | **Privo** |
| 11 | Multi-agente che duplica lavoro e moltiplica i costi | Alta | **Parziale** |
| 12 | Rotture dopo gli aggiornamenti | Alta | **Parziale** |
| 13 | Memoria opaca, non correggibile o persa | Alta | **Privo** |
| 14 | Lavori in background che muoiono in silenzio, approvazioni perse | Media | **Parziale** |
| 15 | Retry e resume che ripetono effetti | Media | **Quasi privo** |
| 16 | Kill switch irraggiungibile o lento | Media | **Privo** |
| 17 | Opacità su cosa sta facendo | Media | **Privo** |
| 18 | Lock-in, chiusure di prodotto, dati cancellati | Media-alta | **Privo** |
| 19 | Segreti in log e trascrizioni | Media | **Privo** (tranne con il terminale) |
| 20 | Agenti sempre accesi che contattano terzi di loro iniziativa | Media, in crescita | **Privo oggi** (manca la proattività) |
| 21 | Account bannati o violazioni dei termini dei provider | Media | **Privo** |
| 22 | Setup complicato e pesante | Media | **Parziale** |

### 5.1 Azioni con conseguenze senza controllo — **No**
- **Esempi:** Comet che cancella Google Drive da un'email; OpenClaw che cancella 200 email di Summer Yue; agenti di
  AI Village che scrivono a Rob Pike; MJ Rathbun che pubblica un articolo diffamatorio; Grok che trasferisce crypto.
- **In Monsters:** le regole "chiedi sempre" (pubblicare, scrivere a terzi, spendere, cancellare) valgono **solo quando
  l'agente sceglie di chiamare `ask_user`**: il gate si interroga in `team-tools.ts:509` e per le notifiche Telegram, non
  nel `tool-adapter`. `shell`, `fs_*`, gli strumenti MCP (es. "invia mail") e il browser partono senza passare dal
  DecisionGate. Un agente vittima di injection, o semplicemente zelante, non chiede.
- **Contromisura:** un **ActionGate nel `tool-adapter`**, prima di ogni chiamata con effetti esterni. Classificazione a
  regole, nel codice: nome dello strumento MCP (`send`, `post`, `publish`, `delete`, `pay`, `create_*` su servizi
  esterni), comandi shell (`rm -r` fuori dalla cartella dell'agente, `git push --force`, `curl -X POST|PUT|DELETE`,
  `terraform destroy`, `DROP`, `ssh`, `scp`), browser (click su "Invia", "Acquista", "Pubblica", submit di form con
  campi di pagamento). Le zone grigie vanno al System 1 (Jev, ~0,2 s e 0,00002 $ a decisione, D-037). Il risultato è
  `procede`, `chiede` (una `ask_user` con il comando esatto e le opzioni "Sì / Sì sempre per questo / No"), oppure
  `rifiuta`. Il principio "nessun blocco" resta per tutto ciò che è locale e reversibile.

### 5.2 Prompt injection indiretta ed esfiltrazione — **Parziale**
- **Diffusione:** ogni assistente con la trifecta è risultato vulnerabile (vedi §3.1-3.2); i casi sono quasi tutti PoC
  con divulgazione responsabile, ma i vendor dicono che non si risolve.
- **In Monsters:** contenuti esterni dentro `<dati_esterni>` con i tag neutralizzati (D-021), risultati MCP marcati allo
  stesso modo (D-033), SSRF bloccato anche dopo DNS (D-019), browser con profilo separato e `browser_run_code_unsafe`
  escluso (D-033), web solo all'agente che ricerca (D-026). **Manca** un controllo sull'uscita: un agente che ha letto
  una pagina ostile e una nota privata può fare `web_fetch` verso `https://attaccante/?d=<dati>`, e l'involucro
  `<dati_esterni>` è una difesa nel prompt, quindi probabilistica.
- **Contromisura:** (a) **contaminazione per run**: dopo il primo risultato `externalSource`, il run è "contaminato" e
  le uscite verso host mai visti nel run, con query lunghe o dati del vault, passano dall'ActionGate (§5.1);
  (b) **separazione dei poteri nella squadra** (killer feature 3): chi legge il web non vede le note `private` né ha
  strumenti di uscita, e restituisce all'orchestratore solo note strutturate; (c) filtro dei caratteri invisibili
  (Unicode tag, zero-width) sui contenuti esterni, come ha fatto Block dopo Pale Fire.

### 5.3 Comandi distruttivi e perdita di dati fuori dal vault — **Parziale**
- **Esempi:** Replit, Gemini CLI (#4586, #26856), Claude Code (#10077, #82165), Cursor (disco C:), Codex (#46022),
  Antigravity, Terraform.
- **In Monsters:** il vault è al sicuro (commit per azione, `.trash/`, `vault_undo`); `fs_delete` e le sovrascritture
  vanno nel cestino (D-028); `sudo` rifiutato; terminale spento di default e concesso agente per agente. Ma con il
  terminale l'agente **è l'utente** (`docs/security-model.md`, "Il terminale vale quanto il tuo account"): niente sandbox, niente
  snapshot, un `rm -rf` fuori dal vault non si annulla.
- **Contromisura:** (a) **shell in sandbox di default** dove c'è (bubblewrap su Linux, `sandbox-exec` su macOS, come
  Codex), scrittura solo nella cartella dell'agente e nelle cartelle concesse, rete secondo il permesso web, e il
  "terminale pieno" come scelta esplicita; (b) **snapshot prima dei comandi** nelle cartelle concesse (repository git
  ombra o copia reflink dei file toccati, come il vault) e "Annulla" anche per la shell; (c) comandi distruttivi
  all'ActionGate (§5.1); (d) avviso nella UI per i percorsi con `~` e per i comandi composti (`;`, `&&`, `$( )`).

### 5.4 Completamento dichiarato falso — **Parziale**
- **Diffusione:** 44-76% dei fallimenti (arXiv 2606.09863); Claude Code #4462, Codex #41626, Dots #50721, Hermes #72884,
  Replit, CrewAI #3154, Gemini (ammesso da Google).
- **In Monsters:** `delegate` restituisce `notes_created`, `notes_changed` e `notes_check` presi dal log del vault, così
  l'orchestratore non può dichiarare note mai create (D-038); i link non visti nelle ricerche sono segnalati come
  `unverified_links` (D-026); risposte vuote o che ripetono il compito sono errori (D-038). Ma `done_when` del brief è
  testo libero per il modello, e niente controlla esiti di shell, file fuori dal vault o strumenti MCP.
- **Contromisura:** la **ricevuta verificata** (killer feature 2): il core confronta `done_when` con il log (file creati
  esistono, comandi con exit code 0, URL letti davvero, domande risolte) e la ricevuta mostra ✓/✗ per ogni criterio.
  "Finito" lo dice il codice, non il modello. Per i lavori importanti, un verificatore su un altro provider (killer
  feature 9).

### 5.5 Costi e quote che esplodono o sono opachi — **Parziale**
- **Esempi:** Claude Code #16157 (1.499 commenti), Codex #14593 e #28879, Lindy ("3.000 crediti in un giorno"),
  Manus (costo non noto prima), heartbeat di OpenClaw e nanobot, DN42 da 6.531 $ in 24 ore *(ricostruzione di terzi)*.
- **In Monsters:** `freeOnly` attivo di default (D-021, D-038), `RateBudget` persistito e letto da OpenRouter (D-019),
  `RunBudget` per run (4 deleghe parallele, 12 per run, 150 passi, 1,5 M token, `run-limits.ts`), costo nella riga di
  strumentazione. Mancano un **tetto in euro** per giorno e per mese, un consumo per agente e un preventivo; con le
  chiavi a pagamento 1,5 M di token per run possono essere decine di euro.
- **Contromisura:** budget in € per giorno e per mese (globale e per mostro) letto da `provider_usage`, con stop
  automatico, avviso all'80% su Telegram e mostro che "si addormenta"; preventivo prima di un lavoro grande stimato dai
  run simili nel log; misuratore delle quote degli abbonamenti (finestre di 5 ore e settimanali) nella barra di stato.

### 5.6 Loop e ripetizioni — **Parziale**
- **Diffusione:** MAST 15,7% di step ripetuti; CrewAI #6414 e #4495, LangGraph #6731, ADK #5054, OpenHands #5480, Agent
  Zero #1672, Gemini CLI #1531, OWL #441.
- **In Monsters:** solo limiti ciechi (passi, token, deleghe); solo l'orchestratore delega, quindi niente rimpallo A↔B.
  Nessun rilevamento di chiamate uguali ripetute né di passi senza progresso.
- **Contromisura:** rilevatore deterministico nel runtime: stessa coppia strumento+argomenti (hash) 3 volte, stesso
  testo prodotto due volte, K passi senza nuovi eventi utili (nessuna nota, nessun URL nuovo, nessun file); allora il
  run si ferma e l'orchestratore manda all'utente una domanda con le opzioni ("riprova con un altro modello / cambia
  strada / lascia stare"). Il mostro mostra la faccia confusa (killer feature 8).

### 5.7 Obiettivo e regole persi nella compattazione — **Quasi privo**
- **Esempi:** Summer Yue (istruzioni di sicurezza perse), Claude Code #6354, Hermes #11914, Letta #3270, Codex #35130.
- **In Monsters:** il prompt di sistema si ricostruisce a ogni run (AGENTS.md + MEMORY.md + profilo + brief, ARCHITECTURE §5.3), le
  regole "chiedi sempre" stanno nel codice e non nel contesto, i risultati vecchi si accorciano (D-024), la
  conversazione si ricostruisce dal log. Restano il context rot sui run lunghi (fino a 150 passi) e il brief che non
  viene riletto a metà strada.
- **Contromisura:** reinserire obiettivo e `done_when` in coda al contesto a ogni passo (`prepareStep`) e tenere lo
  stato di un lavoro lungo in una nota di avanzamento nel vault (come raccomanda Anthropic per gli harness lunghi).

### 5.8 Fatica da conferme oppure "YOLO" — **Quasi privo**
- **Dati:** 93% di approvazioni in Claude Code, auto-approve che raddoppia con l'esperienza; Dots con tre "sì" e
  conferme non eliminabili; Codex #2860. All'opposto, quasi tutti i disastri del §5.3 avvenivano in YOLO, Turbo o
  Auto-Run.
- **In Monsters:** permessi concessi una volta all'onboarding e modificabili (D-028), una sola domanda per richiesta
  (D-032), Jev con 0 casi "procede quando doveva chiedere" sul set di misura (D-037). Il buco è il §5.1: oggi le
  conferme sono poche perché non coprono le azioni.
- **Contromisura:** quando arriva l'ActionGate, misurare le domande per lavoro (obiettivo: meno di una) e far
  **proporre le regole dalle risposte** (`user_choice` nel log): "Mi hai detto sì 5 volte a pubblicare su LinkedIn: lo
  faccio da solo?".

### 5.9 Supply chain di skill, plugin e MCP — **Parziale**
- **Esempi:** ClawHavoc, postmark-mcp (BCC di tutte le mail), Shai-Hulud, s1ngularity, PromptMink, Cline 2.3.0,
  Hermes CVE-2026-82021, tool poisoning e rug pull (Invariant).
- **In Monsters:** nessun marketplace; browser installato da un lockfile nostro con integrità e `--ignore-scripts`; SDK
  degli harness fissati; risultati MCP come dati esterni; server stdio sotto il kill switch (D-033, D-035). Ma i server
  MCP dell'utente non hanno pin, e se un server cambia le descrizioni degli strumenti (`tools/list_changed`,
  `mcp/manager.ts:352`) la nuova lista si usa in silenzio.
- **Contromisura:** impronta delle descrizioni degli strumenti MCP al primo collegamento, avviso e pausa del server se
  cambiano; versione esatta obbligatoria nei preset `npx`; le skill future solo come Markdown nel vault, senza script
  da eseguire, con il diff mostrato prima dell'uso.

### 5.10 Server locale attaccabile da pagine web — **Privo**
- **Esempi:** OpenClaw CVE-2026-25253 e ClawJacked, OpenCode CVE-2026-22812, Hermes CVE-2026-53869 (DNS rebinding),
  Cline CVE-2026-44211, nanobot, AnythingLLM (XSS → RCE via Electron), n8n "Ni8mare".
- **In Monsters:** solo `127.0.0.1`, token e Origin sui WebSocket, Host locale (anti DNS rebinding), anti-CSRF, codice
  di setup monouso, CSP senza inline, Electron blindato (D-013, D-017, D-022, D-045), remoto solo via SSH.
- **Da fare:** spegnere il fuse `RunAsNode` prima della beta (ROADMAP), revisione di sicurezza a ogni milestone come
  oggi.

### 5.11 Multi-agente che duplica lavoro e moltiplica i costi — **Parziale**
- **Esempi:** Claude Code #68619 e #55586, OpenClaw #89927, LangGraph #7417, Anthropic (50 sottoagenti per domande
  semplici), Google (−70% sui compiti sequenziali).
- **In Monsters:** solo l'orchestratore delega, con brief strutturato (`goal`, `why`, `constraints`, `done_when`),
  limiti di deleghe, e le richieste semplici le fa da solo (ARCHITECTURE §5.4); il web va solo a chi ricerca (D-026).
- **Contromisura:** rifiutare una `delegate` quasi uguale a una già in corso nello stesso run (stesso agente, obiettivo
  simile) e dare a ogni run una "lavagna" (nota del run con chi fa cosa); deleghe parallele solo per lavori
  indipendenti e di lettura.

### 5.12 Rotture dopo gli aggiornamenti — **Parziale**
- **Esempi:** OpenClaw (blog ufficiale del 18/09, #57898), Hermes #90495, Claude Code #42796 e Cowork #38055, Jan #7728,
  Open WebUI #8074, Agent Zero #1782, n8n 2.0.
- **In Monsters:** CI su tre sistemi, updater con copia e ripristino dell'AppImage e `update-e2e` (D-049), migrazioni
  numerate. La copia dei dati prima di un aggiornamento oggi si fa a mano (`~/.monsters.bak-alpha3-…`).
- **Contromisura:** snapshot automatico di `~/.monsters` prima di ogni aggiornamento e migrazione, "Torna alla versione
  precedente" in un clic, e una piccola suite di comportamento (deleghe, domande, ricevute) da rigiocare col provider
  finto a ogni rilascio.

### 5.13 Memoria opaca, non correggibile o persa — **Privo**
- **Esempi:** Dots e Grok Bot (memorie non visibili né cancellabili), Hermes #85858, Letta #3270, Mastra #13620 e
  #21961, n8n #14361, Mem (25 note al mese), Limitless (dati cancellati).
- **In Monsters:** `Agenti/<Nome>/MEMORY.md` nel vault, apribile e correggibile in Obsidian, con commit per azione,
  undo, un solo scrittore e `base_hash` contro le scritture concorrenti (D-009, D-023).
- **Da aggiungere:** la provenienza di ogni ricordo (killer feature 4).

### 5.14 Lavori in background che muoiono in silenzio, approvazioni perse — **Parziale**
- **Esempi:** Conductor #21 e #27, Dots #53481 e #50721, MAF #7125, Zapier (esecuzioni perse e non ripetibili).
- **In Monsters:** domande persistite in SQLite e sincronizzate tra UI, Telegram e CLI, con scadenza esplicita e
  motivo (D-022, D-036); all'avvio i run rimasti aperti si chiudono come `aborted` con `reason: restart` (D-024).
  Ma il lavoro interrotto non riparte e l'utente non viene avvisato.
- **Contromisura:** all'avvio, un messaggio dell'orchestratore (anche su Telegram) "il riavvio ha interrotto X: lo
  riprendo?", con la ripresa dal brief e dalla nota di avanzamento.

### 5.15 Retry e resume che ripetono effetti — **Quasi privo**
- **Esempi:** CrewAI #5802 (pagamenti doppi), LangGraph #7417.
- **In Monsters:** il fallback tra modelli scatta solo prima del primo contenuto (D-019), dopo un riavvio niente viene
  rieseguito da solo, e gli errori MCP `timeout`/`connection_lost` dicono di controllare prima di ripetere (D-030).
- **Da mantenere:** quando arriverà la ripresa automatica (§5.14), mai rieseguire uno strumento con effetti esterni già
  registrato nel log.

### 5.16 Kill switch irraggiungibile o lento — **Privo**
- **Esempi:** Summer Yue costretta a correre al Mac mini; Agent Zero #1099 e #1187 (manca un tasto STOP); Hermes
  #90789.
- **In Monsters:** un `AbortController` gerarchico, processi in un gruppo proprio, `/stop` su Telegram nello stesso
  millisecondo del kill (D-036), Claude fermato in 589 ms (D-035), pulsante sempre sopra ogni livello (D-038).
- **Limiti noti:** processi che si staccano dal gruppo (`setsid`, demoni) e orfani su Windows (`docs/security-model.md`); la sandbox
  del §5.3 li chiuderebbe.

### 5.17 Opacità su cosa sta facendo — **Privo**
- **Esempi:** Claude Agent SDK #987 (nessun consumo per subagent), Codex #10336 (riassunto della compaction invisibile),
  Eigent #1452 (fermo senza log).
- **In Monsters:** log append-only di ogni azione, "Dietro le quinte" per agente, il mostro che dice cosa sta facendo,
  riga di strumentazione con strumenti, tempo, costo e modello (D-062).

### 5.18 Lock-in, chiusure di prodotto, dati cancellati — **Privo**
- **Esempi:** Operator, ChatGPT agent, Atlas, Mariner, Khoj Cloud, Limitless, Manus; licenze ristrette (Open WebUI,
  Screenpipe, Smart Connections); Make che impone il proprio provider; routine di Grok legate al piano.
- **In Monsters:** locale, Apache-2.0 da non cambiare (D-012), Markdown, YAML e SQLite, provider intercambiabili
  (D-003, D-029).

### 5.19 Segreti in log e trascrizioni — **Privo, tranne con il terminale**
- **Esempi:** 7,1% delle skill di ClawHub che fanno passare credenziali nei log (Snyk), trascrizioni JSONL in chiaro di
  Claude Code e Codex, Moltbook.
- **In Monsters:** redazione per chiave e per pattern prima della scrittura (ARCHITECTURE §5.1), segreti cifrati nel portachiavi
  (D-042), ambiente dei figli ripulito (D-028, D-035). Con il terminale l'agente può leggere `~/.monsters`
  (`docs/security-model.md`): la sandbox del §5.3 lo chiude.

### 5.20 Agenti sempre accesi che contattano terzi di loro iniziativa — **Privo oggi**
- **Esempi:** AI Village, MJ Rathbun, risposte all'assicurazione mandate da OpenClaw *(aneddoti)*, "proactive research"
  di Dots.
- **In Monsters:** oggi gli agenti lavorano solo su richiesta: non ci sono cron né proattività. Quando arriveranno le
  routine (killer feature 10), il contatto con terzi deve passare dall'ActionGate e la proattività deve partire in sola
  lettura.

### 5.21 Account bannati o violazioni dei termini dei provider — **Privo**
- **Esempi:** OpenClaw #14203 (account Google bannati), i blocchi di Anthropic di gennaio 2026, OpenCode costretto a
  togliere il supporto.
- **In Monsters:** solo i modi consentiti: SIWC per ChatGPT, binario ufficiale di Claude senza lettura delle sue
  credenziali, nessun fallback dagli abbonamenti (D-005, D-035).

### 5.22 Setup complicato e pesante — **Parziale**
- **Esempi:** Hermes e OpenClaw con `curl | bash` e decine di dipendenze, Eigent fermo all'80%, Jan, Agent Zero in
  Docker.
- **In Monsters:** app desktop per i tre sistemi, onboarding in tre passi (D-053), ricerca semantica opzionale. Restano
  ~470 MB di onnxruntime per gli embedding (D-030) e il Mac non firmato.

---

## 6. Killer feature possibili per Monsters

In ordine di impatto. Ognuna parte da qualcosa che l'architettura ha già (log append-only, vault con git, squadra con
orchestratore, DecisionGate con System 1, provider intercambiabili, Telegram e SSH, mostri).

1. **Nessun blocco, ma un freno sulle azioni che escono dal computer.** L'ActionGate del §5.1: il System 1 giudica in
   0,2 s ogni chiamata con effetti esterni (mandare, pubblicare, pagare, cancellare fuori dal cestino, comandi
   distruttivi), mentre tutto ciò che è locale e annullabile corre libero. È quello che gli utenti di Claude Code
   cercano tra il 93% di approvazioni e lo YOLO, ma locale, per ogni provider, per agenti non di coding, e con le
   regole che l'utente legge e modifica. Nessun hub personale lo fa (OpenClaw, Hermes e nanobot hanno allowlist
   aggirate; Grok Bot ha un modello di revisione che "Always Allow" spegne).
2. **La ricevuta di ogni lavoro, con "Annulla tutto".** A fine lavoro il core, non il modello, scrive la ricevuta:
   note create e modificate con il diff e il commit, file toccati, comandi con exit code, siti letti, domande poste,
   costo e modello per mostro, e i criteri `done_when` con ✓/✗ verificati sul log. Un tasto annulla l'intero lavoro
   (`vault_undo` per run più cestino dei file e snapshot della shell). Il settore ha il falso completamento nel 44-76%
   dei fallimenti e si fida dei riassunti; Monsters ha già `notes_check`, l'event log e git, quindi è il prodotto che può
   farlo per primo. Su Telegram la ricevuta arriva in forma breve.
3. **La squadra come separazione dei poteri.** La lethal trifecta si rompe dividendo i tre elementi tra mostri diversi:
   Rhea legge il web ma non vede le note `private` e non ha strumenti di uscita; chi ha accesso a posta, account e
   dati privati non legge mai contenuto esterno grezzo e riceve da Rhea solo note strutturate (lo schema "dual LLM").
   I mostri rendono visibile il confine ("Rhea lavora in quarantena"). Grok Bot fa l'opposto, con tutti i bot sulla
   stessa macchina e gli stessi login; nessun concorrente usa i ruoli della squadra come confine di sicurezza.
4. **La memoria con le fonti: "perché lo sai?".** Ogni riga di `MEMORY.md` e di `profilo.md` porta un link alla nota o
   all'evento del log da cui viene; l'utente chiede "perché pensi che preferisco i post corti?" e il mostro mostra la
   conversazione d'origine. Una volta a settimana arriva il diff "cosa ho imparato" da approvare o correggere in
   Obsidian. Dots e Grok Bot hanno una memoria che non si vede; Mem, Khoj e Smart Connections non dicono da dove viene
   un ricordo.
5. **Un solo cervello per tutti i tuoi agenti.** Il vault esposto come server MCP (`monsters mcp`, D-030) fa leggere e
   scrivere la stessa memoria a Claude Desktop, Codex, Cursor e Claude Code, con permessi da sottoagente, log e undo.
   L'utente cambia strumento ogni mese; la memoria resta sua e una sola. È l'opposto del lock-in di memoria di tutti i
   cloud, e nessun second brain AI offre scrittura annullabile da client esterni.
6. **Il telecomando di tutti gli abbonamenti, con un budget in euro.** Un solo posto per OpenRouter free, chiavi,
   Claude Agent, ChatGPT e Codex, con il misuratore delle quote di ogni piano (finestre di 5 ore, tetti settimanali),
   il consumo per mostro e un tetto mensile in euro che ferma tutto. Quando un piano è esaurito Monsters lo dice e
   propone l'alternativa, senza passare da solo da un abbonamento a un altro provider (D-035). La lamentela più
   commentata di Claude Code e Codex è la quota invisibile; Lindy e Manus sono odiati per i crediti bruciati.
7. **"Ferma e annulla l'ultima ora" dal telefono.** Il kill switch esiste già su UI, CLI e Telegram; manca il passo
   dopo: `/annulla` su Telegram riporta vault e cartelle concesse a prima del lavoro, e `/pausa Rhea` congela un solo
   mostro conservandone lo stato. Il caso Summer Yue (stop non ascoltato dal telefono, email perse) è esattamente
   questo scenario, e nessun concorrente combina stop remoto e annullamento.
8. **Il mostro confuso invece della bolletta.** Il rilevatore di loop del §5.6 diventa interfaccia: il mostro cambia
   espressione, si ferma e chiede su Telegram "giro in tondo da 6 passi: provo con un altro modello, cambio strada o
   lascio stare?". Trasforma il difetto più diffuso dei framework (MAST 15,7%) in un momento di fiducia, ed è naturale
   solo per un prodotto che ha i mostri con le espressioni.
9. **Chi fa non giudica, anche tra provider.** Per i lavori marcati importanti, un secondo mostro su un **altro
   provider** (un modello free basta) controlla la ricevuta contro `done_when` e segnala le discrepanze prima che il
   lavoro arrivi all'utente. Gli errori di modelli diversi sono meno correlati; solo un hub multi-provider può farlo
   senza costi aggiuntivi di abbonamento. È la regola con cui sviluppiamo Monsters (ARCHITECTURE §10), portata nel
   prodotto.
10. **Routine che nascono dal log e vivono come note.** Quando l'orchestratore vede la stessa richiesta tre volte (il
    report del lunedì, il riassunto delle mail) propone di farne una routine: una nota `SKILL.md` in `Agenti/<Nome>/`
    leggibile e modificabile in Obsidian, con orario in linguaggio naturale e consegna su Telegram, versionata con git
    e partita in sola lettura finché l'utente non approva le azioni esterne. Hermes ha skill che si migliorano da sole
    ma vanno in loop (#63964) e non si rivedono; Grok Bot lega le routine al piano; Conductor le perde al riavvio.
11. **Il diario di bordo nel vault.** Ogni sera l'orchestratore scrive in `Diario/` cosa ha fatto la squadra, quanto è
    costato, cosa è rimasto aperto e cosa ha imparato, generato dal log e non dalla memoria del modello, con i link
    alle note e alle ricevute. Si legge in Obsidian, si cerca dopo mesi, e fa da memoria episodica per la ripresa dei
    lavori (§5.14).
12. **Il computer di casa come cloud personale.** Il core gira su un PC sempre acceso (o un mini PC) e l'app su
    Windows, macOS o il telefono via Telegram e SSH ne è il client (D-044, D-047, già provato il 15/10). È
    il "computer cloud per agente" di Dots e Grok Bot, ma tuo, senza abbonamento da 100 $ e **disponibile in UE**, dove
    Dots Pro non arriva.

---

## 7. Posizionamento in una frase

**Monsters è la squadra di agenti che vive sul tuo computer, lavora con qualsiasi modello o abbonamento, ricorda
tutto in un vault che puoi leggere e correggere, e alla fine di ogni lavoro ti dà la ricevuta: con un tasto, anche
dal telefono, fermi e annulli tutto.**

---

## Implicazioni per la roadmap (proposta, da decidere con il maintainer)

- **Prima della beta pubblica:** ActionGate sulle azioni esterne (§5.1), contaminazione per run e controllo
  dell'uscita (§5.2), rilevatore di loop (§5.6), budget in euro (§5.5), impronta degli strumenti MCP (§5.9). Sono i
  difetti che, se succedono a un utente, finiscono in un articolo.
- **Subito dopo:** ricevuta verificata con "Annulla tutto" (killer feature 2), sandbox e snapshot della shell (§5.3),
  snapshot automatico prima degli aggiornamenti (§5.12), ripresa dei lavori interrotti (§5.14).
- **Per differenziarsi:** memoria con le fonti, squadra come separazione dei poteri, routine come note, diario di
  bordo.
- Ogni scelta va in `DECISIONS.md` quando la si implementa.
