import { formatEur, SPEND_PERIOD_WORDS, type LogEvent } from '@monsters/shared';
import { capitalize, modelLabel, toolLabel } from '../../store/derive.ts';
import {
  receiptCost,
  receiptNotes,
  sourceText,
  labelOfUse,
  VERDICT,
} from '../../store/instinct.ts';
import { formatUsd, prettyJson } from '../../lib/utils.ts';

/** One labelled field of an event's details; `code` values show in monospace. */
export interface DetailField {
  label: string;
  value: string;
  code?: boolean;
}

const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} s`;

const CHANNEL: Record<string, string> = {
  ui: 'interfaccia web',
  cli: 'riga di comando',
  telegram: 'Telegram',
  ssh: 'SSH',
  api: 'API',
  system: 'Monsters',
  desktop: 'app desktop',
};

const KILL_SCOPE: Record<string, string> = {
  global: 'tutti i mostri',
  agent: 'un mostro',
  run: 'un lavoro',
  tool: 'uno strumento',
};

const DECIDED_BY: Record<string, string> = {
  rules: 'le regole che hai scelto',
  model: 'il modello',
  user: 'tu',
};

/**
 * The details of a log event as labelled fields in Italian, instead of the raw
 * JSON (which stays available as "Dati tecnici").
 */
export function detailsOf(e: LogEvent): DetailField[] {
  const out: DetailField[] = [];
  const add = (label: string, value: unknown, code = false) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    const v = Array.isArray(value)
      ? value.join(', ')
      : typeof value === 'string'
        ? value
        : prettyJson(value);
    out.push({ label, value: v, code });
  };
  switch (e.type) {
    case 'message':
      add('Testo', e.data.text);
      break;
    case 'delegation':
      add('Compito', e.data.goal);
      add('Perché', e.data.why);
      add('Finito quando', e.data.doneWhen);
      add('Note da leggere', e.data.contextLinks);
      add('Risultato', e.data.summary);
      add('Problema', e.data.error);
      break;
    case 'tool_call':
      add('Strumento', `${toolLabel(e.data.tool)} (${e.data.tool})`);
      add('Dati inviati', e.data.input, true);
      break;
    case 'tool_result':
      add('Strumento', `${toolLabel(e.data.tool)} (${e.data.tool})`);
      add('Esito', e.data.ok ? 'riuscito' : 'non riuscito');
      if (e.data.durationMs !== undefined) add('Durata', seconds(e.data.durationMs));
      add('Problema', e.data.error);
      add('Risultato', e.data.output, true);
      break;
    case 'decision':
      if (e.data.use) {
        // An answer of the instinct: what it was about, how sure, how fast (D-067).
        add('Uso', labelOfUse(e.data.use) ?? e.data.use);
        add(
          'Modalità',
          e.data.mode === 'shadow' ? 'solo annota' : e.data.mode === 'on' ? 'agisce' : undefined,
        );
        add(
          'Chi ha risposto',
          e.data.engine === 'jev'
            ? `Modello esperto (TypeSafe)${e.data.model ? ` (${e.data.model})` : ''}`
            : e.data.engine === 'llm'
              ? 'il modello piccolo'
              : e.data.engine,
        );
        if (e.data.value !== undefined)
          add('Valore', e.data.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }));
        add('Cosa ha fatto', e.data.action);
        if (e.data.latencyMs !== undefined) add('Tempo', seconds(e.data.latencyMs));
        break;
      }
      add('Domanda', e.data.question);
      add('Opzioni', e.data.options);
      add('Scelta', e.data.choice === 'ask_user' ? 'chiedere a te' : e.data.choice);
      add('Chi ha deciso', DECIDED_BY[e.data.decidedBy]);
      if (e.data.confidence !== undefined)
        add('Sicurezza', `${Math.round(e.data.confidence * 100)}%`);
      add('Motivo', e.data.reason);
      break;
    case 'question':
      add('Domanda', e.data.question);
      add(
        'Opzioni',
        e.data.options.map((o) => o.label),
      );
      add('Consigliata', e.data.options.find((o) => o.id === e.data.recommended)?.label);
      break;
    case 'answer':
      add('Risposta', e.data.text ?? e.data.optionId);
      add('Da', e.data.channel ? CHANNEL[e.data.channel] : undefined);
      break;
    case 'question_expired':
      add(
        'Perché',
        e.data.reason === 'kill'
          ? 'hai fermato tutti i mostri'
          : e.data.reason === 'run_aborted'
            ? 'il lavoro si è fermato'
            : e.data.reason === 'restart'
              ? 'Monsters è stato riavviato'
              : e.data.reason === 'run_ended'
                ? 'il lavoro è finito senza questa azione'
                : undefined,
      );
      break;
    case 'question_parked':
      add(
        'Perché',
        e.data.reason === 'harness'
          ? 'il mostro lavora con un abbonamento: chiude il turno e riparte dalla tua risposta'
          : e.data.reason === 'timeout'
            ? 'dopo 10 minuti il mostro ha chiuso il turno: riparte dalla tua risposta'
            : e.data.reason === 'restart'
              ? 'Monsters è stato riavviato: la domanda resta aperta'
              : 'il lavoro è finito con la domanda aperta',
      );
      break;
    case 'conversation_summary':
      add('Messaggi riassunti', String(e.data.turns));
      add(
        'Perché',
        e.data.reason === 'turns'
          ? 'più messaggi di quanti ne entrano'
          : 'il contesto si avvicinava alla finestra del modello',
      );
      if (e.data.model) add('Modello', modelLabel(e.data.model));
      add('Riassunto', e.data.text);
      break;
    case 'new_conversation':
      add('Con', e.data.to ? capitalize(e.data.to) : 'tutti i mostri');
      add('Da', e.data.channel ? CHANNEL[e.data.channel] : undefined);
      break;
    case 'memory':
      add('Nota', e.data.path, true);
      if (e.data.lines?.length) add('Righe aggiunte', e.data.lines);
      if (e.data.dropped !== undefined)
        add('Non mostrati', `${e.data.dropped.toLocaleString('it-IT')} caratteri più vecchi`);
      break;
    case 'vault_change':
      add('Nota', e.data.path, true);
      add('Prima era in', e.data.fromPath, true);
      if (e.data.files && e.data.files.length > 1) add('File toccati', e.data.files, true);
      break;
    case 'provider_usage':
      add('Modello', modelLabel(e.data.model));
      if (e.data.requestedModel) add('Chiesto', modelLabel(e.data.requestedModel));
      if (e.data.inputTokens !== undefined || e.data.outputTokens !== undefined)
        add(
          'Token',
          `${(e.data.inputTokens ?? 0).toLocaleString('it-IT')} letti${e.data.cachedInputTokens ? ` (${e.data.cachedInputTokens.toLocaleString('it-IT')} dalla cache)` : ''}, ${(e.data.outputTokens ?? 0).toLocaleString('it-IT')} scritti`,
        );
      if (e.data.durationMs !== undefined) add('Durata', seconds(e.data.durationMs));
      if (e.data.queuedMs) add('Attesa', seconds(e.data.queuedMs));
      if (e.data.costUsd !== undefined)
        add('Costo', e.data.costUsd === 0 ? 'gratis' : formatUsd(e.data.costUsd));
      break;
    case 'error':
      add('Messaggio', e.data.message);
      break;
    case 'kill':
      add('Fermato', KILL_SCOPE[e.data.scope]);
      add('Da', CHANNEL[e.data.by]);
      add('Motivo', e.data.reason);
      if (e.data.runsAborted !== undefined) add('Lavori fermati', String(e.data.runsAborted));
      if (e.data.processesKilled) add('Programmi chiusi', String(e.data.processesKilled));
      break;
    case 'resume':
      add('Da', CHANNEL[e.data.by]);
      break;
    case 'run':
      add('Compito', e.data.goal);
      add('Problema', e.data.error);
      break;
    case 'auth':
      add('Da', e.data.channel ? CHANNEL[e.data.channel] : undefined);
      break;
    case 'mcp_server':
      add('Server', e.data.server);
      add(
        'Tipo',
        e.data.transport === 'http'
          ? 'indirizzo web'
          : e.data.transport
            ? 'programma sul computer'
            : undefined,
      );
      if (e.data.tools !== undefined) add('Strumenti', String(e.data.tools));
      add('Problema', e.data.message);
      if (e.data.by) add('Da', CHANNEL[e.data.by]);
      break;
    case 'permissions': {
      const p = e.data.permissions;
      if (!p) {
        add('Permessi', 'come il resto della squadra');
      } else {
        add('Note', p.vault ? 'legge e scrive' : 'solo lettura');
        add('Web', p.web ? 'sì' : 'no');
        add('Terminale', p.shell ? 'sì' : 'no');
        add(
          'Cartelle',
          p.folders.length
            ? p.folders.map((f) => `${f.path}${f.write ? '' : ' (solo lettura)'}`)
            : 'nessuna',
          true,
        );
      }
      add('Da', CHANNEL[e.data.by]);
      break;
    }
    case 'instinct':
      add('Uso', labelOfUse(e.data.use) ?? e.data.use);
      add('Messaggio del computer', e.data.message);
      if (e.data.confidence !== undefined)
        add('Sicurezza', `${Math.round(e.data.confidence * 100)}%`);
      break;
    case 'security':
      add('Da dove', sourceText(e.data.source, e.data.tool));
      add('Indirizzo', /https?:\/\/\S+/.exec(e.data.source)?.[0], true);
      if (e.data.blocks !== undefined) add('Parti tolte', String(e.data.blocks));
      if (e.data.chars !== undefined) add('Caratteri invisibili', String(e.data.chars));
      if (e.data.tools?.length)
        add(
          'Strumenti',
          e.data.tools.map((t) => `${t.name} (${t.change === 'new' ? 'nuovo' : 'cambiato'})`),
        );
      if (e.data.p !== undefined) add('Sicurezza', `${Math.round(e.data.p * 100)}%`);
      break;
    case 'spend':
      add('Tetto', `${formatEur(e.data.capEur)} ${SPEND_PERIOD_WORDS[e.data.period]}`);
      add('Speso', formatEur(e.data.spentEur));
      add('Di chi', e.data.scope === 'team' ? 'la squadra' : e.data.scope);
      break;
    case 'receipt':
      add('Richiesta', e.data.request);
      add(
        'Incarichi',
        e.data.delegations.map((d) => `${d.agentName}: ${VERDICT[d.verdict].word}`),
      );
      add(
        'Note',
        receiptNotes(e.data).map((n) => n.path),
        true,
      );
      add('Costo', receiptCost(e.data));
      add('Passi', String(e.data.usage.modelCalls));
      add('Durata', seconds(e.data.durationMs));
      break;
    case 'channel':
      add('Canale', CHANNEL[e.data.channel]);
      add('Account', e.data.name ?? e.data.userId);
      if (e.data.userId && e.data.name) add('Id', e.data.userId, true);
      add('Motivo', e.data.reason, true);
      add('Inizio del messaggio', e.data.preview);
      add('Dettagli', e.data.message, true);
      break;
  }
  return out;
}
