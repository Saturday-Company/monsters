# 02 · Provider AI e motore degli agenti

> Ricerca del 14/10/2026. Fonti ufficiali dove esistono; dove i numeri vengono da terzi lo dico. I limiti dei free tier cambiano spesso: Monsters deve leggerli dagli header di risposta e tenerli configurabili, non scritti nel codice.

## In breve

- **OpenRouter free**: l'ID è `openrouter/free`. Supporta tool calling e structured output, ma con **50 richieste/giorno** (1.000 se si sono comprati almeno 10 $ di crediti, una volta sola) e **20 al minuto**, condivise da tutti gli agenti. In un loop agentico ogni passo con tool è una richiesta, quindi senza crediti si fanno pochi task al giorno.
- **Fallback gratuiti**: Groq e Gemini (Flash/Flash-Lite) sono i più utili; Cerebras e Mistral vanno bene come riserva. **GitHub Models è stato chiuso il 30/07/2026**.
- **Abbonamenti**: oggi si possono usare **legalmente entrambi**, ma in modi diversi.
  - **ChatGPT**: dal 29-30/09/2026 c'è "Sign in with ChatGPT". Per le app open source e locali la registrazione è self-serve, e le chiamate vanno alla Responses API sul piano Plus/Pro dell'utente. È un provider "a livello modello" e si inserisce nel nostro loop.
  - **Claude**: Monsters non può fare il login claude.ai né toccare i token OAuth. Può però avviare **Claude Code non modificato** (CLI `claude -p` o Agent SDK) dopo che l'utente ha fatto il login con il flusso di Anthropic. È un provider "a livello harness": il loop è quello di Claude Code.
- **Libreria**: **Vercel AI SDK 7** (Apache-2.0) come strato provider e loop. Il piano B è **pi-ai** (MIT). Niente Mastra né LangGraph come fondamenta.
- **Modelli locali**: è facile, perché Ollama, LM Studio e llama.cpp espongono API compatibili OpenAI. La qualità del tool calling dipende dal modello.

---

## 1. OpenRouter free router

### Come funziona
| Voce | Dettaglio |
|---|---|
| ID modello | **`openrouter/free`**. In elenco dal 01/02/2026, contesto 200K, 0 $ |
| Selezione | Analizza la richiesta, **filtra i modelli free che supportano le funzioni richieste** (immagini, tool calling, structured output) e ne **sceglie uno a caso** |
| Modello usato | Indicato nel campo `model` della risposta (es. `upstage/solar-pro-3:free`) |
| Tool calling | Sì: l'API `/models` riporta `tools` e `structured_outputs` tra i `supported_parameters` |
| Streaming | La pagina del router non ne parla. OpenRouter documenta lo streaming SSE anche con tool call, in modo uniforme tra i provider |
| Modello specifico | Si usa il suffisso `:free` sull'ID (es. `google/gemma-4-31b-it:free`) |
| Fallback | Parametro `models: [...]` in ordine di priorità: si passa al successivo in caso di errore, rate limit, contesto troppo lungo o downtime |

### Limiti (modelli `:free` e router)
| Crediti acquistati (totale storico) | Richieste/minuto | Richieste/giorno |
|---|---|---|
| meno di 10 $ | 20 | **50** |
| almeno 10 $ | 20 | **1.000** |

- Le risposte 429 della piattaforma hanno gli header `X-RateLimit-Limit/Remaining/Reset` e a volte `Retry-After`. I 429 possono arrivare anche dal provider a monte.
- Il blocco DDoS di Cloudflare scatta sui picchi anomali.
- **Conseguenza per Monsters:** il limite è per account, quindi l'orchestratore e i sottoagenti condividono 20 RPM e 50 o 1.000 RPD. Serve uno **scheduler con budget per provider**. Nell'onboarding conviene suggerire la ricarica una tantum da 10 $, che porta il limite a 1.000/giorno.

