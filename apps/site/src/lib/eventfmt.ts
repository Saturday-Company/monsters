/* Compact one-line rendering of log events, shared by the build and the hero's log pane. */

import type { SiteEvent } from './eventlog.ts';

const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : (JSON.stringify(v) ?? '');

const short = (s: unknown, n = 34): string => {
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The fields worth a glance, per event type. */
export function summarize(e: Pick<SiteEvent, 'type' | 'data'>): string {
  const d = e.data;
  switch (e.type) {
    case 'message':
      return `${str(d['role'])} → ${str(d['to'] ?? '')} "${short(d['text'])}"`;
    case 'run':
      return d['goal'] ? `${str(d['status'])} "${short(d['goal'])}"` : str(d['status']);
    case 'delegation':
      return `${str(d['from'])} → ${str(d['to'])} ${str(d['status'])}`;
    case 'tool_call':
      return `${str(d['tool'])} ${short(d['input'], 30)}`;
    case 'tool_result':
      return `${str(d['tool'])} ${d['ok'] ? 'ok' : 'fail'} ${str(d['durationMs'] ?? '?')}ms`;
    case 'provider_usage':
      return `${str(d['model'])} in=${str(d['inputTokens'])} out=${str(d['outputTokens'])} $${str(d['costUsd'])}`;
    case 'instinct':
      return `${str(d['action'])} "${short(d['message'], 30)}"`;
    case 'vault_change':
      return `${str(d['action'])} ${str(d['path'])} @${str(d['commit'] ?? '')}`;
    case 'receipt': {
      const dl = Array.isArray(d['delegations']) ? d['delegations'].length : 0;
      const notes = Array.isArray(d['notes']) ? d['notes'].length : 0;
      return `${str(d['status'])} delegations=${dl} notes=${notes}`;
    }
    case 'kill':
      return `scope=${str(d['scope'])} by=${str(d['by'])} runsAborted=${str(d['runsAborted'] ?? 0)}`;
    case 'resume':
      return `by=${str(d['by'])}`;
    default:
      return short(d);
  }
}

/** `17:42:07.113` in the given time zone (the build prints Rome; the browser, local time). */
export function clock(ts: number, timeZone?: string): string {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
  return `${parts}.${str(d.getMilliseconds()).padStart(3, '0')}`;
}
