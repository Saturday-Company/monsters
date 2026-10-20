import { LogEventSchema, UlidSchema } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/i18n/strings.ts';
import { EVENTS, summarize, ulidAt } from '../src/lib/eventlog.ts';
import { crc32, xxd, bytesOf } from '../src/lib/hexdump.ts';
import { COMMANDS, complete, runCommand, tokenize } from '../src/lib/palette.ts';
import { HISTORY, UNDO_COMMIT, diffLines } from '../src/lib/vaultlog.ts';

const ctx = {
  killed: false,
  repo: 'https://github.com/Saturday-Company/monsters',
  roster: ['Titan', 'Rhea'],
};
const en = STRINGS.en.palette;

describe('command palette', () => {
  it('tokenizes words and quoted strings', () => {
    expect(tokenize('  summon   "Big Mimas"  ')).toEqual(['summon', 'Big Mimas']);
    expect(tokenize("lang 'it'")).toEqual(['lang', 'it']);
    expect(tokenize('')).toEqual([]);
  });

  it('prints help with every command and its description, in both languages', () => {
    for (const lang of ['en', 'it'] as const) {
      const res = runCommand('help', STRINGS[lang].palette, ctx);
      expect(res.out).toHaveLength(COMMANDS.length);
      for (const c of COMMANDS) {
        expect(STRINGS[lang].palette.desc[c.name]).toBeTruthy();
        expect(res.out.some((l) => l.startsWith(c.usage))).toBe(true);
      }
    }
  });

  it('accepts the real CLI prefix, aliases and any case', () => {
    expect(runCommand('monsters kill', en, ctx).action).toEqual({ kind: 'kill' });
    expect(runCommand('/stop', en, ctx).action).toEqual({ kind: 'kill' });
    expect(runCommand('KILL', en, ctx).action).toEqual({ kind: 'kill' });
    expect(runCommand('?', en, ctx).out.length).toBe(COMMANDS.length);
  });

  it('kill and resume follow the state of the switch', () => {
    expect(runCommand('kill', en, { ...ctx, killed: true })).toEqual({ out: [en.alreadyKilled] });
    expect(runCommand('resume', en, ctx)).toEqual({ out: [en.notKilled] });
    expect(runCommand('resume', en, { ...ctx, killed: true }).action).toEqual({ kind: 'resume' });
  });

  it('summon needs a name and keeps it to 40 characters', () => {
    expect(runCommand('summon', en, ctx).error).toBe(true);
    expect(runCommand('summon Phoebe the Second', en, ctx).action).toEqual({
      kind: 'summon',
      name: 'Phoebe the Second',
    });
    const long = runCommand(`summon ${'x'.repeat(60)}`, en, ctx).action;
    expect(long && long.kind === 'summon' && long.name.length).toBe(40);
  });

  it('switches language only to en or it', () => {
    expect(runCommand('lang it', en, ctx).action).toEqual({ kind: 'lang', lang: 'it' });
    expect(runCommand('lang fr', en, ctx).error).toBe(true);
  });

  it('maps the other verbs to their actions', () => {
    expect(runCommand('download', en, ctx).action).toEqual({ kind: 'download' });
    expect(runCommand('star', en, ctx).action).toEqual({ kind: 'open', url: ctx.repo });
    expect(runCommand('squad', en, ctx).out).toEqual([en.squad, '  00  Titan', '  01  Rhea']);
    expect(runCommand('man monsters', en, ctx).action).toEqual({ kind: 'goto', target: 'faq' });
    expect(runCommand('invaders', en, ctx).action).toEqual({ kind: 'invaders' });
    expect(runCommand('clear', en, ctx)).toEqual({ out: [], action: { kind: 'clear' } });
    expect(runCommand('exit', en, ctx).action).toEqual({ kind: 'exit' });
  });

  it('answers unknown commands and sudo with an error, and ignores empty lines', () => {
    expect(runCommand('rm -rf /', en, ctx)).toEqual({
      out: ['rm: command not found. Try help.'],
      error: true,
    });
    expect(runCommand('sudo kill', en, ctx).error).toBe(true);
    expect(runCommand('   ', en, ctx)).toEqual({ out: [] });
  });

  it('completes command names', () => {
    expect(complete('su')).toEqual(['summon']);
    expect(complete('monsters re')).toEqual(['resume']);
    expect(complete('s')).toEqual(['star', 'squad', 'summon']);
    expect(complete('summon x')).toEqual([]);
    expect(complete('')).toEqual([]);
  });
});

describe('the action log of the hero', () => {
  it('is made of events valid for the core schema, in time order', () => {
    let last = 0;
    for (const e of EVENTS) {
      const parsed = LogEventSchema.safeParse(e);
      expect(parsed.success, `${e.type}: ${parsed.error?.message ?? ''}`).toBe(true);
      expect(e.ts).toBeGreaterThanOrEqual(last);
      last = e.ts;
    }
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length);
  });

  it('makes valid ULIDs', () => {
    expect(UlidSchema.safeParse(ulidAt(Date.UTC(2026, 9, 20), 3)).success).toBe(true);
    expect(ulidAt(1, 1)).not.toBe(ulidAt(1, 2));
  });

  it('summarizes each event on one short line', () => {
    expect(summarize({ type: 'kill', data: { scope: 'global', by: 'ui', runsAborted: 1 } })).toBe(
      'scope=global by=ui runsAborted=1',
    );
    for (const e of EVENTS) expect(summarize(e).length).toBeLessThan(80);
  });
});

describe('hex dump and checksum', () => {
  it('prints xxd rows', () => {
    expect(xxd(bytesOf('{\n  "id": "x"\n}'))).toEqual([
      '00000000: 7b0a 2020 2269 6422 3a20 2278 220a 7d    {.  "id": "x".}',
    ]);
    expect(xxd(bytesOf('a'.repeat(40)), { maxRows: 2 })).toHaveLength(2);
  });

  it('computes CRC-32 (IEEE)', () => {
    expect(crc32('123456789')).toBe('cbf43926');
    expect(crc32('')).toBe('00000000');
  });
});

describe('the vault history', () => {
  it('uses the vault commit subject format', () => {
    for (const c of [...HISTORY.slice(0, 3), UNDO_COMMIT])
      expect(c.subject).toMatch(
        /^vault_[a-z_]+: \S+ \[agent=[a-z]+ action=[0-9A-HJKMNP-TV-Z]{26}\]$/,
      );
  });

  it('undo is the same hunk reversed', () => {
    const done = diffLines(false);
    const undone = diffLines(true);
    expect(done.filter((l) => l.kind === 'add').map((l) => l.text.slice(1))).toEqual(
      undone.filter((l) => l.kind === 'del').map((l) => l.text.slice(1)),
    );
  });
});