### Modelli free con tool calling (lettura live dell'API `/api/v1/models`, 14/10/2026)
| Modello | Contesto | Tools | Structured |
|---|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b:free` | 262K | ✓ | ✓ |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | ✓ | – |
| `nvidia/nemotron-3.5-lightning:free` | 1M | ✓ | – |
| `thinkingmachines/inkling:free` / `inkling-small:free` | 1M | ✓ | – |
| `poolside/laguna-s-2.1:free` / `laguna-xs-2.1:free` | 262K | ✓ | – |
| `cohere/north-mini-code:free` | 256K | ✓ | – |
| `google/gemma-4-31b-it:free` / `gemma-4-26b-a4b-it:free` | 262K | ✓ | – |
| `dots-studio/dots-3-note-preview:free` | 512K | ✓ | ✓ |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256K | ✓ | – |
| `liquid/lfm-2.5-2.6b:free` (troppo piccolo per agenti) | 65K | ✓ | ✓ |

Per gli agenti con tool punterei su Nemotron 3 Super/Ultra, Laguna S, Inkling e Gemma 4 31B. Le guide di terzi (giugno-luglio 2026) danno Laguna e Nemotron Ultra come accurati ma lenti. Il catalogo cambia di mese in mese, quindi la lista va **letta a runtime** e non scritta nel codice.

### Affidabilità e punti critici
1. **Il modello cambia a ogni richiesta.** In un loop multi-step ogni passo può finire su un modello diverso, con stile e capacità di tool calling diversi. Soluzione: il primo turno usa `openrouter/free`, poi si **fissa per la sessione** il modello letto dal campo `model`, tenendo `openrouter/free` come ultimo fallback.
2. Molti modelli free hanno **un solo host** e nessun fallback, e spariscono senza preavviso (es. Qwen3 Coder free, ritirato a luglio 2026).
3. **Privacy**: OpenRouter non conserva i prompt di default, ma secondo analisi di terzi (ottobre 2026) circa metà dei provider dei modelli free *può* usarli per l'addestramento. Le impostazioni privacy dell'account decidono se instradare verso questi provider; se sono troppo restrittive, alcune chiamate free falliscono. L'onboarding deve dirlo chiaramente.
4. Latenza più alta nelle ore di punta.

**Configurazione consigliata per la "prima chiave":**
```jsonc
{ "models": ["nvidia/nemotron-3-super-120b-a12b:free", "poolside/laguna-s-2.1:free", "openrouter/free"],
  "tools": [...], "stream": true }
