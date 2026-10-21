import { formatEur, formatNumber, SPEND_PERIOD_WORDS, type LogEvent } from '@monsters/shared';
import { capitalize, modelLabel, toolLabel } from '../../store/derive.ts';
import {
  receiptCost,
  receiptNotes,
  sourceText,
  labelOfUse,
  VERDICT,
} from '../../store/instinct.ts';
import { formatUsd, prettyJson } from '../../lib/utils.ts';
import { logStrings } from './log.strings.ts';

/** One labelled field of an event's details; `code` values show in monospace. */
export interface DetailField {
  label: string;
  value: string;
  code?: boolean;
}

const seconds = (ms: number) =>
  logStrings().detail.seconds(formatNumber(ms / 1000, { maximumFractionDigits: 1 }));

/**
 * The details of a log event as labelled fields, instead of the raw
 * JSON (which stays available as "Technical data").
 */
export function detailsOf(e: LogEvent): DetailField[] {
  const out: DetailField[] = [];
  const d = logStrings().detail;
  const l = d.label;
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
      add(l.text, e.data.text);
      break;
    case 'delegation':
      add(l.task, e.data.goal);
      add(l.why, e.data.why);
      add(l.doneWhen, e.data.doneWhen);
      add(l.notesToRead, e.data.contextLinks);
      add(l.result, e.data.summary);
      add(l.problem, e.data.error);
      break;
    case 'tool_call':
      add(l.tool, `${toolLabel(e.data.tool)} (${e.data.tool})`);
      add(l.dataSent, e.data.input, true);
      break;
    case 'tool_result':
      add(l.tool, `${toolLabel(e.data.tool)} (${e.data.tool})`);
      add(l.outcome, e.data.ok ? d.succeeded : d.failed);
      if (e.data.durationMs !== undefined) add(l.duration, seconds(e.data.durationMs));
      add(l.problem, e.data.error);
      add(l.result, e.data.output, true);
      break;
    case 'decision':
      if (e.data.use) {
        // An answer of the instinct: what it was about, how sure, how fast (D-067).
        add(l.use, labelOfUse(e.data.use) ?? e.data.use);
        add(
          l.mode,
          e.data.mode === 'shadow' ? d.shadow : e.data.mode === 'on' ? d.acts : undefined,
        );
        add(
          l.answeredBy,
          e.data.engine === 'jev'
            ? d.expert(e.data.model)
            : e.data.engine === 'llm'
              ? d.smallModel
              : e.data.engine,
        );
        if (e.data.value !== undefined)
          add(l.value, formatNumber(e.data.value, { maximumFractionDigits: 2 }));
        add(l.didWhat, e.data.action);
        if (e.data.latencyMs !== undefined) add(l.time, seconds(e.data.latencyMs));
        break;
      }
      add(l.question, e.data.question);
      add(l.options, e.data.options);
      add(l.choice, e.data.choice === 'ask_user' ? d.askYou : e.data.choice);
      add(l.decidedBy, d.decidedBy[e.data.decidedBy]);
      if (e.data.confidence !== undefined)
        add(l.confidence, `${Math.round(e.data.confidence * 100)}%`);
      add(l.reason, e.data.reason);
      break;
    case 'question':
      add(l.question, e.data.question);
      add(
        l.options,
        e.data.options.map((o) => o.label),
      );
      add(l.recommended, e.data.options.find((o) => o.id === e.data.recommended)?.label);
      break;
    case 'answer':
      add(l.answer, e.data.text ?? e.data.optionId);
      add(l.from, e.data.channel ? d.channel[e.data.channel] : undefined);
      break;
    case 'question_expired':
      add(l.why, e.data.reason ? d.expired[e.data.reason] : undefined);
      break;
    case 'question_parked':
      add(
        l.why,
        e.data.reason === 'harness'
          ? d.parked['harness']
          : e.data.reason === 'timeout'
            ? d.parked['timeout']
            : e.data.reason === 'restart'
              ? d.parked['restart']
              : d.parked['other'],
      );
      break;
    case 'conversation_summary':
      add(l.messagesSummarized, String(e.data.turns));
      add(l.why, e.data.reason === 'turns' ? d.summaryTurns : d.summaryWindow);
      if (e.data.model) add(l.model, modelLabel(e.data.model));
      add(l.summary, e.data.text);
      break;
    case 'new_conversation':
      add(l.with, e.data.to ? capitalize(e.data.to) : d.allMonsters);
      add(l.from, e.data.channel ? d.channel[e.data.channel] : undefined);
      break;
    case 'memory':
      add(l.note, e.data.path, true);
      if (e.data.lines?.length) add(l.linesAdded, e.data.lines);
      if (e.data.dropped !== undefined) add(l.notShown, d.olderChars(formatNumber(e.data.dropped)));
      break;
    case 'vault_change':
      add(l.note, e.data.path, true);
      add(l.wasIn, e.data.fromPath, true);
      if (e.data.files && e.data.files.length > 1) add(l.filesTouched, e.data.files, true);
      break;
    case 'provider_usage':
      add(l.model, modelLabel(e.data.model));
      if (e.data.requestedModel) add(l.requested, modelLabel(e.data.requestedModel));
      if (e.data.inputTokens !== undefined || e.data.outputTokens !== undefined)
        add(
          l.tokens,
          d.tokens(
            formatNumber(e.data.inputTokens ?? 0),
            e.data.cachedInputTokens ? formatNumber(e.data.cachedInputTokens) : null,
            formatNumber(e.data.outputTokens ?? 0),
          ),
        );
      if (e.data.durationMs !== undefined) add(l.duration, seconds(e.data.durationMs));
      if (e.data.queuedMs) add(l.wait, seconds(e.data.queuedMs));
      if (e.data.costUsd !== undefined)
        add(l.cost, e.data.costUsd === 0 ? d.free : formatUsd(e.data.costUsd));
      break;
    case 'error':
      add(l.message, e.data.message);
      break;
    case 'kill':
      add(l.stopped, d.killScope[e.data.scope]);
      add(l.from, d.channel[e.data.by]);
      add(l.reason, e.data.reason);
      if (e.data.runsAborted !== undefined) add(l.jobsStopped, String(e.data.runsAborted));
      if (e.data.processesKilled) add(l.programsClosed, String(e.data.processesKilled));
      break;
    case 'resume':
      add(l.from, d.channel[e.data.by]);
      break;
    case 'run':
      add(l.task, e.data.goal);
      add(l.problem, e.data.error);
      break;
    case 'auth':
      add(l.from, e.data.channel ? d.channel[e.data.channel] : undefined);
      break;
    case 'mcp_server':
      add(l.server, e.data.server);
      add(
        l.type,
        e.data.transport === 'http'
          ? d.transportHttp
          : e.data.transport
            ? d.transportLocal
            : undefined,
      );
      if (e.data.tools !== undefined) add(l.tools, String(e.data.tools));
      add(l.problem, e.data.message);
      if (e.data.by) add(l.from, d.channel[e.data.by]);
      break;
    case 'permissions': {
      const p = e.data.permissions;
      if (!p) {
        add(l.permissions, d.sameAsSquad);
      } else {
        add(l.notes, p.vault ? d.vaultWrite : d.vaultRead);
        add(l.web, p.web ? d.yes : d.no);
        add(l.terminal, p.shell ? d.yes : d.no);
        add(
          l.folders,
          p.folders.length ? p.folders.map((f) => `${f.path}${f.write ? '' : d.readOnly}`) : d.none,
          true,
        );
      }
      add(l.from, d.channel[e.data.by]);
      break;
    }
    case 'instinct':
      add(l.use, labelOfUse(e.data.use) ?? e.data.use);
      add(l.computerMessage, e.data.message);
      if (e.data.confidence !== undefined)
        add(l.confidence, `${Math.round(e.data.confidence * 100)}%`);
      break;
    case 'security':
      add(l.whereFrom, sourceText(e.data.source, e.data.tool));
      add(l.address, /https?:\/\/\S+/.exec(e.data.source)?.[0], true);
      if (e.data.blocks !== undefined) add(l.partsRemoved, String(e.data.blocks));
      if (e.data.chars !== undefined) add(l.invisibleChars, String(e.data.chars));
      if (e.data.tools?.length)
        add(
          l.tools,
          e.data.tools.map((t) => `${t.name} (${t.change === 'new' ? d.toolNew : d.toolChanged})`),
        );
      if (e.data.p !== undefined) add(l.confidence, `${Math.round(e.data.p * 100)}%`);
      break;
    case 'spend':
      add(l.cap, `${formatEur(e.data.capEur)} ${SPEND_PERIOD_WORDS[e.data.period]}`);
      add(l.spent, formatEur(e.data.spentEur));
      add(l.whose, e.data.scope === 'team' ? d.wholeSquad : e.data.scope);
      break;
    case 'receipt':
      add(l.request, e.data.request);
      add(
        l.tasks,
        e.data.delegations.map((x) => `${x.agentName}: ${VERDICT[x.verdict].word}`),
      );
      add(
        l.notes,
        receiptNotes(e.data).map((n) => n.path),
        true,
      );
      add(l.cost, receiptCost(e.data));
      add(l.steps, String(e.data.usage.modelCalls));
      add(l.duration, seconds(e.data.durationMs));
      break;
    case 'channel':
      add(l.channel, d.channel[e.data.channel]);
      add(l.account, e.data.name ?? e.data.userId);
      if (e.data.userId && e.data.name) add(l.id, e.data.userId, true);
      add(l.reason, e.data.reason, true);
      add(l.messageStart, e.data.preview);
      add(l.details, e.data.message, true);
      break;
  }
  return out;
}
