# Usare i tuoi abbonamenti: ChatGPT, Codex e Claude Agent

Se hai già ChatGPT Plus o Pro, o un abbonamento Claude, i mostri possono lavorare con quello. Monsters li usa solo
nei modi che OpenAI e Anthropic permettono alle app open source che girano sul tuo computer (D-005, D-035). Non
servono per cominciare: OpenRouter gratuito basta.

Tutto si fa da **Impostazioni → Modelli → Abbonamenti**. Poi, in **Il modello di ogni mostro**, scegli quale mostro usa cosa.

## ChatGPT (Plus e Pro)

1. Premi **Continue with ChatGPT**. Si apre il browser sulla pagina di OpenAI.
2. Accedi e approva Monsters. Il browser torna su `http://127.0.0.1:1455/auth/callback` (o su un'altra porta, se la
   1455 è occupata) e la pagina delle impostazioni si aggiorna da sola.
3. La prima volta compare il messaggio di OpenAI «You're using your ChatGPT plan»: premi **Got it**.
4. Scegli ChatGPT come primo modello di un mostro. Accanto al campo dei messaggi vedi **Using ChatGPT plan** e il
   link **Manage usage**, che porta alle impostazioni di ChatGPT dove decidi quanto del tuo piano può usare Monsters.

Cose da sapere:
- I token stanno in `~/.monsters/secrets/`, cifrati con una chiave nel portachiavi del sistema (o, dove il
  portachiavi non c'è, in un file leggibile solo dal tuo utente). Non finiscono mai nel log.
- Se raggiungi il limite, il mostro si ferma e ti mostra il messaggio di OpenAI con **Manage usage**. Monsters non
  passa mai da solo a un altro provider a pagamento: decidi tu se cambiare modello.
- **Utilizzo del piano** (Impostazioni → Modelli, sotto il piano, e nei Consumi di un mostro): le finestre di Claude
  (sessione, settimana, Opus) e di ChatGPT con la percentuale usata e quando si azzerano. Monsters non chiede nulla al
  servizio e non legge le credenziali dei programmi: mostra quello che Claude Code e Codex scrivono mentre un mostro
  lavora, quindi il numero si aggiorna solo quando un mostro lavora su quel piano ("aggiornato 20 min fa").
- **Scollega** revoca l'accesso. Se OpenAI non risponde, scollega Monsters anche dalle impostazioni di ChatGPT.

### Monsters su un altro computer (SSH)

Il browser deve tornare sul computer dove gira Monsters. Prima di premere **Continue with ChatGPT**, apri un tunnel
dal computer con il browser:

```sh
ssh -L 1455:127.0.0.1:1455 utente@computer-di-monsters
```

Tieni aperta la connessione finché l'accesso non è completato. Se Monsters ha scelto un'altra porta, le impostazioni
la mostrano nel riquadro «Completa l'accesso nel browser»: usa quella nel comando.

## Codex

Codex è l'agente di OpenAI per programmare e usare il computer. Usa lo stesso accesso a ChatGPT: non c'è un secondo
login e Monsters non usa mai `codex login`.

1. Collega prima ChatGPT.
2. Premi **Installa e attiva Codex** (o **Attiva Codex** se hai già il comando `codex`). Monsters installa il
   pacchetto ufficiale `@openai/codex` 0.159.2 (Apache-2.0, circa 450 MB) in `~/.monsters/harness/codex`, solo
   quando lo chiedi.
3. Scegli Codex come primo modello di un mostro.

Codex lavora nella cartella del mostro (`~/.monsters/workspaces/<mostro>`) con le sue impostazioni in
`~/.monsters/harness/codex-home`, separate dalle tue. Gli strumenti di Monsters (note, web, squadra) gli arrivano
come server MCP, con i permessi del mostro. Senza il permesso del terminale Codex può solo leggere. I mostri che
possono usare il web cercano con la ricerca di Codex, compresa nel piano. I comandi di Codex non hanno accesso alla
rete (sandbox di Codex): pubblicare o inviare dal terminale non riesce.

## Claude Agent

Claude Agent usa **Claude Code installato sul tuo PC e il tuo abbonamento**. L'accesso a Claude lo fai tu, nel
terminale: Monsters non ha un pulsante di login, non chiede né salva token e non legge i file di Claude Code.

1. Premi **Attiva Claude Agent**.
   - Se hai già il comando `claude`, Monsters usa quello.
   - Se non lo hai, puoi premere **Installa e attiva Claude Agent**: Monsters installa il componente ufficiale
     `@anthropic-ai/claude-agent-sdk` 0.3.286 in `~/.monsters/harness/claude-agent`. Ha una licenza proprietaria di
     Anthropic, per questo non è incluso in Monsters.
2. Se le impostazioni dicono di farlo, apri un terminale, esegui `claude` e accedi con il tuo abbonamento (`/login`).
   Poi premi **Ricontrolla**: Monsters chiede a Claude Code se sei collegato (`claude auth status`).
3. Scegli Claude Agent come primo modello di un mostro (`sonnet`, `opus` o `haiku`).

Cose da sapere:
- Al processo di Claude Code Monsters toglie `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN`: con una chiave API
  pagheresti a consumo invece di usare l'abbonamento. Toglie anche le chiavi e le impostazioni di Monsters.
- Claude Code lavora nella cartella del mostro, dove Monsters scrive `AGENTS.md` e un `CLAUDE.md` che lo importa.
  Gli strumenti di Monsters gli arrivano come server MCP; i suoi comandi e i suoi file li usa solo se il mostro ha
  il permesso del terminale.
- Se le impostazioni dicono che Claude Code userebbe una chiave API, accedi con `claude` e il tuo piano.
- I mostri che possono usare il web cercano con la ricerca di Claude (`WebSearch`), compresa nel piano; le pagine le
  leggono con lo strumento di Monsters, che le tratta come dati e non come istruzioni.
- Il **freno** vale anche qui: prima di un comando nel terminale, di una ricerca o di un servizio collegato tramite
  Claude, Claude Code chiede a Monsters. Se l'azione è di quelle che vuoi decidere tu (pubblicare, scrivere a terzi,
  spendere, cancellare per sempre), compare la scheda "Rhea vuole …: procedo?" e il mostro aspetta la tua risposta.

