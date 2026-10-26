import { findSettingsPlaces, setAppLang, type LimitReason } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { detailsOf } from '../src/components/log/details.ts';
import {
  delegationLimitSentence,
  errorSentence,
  limitStopSentence,
  makeNameOf,
} from '../src/store/derive.ts';

/*
 * A job that stops at a limit says which one, in the person's language, and where to change it
 * (the core sends the cap as data in `limit`): "Franco stops here: the job used all its 400
 * steps on the plan." Events without `limit` keep the old, generic text.
 */

afterEach(() => setAppLang('en'));

const names = makeNameOf({});
const WHERE_EN = 'Settings → Models → Spending cap → Safety net';
const WHERE_IT = 'Impostazioni → Modelli → Tetto di spesa → Rete di sicurezza';

function both<T>(fn: () => T): [T, T] {
  setAppLang('en');
  const en = fn();
  setAppLang('it');
  const it = fn();
  setAppLang('en');
  return [en, it];
}

const run = (limit?: LimitReason, code = 'run_limit') =>
  errorSentence(
    {
      agent: 'franco',
      data: { code, message: 'Franco stops: this task used all its 400 model steps', limit },
    },
    names,
  );

describe('which limit stopped a job', () => {
  it('says the steps of the plan and where to raise them', () => {
    const [en, it] = both(() => run({ kind: 'steps', value: 400, plan: true }));
    expect(en).toBe(
      `Franco stops here: the job used all its 400 steps on the plan. You can raise the limit in ${WHERE_EN}.`,
    );
    expect(it).toBe(
      `Franco si ferma qui: il lavoro ha usato tutti i suoi 400 passi sul piano. Puoi alzare il limite in ${WHERE_IT}.`,
    );
  });

  it('tells the API steps, the tokens and the cost apart from the plan’s', () => {
    expect(run({ kind: 'steps', value: 150 })).toContain('all its 150 model steps.');
    expect(run({ kind: 'tokens', value: 1_500_000 })).toContain('all its 1,500,000 tokens.');
    expect(run({ kind: 'tokens', value: 5_000_000, plan: true })).toContain(
      'all its 5,000,000 tokens on the plan.',
    );
    expect(run({ kind: 'cost', value: 0.5 })).toContain('spent its €0.43 limit.');
    expect(run({ kind: 'tree_cost', value: 1.5 })).toContain('with the work sent to projects');
    const [, it] = both(() => run({ kind: 'cost', value: 0.5 }));
    expect(it).toContain('ha speso il suo limite di 0,43 €.');
  });

  it('the place it names is a link to the row, in either language', () => {
    for (const sentence of both(() => run({ kind: 'steps', value: 400, plan: true }))) {
      const places = findSettingsPlaces(sentence);
      expect(places).toHaveLength(1);
      expect(places[0]).toMatchObject({ tab: 'limiti' });
      expect(places[0]!.text).toMatch(/(Safety net|Rete di sicurezza)$/);
    }
    // A plain tab is still the tab.
    expect(findSettingsPlaces('Impostazioni → Modelli')[0]).toMatchObject({ tab: 'modelli' });
  });

  it('a monster’s own limits do not point to the settings of the jobs', () => {
    const tokens = run({ kind: 'agent_tokens', value: 400_000 }, 'token_limit');
    expect(tokens).toBe(
      `Franco stops here: it used all its 400,000 tokens for this job. You can raise the limit in ${WHERE_EN}.`,
    );
    // Its own limit (agent.yaml) is not in those settings.
    const own = run({ kind: 'agent_tokens', value: 7000, own: true }, 'token_limit');
    expect(own).toBe('Franco stops here: it used all its 7,000 tokens for this job.');
    const steps = run({ kind: 'agent_steps', value: 12 }, 'max_steps');
    expect(steps).toBe('Franco stops here: it used all its 12 steps without finishing.');
  });

  it('says the monster wrote a partial report when it did (D-196)', () => {
    const stopped = (code: string, limit?: LimitReason) =>
      errorSentence(
        {
          agent: 'franco',
          data: { code, message: 'stopped', report: true, ...(limit ? { limit } : {}) },
        },
        names,
      );
    const [en, it] = both(() => stopped('max_steps', { kind: 'agent_steps', value: 30 }));
    expect(en).toBe(
      'Franco stops here: it used all its 30 steps without finishing. It wrote a partial report.',
    );
    expect(it).toMatch(/Ha scritto un rapporto parziale\.$/);
    // The generic sentence of an older run limit gets its full stop first.
    expect(stopped('run_limit')).toBe(
      'Franco stops here: this job reached its limit. It wrote a partial report.',
    );
    // Without the flag, nothing is added.
    expect(run({ kind: 'agent_steps', value: 12 }, 'max_steps')).not.toContain('report');
  });

  it('the spending cap keeps its own words', () => {
    const sentence = errorSentence(
      {
        agent: 'franco',
        data: {
          code: 'run_limit',
          message: 'Franco stops: all monsters’ spending cap for today was reached.',
          limit: { kind: 'spend' },
        },
      },
      names,
    );
    expect(sentence).toBe('Franco stops: all monsters’ spending cap for today was reached');
    expect(limitStopSentence('Franco', 'run_limit', { kind: 'spend' })).toBeNull();
  });

  it('older events without the data keep the generic text', () => {
    const [en, it] = both(() => run(undefined));
    expect(en).toBe('Franco stops here: this job reached its limit');
    expect(it).toBe('Franco si ferma qui: questo lavoro ha raggiunto il suo limite');
    // A token or step limit without data is the core’s own sentence, as before.
    expect(
      errorSentence(
        { agent: 'franco', data: { code: 'token_limit', message: 'Franco went over 1000 tokens' } },
        names,
      ),
    ).toBe('Franco ran into a problem: Franco went over 1000 tokens');
  });
});

