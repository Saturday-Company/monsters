# 03 · Istruzioni degli agenti, orchestrazione, System 1

Ricerca del 14/10/2026. Le fonti sono in fondo a ogni sezione. Dove un dato viene solo dal produttore lo segnalo.

---

## 1. Cosa dicono le guide Anthropic (principi applicabili a Monsters)

**Istruzioni (CLAUDE.md / prompt di sistema)**
- **Corte e verificabili.** Sotto le 200 righe per file. Per ogni riga ci si chiede: *"Se la tolgo, l'agente sbaglia?"* Se la risposta è no, la riga va tolta. Un file gonfio fa ignorare proprio le regole importanti.
- **Cosa metterci:** quello che il modello non può dedurre da solo (comandi, convenzioni, decisioni, trappole). **Cosa non metterci:** ovvietà ("lavora bene"), tutorial, informazioni che cambiano spesso, documentazione lunga (meglio un link).
- **"Altitudine giusta":** né logica rigida da if/else, né indicazioni vaghe. Si parte dal minimo e si aggiunge una regola solo quando si osserva un errore.
- **Un ruolo basta.** Anche una sola frase di ruolo nel prompt di sistema cambia il comportamento. Conviene spiegare il *perché* delle regole.
- **Niente toni urlati.** I modelli attuali seguono il prompt di sistema più di prima, quindi "CRITICAL: You MUST..." produce eccessi. Basta scrivere "Usa X quando...". IMPORTANT va usato su una riga sola, se proprio serve.
- **Le procedure vanno nelle Skill, non nel file.** Una Skill è una cartella con `SKILL.md`; all'avvio si carica solo nome e descrizione, il resto quando serve (*progressive disclosure*). Da dicembre 2025 è uno standard aperto (agentskills.io), quindi è portabile tra provider.
- **Le regole che devono valere sempre vanno nel codice (hook o gate), non nel prompt:** le istruzioni sono contesto, non vincoli.

**Context engineering**
- Il contesto è una risorsa finita e le prestazioni calano man mano che si riempie (*context rot*). L'obiettivo è il minimo insieme di token ad alto segnale.
- **Recupero just-in-time:** l'agente tiene in contesto riferimenti leggeri (percorsi, query, link) e legge i contenuti solo quando servono.
- **Strumenti:** pochi, distinti, senza sovrapposizioni e con output compatti.
- **Sessioni lunghe:** compattazione (riassunto in loco), *note strutturate* salvate fuori dal contesto e sottoagenti con contesto pulito che restituiscono 1.000-2.000 token.

**Sottoagenti**
- Ognuno ha un proprio contesto e restituisce **solo il rapporto finale**. Sono adatti a lavori verbosi (ricerca, log, test) e paralleli.
- La `description` decide quando delegare: deve essere breve e chiara. Si restringono gli strumenti per ruolo e si usano modelli economici per i compiti semplici.
- Ogni sottoagente può avere una **memoria persistente** su file (`MEMORY.md`, di cui si caricano le prime 200 righe).
- I modelli recenti delegano anche troppo. Va detto esplicitamente quando *non* usare sottoagenti (compiti semplici, sequenziali, a file singolo).

