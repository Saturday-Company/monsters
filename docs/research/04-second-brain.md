# 04 · Second brain: vault Markdown/Obsidian, ricerca locale, reversibilità

> Ricerca del 14/10/2026 per Monsters (hub agentico locale, TypeScript, Node 22+/Bun, Linux/macOS/Windows, anche senza GPU).
> Le fonti sono alla fine di ogni sezione. Le misure marcate **[test locale]** le ho fatte sulla macchina di sviluppo (CPU desktop, niente GPU, Node 22.22.1, Bun 1.4.2, transformers.js 4.3.1). Sono indicative: una sola esecuzione, 64 testi da circa 100 token.

---

## 1. Approcci esistenti: cosa funziona e cosa no

| Progetto | Come funziona | Cosa funziona | Cosa non va per Monsters |
|---|---|---|---|
| **basic-memory** (Basic Machines) | File Markdown come fonte di verità, indice SQLite (anche Postgres), ricerca ibrida FTS + vettori (FastEmbed), reranker opzionale. Sintassi per "osservazioni" `- [categoria] testo #tag` e "relazioni" `- tipo [[Nota]]`. Circa 20 tool MCP (`write_note`, `read_note`, `edit_note`, `move_note`, `delete_note`, `search_notes`, `build_context`, `recent_activity`…). 4,2k stelle, v0.23. | È il modello più vicino al nostro: file in chiaro e indice ricostruibile, compatibile con Obsidian, sincronizzazione bidirezionale, `build_context` che segue i link. | È in Python e con licenza **AGPL-3.0**: si può prendere come ispirazione, non come codice da incorporare. La sintassi delle osservazioni pesa sull'utente medio. |
| **MCP Obsidian via Local REST API** (cyanheads/obsidian-mcp-server, mcp-obsidian, fazer-ai…) | Plugin community "Local REST API" (porta 27124, API key) e un server MCP che fa da ponte. | Lavora sull'app viva: link aggiornati da Obsidian, nota attiva, comandi. | Serve **Obsidian aperto**, più un plugin e una chiave. È fragile per agenti che lavorano in background o da remoto. |
| **Obsidian CLI ufficiale** (1.12, feb 2026) | Comandi `search`, `read`, `create`, `move`/`rename` (aggiornano i link), `delete` (cestino), `backlinks`, `tags`, `properties`, output JSON. | È ufficiale, gestisce bene i link ed è utile come integrazione opzionale. | Comunica via IPC con **l'app desktop in esecuzione**. Su Linux serve un wrapper. `delete` ignora l'impostazione "Deleted files". |
| **Obsidian Headless** (feb 2026) | Client Node 22+ per Obsidian Sync senza app. | Utile a chi ha già Sync. | Richiede l'abbonamento Sync. Non è un'API per le note. |
| **Filesystem MCP** | Il vault trattato come cartella. | È semplicissimo. | Niente indice, niente link, niente tag. |
| **Smart Connections** | Plugin Obsidian con embedding locali (modello incluso, opzionalmente Ollama) salvati in `.smart-env/`. | Dimostra che le "note correlate" sono la funzione semantica più apprezzata. Indicizza in modo incrementale. | Dal 2026 la licenza è **source-available** (Smart Plugins License, vieta l'uso in prodotti concorrenti). Mette i dati dentro il vault. |
| **Khoj** | Server Python (Postgres+pgvector) con client Obsidian/desktop. Licenza AGPL. Il cloud è stato chiuso ad aprile 2026. | Chat sulle note, modelli locali. | Lo stack è pesante, troppo per un "PC normale". La chiusura del cloud mostra quanto costi mantenerlo. |
| **Letta / MemGPT** | "Memory blocks" sempre nel contesto (modificabili dall'agente) più un archivio esterno. Letta Code (mar 2026) ha una memoria **su git**. | Il loro benchmark: un agente con **solo file e ricerca** arriva al 74% su LoCoMo, quanto i sistemi di memoria dedicati. | Il runtime è suo. Per noi conta il principio: blocchi piccoli sempre in contesto, il resto si cerca. |
| **Claude Code memory** | `CLAUDE.md` gerarchici più "auto memory": un indice `MEMORY.md` (si caricano solo le prime 200 righe o 25 KB) e un file per argomento, letto quando serve. | Pattern provato: **indice corto sempre caricato e dettagli su richiesta**. | Riguarda un solo progetto e non ha un indice di ricerca. |
| **Anthropic memory tool** (`memory_20250818`) | È lato client: una directory `/memories` con i comandi `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. | I modelli Claude sono addestrati su questa interfaccia. Conviene riprenderne la semantica (soprattutto `str_replace`). | Gestisce solo file: niente ricerca, tag o link. |
| **mem0 / OpenMemory** | Un LLM estrae "fatti" che finiscono in un vector store (più un grafo opzionale). Apache-2.0. | L'estrazione automatica dei fatti dalle conversazioni. | La memoria è opaca e illeggibile per l'utente: va contro l'idea del vault. Ne prendiamo solo l'idea di un "consolidatore" che scrive note. |
| **qmd** (Tobi Lütke, MIT, 30k stelle) | TS su Node/Bun: SQLite FTS5 + sqlite-vec + embedding EmbeddingGemma (GGUF), espansione della query (1,7B) e reranker Qwen3 0,6B, fusione RRF k=60. Server MCP. | È **l'architettura di riferimento** per la ricerca: chunk di circa 900 token con overlap del 15%, tagliati sui titoli; RRF; reranking. | I modelli pesano circa 2 GB e girano su llama.cpp. Come default su CPU è troppo. |

**In sintesi**
1. I file Markdown sono la fonte di verità e l'indice si può sempre ricostruire: lo fanno tutti quelli che funzionano (basic-memory, qmd, Smart Connections).
2. Non dipendere da Obsidian aperto: l'integrazione con l'app (CLI o REST) è un extra, non la base.
3. Un filesystem con buona ricerca basta (Letta). La complessità va nella qualità della ricerca e nelle convenzioni, non in un "memory engine".
4. Memoria degli agenti come in Claude Code: un indice corto sempre in contesto più note lette quando servono.
5. Nessuno dei progetti open source maturi ha una licenza compatibile con l'incorporamento (AGPL o source-available). Lo scriviamo noi, ed è un modulo piccolo.

Fonti: [basic-memory](https://github.com/basicmachines-co/basic-memory) · [guida MCP Obsidian 2026](https://mcp.directory/blog/obsidian-mcp-complete-guide-2026) · [cyanheads/obsidian-mcp-server](https://gittrend.io/repo/cyanheads/obsidian-mcp-server) · [Obsidian CLI](https://obsidian.md/help/cli) · [Obsidian Headless](https://obsidian.md/changelog/2026-02-27-sync) · [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) · [Khoj review 2026](https://www.promptquorum.com/power-local-llm/khoj-ai-second-brain-review) · [Letta: "Is a filesystem all you need?"](https://www.letta.com/blog/benchmarking-ai-agent-memory) · [Letta: our next phase](https://www.letta.com/blog/our-next-phase) · [Claude Code memory](https://code.claude.com/docs/en/memory) · [Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) · [mem0 2026](https://rywalker.com/research/mem0) · [qmd](https://github.com/tobi/qmd)

---

## 2. Ricerca full-text locale in TypeScript

| Opzione | Tipo | Pro | Contro | Verdetto |
|---|---|---|---|---|
| **SQLite FTS5** via `bun:sqlite` | Integrato in Bun | Bun 1.4.2 include **SQLite 3.53.2** con FTS5 **[test locale]**. Nessuna dipendenza. BM25 con pesi per colonna, `snippet()`/`highlight()`, prefissi, query booleane, tokenizer `trigram` per le sottostringhe. | Su macOS Bun usa la SQLite di sistema, che **non carica estensioni** (sqlite-vec): serve `Database.setCustomSQLite`. | ✅ Scelta, se il runtime è Bun |
| **SQLite FTS5** via `node:sqlite` | Integrato in Node | Senza flag da Node 22.13, "release candidate" (stabilità 1.2) da 25.7 (docs v26). FTS5 abilitato **[test locale]**, `loadExtension` con `allowExtension`. | Node 22.22 include **SQLite 3.46.1** **[test locale]**: c'è il CVE di FTS5 corretto in 3.53.2 (rischio basso, perché l'indice è nostro) e su Node 22 compare un warning "experimental". | ✅ Scelta, se il runtime è Node (meglio Node ≥ 24) |
| **better-sqlite3** | Addon nativo | È il driver Node più maturo e veloce, con SQLite incluso (FTS5 e `loadExtension` ovunque, anche su macOS). | Va compilato o preso da prebuild per ogni ABI (dolore con Electron e versioni nuove di Node). Non va su Bun. | Fallback |
| **MiniSearch** 7.x (MIT) | In memoria, JS puro | Fuzzy, prefissi, boost per campo, add/remove incrementali, piccolo. | Tutto in RAM, da serializzare a mano. Niente stemming italiano. | Buono per l'autocomplete nella UI |
| **FlexSearch** 0.8 (Apache) | JS, molto veloce | Indici persistenti (SQLite/IndexedDB/Redis…), tag, ricerca fonetica. | Lingue integrate: solo en/de/fr. API complessa, manutenzione affidata a una sola persona. | No |
| **Orama** (Apache, 10,6k stelle) | JS, in memoria | Full-text BM25, vettori e **ibrida** in una sola libreria, stemming in 30 lingue. | L'indice sta in RAM e va serializzato. Un secondo archivio da tenere allineato. | Valida alternativa "tutto JS", ma SQLite unifica meglio |
| **Tantivy** (binding Node) | Rust via napi | Motore di livello Lucene. | Solo binding di terze parti poco diffusi (`@oxdev03/node-tantivy-binding`) e un binario nativo per piattaforma. | No |

**Scelta: SQLite FTS5** nello stesso database che contiene metadati, tag, link e vettori. È un solo file, transazionale, interrogabile con SQL (tag, cartelle, date, backlink con CTE ricorsive) e senza server.

Dettagli pratici:
- Tokenizer `unicode61 remove_diacritics 2`: "citta" trova "città" **[test locale]**. Una seconda tabella FTS5 `trigram` (opzionale) per le ricerche parziali dentro le parole ("getta" trova "progettazione") **[test locale]**.
- **Italiano**: FTS5 non ha uno stemmer italiano (il tokenizer `porter` è inglese). La soluzione è una colonna `body_stem` riempita in JS con lo Snowball italiano: si stemma la query allo stesso modo e si cerca su entrambe le colonne. Nell'MVP bastano query con prefisso (`progett*`).
- Pesi BM25: `bm25(fts, 10.0 titolo, 8.0 alias, 5.0 tag, 3.0 titoli di sezione, 1.0 corpo)`.
- Driver dietro un'interfaccia `Db` minima (`prepare/run/all/get/exec/transaction`), con implementazioni `bun:sqlite` → `node:sqlite` → `better-sqlite3`.

Fonti: [node:sqlite docs (v26)](https://nodejs.org/api/sqlite.html) · [CVE FTS5 < 3.53.2](https://linux.oracle.com/cve/CVE-2026-11822.html) · [Bun loadExtension/macOS](https://bun.sh/reference/bun:sqlite/Database/loadExtension) · [SQLite FTS5](https://sqlite.org/fts5.html) · [better-sqlite3](https://cdn.jsdelivr.net/gh/wiselibs/better-sqlite3@master/README.md) · [MiniSearch](https://github.com/lucaong/minisearch) · [FlexSearch](https://github.com/nextapps-de/flexsearch) · [Orama](https://github.com/oramasearch/orama) · [confronto Fuse/FlexSearch/Orama 2026](https://www.pkgpulse.com/guides/fusejs-vs-flexsearch-vs-orama-client-side-search-2026)

---

## 3. Ricerca semantica locale

### 3.1 Modelli di embedding (multilingue, CPU)

| Modello | Parametri | Dim | MMTEB multilingue retrieval¹ | Contesto | Licenza | Velocità CPU **[test locale]**² | RAM processo² | Note |
|---|---|---|---|---|---|---|---|---|
| **granite-embedding-97m-multilingual-r2** (IBM, apr 2026) | 97M | 384 | **60,3** | **32K** | **Apache-2.0** | fp32: 11,5 doc/s · **quint8: 45,8 doc/s** | 0,76 GB (q8) | Italiano tra le 52 lingue "potenziate". ONNX ufficiale (`onnx/model_quint8_avx2.onnx`, 98 MB). Pooling CLS, nessun prefisso. Su transformers.js funziona con `model_file_name` |
| granite-embedding-311m-multilingual-r2 | 311M | 768 (Matryoshka) | 65,2 | 32K | Apache-2.0 | n.d. | n.d. | La scelta "qualità alta" |
| **EmbeddingGemma-300m** (Google) | 308M | 768 (→512/256/128) | 62,5 | 2K | **Gemma Terms** (non OSI, va accettata) | q8: 13,8 doc/s | 2,7 GB | Prefissi obbligatori (`task: search result \| query:`). Niente fp16. Default di qmd e Ollama |
| **multilingual-e5-small** | 118M | 384 | 50,9 | 512 | MIT | **q8: 99,8 doc/s** · fp32: 70 doc/s | 0,66 GB | È il più veloce, ma la qualità è nettamente più bassa. Prefissi `query:`/`passage:` |
| Qwen3-Embedding-0.6B | 596M | fino a 1024 | n.d. (70,7 MTEB eng) | 32K | Apache-2.0 | n.d. (pesante su CPU) | ~1,5 GB | Disponibile in Ollama |
| bge-m3 | 568M | 1024 (+sparse) | sotto 56 | 8K | MIT | n.d. | >2 GB | Ormai superato dai modelli 2026 più piccoli |
| nomic-embed-text-v2 (MoE) | 475M (305M attivi) | 768 | n.d. | 512 | Apache-2.0 | n.d. | n.d. | Del 2025 |
| jina-embeddings-v5-text-small/nano | 677M / 239M | — | 67,0 (MMTEB) | — | **CC-BY-NC** | — | — | ❌ Non commerciale |
| bekko-embedding-v1 (lug 2026) | 8–25M attivi | — | 56,2–57,5 | — | MIT | 134–364 doc/s (OpenVINO) | — | Promettente ma nuovissimo. Da tenere d'occhio |

¹ Valori dichiarati da IBM (tabella del blog Granite R2, 18 task); per bge-m3 il dato viene dal blog bekko. ² Un batch di 64 testi da circa 100 token, CPU desktop, transformers.js 4.3.1 su Node 22, CPU. I chunk veri da 300–900 token sono più lenti.

Sul test di ranking in italiano (8 note, 4 domande come "quanto spendiamo in pubblicità" → "Budget marketing Q4") **tutti e tre** i modelli provati hanno messo la nota giusta al primo posto.

**Scelta**: **granite-embedding-97m-multilingual-r2 quantizzato** come default. È Apache-2.0 (redistribuibile senza clausole), pesa circa 100 MB, ha qualità vicina a EmbeddingGemma, va 3,3 volte più veloce e usa 3,5 volte meno RAM, e accetta 32K token di contesto. Profilo "lite" per PC deboli: multilingual-e5-small q8. Se l'utente ha già **Ollama**, il provider di embedding può usare `/api/embed` (embeddinggemma, qwen3-embedding).

Stima per l'indicizzazione iniziale: un vault da 2.000 note (circa 5.000 chunk) richiede qualche minuto in background. Gli aggiornamenti sono incrementali per hash del contenuto.
Da verificare: velocità della variante `quint8_avx2` su Apple Silicon/ARM; se è lenta si usa il fp32 o la variante OpenVINO.

### 3.2 Runtime di inferenza

| Opzione | Pro | Contro | Verdetto |
|---|---|---|---|
| **transformers.js v4** (`@huggingface/transformers`) | Funziona su Node, Bun e Deno. ONNX Runtime con CPU e, dalla v4, WebGPU anche in Node. Scarica i modelli da HF in cache. API `pipeline('feature-extraction')`. | Il pacchetto con onnxruntime-node pesa (centinaia di MB di binari). | ✅ Default |
| onnxruntime-node diretto | Più controllo, meno strati. | Tokenizer e pooling da gestire a mano. | Solo per ottimizzare in seguito |
| fastembed-js | API comoda. | È un port della community, non ufficiale Qdrant. | No |
| node-llama-cpp (GGUF) | Usato da qmd. Permette anche reranker ed espansione della query. | Binari nativi pesanti. | Fase 3 (reranker) |
| Ollama `/api/embed` | Zero lavoro se è già installato, usa la GPU se c'è. | È una dipendenza esterna. | Provider opzionale |

### 3.3 Archivio dei vettori

| Opzione | Pro | Contro | Verdetto |
|---|---|---|---|
| **BLOB in SQLite + KNN esatto in JS** | Nessuna dipendenza. Stesso DB e stessa transazione dell'FTS. 30.000 chunk × 384 dim = 46 MB, **15 ms a query** in JS puro **[test locale]**. | Lineare: oltre circa 200.000 chunk rallenta. | ✅ MVP / Fase 2 |
| **sqlite-vec** (MIT/Apache, 8,2k stelle) | Tabelle virtuali `vec0`, colonne di metadati e partizione, quantizzazione int8/bit, IVF/DiskANN in sviluppo. | Pre-v1 (ci saranno breaking change). Bun su macOS non carica estensioni senza una SQLite custom. | Upgrade quando il vault diventa grande |
| LanceDB (Apache) | Embedded, ANN e FTS, versioning. | Un secondo motore e un secondo formato su disco. Binari Rust pesanti. | No (sovradimensionato) |
| Orama | Ibrido in JS. | Indice in RAM, un secondo archivio. | No |
| hnswlib-node | ANN veloce. | Addon nativo, solo vettori. | No |

### 3.4 Ricerca ibrida

- **RRF** (Reciprocal Rank Fusion, k=60): `score = Σ 1/(60 + rank_i)` sulle liste FTS5 e vettoriale (top 50 ciascuna). Non richiede di normalizzare i punteggi ed è usata da qmd e basic-memory.
- Correttivi leggeri: +peso alla query originale, bonus a chi è primo in una lista (come qmd), filtri SQL prima della fusione (tag, cartella, tipo, data).
- Il **chunking** segue i titoli Markdown (circa 500–900 token, overlap 10–15%). Il titolo della nota e il percorso delle sezioni vanno anteposti al chunk prima dell'embedding.
- Si risale alla nota aggregando i chunk (max score) e si restituisce lo snippet del chunk migliore.
- Fase 3: reranker cross-encoder (qwen3-reranker-0.6b o jina-reranker-v1-tiny) sui primi 30 risultati, solo se la CPU regge.

Fonti: [Granite Embedding Multilingual R2](https://huggingface.co/blog/ibm-granite/granite-embedding-multilingual-r2) · [model card granite-97m](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2) · [EmbeddingGemma](https://huggingface.co/google/embeddinggemma-300m) · [blog EmbeddingGemma](https://huggingface.co/blog/embeddinggemma) · [ONNX EmbeddingGemma](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) · [bekko-embedding](https://huggingface.co/blog/hotchpotch/bekko-embedding) · [jina v5 (licenza)](https://jina.ai/models/jina-embeddings-v5-text-small/) · [modelli locali per RAG 2026](https://d-central.tech/local-embedding-models/) · [transformers.js releases](https://github.com/huggingface/transformers.js/releases) · [sqlite-vec](https://github.com/asg017/sqlite-vec) · [LanceDB TS](https://noqta.tn/en/tutorials/lancedb-typescript-embedded-vector-search-nextjs-2026) · [Ollama embeddings](https://techsy.io/it/blog/eseguire-modelli-embedding-in-locale-con-ollama) · [qmd (RRF/chunking)](https://github.com/tobi/qmd)

---

## 4. Parsing Markdown/Obsidian e compatibilità

### 4.1 Cosa definisce Obsidian (da rispettare)

| Elemento | Regola |
|---|---|
| Frontmatter (Properties) | YAML in testa al file. Proprietà predefinite: `tags`, `aliases`, `cssclasses` (liste). `tag`, `alias` e `cssclass` sono deprecate dalla 1.4 e **non più supportate come predefinite dalla 1.9**. Tipi: Text, List, Number, Checkbox, Date (`YYYY-MM-DD`), Date & time (`YYYY-MM-DDTHH:mm:ss`), Tags. **I link nelle proprietà vanno tra virgolette**: `rel: "[[Marco]]"`. A una proprietà corrisponde un solo tipo in tutto il vault. |
| Link | `[[Nota]]`, `[[Nota\|testo]]`, `[[Nota#Titolo]]`, `[[Nota#^id-blocco]]`, `[[#Titolo]]`. Embed: `![[Nota]]`, `![[img.png\|300]]`. Link Markdown: `[testo](Nota%20x.md)`. |
| Risoluzione | Formato "shortest" per default: basta il nome del file se è unico nel vault, altrimenti serve il percorso. Gli alias in `aliases` servono ad autocompletamento e ricerca, ma il link punta al file. |
| Tag | `#tag` inline o `tags:` nel frontmatter. Gerarchici con `/` (`#progetto/monsters`). Non possono essere solo numeri. |
| Caratteri da evitare nei nomi | `# \| ^ : %% [[ ]]`, più quelli vietati dai sistemi operativi (`\ / ? * " < >`). |
| ID blocco | `^id` con sole lettere latine, numeri e trattini. |
| Cartella `.obsidian/` | Configurazione (`app.json`, `core-plugins.json`, `daily-notes.json`, `templates.json`, `workspace.json`…). **Monsters non la tocca**, tranne alla creazione del vault. |
| `.trash/` | Cestino locale (opzione "Deleted files → Obsidian trash"), nascosto nell'app. |
| Rinomina | Con "Automatically update internal links" attivo, Obsidian aggiorna i link **solo se la rinomina avviene dentro Obsidian**. Se rinominiamo noi, i link li aggiorniamo noi. |
| Bases (`.base`) | Viste tipo database definite in YAML: le lasciamo intatte e le indicizziamo solo come file. |

Configurazione iniziale proposta per `.obsidian/app.json` alla creazione del vault: `useMarkdownLinks: false`, `newLinkFormat: "shortest"`, `alwaysUpdateLinks: true`, `trashOption: "local"`, `attachmentFolderPath: "Allegati"`, `newFileLocation: "folder"`, `newFileFolderPath: "Inbox"`. I nomi delle chiavi vanno verificati su un vault reale prima di scriverli.

### 4.2 Librerie

| Compito | Libreria | Nota |
|---|---|---|
| Frontmatter | **`yaml`** (eemeli) con l'API `Document` | Modifica **round-trip**: conserva ordine, commenti e stile delle chiavi scritte dall'utente. `gray-matter` (v4.0.3, ferma da anni) va bene solo in lettura, perché in scrittura riformatta. |
| Struttura | **unified/remark** (`remark-parse`, `remark-frontmatter`, `remark-gfm`) + `mdast` con posizioni | Serve a sapere dove stanno titoli, blocchi di codice e link, per non toccare `[[...]]` dentro il codice. |
| Wikilink/embed | `@flowershow/remark-wiki-link` o `remark-obsidian` (heavycircle) per il **rendering** nella UI | Per l'**indicizzazione** e la **rinomina** conviene un nostro tokenizer di circa 150 righe (regex con offset, escluse le aree di codice ricavate da mdast) che estrae `{target, heading, block, alias, embed, start, end}`. |
| Tag inline | Regex compatibile con Obsidian (`#[\p{L}\p{N}_/-]+`, non solo numeri, fuori da codice e URL) | — |
| Rendering UI (Fase 2) | `remark-rehype` + `rehype-sanitize`; callout con `remark-obsidian` | — |

**Rinomina con aggiornamento dei link**, a partire dall'indice: (1) si cercano i backlink nella tabella `links` (per target risolto); (2) per ogni file si riscrivono **solo gli intervalli** dei link (edit per offset, non si ri-serializza l'AST), conservando alias, `#titolo`, `^blocco` e `!` degli embed; (3) i link Markdown `[x](a%20b.md)` si aggiornano con URL encoding; (4) si mantiene la forma "shortest" se il nuovo nome resta unico, altrimenti si passa al percorso; (5) **un solo commit** per l'intera operazione.

Fonti: [Obsidian Properties](https://obsidian.md/help/properties) · [Obsidian Links](https://obsidian.md/help/links) · [cestino .trash](https://forum.obsidian.md/t/cli-delete-should-respect-the-deleted-files-setting/113035) · [remark-obsidian](https://awesome.ecosyste.ms/projects/github.com%2Fheavycircle%2Fremark-obsidian) · [Flowershow wiki-link](https://test.flowershow.app/syntax/links-and-embeds-md) · [gray-matter e round-trip](https://cdn.jsdelivr.net/npm/simple-task-master@0.3.1/reports/FRONTMATTER_ANALYSIS.md)

---

## 5. Reversibilità e concorrenza

### 5.1 Git del vault

| Opzione | Pro | Contro |
|---|---|---|
| **isomorphic-git** | JS puro, **niente git installato** (conta su Windows/macOS "normali"). Copre `init/add/remove/commit/log/readBlob/checkout`. | Lento con repo grandi e `statusMatrix` su migliaia di file. Niente SSH, niente rebase. Usa molta memoria nei clone grandi. |
| **simple-git** | Wrapper del git di sistema: veloce e completo. | Richiede git installato (spesso manca su Windows e macOS senza Xcode CLT). |
| **dugite** (GitHub Desktop) | Git portabile incluso nel pacchetto. | Aggiunge decine di MB all'installer. |

**Scelta: lo stesso schema del plugin obsidian-git.** Un'interfaccia `VaultVcs` con due backend: **isomorphic-git di default** e **git di sistema via simple-git** se presente (più veloce, serve per un push remoto opzionale). La lentezza di isomorphic-git non pesa, perché sappiamo **quali file** abbiamo scritto: `add(filepath)` e `commit` mirati, mai `status` su tutto il vault. Per sicurezza, un "commit di riconciliazione" completo può girare ogni notte.

**Granularità**
- **1 tool call di scrittura = 1 commit** (una rinomina che aggiorna 12 file resta comunque un solo commit).
- Messaggio strutturato e leggibile: `vault_edit: Progetti/Monsters.md [agent=rhea action=01JA…]`, con trailer `Monsters-Action: <id>` e `Monsters-Agent: rhea`. L'autore git è il nome dell'agente, così `git log`/`blame` dicono chi ha scritto cosa.
- Il log delle azioni dell'app salva lo SHA del commit: dalla UI "annulla" → `vault_undo(action_id)` ripristina i blob precedenti di quei file con **un nuovo commit**. La storia non si riscrive mai.
- **Snapshot dell'utente**: prima che un agente scriva un file, se il contenuto su disco è diverso dall'ultimo commit (l'ha modificato l'utente in Obsidian), si fa prima un commit `snapshot utente` con autore "utente". Così la versione dell'utente è sempre recuperabile.
- `.gitignore`: `.trash/`, `.obsidian/workspace*.json`, `.obsidian/cache`, `.smart-env/`, file temporanei `*.monsters-tmp`.

### 5.2 Cestino
- `vault_delete` sposta il file in **`.trash/`** con lo stesso schema di Obsidian (in caso di collisione aggiunge un suffisso numerico) e fa il commit della rimozione. Le copie di recupero sono quindi due: `.trash` (visibile e semplice per l'utente) e la storia git.
- Il `.trash` si svuota dopo 30 giorni (configurabile). La storia git resta.
- La cancellazione definitiva (`permanent: true`) è riservata all'utente dalla UI.

### 5.3 Modifiche concorrenti (utente in Obsidian e agenti)
- **Watcher**: `chokidar` v5 (solo ESM, Node ≥ 20.19) con `awaitWriteFinish`, che ignora `.git`, `.obsidian` e `.trash`. Alternativa: `@parcel/watcher` (nativo, quello di VS Code) se servono prestazioni migliori su vault molto grandi. A ogni evento: si ricalcola l'hash, si reindicizza (FTS subito, embedding in coda) e **si ignorano le scritture nostre** con un registro `path → hash scritto`.
- **Concorrenza ottimistica**: `vault_read` restituisce un `hash`. `vault_edit` e `vault_write` in sovrascrittura **richiedono `base_hash`**. Se il file è cambiato, l'operazione fallisce con `CONFLICT` più il diff, e l'agente rilegge e riapplica. Niente lock lunghi: Obsidian non li rispetta.
- **Lock in-process**: un mutex per percorso (le operazioni multi-file prendono i lock in ordine) e una coda unica per i commit git (git non sopporta commit paralleli sullo stesso repo).
- **Scrittura atomica**: si scrive su `file.md.monsters-tmp` e poi `rename`. Obsidian vede un solo evento di modifica e ricarica la nota.
- **Edit chirurgici** (`str_replace`, append a una sezione) invece di riscrivere tutto il file: riducono i conflitti con chi sta digitando.
- Rischio residuo: l'utente ha la nota aperta e sta scrivendo proprio mentre l'agente la modifica. Obsidian ricarica da disco e può sovrascrivere al salvataggio successivo, ma lo snapshot e il commit rendono comunque tutto recuperabile. In Fase 2 un **plugin Obsidian companion** opzionale può segnalare a Monsters quale nota è attiva (e l'agente rimanda la scrittura).

Fonti: [obsidian-git (simple-git desktop / isomorphic-git mobile)](https://github.com/vinzent03/obsidian-git) · [isomorphic-git](https://stackshare.io/tools/isomorphic-git) · [dugite](https://cdn.jsdelivr.net/npm/dugite@3.2.2/README.md) · [chokidar 5.0.0](https://newreleases.io/project/npm/chokidar/release/5.0.0) · [Letta Code git-backed memory](https://www.letta.com/blog/our-next-phase)

---

## 6. Proposte per Monsters

### 6.1 Struttura iniziale del vault

```
Monsters Vault/
├── Inbox/                 # cattura veloce: utente e agenti senza area dedicata
├── Diario/                # daily note YYYY-MM-DD.md (riepilogo giornaliero di utente e agenti)
├── Progetti/              # una nota (o cartella) per progetto attivo, con scadenza o obiettivo
├── Aree/                  # responsabilità continue (salute, lavoro, casa, finanze…)
├── Risorse/               # conoscenza di riferimento, appunti, ricerche, link
├── Persone/               # una nota per persona (aliases = soprannomi, email)
├── Archivio/              # progetti chiusi e note non più attive
├── Agenti/
│   ├── <Orchestratore>/   # nome scelto dall'utente
│   │   ├── MEMORY.md      # indice corto sempre caricato (≤ 150 righe)
│   │   └── *.md           # note di memoria per argomento, lette quando servono
│   ├── Rhea/
│   └── Dione/
├── Modelli/               # template (nota, persona, progetto, diario, decisione)
├── Allegati/              # immagini e PDF (attachmentFolderPath di Obsidian)
├── LEGGIMI.md             # cos'è il vault, convenzioni in breve (per utente e agenti)
├── .obsidian/             # creata con le impostazioni del §4.1, poi gestita da Obsidian
└── .trash/                # cestino compatibile con Obsidian (fuori da git)
```

È uno schema PARA semplificato, comprensibile all'utente medio. Le cartelle "umane" sono poche e i nomi si localizzano all'onboarding (EN: Inbox, Journal, Projects…). Gli agenti creati all'onboarding ricevono la propria `Agenti/<Nome>/`.
**L'indice (SQLite) non sta nel vault**: va nella cartella dati dell'app (`~/.monsters/index/<vault-id>.sqlite`), così non sporca né Obsidian né git e si può ricostruire.

### 6.2 Convenzioni delle note

**Nomi file**: titolo leggibile in forma naturale (`Riunione con Marco.md`), **unico nel vault** (così i wikilink brevi funzionano), senza `# | ^ : %% [ ] \ / ? * " < >`, al massimo 120 caratteri. Le daily note seguono `YYYY-MM-DD.md`. In caso di collisione, `vault_write` restituisce un errore e propone `Titolo (2).md` oppure un titolo più specifico.

**Frontmatter minimo** (chiavi in inglese: sono un contratto macchina, compatibile con le proprietà predefinite di Obsidian e con altri tool; la UI le mostra tradotte):

```yaml
---
id: 01JA7Q3K9X2M4V8N6P0R5T1W3Y   # ULID stabile, sopravvive a rinomine e spostamenti
type: note                       # note | project | area | person | daily | decision | memory | resource
tags: [progetto/monsters, ai]
aliases: []
created: 2026-10-14T10:32:00
updated: 2026-10-14T10:40:12
author: rhea                     # user | <nome agente>
source: https://…                # facoltativo
status: active                   # facoltativo (project: active | paused | done)
---
```

- `id`, `created`, `updated` e `author` li gestisce il sistema: le note create in Obsidian senza frontmatter vengono **accettate così come sono**. L'`id` si aggiunge solo quando un agente modifica la nota, mai riscrivendo il resto del YAML.
- **Tag**: minuscoli, `kebab-case`, gerarchici con `/` (`area/salute`, `progetto/monsters`, `persona/cliente`). Vanno nel frontmatter. Quelli inline sono letti ma gli agenti non li aggiungono. Il tipo della nota sta in `type`, non nei tag.
- **Link**: wikilink nella forma breve `[[Titolo]]`, `[[Titolo|testo]]`. Nelle proprietà vanno tra virgolette. Le relazioni esplicite sono facoltative, in una sezione `## Collegamenti` (`- lavora con [[Marco Rossi]]`), stile basic-memory ma senza sintassi obbligatoria.
- **Corpo**: un `# Titolo` uguale al nome del file. Si comincia da un riassunto di 1–3 righe (utile agli snippet e agli embedding), poi le sezioni `##`.
- **Note degli agenti**: ogni agente tiene `Agenti/<Nome>/MEMORY.md` come indice (una riga per voce con link alla nota di dettaglio), come in Claude Code. Il contenuto viene caricato nel prompt all'avvio dell'agente.
- **Diario**: gli agenti aggiungono righe nella sezione `## Agenti` della daily note (`- 14:32 **Rhea**: pubblicato post… [[Lancio Monsters]]`), mai altrove nella nota.

### 6.3 Permessi dei sottoagenti

Il principio del brief è "nessun blocco": i permessi sul vault **non bloccano il lavoro**, ma tengono l'ordine. Tutto è comunque reversibile e loggato. Sono configurabili per agente in `agents/<nome>.yaml` (`vault.read`, `vault.write`, `vault.delete` come glob).

| Chi | Lettura | Crea/modifica | Sposta/rinomina | Cancella (→ .trash) |
|---|---|---|---|---|
| **Utente** (UI) | tutto | tutto | tutto | tutto, anche in modo definitivo |
| **Orchestratore** | tutto | tutto | tutto | tutto |
| **Sottoagente** (default) | tutto, tranne le note con `private: true` e la cartella `Privato/` se esiste | `Agenti/<sé>/**`, `Inbox/**`, append nella sezione `## Agenti` della daily note, **note con `author: <sé>`** ovunque, più i glob concessi (es. `Progetti/Social/**` all'agente social) | solo nella propria area | solo nella propria area e le proprie note in Inbox |
| **Client MCP esterno** (Fase 2) | tutto tranne `private` | solo `Inbox/**` (default) | no | no |
| **Tutti** | — | **mai** `.obsidian/`, `.git/`, `.trash/` (solo il sistema) | — | — |

Se un sottoagente deve modificare una nota fuori dalla sua area, il tool **non fallisce in silenzio**. Restituisce `PERMISSION_DENIED` con un suggerimento: lavorare in `vault_propose` (che crea una nota in `Inbox/` con la modifica proposta come diff, collegata all'originale) oppure chiedere all'orchestratore, che può applicarla o concedere il glob per sempre (decisione dell'utente, come nel flusso "opzioni" del brief).

### 6.4 Interfaccia degli strumenti del vault

Le regole di progetto sono poche: tool ben descritti, semantiche vicine al memory tool di Anthropic (che i modelli conoscono), schemi zod condivisi tra gli agenti interni e il server MCP. Ogni scrittura restituisce `{action_id, commit, path, hash}` e finisce nel log delle azioni.

| Tool | Parametri | Restituisce | Note |
|---|---|---|---|
| `vault_search` | `query: string`, `mode?: "auto"\|"text"\|"semantic"` (default `auto` = ibrida RRF), `tags?: string[]` (AND), `folder?: string`, `type?: string`, `updated_after?: date`, `limit?: number = 10` | `[{path, title, score, snippet, tags, updated}]` | Con `query` vuota fa solo filtro (es. tutte le note `#progetto/monsters`). In `auto` usa il solo full-text se gli embedding non sono pronti. |
| `vault_read` | `path` (o `title`, o `id`), `section?: string` (titolo), `max_chars?: number = 20000` | `{path, id, frontmatter, content, hash, outlinks[], backlinks_count}` | Il percorso si risolve anche dal titolo o da un alias, come un wikilink. Le note lunghe vengono troncate con l'indicazione delle sezioni. |
| `vault_list` | `folder?: string = "/"`, `recursive?: bool`, `sort?: "updated"\|"name"`, `limit?: number = 50` | `[{path, title, type, updated}]` | — |
| `vault_write` | `path`, `content` (corpo), `frontmatter?: object`, `mode: "create"\|"overwrite"`, `base_hash?` (obbligatorio con `overwrite`) | `{action_id, commit, path, hash}` | Crea le cartelle mancanti e aggiunge `id/created/author`. Se la nota esiste e `mode=create`, restituisce `EXISTS`. |
| `vault_edit` | `path`, `base_hash`, `ops: Op[]` con `Op = {str_replace:{old,new}} \| {append:{text, section?}} \| {prepend:{text}} \| {replace_section:{heading, text}} \| {set_props:{…}} \| {remove_props:[…]}` | `{action_id, commit, hash, diff}` | È il tool di modifica principale. Usa `str_replace` (con `old` unico nel file) come il memory tool. Gli `ops` sono atomici: o tutti o nessuno. |
| `vault_move` | `from`, `to`, `update_links?: bool = true` | `{action_id, commit, updated_files[]}` | Copre la rinomina e lo spostamento, con l'aggiornamento dei backlink (§4.2). Un solo commit. |
| `vault_delete` | `path`, `reason: string` | `{action_id, commit, trash_path}` | Sposta in `.trash/`. Il `reason` finisce nel commit e nel log. |
| `vault_links` | `path`, `direction?: "out"\|"in"\|"both" = "both"`, `depth?: 1..3 = 1`, `include_unresolved?: bool` | `{nodes:[{path,title}], edges:[{from,to,type:"link"\|"embed"}]}` | Serve a "seguire i link" (CTE ricorsiva) e alimenta il grafo nella UI. |
| `vault_tags` | `prefix?: string` | `[{tag, count}]` | — |
| `vault_history` | `path?`, `limit?: number = 20` | `[{commit, date, author, action_id, message}]` | — |
| `vault_restore` | `path`, `commit` | `{action_id, commit}` | Riporta un file a una versione precedente (anche se cancellato) con un nuovo commit. |
| `vault_undo` | `action_id` | `{action_id, commit, files[]}` | Annulla un'intera azione multi-file. Lo usano l'orchestratore e la UI. |
| `vault_propose` (sottoagenti) | `path`, `ops` (come `vault_edit`), `note: string` | `{proposal_path}` | Crea una proposta in `Inbox/`. L'orchestratore la applica con `vault_apply_proposal(proposal_path)`. |

Per i modelli piccoli o free (OpenRouter) si può esporre un **sottoinsieme minimo** (`vault_search`, `vault_read`, `vault_write`, `vault_edit`, `vault_delete`) e lasciare il resto all'orchestratore.

Schema dell'indice SQLite (bozza):

```sql
notes(id TEXT PK, path TEXT UNIQUE, title, type, author, created, updated, hash, mtime, size, private INT)
props(note_id, key, value_json)               -- tutte le proprietà, interrogabili
tags(note_id, tag)                            -- frontmatter + inline, con prefissi gerarchici espansi
aliases(note_id, alias)
links(src_id, target_raw, target_id NULL, heading, block, is_embed, start, end)  -- target_id NULL = link non risolto
chunks(id PK, note_id, ord, heading_path, text, token_count, hash)
fts USING fts5(title, aliases, tags, headings, body, tokenize='unicode61 remove_diacritics 2')  -- per nota
chunks_fts USING fts5(text, content='chunks')   -- per snippet di chunk
embeddings(chunk_id PK, model TEXT, dim INT, vec BLOB)   -- Float32/Int8; KNN in JS (o vec0 di sqlite-vec)
actions(id ULID PK, ts, agent, tool, params_json, paths_json, commit, status)    -- ponte verso il log delle azioni
```

---

## 7. Server MCP del vault (Fase 2)

**SDK**: `@modelcontextprotocol/server` **v2** (ultima release v2.3.1, 5 ottobre 2026; supporta la spec **2026-07-28** con i *tasks*). La v1 (`@modelcontextprotocol/sdk` 1.32.x) è ancora mantenuta ma conviene partire dalla v2. Questa divide il pacchetto in `server`/`client` e accetta come `inputSchema` qualsiasi Standard Schema, **zod v4 compreso**: gli schemi dei tool interni si riusano tali e quali.

Cosa esporre:

| Primitiva MCP | Contenuto |
|---|---|
| **Tools** | Gli stessi del §6.4 (`vault_search`, `vault_read`, `vault_list`, `vault_write`, `vault_edit`, `vault_move`, `vault_delete`, `vault_links`, `vault_tags`, `vault_history`, `vault_restore`), con le **annotations** `readOnlyHint` (search/read/list/links/tags/history) e `destructiveHint` (delete/move/restore), più `outputSchema` per i risultati strutturati. |
| **Resources** | Template `vault://note/{path}` (testo Markdown), `vault://tag/{tag}` (elenco), `vault://daily/{date}`. Notifiche `resources/updated` quando il watcher vede modifiche (subscription). |
| **Prompts** | `riassunto-giornaliero`, `nuova-nota-da-modello` (sceglie il template in `Modelli/`), `rivedi-inbox`. |
| **Transport** | **stdio** (Claude Desktop/Code, Cursor) e **Streamable HTTP** solo su `127.0.0.1` con token bearer generato dall'app. L'accesso remoto passa dal tunnel SSH già previsto, mai da una porta aperta. |
| **Permessi** | Ogni client MCP è un "agente esterno" con il proprio profilo del §6.3 (default: lettura e scrittura solo in `Inbox/`). Le sue azioni compaiono nel log con `agent=mcp:<nome-client>`. |

Il server MCP **gira nello stesso processo** di Monsters, oppure come comando `monsters mcp` che apre lo stesso indice in sola lettura e inoltra le scritture al core via IPC. Le scritture devono passare sempre dall'unico `VaultService`, per non avere due scrittori git in contemporanea.

Fonti: [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/) · [release typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk/releases) · [v2.0.0-beta.1](https://newreleases.io/project/github/modelcontextprotocol/typescript-sdk/release/v2.0.0-beta.1) · [qmd MCP (stdio + HTTP localhost)](https://github.com/tobi/qmd) · [basic-memory tools](https://github.com/basicmachines-co/basic-memory)

---

## Raccomandazione per Monsters

**Stack**

| Livello | Scelta |
|---|---|
| Fonte di verità | File `.md` nel vault (compatibile con Obsidian). Nessun dato solo nel database. |
| Indice | **SQLite** in `~/.monsters/index/`: `bun:sqlite`, `node:sqlite` (Node ≥ 24 consigliato) o `better-sqlite3`, dietro un adapter `Db`. **FTS5** `unicode61 remove_diacritics 2` più tabelle per tag, link, proprietà e chunk. |
| Parsing | `yaml` (Document, round-trip) + `remark` (posizioni) + un tokenizer nostro per wikilink, embed e tag. Edit per intervalli di testo, mai ri-serializzando l'AST. |
| Semantica | **transformers.js v4** + **granite-embedding-97m-multilingual-r2 (quint8, Apache-2.0, circa 100 MB)**. Profilo lite: multilingual-e5-small q8. Provider opzionale: Ollama. Vettori in **BLOB SQLite con KNN in JS** (15 ms su 30.000 chunk). `sqlite-vec` quando i chunk superano circa 200.000. |
| Fusione | **RRF k=60** tra BM25 e vettori, filtri SQL prima. Reranker solo in Fase 3. |
| Reversibilità | **Git** (isomorphic-git di default, simple-git se c'è git di sistema), 1 commit per azione con trailer `Monsters-Action`, snapshot delle modifiche dell'utente prima delle scritture degli agenti, `vault_undo`/`vault_restore`, `.trash/` come Obsidian. |
| Concorrenza | chokidar v5, hash ottimistico (`base_hash`), scrittura atomica tmp+rename, mutex per percorso, coda unica per git. |
| MCP | `@modelcontextprotocol/server` v2 (spec 2026-07-28), stessi schemi zod dei tool interni. |

**MVP (Fase 1)**
- Creazione del vault con la struttura del §6.1, `LEGGIMI.md`, `Modelli/` e `.obsidian/app.json` iniziale. In alternativa, si apre un vault Obsidian esistente senza modificarlo.
- `VaultService` unico con i tool `vault_search` (full-text, tag, cartella, tipo), `vault_read`, `vault_list`, `vault_write`, `vault_edit`, `vault_move` (con aggiornamento dei link), `vault_delete` (.trash), `vault_links`, `vault_tags`, `vault_history`, `vault_restore`, `vault_undo`.
- Indice SQLite FTS5 + tag/link/proprietà, watcher incrementale, ricostruzione completa con `monsters vault reindex`.
- Git con commit per azione e snapshot dell'utente. Ogni operazione va nel log delle azioni con il link al commit. Pulsante "annulla" nella UI.
- Permessi: orchestratore ovunque, sottoagenti nella propria area più `Inbox/`, più `vault_propose`.
- Memoria degli agenti in `Agenti/<Nome>/MEMORY.md`, caricata all'avvio dell'agente.
- Test: parser (link, embed, alias, codice escluso), rinomina con backlink, conflitto `base_hash`, undo multi-file, reindicizzazione dopo una modifica esterna. Demo e2e: l'utente modifica una nota in Obsidian, l'orchestratore la trova e la aggiorna, l'utente annulla dalla UI.

**Fase 2**
- Ricerca **semantica e ibrida** (embedding in background in un worker thread, chunking per titoli, RRF), "note correlate" nella UI.
- Vista del vault nella UI: note, backlink, **grafo** (da `vault_links`), cestino e cronologia.
- **Server MCP** del vault (stdio + HTTP localhost con token), con profili di permesso per client.
- Stemming italiano (colonna `body_stem` Snowball) e tabella `trigram` se servono.
- Plugin Obsidian companion opzionale (nota attiva, per evitare conflitti) e integrazione opzionale con l'Obsidian CLI.
- Push git opzionale verso un remote privato (backup e sincronizzazione), solo con il git di sistema.

**Fase 3 e oltre**: reranker locale (qwen3-reranker-0.6b via node-llama-cpp) sui primi 30 risultati; `sqlite-vec` per vault molto grandi; agente "consolidatore" stile mem0 che trasforma le conversazioni in note e aggiorna `MEMORY.md`; modello granite-311m o EmbeddingGemma per chi ha una GPU.

**Rischi da verificare all'inizio dell'implementazione**: (1) runtime Node o Bun (decide driver SQLite e caricamento estensioni su macOS); (2) velocità di granite quint8 su Apple Silicon/ARM; (3) chiavi esatte di `.obsidian/app.json` su un vault creato dall'Obsidian attuale; (4) comportamento di Obsidian quando un file aperto viene modificato da fuori mentre l'utente scrive (test manuale).