```

---

## 2. Altre API gratuite come fallback

| Provider | Modelli free utili | Limiti free | Tool calling | Note |
|---|---|---|---|---|
| **Groq** | `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.8-27b` | 30 RPM · 1K RPD · **8K TPM** · 200K TPD (tabella base delle docs; i valori del proprio account sono nella console) | Buono (gpt-oss nativo) | Molto veloce. Con contesti agentici grandi il vincolo vero sono gli 8K TPM. Compatibile OpenAI |
| **Google Gemini (AI Studio)** | Gemini 3.8 Flash, 3.6 Flash, 3.5/3.1 Flash-Lite, 2.5 Pro/Flash, Gemma 4 | Pubblicati solo per progetto in AI Studio. Su forum e da terzi: **~20 RPD su 3.8 Flash, ~500 RPD su Flash-Lite**. Reset a mezzanotte (ora del Pacifico) | Ottimo (function calling nativo) | Sul free tier "Used to improve our products: **Yes**". Il Pro è solo a pagamento |
| **Cerebras** | `gpt-oss-120b`, `qwen-3.8-27b` | Free Trial: **5 RPM**, 30K TPM non in cache, 1M TPD | Buono | Free *trial*: va considerato instabile |
| **Mistral La Plateforme** | Mistral Small/Medium, Codestral, Devstral | Piano "Experiment". Mistral non pubblica i limiti (sono nel pannello Limits); da terzi: ~1 req/s, ~1B token/mese | Buono | Secondo un'analisi di terzi richiede il consenso all'uso dei dati per il training. Europeo, utile come opzione "UE" |
| **NVIDIA NIM (build.nvidia.com)** | Nemotron, Llama, Qwen, DeepSeek ecc. | ~40 RPM (dai forum NVIDIA, nessun documento ufficiale); nessun aumento possibile sul free | Dipende dal modello | Pensato per prototipi |
| **Cloudflare Workers AI** | 20+ modelli | ~10K "neurons"/giorno | Parziale | Contesti piccoli |
| ~~GitHub Models~~ | – | **Chiuso dal 30/07/2026** | – | Da escludere |

**Ordine di fallback suggerito:** OpenRouter free → Groq (gpt-oss-120b) → Gemini Flash-Lite → Cerebras → Mistral. Sono tutti compatibili OpenAI o hanno un provider ufficiale nell'AI SDK.

---

## 3. Abbonamenti consumer (Claude e ChatGPT)

### 3a. Claude (Anthropic): cosa dicono i termini oggi

Dalla pagina ufficiale *Legal and compliance* di Claude Code (letta oggi):
- **Non permesso:** "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." E inoltre: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- **Permesso:** "Nor does it prevent an end user from signing in to the **unmodified Claude Code binary** with their own Claude subscription, including where a platform hosts Claude Code." Le condizioni: il binario non va modificato né privato dei metodi di autenticazione, e l'utilizzo non va rivenduto né intermediato.
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the **Agent SDK**."
- Nella panoramica dell'Agent SDK resta la nota: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."

**Cronologia 2026**, che mostra quanto la politica sia instabile:
| Data | Evento |
|---|---|
| gen 2026 | Blocchi lato server sui token OAuth usati fuori da Claude Code |
| 20/02 | Termini aggiornati: vietati i token OAuth dell'abbonamento in tool terzi |
| 04/04 | Enforcement: OpenClaw, OpenCode e simili perdono l'accesso tramite abbonamento |
| 13/05 | Annunciato un "Agent SDK credit" mensile separato (20/100/200 $), da attivare il 15/06 |
| 15/06 | **Sospeso**: Agent SDK, `claude -p` e app di terzi basate sull'SDK continuano a usare i limiti dell'abbonamento |
| 07/10 | I piani Max e Team includono **crediti API mensili** (Max 5x 100 $, Max 20x 200 $; Team 20-100 $ a posto, massimo 500 $), validi per API, Agent SDK e Managed Agents |

**Cosa può fare Monsters con Claude, in ordine di sicurezza legale:**
1. **Chiave API** dell'utente. Per chi ha Max o Team, la chiave dell'organizzazione Console collegata al piano consuma i crediti API mensili inclusi. È un provider "a livello modello" e passa dal nostro loop. **È il percorso più pulito.**
2. **Claude Code come harness**: Monsters avvia il binario ufficiale e non modificato tramite `@anthropic-ai/claude-agent-sdk`, che include il binario, oppure `claude -p --output-format stream-json --verbose --include-partial-messages`. Il **login lo fa l'utente con il flusso Anthropic** (`claude`, poi `/login` nel terminale); Monsters non vede mai il token. È il modello di Conductor.
   - Attenzione: `--bare`, consigliato per gli script, **non legge le credenziali OAuth** e richiede `ANTHROPIC_API_KEY`. Per usare l'abbonamento bisogna avviare senza `--bare`, con `--settings`, `--mcp-config` e `--append-system-prompt` espliciti.
   - Gli strumenti di Monsters (vault, log, Telegram…) si espongono a Claude Code come **server MCP**: in-process con `createSdkMcpServer()` oppure via `--mcp-config`. I permessi passano da `canUseTool`/`permissionMode`; gli eventi dei sottoagenti arrivano con `parent_tool_use_id`.
   - Il marchio va usato come prevede la guida: "Claude Agent" o "Powered by Claude", mai "Claude Code".
3. **Vietato**: un nostro bottone "Accedi con Claude", la lettura di `~/.claude/.credentials.json`, l'uso del token OAuth sulle Messages API (`ANTHROPIC_OAUTH_TOKEN` in pi-ai, approccio OpenClaw). Anthropic dichiara che applica il divieto "without prior notice".

### 3b. ChatGPT (OpenAI): "Sign in with ChatGPT"
Annunciato al DevDay (29-30/09/2026). I partner sono 16, **Conductor compreso**, insieme a OpenCode, Pi, Warp, Devin e altri.
| Voce | Dettaglio |
|---|---|
| Chi può integrarlo | App **open source e locali: self-serve**. App commerciali o in hosting: modulo di richiesta (trial limitato) |
| Piani | Plus e Pro (secondo le fonti di terzi). L'utente imposta un **tetto settimanale per app**; al raggiungimento l'utilizzo si ferma, e l'overflow sui crediti è disattivato di default |
| OAuth | Authorization Code + PKCE, redirect loopback `http://127.0.0.1:<porta>/auth/callback` (non `localhost`). Prima registrazione con `client_id=dynamic_agent_client`, `agent_name_hint` ("Monsters") e `ext_agent_host_id` persistente per macchina. Si riceve un client id `oaiapp_…` da riusare |
| Scope | `offline_access resource.invoke chatgpt.tokens.use.direct` (+ `openid profile email`). Il token d'accesso dura circa 1 ora, il refresh va gestito dall'app |
| Inferenza | `POST https://api.openai.com/v1/responses` con bearer, **`store:false`, `stream:true`**, cronologia completa in `input`. Elenco modelli con `GET /v1/models` (filtrare `visibility:"list"`) |
| Limiti tecnici | Niente `temperature`, `max_output_tokens`, `previous_response_id` via HTTP, messaggi `role:system` (si usano `instructions`). Function e custom tool **sì, ma raggruppati in namespace o passati come `additional_tools`**. Non disponibili: MCP ospitato, file search, Code Interpreter, image generation |
| Alternativa harness | `@openai/codex-sdk` / Codex app-server con `codex login`, lo stesso schema di Claude Code |