**Agenti di lunga durata**
- **Prima sessione diversa dalle altre:** un "initializer" prepara ambiente, lista obiettivi (in JSON, che i modelli alterano meno del Markdown), file di progresso e commit iniziale. Le sessioni successive leggono progresso e git, poi lavorano **una cosa alla volta**.
- **Verifica prima di dichiarare finito**, possibilmente "come farebbe un utente" (browser). L'agente si ferma quando il lavoro *sembra* finito, quindi gli serve un controllo che dia pass/fail.
- **Generatore e valutatore separati:** chi produce giudica il proprio lavoro troppo generosamente. Prima di iniziare va concordato cosa significa "finito" (*sprint contract*).
- **Reset del contesto con passaggio di consegne strutturato** contro compattazione: i modelli recenti ricostruiscono bene lo stato dai file. Nel prompt va scritto che il contesto verrà compattato, altrimenti alcuni modelli chiudono in anticipo.
- **Semplificare a ogni nuovo modello:** ogni pezzo dell'harness presuppone un limite del modello, e quel limite scade. Va tenuta la soluzione più semplice che funziona.
- **Architettura (Managed Agents, aprile 2026):** il "cervello" (modello + harness) va separato dalle "mani" (sandbox e strumenti dietro un'interfaccia unica). Il **log di eventi append-only** è la fonte di verità e l'harness non ha stato, così può riprendere dopo un crash. Le credenziali stanno fuori dalla portata degli agenti.
- **Autonomia controllata (auto mode di Claude Code, marzo 2026):** un classificatore a due stadi (filtro veloce prudente, poi ragionamento solo sui casi segnalati) decide se un'azione passa. Giudica *le azioni, non le giustificazioni* dell'agente e interpreta il consenso in modo stretto. Se un'azione viene negata, l'agente riceve il motivo e cerca un'altra strada. Si passa all'umano dopo 3 dinieghi consecutivi o 20 in totale. **È il precedente più vicino al "chiedo o procedo" di Monsters** (vedi §4).

Fonti:
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/sub-agents
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (29/09/2025)
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills (16/10/2025, aggiornato 18/12/2025)
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (26/11/2025)
- https://www.anthropic.com/engineering/harness-design-long-running-apps (24/03/2026)
- https://www.anthropic.com/engineering/claude-code-auto-mode (25/03/2026)
- https://www.anthropic.com/engineering/managed-agents (08/04/2026)

---

## 2. Lo standard AGENTS.md

- **Formato:** Markdown libero, senza campi obbligatori. Le sezioni tipiche sono panoramica, comandi, stile, test, sicurezza. I file possono essere **annidati** nelle sottocartelle e vince quello più vicino al file su cui si lavora. Le istruzioni date in chat prevalgono su tutto.
- **Governance:** è curato dall'**Agentic AI Foundation (Linux Foundation)** ed è usato da oltre 60.000 progetti open source.
- **Chi lo legge:** OpenAI Codex, Cursor, GitHub Copilot coding agent, Gemini CLI (va configurato), Jules, Devin/Windsurf, Amp, Factory, Aider (va configurato), goose, opencode, Zed, Warp, VS Code, JetBrains Junie, Kilo Code, RooCode, Augment e altri. **Claude Code lo legge in modo nativo dalla v2.1.277**, ma solo se nella cartella o in quelle superiori non c'è un `CLAUDE.md`. In alternativa:
  - un `CLAUDE.md` che contiene `@AGENTS.md` (import);
  - un symlink;
  - l'impostazione `claude-md-and-agents-md`, che li legge entrambi.
- **Convivenza in Monsters:** il file di verità di ogni agente è **`AGENTS.md`**, coerente con l'agnosticismo sul provider. Quando un agente gira su Claude (Agent SDK, Claude Code o abbonamento) l'adapter crea un `CLAUDE.md` di una riga (`@AGENTS.md`) oppure non crea nulla. Le procedure ricorrenti vanno in Skill (`SKILL.md`), che sono portabili anche loro.

Fonti:
- https://agents.md
- https://code.claude.com/docs/en/memory (sezione AGENTS.md)

---

## 3. Orchestrazione multi-agente: cosa funziona nel 2026

**Pattern**
- **Orchestrator-worker (Anthropic Research):** un lead pianifica, lancia sottoagenti in parallelo e sintetizza. Ogni delega deve contenere **obiettivo, formato dell'output, strumenti/fonti, confini del compito**: con deleghe vaghe i sottoagenti duplicano il lavoro o fraintendono. Nel prompt vanno messe regole esplicite di *effort scaling* (domanda semplice = 1 agente e poche chiamate).
- **Agents-as-tools contro handoff (OpenAI Agents SDK):**
  - *agents-as-tools* (manager): il manager resta padrone della conversazione e combina i risultati;
  - *handoff*: la conversazione passa allo specialista, che di default vede tutta la storia, filtrabile con `input_filter`.
  - Si può orchestrare via LLM (compiti aperti) o via codice (output strutturato, catene, loop valutatore, parallelo: più prevedibile).
- **Per Monsters:** l'orchestratore usa **agents-as-tools**, perché l'utente parla sempre con lui. L'handoff serve solo se l'utente sceglie di parlare direttamente con un agente (es. aprendone il terminale).

**Contesto mirato in andata, riassunto in ritorno**
- **Andata:** un brief strutturato con obiettivo, *link* alle note del vault (non il loro contenuto), vincoli, formato, criterio di completamento. Va passato anche il **perché** e le decisioni già prese. Cognition avverte che le azioni contengono decisioni implicite e che due agenti con assunzioni diverse producono risultati incoerenti.
- **Ritorno:** un riassunto di 1-2k token al massimo (cosa è stato fatto, file e note creati, decisioni, dubbi aperti). Gli output grandi restano nel vault e si restituisce il percorso.

**Memoria su file**
- Ogni agente ha `agenti/<nome>/memoria.md` (da leggere all'inizio e aggiornare alla fine).
- Lo stato condiviso dei task sta in JSON, le note di progresso in testo libero.
- Il **log eventi append-only** è la fonte di verità (coincide con il "log delle azioni" del brief, ed è utile per riprendere e per il kill switch).
- Versioning git del vault.

**Quando NON usare il multi-agente**
- **Costo:** un sistema multi-agente consuma circa **15 volte i token** di una chat. Vale solo per lavori di valore, parallelizzabili, che superano un singolo contesto o richiedono molti strumenti.
- **Compiti sbagliati per il multi-agente:** quelli fortemente interdipendenti o che devono condividere tutto il contesto (gran parte del coding). Lì conviene un agente unico, eventualmente con sottoagenti di sola lettura (ricerca, review).
- **Regola pratica:** se la richiesta si risolve in poche azioni, la fa l'orchestratore da solo.
- **Diffidare dei modelli che delegano troppo:** nel prompt dell'orchestratore va scritto quando non delegare.

Fonti:
- https://www.anthropic.com/engineering/multi-agent-research-system (13/06/2025)
- https://openai.github.io/openai-agents-python/multi_agent/
- https://openai.github.io/openai-agents-python/handoffs/
- https://cognition.com/blog/dont-build-multi-agents (12/06/2025)
- https://www.anthropic.com/engineering/building-effective-agents

---

## 4. System 1 model: Jev, Laya e alternative

### Jev (TypeSafe AI)
- **Cos'è:** un modello "System One" che **non genera testo**. Riceve uno `state` (testo libero o JSON) e delle `questions` tipizzate e risponde a tutte in un solo passaggio con valori tipizzati e confidenza calibrata. Non spiega le scelte e non chiama strumenti. I tipi di domanda sono:
  - `choice` (una categoria tra le opzioni);
  - `score` (punteggio o rubrica);
  - `noul` (probabilità sì/no).
- **API:** `POST https://api.typesafe.ai/v1/systemone`, `model: jev-latest` (oggi `jev-1.13.0`). È disponibile anche tramite LiteLLM proxy (`/typesafe/v1/systemone`), DigitalOcean Serverless Inference e Cloudflare Workers AI (`typesafe/jev`).
- **Stato:** early access con waitlist dal **15/09/2026**. Non c'è un tier gratuito self-serve e i rate limit non sono pubblicati. È **proprietario**: pesi e architettura non sono pubblici.
- **Costo:** **$0,042 per milione di token in input, output gratis**. TypeSafe ammette di non poter dimostrare che il prezzo non sia sussidiato.
- **Latenza:** 70-500 ms secondo il produttore. Misure di terzi danno 236-276 ms p50 per domanda.
- **Contesto:** 32k token. **Opzioni:** fino a 255 per domanda, e gestisce bene anche oltre 50.
- **Accuratezza:** sul benchmark del produttore 67,8% contro 67,9% di GPT-5.6 Terra, a circa 1/76 del costo e in 0,4 s invece di 10 s. Su Banking77 (77 etichette) arriva a 0,87. **Tutti i numeri sono del produttore o di test preliminari.**

### Laya (ConvAI Innovations), `pip install laya`, Apache 2.0
- **Cos'è:** un clone open del concetto Jev. È un encoder bidirezionale (non autoregressivo) con una testa decisionale, sugli stessi tipi `choice`/`score`/`noul`. `laya-serve` espone **lo stesso endpoint `/v1/systemone` di Jev**. Ci sono extra per MCP, LangChain, LlamaIndex, CrewAI e ONNX, più SDK TypeScript, Java e Go.
- **Checkpoint:**

  | Checkpoint | Backbone | Parametri | Contesto | Note |
  |---|---|---|---|---|
  | `laya` | ModernBERT-large | 421M | 512 | solo inglese |
  | `laya-multilingual` | mmBERT-base | 322M | 1024, fino a 8k con `max_len` | 100+ lingue, **serve per l'italiano** |
  | `laya-typed-decisions` | ModernBERT-large | 421M | 1024 | fine-tuned su 4 workflow |

- **Versioni:** prima release il 18/09/2026. **Oggi la versione è 0.4.7 (14/10/2026)**, con rilasci quasi quotidiani: è un progetto giovane e instabile.
- **Latenza:** circa 33-40 ms per 1 domanda e circa 160 ms per 10 domande su una T4. Su CPU è più lento ma usabile, e c'è l'ONNX.
- **Accuratezza (quello che già sapevamo è confermato):**
  - **zero-shot è vicino al caso:** 0,362 per `laya` e 0,342-0,352 per il multilingual, contro un baseline casuale di 0,318 e una classe maggioritaria di 0,461;
  - **dopo il fine-tuning arriva a 0,766**, sopra Jev (0,727) sullo stesso benchmark;
  - con 77 opzioni crolla a 0,425: il budget di token si divide tra le opzioni (minimo 4 token l'una).
- **Novità rispetto a quanto noto:**
  - dalla 0.3.28 c'è `predict_tournament` (eliminazione a gruppi fino a 256 etichette) e c'è `predict_shortlist` con embedding;
  - c'è la CLI `laya-train` con fit della soglia di astensione e report prima/dopo;
  - l'output include la formula di confidenza di Jev (`x_jev_confidence`);
  - `MAX_CHOICE_OPTIONS` = 100 sul server.
  - Non ci sono miglioramenti zero-shot né nuovi checkpoint pubblici.
- **Limiti noti:**
  - è troppo sicuro di sé finché non lo si calibra (fit della temperatura sui propri dati);
  - `noul` può seguire le etichette invece del testo;
  - `act_probability` è inutilizzabile, quindi conviene filtrare sulla `confidence`;
  - le negazioni sono fragili.

### Alternative
- **Altri modelli open in stile Jev** (guida DataCamp del 23/09/2026, tutti nuovi e poco testati):
  - **Kev** (Qwen3.5 0.8B/4B/9B, compatibile `/v1/systemone`);
  - **Von** (ModernBERT 395M, compatibile);
  - **Rizzo Flow** (llama.cpp, compatibile);
  - **Nimble** (Qwen3.5-9B LoRA);
  - **NanoJev** (Qwen3-0.6B);
  - **SemIf** (nessun training: legge i logit delle opzioni da un LLM open).
- **LLM piccolo con output strutturato:** funziona zero-shot, spiega le scelte e capisce l'italiano. Due esempi:
  - **Claude Haiku 5.5** a $0,10 / $0,50 per milione di token (in/out);
  - un modello OpenRouter (anche free) con `response_format: json_schema` e `require_parameters: true`. Il supporto va verificato per singolo endpoint.
  - Contro: centinaia di ms o qualche secondo di latenza.
- **Regole deterministiche:** coprono la maggior parte dei casi "chiedo o procedo", come mostra l'auto mode di Claude Code. Danno costo zero, sono spiegabili e testabili.

### Raccomandazione per Monsters
1. **Un'interfaccia sola, `DecisionPort`, con il contratto `/v1/systemone`** (`state` + domande tipizzate → risposta + confidenza). Così Jev, Laya, Kev, Von o un LLM sono intercambiabili, coerentemente con l'agnosticismo sul provider.
2. **Usi giusti:**
   - **(a) gate "chiedo all'utente o procedo"**: è il principale;
   - **(b) smistamento di una richiesta generica all'agente giusto**: `choice` sui 2-7 agenti del team, quindi poche opzioni, il caso ideale;
   - **(c) priorità e urgenza delle notifiche** (Telegram ora o più tardi).
   - **Usi sbagliati:** scegliere *al posto dell'utente* tra opzioni di gusto (design, tono), che sono il motivo per cui gli si chiede; ragionamenti aperti.
3. **Il gate è prima di tutto a regole, poi il modello:**
   - **procede in autonomia:** azioni locali, reversibili e dentro l'obiettivo (lettura, bozze, note nel vault con versioning);
   - **chiede sempre:** pubblicare, scrivere a terzi, spendere, cancellare in modo irreversibile, cambiare obiettivo;
   - **zona grigia** (scelte operative o di design dentro un task): domanda `noul` "serve l'utente?" più `choice` sull'opzione. Si procede da soli solo sopra una soglia di confidenza, altrimenti l'opzione viene messa in coda di domande all'utente, con la consigliata in evidenza.
   - Ogni decisione automatica viene annotata ed è annullabile.
4. **Fasi:**
   - **Fase 1 (MVP):** niente modello dedicato. Regole + LLM piccolo con output strutturato dietro `DecisionPort`. **Si registra ogni decisione** (stato, opzioni, scelta automatica o dell'utente): questo diventa il dataset.
   - **Fase 2:** si aggiunge **Laya multilingual in locale** (Apache 2.0, gira su CPU/GPU), fine-tuned con `laya-train` sulle decisioni registrate e calibrato. Si confronta col baseline LLM sulle stesse decisioni e si attiva solo se a parità di accuratezza è più veloce o economico. Laya zero-shot va escluso.
   - **Fase 4 (pacchetti a pagamento):** Jev via API come opzione gestita, se esce dall'early access e i prezzi restano quelli. Si guadagna latenza e accuratezza zero-shot, ma si perde la località: va reso opzionale.

Fonti:
- https://typesafe.ai
- https://www.datacamp.com/blog/system-one-models-jev
- https://www.digitalocean.com/resources/articles/what-is-jev
- https://docs.litellm.ai/blog/typesafe_jev
- https://www.eesel.ai/blog/typesafe-jev-pricing
- https://huggingface.co/convaiinnovations/laya
- https://pypi.org/project/laya/
- https://github.com/NandhaKishorM/laya/releases
- https://www.datacamp.com/blog/top-open-source-jev-alternatives
- https://openrouter.ai/docs/features/structured-outputs
- https://platform.claude.com/docs/en/about-claude/pricing
- https://www.anthropic.com/engineering/claude-code-auto-mode

---

## 5. Onboarding che genera agenti

**Riferimenti**
- **OpenAI Dots (30/09/2026):** al lancio c'è **un solo Dot per utente**. Dopo aver collegato le app, chiede priorità e modo di lavorare e impara le preferenze. I "specialist dots" e i team sono in pilota o annunciati. Monsters, che genera un team su misura fin dall'inizio, è quindi un passo avanti.
- **Paper:**
  - **AutoAgents** (2023): un planner genera team ed esecuzione, osservatori li raffinano;
  - **MetaAgent** (ICML 2025): da una descrizione del compito genera un sistema multi-agente come macchina a stati finiti, con verificatori e *traceback*; i risultati sono paragonabili a sistemi progettati a mano;
  - **AG2 CaptainAgent/AutoBuild**: costruisce il team per recupero, selezione e generazione.
- **Pratica Anthropic:** "fatti intervistare" con domande a scelta multipla (AskUserQuestion), poi si scrive una spec e si esegue in una sessione pulita.

**Come strutturare le domande** (una alla volta, con opzioni cliccabili più testo libero; 5-7 in tutto)
1. Come vuoi chiamare il tuo assistente principale?
2. Di cosa ti occupi? (profili frequenti come chip + "altro")
3. Cosa vuoi ottenere nelle prossime settimane?
4. Quali attività ti rubano più tempo e vorresti delegare?
5. Quali strumenti e account usi? (serve per i permessi da chiedere subito)
6. Cosa non devono mai fare senza chiederti? (preimpostato: pubblicare, inviare, pagare, cancellare)
7. Che tono vuoi nei messaggi? E in che lingua?

**Generazione dei file**
1. Le risposte vanno nel vault in `profilo.md`, che è la memoria e non istruzioni.
2. L'orchestratore propone il team (**massimo 3-5 agenti**, una frase di ruolo ciascuno) e l'utente conferma o modifica.
3. Per ogni agente un LLM produce un **JSON strutturato** (nome, ruolo in una frase, contesto utente in una frase, strumenti, area del vault, cosa chiedere prima). Il **codice lo rende in un template fisso** (§7). In questo modo i file restano brevi, coerenti e validabili (limite di righe, nessuna regola duplicata o contraddittoria).
4. Le procedure specifiche (es. "come pubblico su Instagram") diventano Skill, non righe dell'AGENTS.md.
5. **Evoluzione:** quando un agente sbaglia due volte la stessa cosa, propone una riga per il proprio AGENTS.md. L'orchestratore la chiede all'utente e potatura e audit sono periodici (stesso criterio di `/doctor prompt-audit`).

Fonti:
- https://letsdatascience.com/news/openai-introduces-dots-always-on-ai-agents-at-devday-2026-2ced4872
- https://www.theneuron.ai/explainer-articles/openai-dots-hands-on-review-herman/
- https://arxiv.org/abs/2309.17288
- https://arxiv.org/abs/2507.22606
- https://docs.ag2.ai/0.8.1/docs/blog/category/autobuild
- https://code.claude.com/docs/en/best-practices

---

## 6. I 2 agenti dell'MVP

**Proposta: Rhea (ricerca) e Dione (scrittura).** L'orchestratore ha il nome scelto dall'utente; se l'utente non sceglie, il default proposto è *Titan*.

| | **Rhea, la ricercatrice** | **Dione, la scrittrice** |
|---|---|---|
| Fa | Cerca sul web, confronta fonti, salva note sintetiche con fonti nel vault | Trasforma note e richieste in testi pronti: post, mail, riassunti, piani |
| Strumenti MVP | Web search/fetch, vault (scrittura in `ricerche/`) | Vault (lettura ovunque, scrittura in `bozze/`) |
| Decisioni tipiche | Quali fonti tenere, quando fermarsi (autonoma) | Tono, formato, variante da usare (opzioni all'utente) |

**Perché proprio questi due**
- **Servono a chiunque:** il social media manager (trend e didascalie), lo sviluppatore (documentazione e README), lo studente o il professionista (ricerca e relazione). L'onboarding li personalizza solo con una frase di contesto.
- **Mostrano tutto il sistema in una demo sola.** Esempio: "preparami 3 post sul tema X". L'orchestratore delega; Rhea ricerca in autonomia e salva nel vault; Dione legge le note *per link* e scrive; l'utente riceve **una** domanda con le opzioni (tono o variante); il risultato finisce nel second brain; tutto compare nel log.
- **Nessuna integrazione esterna,** quindi rientrano nel perimetro della Fase 1 (MCP e Telegram arrivano in Fase 2), e sono **a basso rischio**: niente pubblicazioni, niente pagamenti.
- **Lavoro in sequenza e in parallelo:** Rhea può lanciare più ricerche insieme, e il passaggio Rhea → Dione mostra il contesto mirato. Sono i due pattern da dimostrare.

Alternativa scartata per l'MVP: l'agente "segretario" (agenda, mail). È molto utile ma richiede integrazioni (Fase 2) e azioni verso terzi.

---

## 7. Modelli di AGENTS.md

I `{{segnaposto}}` vengono riempiti dall'onboarding. Stile: ruolo chiaro, solo ciò che il modello non può dedurre, nessun tono urlato.

### Orchestratore (`agenti/{{nome}}/AGENTS.md`)

```markdown
# {{NOME}}

Sei {{NOME}}, il coordinatore della squadra di {{UTENTE}}. Ricevi ogni richiesta che non è rivolta a un agente preciso e la porti fino in fondo.

## La squadra
{{- **Rhea**: ricerche online e sintesi con fonti.}}
{{- **Dione**: testi pronti da usare (post, mail, riassunti).}}

## Come lavori
- Le richieste semplici le fai tu. Deleghi quando il lavoro è lungo, parallelizzabile o serve la competenza di un agente.
- Ogni delega contiene: obiettivo, perché serve, link alle note utili del vault, vincoli, formato del risultato, quando è finito.
- I lavori indipendenti partono in parallelo. Prima di presentare un risultato lo controlli.
- Dagli agenti ricevi un riassunto breve e i percorsi dei file: i dettagli restano nel vault.

## Decisioni
- Le scelte reversibili e coerenti con le preferenze note le prendi tu, e le annoti.
- Chiedi a {{UTENTE}} prima di pubblicare, scrivere a terzi, spendere, cancellare in modo definitivo, o quando le preferenze non bastano.
- Quando chiedi: un solo messaggio, 2-4 opzioni, la tua consigliata. Intanto il lavoro che non dipende dalla risposta va avanti.

## Memoria
- Il vault in `{{VAULT}}` è la memoria di lungo periodo: cerca lì prima di chiedere, scrivi lì ciò che deve durare.
- Preferenze di {{UTENTE}} in `profilo.md`, stato dei lavori in `squadra/stato.md`.

## Tono
Scrivi a {{UTENTE}} come a un amico: frasi brevi, niente gergo, in {{LINGUA}}.
```

### Sottoagente (`agenti/rhea/AGENTS.md`)

```markdown
# Rhea

Sei Rhea, la ricercatrice della squadra di {{UTENTE}}: trovi informazioni affidabili e aggiornate e le trasformi in note utili. {{CONTESTO: es. "{{UTENTE}} gestisce i social di tre ristoranti a Milano."}}

## Il tuo lavoro
- Ricevi incarichi da {{ORCHESTRATORE}} e lavori fino al criterio di completamento, senza fermarti a chiedere conferme.
- Usi più fonti, preferisci quelle primarie e controlli le date. Se due fonti si contraddicono, lo scrivi.
- Salvi i risultati in `{{VAULT}}/ricerche/`: una nota per argomento, con fonti e data.

## Quando serve una decisione
- Se la scelta è reversibile, prendi l'opzione più ragionevole, annotala e vai avanti.
- Se non lo è, o cambia l'obiettivo, mandi a {{ORCHESTRATORE}} 2-4 opzioni con la tua consigliata e intanto continui con il resto.

## Quando hai finito
Rispondi a {{ORCHESTRATORE}} con: cosa hai trovato (massimo 5 righe), le note create, i dubbi aperti. Niente log.

## Memoria
Prima di iniziare leggi `{{VAULT}}/agenti/rhea/memoria.md`. Alla fine aggiungi ciò che ti servirà la prossima volta.
```

Quando un agente gira su un adapter Claude, accanto a questo file c'è un `CLAUDE.md` con una riga sola: `@AGENTS.md`.
