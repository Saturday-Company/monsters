import { ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  hasEffect,
  OTHER_TYPES,
  TYPE_LABEL,
  matchesActivity,
  pausedToolEvents,
  undoState,
  type ActivityFilter,
} from '../src/components/log/activity.ts';
import {
  latestMemoryChange,
  latestNoteChanges,
  rootChange,
} from '../src/components/log/ActivityPanel.tsx';
import { trashedByUndo, trashedText } from '../src/components/vault/TrashView.tsx';

/* Attività (D-056, audit 5.1-5.4 and 4.2-4.3): default filter, undo and redo, trash wording. */

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

const change = (
  action: 'create' | 'edit' | 'undo' | 'restore' | 'delete',
  path: string,
  actionId: string,
  extra: { undoneActionId?: string; agent?: string } = {},
) =>
  ev({
    agent: extra.agent ?? 'user',
    type: 'vault_change',
    data: {
      action,
      path,
      actionId,
      ...(extra.undoneActionId ? { undoneActionId: extra.undoneActionId } : {}),
    },
  });

describe('what Attività shows by default', () => {
  const reply = ev({ agent: 'titan', type: 'message', data: { text: 'Fatto', role: 'agent' } });
  const job = ev({ agent: 'mimas', type: 'run', data: { status: 'started', goal: 'x' } });
  const read = ev({
    agent: 'rhea',
    type: 'tool_call',
    data: { callId: 'c1', tool: 'web_search', input: {} },
  });
  const shell = ev({
    agent: 'rhea',
    type: 'tool_call',
    data: { callId: 'c2', tool: 'shell', input: {} },
  });
  const note = change('create', 'Risorse/Lisbona.md', 'a1', { agent: 'rhea' });
  const memory = change('edit', 'Agenti/Rhea/MEMORY.md', 'a2', { agent: 'rhea' });
  const question = ev({
    agent: 'titan',
    type: 'question',
    data: { questionId: 'q1', question: 'Che tono?', options: [], blocking: false },
  });
  const failure = ev({
    agent: 'mimas',
    type: 'error',
    data: { code: 'tool_failed', message: 'Il foglio è aperto' },
  });

  it('keeps the actions with an effect, drops replies, jobs and reading tools', () => {
    expect([note, shell, question, failure].map(hasEffect)).toEqual([true, true, true, true]);
    expect([reply, job, read, memory].map(hasEffect)).toEqual([false, false, false, false]);
  });

  it('"Tutto", a type or a person change what passes', () => {
    const base: ActivityFilter = { who: null, types: new Set(), all: false, since: 0, note: null };
    expect(matchesActivity(reply, base)).toBe(false);
    expect(matchesActivity(reply, { ...base, all: true })).toBe(true);
    expect(matchesActivity(reply, { ...base, types: new Set(['messages']) })).toBe(true);
    expect(matchesActivity(note, { ...base, types: new Set(['messages']) })).toBe(false);
    expect(matchesActivity(note, { ...base, who: 'titan' })).toBe(false);
    expect(matchesActivity(note, { ...base, who: 'rhea' })).toBe(true);
  });

  it('names the filters in plain words: "Sistema", not the product name (audit UI-20)', () => {
    const labels = OTHER_TYPES.map((t) => t.label);
    expect(labels).toContain('Sistema');
    expect(labels).toContain('Lavori dei mostri');
    expect(labels).not.toContain('Monsters');
    expect(TYPE_LABEL.system).toBe('Sistema');
  });

  it('the panel says when a monster last updated its own notes', () => {
    const own = change('edit', 'Agenti/Rhea/MEMORY.md', 'm1', { agent: 'rhea' });
    expect(latestMemoryChange([note, own, failure])?.id).toBe(own.id);
    expect(latestMemoryChange([note, failure])).toBeNull();
  });
});