**Per Monsters:** ChatGPT diventa un **provider a livello modello** (Responses API) dentro il nostro loop. Va scritto un piccolo adattatore che imposti `store:false`, tolga i parametri non supportati e raggruppi i tool in un namespace. Si può fare con un `fetch` personalizzato sopra `@ai-sdk/openai`; pi-ai lo supporta già nel suo provider `openai`. Il core open source va registrato come client open source. **Quando arriverà il cloud a pagamento (Fase 4) servirà il modulo per le app commerciali.**

### 3c. Cosa fa Conductor
Integra i binari di **Claude Code e Codex** (o usa quelli di sistema) e li fa girare con **il login locale dell'utente** (`claude /login`, `codex login`) oppure con le chiavi API. Non fattura né rivende l'utilizzo. È anche partner di Sign in with ChatGPT. Monsters può adottare lo stesso schema.

---

## 4. Libreria per il loop agentico multi-provider (TypeScript)

| | **Vercel AI SDK 7** | **OpenAI Agents SDK JS** | **Mastra** | **LangGraph.js** | **pi-ai + pi-agent-core** | **Loop proprio** |
|---|---|---|---|---|---|---|
| Versione | `ai` 7.0.140 (14/10/26) | 0.20.0 (pre-1.0) | `@mastra/core` 1.77 | 1.5.0 | 1.2.0 (12/10/26) | – |
| Licenza | Apache-2.0 | MIT | Apache-2.0 + **`ee/` sotto licenza enterprise** | MIT | MIT | nostra |
| Multi-provider | ✓✓ provider ufficiali OpenAI, Anthropic, Google, Mistral, openai-compatible; **OpenRouter ufficiale** (`@openrouter/ai-sdk-provider` 3.1, per v7); Ollama community | OpenAI prima di tutto; gli altri via adattatore `aisdk()` (**beta**) | ✓✓ (si appoggia all'AI SDK, router "provider/model") | ✓ via `@langchain/*` | ✓✓ circa 35 provider (OpenRouter, Mistral, Groq, Cerebras, NIM, Google, Anthropic, OpenAI, Ollama, LM Studio, llama.cpp…) | quanto ne scriviamo |
| Tool calling + streaming | ✓ `ToolLoopAgent`, `prepareStep`, **tool approval** (anche firmate HMAC), contesto runtime tipizzato | ✓ handoff, guardrail, tracing | ✓ | ✓ grafi, checkpoint | ✓ streaming anche degli argomenti dei tool, catalogo solo con modelli che supportano i tool | da fare |
| Client MCP | ✓ `@ai-sdk/mcp` (stdio, HTTP, SSE, OAuth, elicitation; "leggero") | ✓ | ✓ `@mastra/mcp` | ✓ adattatori | **✗ (scelta di design)**, si aggiunge `@modelcontextprotocol/sdk` | SDK MCP ufficiale |
| Abbonamenti | `HarnessAgent` **sperimentale** con adattatori Claude Code, Codex, Pi e OpenCode, pensati per sandbox cloud | Codex no | – | – | **Sign in with ChatGPT** nel provider `openai`; OAuth Anthropic presente ma **vietato dai ToS** | da fare |
| Peso | `ai` + 3 dipendenze; un pacchetto per provider | leggero | **pesante** (30 dipendenze, ~76 MB) | medio-pesante (LangChain) | medio (SDK dei provider caricati in lazy) | minimo |
| Maturità | ~27K stelle, 16M download/settimana, rilasci giornalieri | ~3,9K stelle | ~28,8K stelle | ~3,4K stelle | repo `earendil-works/pi` ~115K stelle; **cambio di scope npm a maggio 2026** | – |
| Adatto a Monsters? | **Sì, come base** | No (vincolato a OpenAI) | No come base: framework opinionato, e abbiamo già UI, memoria e orchestratore nostri | No: troppo per i nostri bisogni | **Piano B** valido | Solo il sottile strato di orchestrazione |

**Scelta:** AI SDK 7 per lo strato provider e per il loop di ogni agente. Sopra ci va il nostro orchestratore, cioè il codice che fa davvero Monsters (team, deleghe, kill switch, log). Motivi:
- ecosistema più ampio, con provider ufficiali per tutte le API a consumo;
- provider OpenRouter mantenuto da OpenRouter;
- client MCP integrato;
- tool approval e callback di lifecycle comode per **log delle azioni e kill switch** (con `AbortSignal`);
- licenza Apache-2.0.

pi-ai resta il riferimento per l'adattatore ChatGPT e il ripiego se l'AI SDK diventasse troppo legato a Vercel.

---

## 5. Modelli locali (opzionali)

| Runtime | Integrazione con AI SDK 7 | Tool calling |
|---|---|---|
| **Ollama** | `ai-sdk-ollama` (client ufficiale Ollama, "reliable tool calling") o `ollama-ai-provider-v2`, entrambi per `ai@^7`; in alternativa `@ai-sdk/openai-compatible` su `http://localhost:11434/v1` | Dipende dal modello: con schemi complessi (`anyOf`, `$ref`) i modelli piccoli sbagliano. Servono schemi piatti |
| **LM Studio** | `@ai-sdk/openai-compatible`, `baseURL: http://localhost:1234/v1` (documentato) | Dipende dal modello |
| **llama.cpp (`llama-server`)** | `@ai-sdk/openai-compatible` su `/v1` | Richiede i template chat corretti (`--jinja`) |
| vLLM | `@ai-sdk/openai-compatible` | Buono con parser dedicati |

È **facile**: con un solo adattatore "OpenAI-compatible" più l'auto-rilevamento (`GET /v1/models` o `/api/tags` sulle porte note) si coprono tutti. Il limite vero è la qualità: sotto i ~20-30B parametri il tool calling multi-step non è affidabile. Li proporrei per compiti leggeri (classificazione, riassunti, embedding del second brain) e non per l'orchestratore.

---

## Raccomandazione per Monsters

**1. Libreria:** **Vercel AI SDK 7**, insieme a `@openrouter/ai-sdk-provider`, `@ai-sdk/{openai,anthropic,google,mistral,openai-compatible}`, `@ai-sdk/mcp` e `ai-sdk-ollama`. Per gli abbonamenti Claude e Codex: `@anthropic-ai/claude-agent-sdk` e `@openai/codex-sdk`, usati direttamente. Rinvierei `HarnessAgent` finché resta sperimentale e orientato alle sandbox cloud.

**2. Interfaccia provider.** Ci sono due tipi di provider: "modello" (il loop è nostro) e "harness" (il loop è di Claude Code o Codex). L'orchestratore vede solo `AgentEvent`.
```ts
type AgentEvent =
  | { type: 'text'; delta: string } | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; output: unknown; isError?: boolean }
  | { type: 'usage'; model: string; inTok: number; outTok: number; costUsd?: number }
  | { type: 'done'; reason: 'stop' | 'max-steps' | 'aborted' | 'error'; error?: string };

interface ProviderBase {
  id: string;                                   // 'openrouter-free' | 'groq' | 'chatgpt' | 'claude-code' | 'ollama' ...
  auth: 'none' | 'api-key' | 'oauth-siwc' | 'external-login';
  listModels(): Promise<{ id: string; tools: boolean; free: boolean; context: number }[]>;
  budget(): { rpm?: number; rpd?: number; remaining?: number; resetAt?: Date }; // aggiornato dagli header
}
interface ModelProvider extends ProviderBase {   // API gratuite, a consumo, ChatGPT (SIWC), locali
  kind: 'model';
  model(id: string): import('ai').LanguageModel; // usato dal nostro loop (ToolLoopAgent/streamText)
}
interface HarnessProvider extends ProviderBase { // Claude Code (Agent SDK), Codex (codex-sdk)
  kind: 'harness';
  run(task: { prompt: string; cwd: string; mcpServers: Record<string, unknown>; resume?: string },
      signal: AbortSignal): AsyncIterable<AgentEvent>;
}
type Provider = ModelProvider | HarnessProvider;
```
Ogni agente ha una **catena di fallback** (`Provider + modello`) e un modello fissato per sessione. Un **RateBudget per provider**, condiviso da tutti gli agenti, mette in coda le richieste invece di farle fallire.

**3. Come integrare gli abbonamenti**
- **ChatGPT**: un provider `chatgpt` di tipo modello. Il login OAuth "Sign in with ChatGPT" è fatto da noi, nel modo consentito alle app open source locali: loopback 127.0.0.1 e token salvati nel portachiavi del sistema. Le chiamate vanno alla Responses API con l'adattatore descritto al §3b. Per SSH e Telegram il login va fatto una volta sulla macchina principale.
- **Claude**: un provider `claude-code` di tipo harness. Monsters controlla che Claude Code sia autenticato; se non lo è, dice all'utente di eseguire `claude` e poi `/login` nel terminale, senza alcun login nella nostra UI. Usa l'Agent SDK senza `--bare` e gli passa gli strumenti di Monsters come server MCP. In alternativa, per chi ha Max o Team, si inserisce la chiave API con i crediti mensili inclusi e Claude torna a essere un provider normale del nostro loop.
- Sia "Claude" sia "ChatGPT" vanno mostrati come **opzionali** e mai indispensabili: la prima esperienza resta OpenRouter free.

**4. Rischi**
| Rischio | Mitigazione |
|---|---|
| Politica Anthropic instabile (4 cambi nel 2026, applicati senza preavviso) | Solo il binario ufficiale con il login dell'utente; percorso con chiave API sempre disponibile; nessun token toccato |
| Sign in with ChatGPT è in "preview": parametri e limiti possono cambiare; un Monsters a pagamento richiederà l'approvazione commerciale | Adattatore isolato; modulo d'interesse prima della Fase 4 |
| Free tier stretti (50 RPD su OpenRouter, 8K TPM su Groq, ~20 RPD su Gemini Flash) | Budget e coda condivisi, catena di fallback, suggerimento dei 10 $ su OpenRouter, modelli piccoli per i compiti semplici |
| `openrouter/free` cambia modello a ogni chiamata | Modello fissato per sessione e catena `models` |
| Privacy dei modelli free (training sui prompt) | Avviso nell'onboarding; per il vault e i dati sensibili, provider senza training o modelli locali |
| Gli harness (Claude Code, Codex) hanno strumenti e permessi propri, al di fuori del nostro controllo | Configurazione esplicita (`--settings`, `--mcp-config`, `permissionMode`); log dagli eventi stream-json; kill con SIGINT o `interrupt()` |
| AI SDK in rapida evoluzione (v6→v7 in pochi mesi) | Versioni bloccate; tutto passa dalla nostra interfaccia `Provider` |
| Modelli locali deboli nel tool calling | Usarli solo per compiti leggeri; schemi dei tool semplici |

> **Nota collaterale (per la ricerca sul "system one model"):** pi-ai espone i modelli classificatori **TypeSafe Jev** (`typesafe/jev-1.13` anche su OpenRouter) e OpenAI `gpt-6-luna`, pensati proprio per decisioni rapide e tipizzate.

---

## Fonti
- OpenRouter free router: https://openrouter.ai/docs/guides/routing/routers/free-router · pagina modello: https://openrouter.ai/openrouter/free
- OpenRouter limiti: https://openrouter.ai/docs/api/reference/limits · fallback: https://openrouter.ai/docs/guides/routing/model-fallbacks · tool calling: https://openrouter.ai/docs/guides/features/tool-calling · privacy: https://openrouter.ai/docs/guides/privacy/data-collection · elenco modelli live: https://openrouter.ai/api/v1/models
- Confronto free API (OpenRouter, set. 2026): https://openrouter.ai/blog/tutorials/free-llm-apis-compared/ · analisi privacy dei modelli free: https://www.truefoundry.com/es/blog/openrouter-free-models-whats-actually-free-and-what-it-costs-you
- Gemini pricing/free tier: https://ai.google.dev/gemini-api/docs/pricing · rate limit: https://ai.google.dev/gemini-api/docs/rate-limits · forum "20 RPD": https://discuss.ai.google.dev/t/gemini-3-8-flash-free-tier-20-rpd-is-too-limited-for-practical-evaluation/180609
- Groq: https://console.groq.com/docs/rate-limits · Cerebras: https://inference-docs.cerebras.ai/support/rate-limits · Mistral (terzi): https://benchlm.ai/md/free-tier/mistral.md · NVIDIA (forum): https://forums.developer.nvidia.com/t/request-for-nvidia-nim-api-rate-limit-increase-40-200-rpm/375340 · GitHub Models ritirato: https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models
- Anthropic, termini e autenticazione: https://code.claude.com/docs/en/legal-and-compliance · Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview · TS: https://code.claude.com/docs/en/agent-sdk/typescript · headless: https://code.claude.com/docs/en/headless
- Anthropic, abbonamento e SDK: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan · crediti API Max/Team: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers · cronologia: https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch · https://www.mindstudio.ai/blog/anthropic-openclaw-ban-oauth-authentication
- Sign in with ChatGPT: https://developers.openai.com/siwc · open source: https://developers.openai.com/siwc/token-sharing-open-source · registrazione: https://developers.openai.com/siwc/token-sharing-open-source/sign-in · modelli: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference · limitazioni: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations · annuncio: https://thenewstack.io/sign-in-with-chatgpt/ · riepilogo: https://www.eesel.ai/blog/sign-in-with-chatgpt
- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk
- Conductor: https://www.conductor.build/docs/reference/harnesses/claude-code · https://www.conductor.build/docs/reference/harnesses/codex
- AI SDK 7: https://vercel.com/blog/ai-sdk-7 · MCP: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools · harness: https://ai-sdk.dev/v7/docs/ai-sdk-harnesses · https://ai-sdk.dev/providers/ai-sdk-harnesses/claude-code · Ollama: https://ai-sdk.dev/providers/community-providers/ollama · LM Studio: https://ai-sdk.dev/providers/openai-compatible-providers/lmstudio
- OpenAI Agents JS e adattatore AI SDK: https://openai.github.io/openai-agents-js/extensions/ai-sdk/
- Mastra, licenza: https://mastra.ai/docs/license
- pi: https://pi.dev/changelog/2026/5/7/pi-has-a-new-home · https://www.npmjs.com/package/@earendil-works/pi-ai
- Versioni, licenze e stelle: registry npm e API GitHub, consultati il 14/10/2026
