import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@monsters/shared';
import { automationRunOf } from '../src/automations/run-index.ts';
import {
  coreMigrations,
  createRedactor,
  EventLog,
  isSecretKey,
  migrate,
  openDb,
  REDACTED,
} from '../src/index.ts';

function setup(now?: () => number) {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db, now ? { now } : {});
  return { db, log };
}

describe('redaction', () => {
  const r = createRedactor();

  it('masks values of sensitive keys at any depth', () => {
    const out = r.redact({
      apiKey: 'abc',
      nested: {
        Authorization: 'whatever',
        'x-api-key': 'k',
        password: 'p',
        list: [{ token: 't' }],
      },
      inputTokens: 120,
      maxTokens: 10,
      tool: 'web_search',
    });
    expect(out).toEqual({
      apiKey: REDACTED,
      nested: {
        Authorization: REDACTED,
        'x-api-key': REDACTED,
        password: REDACTED,
        list: [{ token: REDACTED }],
      },
      inputTokens: 120,
      maxTokens: 10,
      tool: 'web_search',
    });
  });

  it('recognises key names', () => {
    for (const k of ['api_key', 'OPENROUTER_API_KEY', 'client_secret', 'refreshToken', 'cookie']) {
      expect(isSecretKey(k)).toBe(true);
    }
    for (const k of ['inputTokens', 'tokenCount', 'author', 'keyword', 'path']) {
      expect(isSecretKey(k)).toBe(false);
    }
  });

  it('masks well-known token patterns inside strings', () => {
    const cases: [string, string][] = [
      ['key sk-or-v1-0123456789abcdef0123456789abcdef here', `key ${REDACTED} here`],
      ['sk-ant-api03-AAAABBBBCCCCDDDDEEEE', REDACTED],
      ['sk-proj-abcdefghijklmnop1234', REDACTED],
      ['Authorization: Bearer abc.def.ghi-123456', `Authorization: Bearer ${REDACTED}`],
      [
        'curl -H "authorization: bearer 0123456789abcdef"',
        `curl -H "authorization: bearer ${REDACTED}"`,
      ],
      ['ghp_0123456789abcdefghijABCDEFGHIJ', REDACTED],
      ['https://user:hunter22@example.com/x', `https://${REDACTED}@example.com/x`],
      ['OPENROUTER_API_KEY=abcdef123456', `OPENROUTER_API_KEY=${REDACTED}`],
    ];
    for (const [input, expected] of cases) expect(r.redactString(input)).toBe(expected);
    expect(r.redactString('nothing secret here, 42 tokens used')).toBe(
      'nothing secret here, 42 tokens used',
    );
  });

  it('masks registered secret values and handles cycles without mutating input', () => {
    const red = createRedactor(['my-very-private-value']);
    const input: Record<string, unknown> = { text: 'value is my-very-private-value!' };
    input['self'] = input;
    const out = red.redact<Record<string, unknown>>(input);
    expect(out['text']).toBe(`value is ${REDACTED}!`);
    expect(out['self']).toBe('[CIRCULAR]');
    expect(input['text']).toBe('value is my-very-private-value!');
  });
});