describe('a delegation that stopped at a limit', () => {
  const failed = {
    status: 'failed',
    runStatus: 'run_limit',
    limit: { kind: 'steps', value: 400, plan: true } as LimitReason,
  };

  it('is worded in the person’s language, not with the core’s English for the model', () => {
    const [en, it] = both(() => delegationLimitSentence(failed, 'Franco'));
    expect(en).toBe(
      `Franco stops here: the job used all its 400 steps on the plan. You can raise the limit in ${WHERE_EN}. It wrote no report.`,
    );
    expect(it).toBe(
      `Franco si ferma qui: il lavoro ha usato tutti i suoi 400 passi sul piano. Puoi alzare il limite in ${WHERE_IT}. Non ha scritto nessun rapporto.`,
    );
  });

  it('with a partial report it says so, and it is not a failure', () => {
    const partial = { ...failed, status: 'aborted', summary: 'Trovate 3 fonti su 5' };
    const [en, it] = both(() => delegationLimitSentence(partial, 'Franco'));
    expect(en).toMatch(/It wrote a partial report\.$/);
    expect(it).toMatch(/Ha scritto un rapporto parziale\.$/);
  });

  it('without the cap (an older event) it still says it stopped at a limit', () => {
    const old = { status: 'failed', runStatus: 'token_limit' };
    expect(delegationLimitSentence(old, 'Franco')).toBe(
      'Franco stops here: it reached its token limit. It wrote no report.',
    );
  });

  it('is nothing for the other delegations', () => {
    expect(delegationLimitSentence({ status: 'completed' }, 'Franco')).toBeNull();
    expect(delegationLimitSentence({ status: 'failed' }, 'Franco')).toBeNull();
    expect(
      delegationLimitSentence({ status: 'aborted', runStatus: 'aborted' }, 'Franco'),
    ).toBeNull();
    expect(delegationLimitSentence({ ...failed, limit: { kind: 'spend' } }, 'Franco')).toBeNull();
  });

  it('is the problem line in the details of the log', () => {
    const fields = detailsOf({
      id: 'e1',
      ts: 1,
      agent: 'samantha',
      type: 'delegation',
      data: {
        from: 'samantha',
        to: 'franco',
        goal: 'Cerca',
        error: 'Franco stopped at its limit (run_limit) without a report',
        ...failed,
      },
    } as never);
    expect(fields.find((f) => f.value.includes('400 steps'))?.value).toContain(
      'the job used all its 400 steps on the plan',
    );
    expect(JSON.stringify(fields)).not.toContain('without a report');
  });
});