### Servizi tramite Claude

Slack, Gmail, Drive e Calendar, Figma, Canva, Asana, HubSpot, Vercel e Claude Design accettano solo app approvate:
Claude lo è. Con l'abbonamento Claude collegato, in **Impostazioni → Collegamenti → App e servizi** questi servizi
dicono **Collega tramite Claude**. Li usano i mostri che lavorano con Claude.

1. Collega il servizio al tuo account Claude, se non l'hai già fatto: su claude.ai, **Impostazioni → Connettori**
   (il pannello ha il link). Per **Claude Design** invece apri un terminale su questo computer, scrivi `claude` e poi
   `/design-login`.
2. Torna in Monsters e premi **Collega**: Monsters chiede a Claude Code se il servizio è pronto.
3. Se Claude chiede di accedere di nuovo, ricollegalo dai connettori di Claude, oppure in un terminale:
   `claude mcp login "claude.ai Figma"` (con `--no-browser` se sei collegato via SSH). Poi **Ricontrolla**.

Monsters non vede password né token di questi servizi e non cambia la configurazione di Claude Code: ricorda solo
quali servizi hai scelto e quali mostri li usano. **Scollega** li toglie dai mostri; restano collegati al tuo account
Claude finché non li togli da claude.ai.

## Per tutti e tre

- Ogni passo finisce nel log delle azioni; il pulsante **Ferma tutto** chiude subito anche Codex e Claude Code.
- I limiti di ogni lavoro (passi e token, impostazioni `limits`) valgono anche per loro.
- Le regole di OpenAI e Anthropic cambiano spesso: le ricontrolliamo a ogni rilascio che tocca i provider.