describe('EventLog', () => {
  it('appends validated events with ULID ids and redacts secrets before writing', () => {
    const { db, log } = setup();
    const e = log.append({
      agent: 'rhea',
      runId: 'run-1',
      type: 'tool_call',
      data: {
        callId: 'c1',
        tool: 'web_fetch',
        input: {
          url: 'https://x.dev',
          headers: { authorization: 'Bearer sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaa' },
          apiKey: 'sk-123',
        },
      },
    });
    expect(e.id).toMatch(/^[0-9A-Z]{26}$/);
    const raw = db.get<{ data: string }>('SELECT data FROM events WHERE id = ?', e.id);
    expect(raw?.data).not.toContain('sk-or-v1');
    expect(raw?.data).not.toContain('sk-123');
    expect(raw?.data).toContain(REDACTED);
    expect(log.get(e.id)).toEqual(e);
  });

  it('rejects invalid events', () => {
    const { log } = setup();
    expect(() =>
      log.append({ agent: 'Not A Slug', type: 'error', data: { message: 'x' } }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error unknown type
      log.append({ agent: 'rhea', type: 'nope', data: {} }),
    ).toThrow();
  });

  it('is append-only at the database level', () => {
    const { db, log } = setup();
    log.append({ agent: 'system', type: 'error', data: { message: 'x' } });
    expect(() => db.exec("UPDATE events SET agent = 'x'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM events')).toThrow(/append-only/);
  });

  it('filters by agent, type, run, period and cursor', () => {
    let t = 1_000;
    const { log } = setup(() => t);
    const add = (agent: string, runId: string | null, msg: string) => {
      t += 10;
      return log.append({ agent, runId, type: 'message', data: { role: 'agent', text: msg } });
    };
    const a = add('rhea', 'r1', 'a');
    add('dione', 'r1', 'b');
    const c = add('rhea', 'r2', 'c');
    t += 10;
    log.append({ agent: 'system', type: 'error', data: { message: 'e' } });

    expect(log.query({ agent: 'rhea' }).map((e) => e.id)).toEqual([a.id, c.id]);
    expect(log.query({ agent: ['rhea', 'dione'] })).toHaveLength(3);
    expect(log.query({ type: 'error' })).toHaveLength(1);
    expect(log.query({ type: ['message', 'error'] })).toHaveLength(4);
    expect(log.query({ runId: 'r1' })).toHaveLength(2);
    expect(log.query({ since: 1_020, until: 1_031 })).toHaveLength(2);
    expect(log.query({ after: a.id })).toHaveLength(3);
    expect(log.query({ order: 'desc', limit: 1 })[0]?.type).toBe('error');
  });

  it('notifies subscribers after persisting and isolates failing listeners', () => {
    const errors: unknown[] = [];
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db, { onListenerError: (e) => errors.push(e) });
    const seen: LogEvent[] = [];
    log.subscribe(() => {
      throw new Error('bad listener');
    });
    const off = log.subscribe((e) => {
      expect(log.get(e.id)).toBeDefined();
      seen.push(e);
    });
    log.append({ agent: 'system', type: 'resume', data: { by: 'cli' } });
    off();
    log.append({ agent: 'system', type: 'resume', data: { by: 'cli' } });
    expect(seen).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it('the run index of the automations sees a giro started inside a listener at once', () => {
    const { log } = setup();
    expect(automationRunOf(log, 'r9')).toBeNull();
    let seen: unknown = 'not yet';
    log.subscribe((e) => {
      if (e.type !== 'resume') return;
      log.append({
        agent: 'titan',
        runId: 'r9',
        type: 'automation_run_started',
        data: { automationId: 'posta', name: 'Posta', giro: 'r9', trigger: 'schedule' },
      });
      // Still undelivered: the index must know of it all the same.
      seen = automationRunOf(log, 'r9');
    });
    log.append({ agent: 'system', type: 'resume', data: { by: 'cli' } });
    expect(seen).toEqual({ automationId: 'posta', giro: 'r9' });
  });

  it('delivers events appended by a subscriber after the current one, in id order', () => {
    const { log } = setup();
    // The first subscriber reacts to a stopped run (like the hub expiring its questions).
    log.subscribe((e) => {
      if (e.type === 'run' && e.data.status === 'aborted') {
        log.append({
          agent: 'titan',
          runId: 'r1',
          type: 'question_expired',
          data: { questionId: 'q1', reason: 'run_aborted' },
        });
      }
    });
    const seen: string[] = [];
    let last = '';
    log.subscribe((e) => {
      expect(e.id > last).toBe(true);
      last = e.id;
      seen.push(e.type);
    });
    log.append({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'aborted' } });
    expect(seen).toEqual(['run', 'question_expired']);
  });
});