describe('undo and redo', () => {
  const a = change('edit', 'Inbox/Bozze.md', 'act_a', { agent: 'dione' });
  const u1 = change('undo', 'Inbox/Bozze.md', 'act_u1', { undoneActionId: 'act_a' });
  const u2 = change('undo', 'Inbox/Bozze.md', 'act_u2', { undoneActionId: 'act_u1' });

  it('follows the chain: undone, redone ("Rifai" undoes the undo), undone again', () => {
    expect(undoState('act_a', {}, [a])).toEqual({ undone: false, next: 'act_a' });
    expect(undoState('act_a', { act_a: 'c1' }, [a, u1])).toEqual({ undone: true, next: 'act_u1' });
    expect(undoState('act_a', { act_a: 'c1', act_u1: 'c2' }, [a, u1, u2])).toEqual({
      undone: false,
      next: 'act_u2',
    });
  });

  it('waits for the event of an undo before offering "Rifai"', () => {
    expect(undoState('act_a', { act_a: 'c1' }, [a])).toEqual({ undone: true, next: null });
  });

  it('the panel shows the latest change of each note, an undo as the change it undid', () => {
    const other = change('create', 'Risorse/Tram.md', 'act_t', { agent: 'rhea' });
    const restore = change('restore', 'Inbox/Bozze.md', 'act_r');
    const rows = latestNoteChanges([a, other, u1]);
    expect(rows.map((e) => e.data.actionId)).toEqual(['act_u1', 'act_t']);
    expect(rootChange([a, other, u1], rows[0]!)?.data.actionId).toBe('act_a');
    expect(rootChange([a, u1, u2], u2 as LogEvent<'vault_change'>)?.data.actionId).toBe('act_a');
    // Restored after the undo: the row tells the restore (4.2).
    expect(latestNoteChanges([a, u1, restore]).map((e) => e.data.action)).toEqual(['restore']);
  });
});

describe('trash wording', () => {
  const nameOf = (id: string) => (id === 'dione' ? 'Dione' : id);
  it('says who deleted it, in words, and when an undo removed it', () => {
    expect(trashedText({ deletedBy: 'user' }, false, nameOf)).toBe('cancellata da te');
    expect(trashedText({ deletedBy: 'dione' }, false, nameOf)).toBe('cancellata da Dione');
    expect(trashedText({ deletedBy: 'user' }, true, nameOf)).toBe('tolta annullando la creazione');
    const undo = change('undo', 'Inbox/X.md', 'act_u', { undoneActionId: 'act_c' });
    expect(trashedByUndo('act_u', [undo])).toBe(true);
    expect(trashedByUndo('act_c', [undo])).toBe(false);
    expect(trashedByUndo(null, [undo])).toBe(false);
  });
});

describe('tools of another program in pause', () => {
  const sec = (action: 'mcp_tools_changed' | 'mcp_tools_accepted', server: string) =>
    ev({
      agent: 'system',
      type: 'security',
      data: {
        action,
        source: `mcp:${server}`,
        tool: `mcp__${server}`,
        server,
        message: `${server} ha cambiato uno strumento`,
      },
    });

  it('lists the servers whose last word is "changed", not the accepted ones', () => {
    const events = [
      sec('mcp_tools_changed', 'github'),
      sec('mcp_tools_changed', 'notion'),
      sec('mcp_tools_accepted', 'github'),
      sec('mcp_tools_changed', 'github'),
      sec('mcp_tools_accepted', 'notion'),
    ];
    expect(pausedToolEvents(events).map((e) => e.data.server)).toEqual(['github']);
    expect(pausedToolEvents([...events, sec('mcp_tools_accepted', 'github')])).toEqual([]);
  });

  const withTools = (
    action: 'mcp_tools_changed' | 'mcp_tools_accepted',
    server: string,
    tools: string[],
  ) =>
    ev({
      agent: 'system',
      type: 'security',
      data: {
        action,
        source: `mcp:${server}`,
        tool: `mcp__${server}`,
        server,
        tools: tools.map((name) => ({ name, change: 'new' as const })),
        message: `${server}: ${tools.join(', ')}`,
      },
    });

  it('keeps a server while one of its tools is still paused', () => {
    const changed = withTools('mcp_tools_changed', 'github', ['a', 'b', 'c']);
    const one = withTools('mcp_tools_accepted', 'github', ['a']);
    expect(pausedToolEvents([changed, one])).toEqual([changed]);
    const rest = withTools('mcp_tools_accepted', 'github', ['b', 'c']);
    expect(pausedToolEvents([changed, one, rest])).toEqual([]);
    // Two pauses, the later one accepted: the earlier one is still shown.
    const later = withTools('mcp_tools_changed', 'github', ['d']);
    const accepted = withTools('mcp_tools_accepted', 'github', ['d']);
    expect(pausedToolEvents([changed, later, accepted])).toEqual([changed]);
  });

  it('forgets the tools of a server that was removed', () => {
    const changed = withTools('mcp_tools_changed', 'github', ['a']);
    const removed = ev({
      agent: 'user',
      type: 'mcp_server',
      data: { server: 'github', action: 'removed', transport: 'stdio', by: 'ui' },
    });
    expect(pausedToolEvents([changed, removed])).toEqual([]);
  });
});
