import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { abortMessage } from '../src/agents/run-agent.ts';
import { runAgentStrings } from '../src/agents/run-agent.strings.ts';
import { accessStrings } from '../src/team/access.strings.ts';
import { decisionStrings } from '../src/team/decision.strings.ts';
import { classifyOutbound } from '../src/team/instinct/outbound.ts';
import { brakeQuestion } from '../src/team/instinct/guard.ts';
import { instinctStrings } from '../src/team/instinct/instinct.strings.ts';
import { permissionsStrings } from '../src/team/permissions.strings.ts';
import { describeToolCall } from '../src/team/team-service.ts';
import { teamManagerStrings } from '../src/team/team-manager.strings.ts';
import { teamStrings } from '../src/team/team.strings.ts';

/* The team's dictionaries (D-153): English by default in the tests, Italian when the app says so. */

afterEach(() => setAppLang('en'));

describe('the team dictionaries', () => {
  it('speak English by default and Italian when the app language is Italian', () => {
    expect(teamManagerStrings().unknownProject('x')).toBe('There’s no project "x".');
    expect(permissionsStrings().isFile('/tmp/a')).toBe('/tmp/a is a file, not a folder.');
    expect(accessStrings().grant).toBe('Yes, grant');
    expect(decisionStrings().grayNoModel).toBe('gray area without a model: asking');
    expect(runAgentStrings().taskLimit).toBe('task limit reached');
    setAppLang('it');
    expect(teamManagerStrings().unknownProject('x')).toBe('Non c’è un progetto "x".');
    expect(permissionsStrings().isFile('/tmp/a')).toBe('/tmp/a è un file, non una cartella.');
    expect(accessStrings().grant).toBe('Sì, concedi');
    expect(decisionStrings().grayNoModel).toBe('zona grigia senza modello: si chiede');
    expect(runAgentStrings().taskLimit).toBe('limite del compito raggiunto');
  });

  it('plurals and lists follow the language', () => {
    expect(teamManagerStrings().busy(['Rhea', 'Nova'])).toBe(
      'Rhea and Nova are still working: wait for them to finish or stop the squad, then change it.',
    );
    expect(teamStrings().memorySkipped('Rhea', 1)).toContain('a line that only mattered');
    setAppLang('it');
    expect(teamManagerStrings().busy(['Rhea', 'Nova'])).toBe(
      'Rhea e Nova stanno ancora lavorando: aspetta che finisca o ferma la squadra, poi cambiala.',
    );
    expect(teamManagerStrings().busy(['Rhea'])).toContain('Rhea sta ancora lavorando');
    expect(teamStrings().memorySkipped('Rhea', 3)).toBe(
      'Non ho aggiunto alla memoria di Rhea 3 righe che servivano solo a questo lavoro.',
    );
  });

  it('the card of the brake and what an action means', () => {
    expect(brakeQuestion('Rhea', 'run “git push”', 'publish')).toBe(
      'Rhea wants to run “git push”, meaning publish. Proceed?',
    );
    const push = classifyOutbound({ name: 'shell' } as Parameters<typeof classifyOutbound>[0], {
      command: 'git push origin main',
    });
    expect(push?.summary).toBe('run “git push origin main”');
    setAppLang('it');
    expect(brakeQuestion('Rhea', 'eseguire «git push»', 'publish')).toBe(
      'Rhea vuole eseguire «git push», cioè pubblicare. Procedo?',
    );
    const pushIt = classifyOutbound({ name: 'shell' } as Parameters<typeof classifyOutbound>[0], {
      command: 'git push origin main',
    });
    expect(pushIt?.summary).toBe('eseguire «git push origin main»');
    expect(instinctStrings().hold('Rhea', 'eseguire «x»')).toBe(
      'Rhea vuole eseguire «x»: aspetta la tua risposta.',
    );
  });

  it('the line under a monster and the stop of a job', () => {
    expect(describeToolCall('web_search', { query: 'moons' })).toBe('searches the web: moons');
    expect(abortMessage('Rhea', 'stopped (run)')).toBe('Rhea’s job stopped: you stopped this job');
    setAppLang('it');
    expect(describeToolCall('web_search', { query: 'lune' })).toBe('cerca sul web: lune');
    expect(abortMessage('Rhea', 'stopped (run)')).toBe(
      'Il lavoro di Rhea si è fermato: hai fermato questo lavoro',
    );
  });
});
