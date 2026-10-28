import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { detailsOf } from '../src/components/log/details.ts';
import { toolProblem, type FailedTool } from '../src/store/tool-problem.ts';

/* A failed note tool in plain words (store/tool-problem.ts), in both languages (D-153). */

afterEach(() => setAppLang('en'));

const marta = { id: 'marta', name: 'Marta' };

/** A failure as the core logs it: the `error` text and the `output` the model read. */
function failure(tool: string, code: string, message: string, hint?: string): FailedTool {
  return {
    tool,
    error: `${code}: ${message}`,
    output: { error: { code, message, ...(hint ? { hint } : {}) } },
  };
}

const writeHint =
  'Use vault_propose to suggest this change: it creates a proposal in Inbox/ that the orchestrator can apply. You can write freely in Agenti/Marta/, create new notes in Inbox/ and edit your own notes there, and in Commerciale/. The user can change the note areas of a monster.';

describe('toolProblem', () => {
  it('a write the settings do not allow: who, where it can write, where to change it', () => {
    const f = failure(
      'vault_write',
      'SETTING_OFF',
      'marta cannot write Commerciale/Z One – application e pitch deck.md',
      writeHint,
    );
    setAppLang('it');
    expect(toolProblem(f, marta)).toEqual({
      text: 'Marta non può modificare questa nota: scrive solo in Agenti/Marta/ e Commerciale/ e nelle note che ha creato. Le cartelle di un mostro si cambiano in Impostazioni → Squadra → Marta → Dove scrive nelle note.',
      settingsLabel: 'Apri le impostazioni di Marta',
    });
    setAppLang('en');
    expect(toolProblem(f, marta)?.text).toBe(
      'Marta can’t edit this note: it only writes in Agenti/Marta/ and Commerciale/ and in the notes it created. A monster’s folders are changed in Settings → Squad → Marta → Where it writes in the notes.',
    );
  });

  it('without the hint (a cut output) the folders are left out, the sentence still stands', () => {
    const f: FailedTool = {
      tool: 'vault_edit',
      error: 'SETTING_OFF: marta cannot write Notes/A.md',
      output: { truncated: true, preview: '…', chars: 9000 },
    };
    setAppLang('it');
    expect(toolProblem(f, marta)?.text).toMatch(
      /^Marta non può modificare questa nota: scrive solo nelle sue cartelle e nelle note che ha creato\./,
    );
  });

  it('deleting and moving have their own sentences', () => {
    const del = failure(
      'vault_delete',
      'SETTING_OFF',
      'marta cannot delete or move Notes/A.md',
      'Use vault_propose to suggest this change: it creates a proposal in Inbox/ that the orchestrator can apply. You can delete and move only inside Agenti/Marta/ and your own notes in Inbox/. The user can change the note areas of a monster.',
    );
    expect(toolProblem(del, marta)?.text).toContain(
      'Marta can’t delete or move this note: it only changes the notes in Agenti/Marta/ and the ones it created.',
    );
    const move = failure(
      'vault_move',
      'SETTING_OFF',
      'marta cannot move notes to Notes/B.md',
      'x. Sub-agents move notes only inside Agenti/Marta/. The user can change the note areas of a monster.',
    );
    setAppLang('it');
    expect(toolProblem(move, marta)?.text).toContain(
      'Marta non può spostare una nota lì: sposta le note solo dentro Agenti/Marta/.',
    );
  });

  it('a section that is not in the note, a note that is not there', () => {
    const section = failure(
      'vault_read',
      'NOT_FOUND',
      'section "4.3 Costi" not found in Progetti/Piano.md',
      'Headings: 1 Intro, 2 Obiettivi',
    );
    expect(toolProblem(section, marta)?.text).toBe(
      'The note has no section with that title: “4.3 Costi”.',
    );
    setAppLang('it');
    expect(toolProblem(section, marta)?.text).toBe(
      'La nota non ha una sezione con quel titolo: «4.3 Costi».',
    );
    const missing = failure('vault_read', 'NOT_FOUND', 'note not found: Progetti/Piano B.md');
    expect(toolProblem(missing, marta)?.text).toBe(
      'Marta ha cercato una nota che non esiste: «Piano B».',
    );
  });

  it('a private note, a note that changed meanwhile, a name taken', () => {
    expect(
      toolProblem(failure('vault_read', 'BLOCKED_BY_POLICY', 'Privato/Conti.md is private'), marta)
        ?.text,
    ).toBe('This note is private: only you and the lead can read it.');
    const conflict = failure(
      'vault_edit',
      'CONFLICT',
      'Notes/A.md changed since you read it',
      'Read the note again (vault_read), then reapply your change with the new hash.',
    );
    setAppLang('it');
    expect(toolProblem(conflict, marta)?.text).toBe(
      'La nota è cambiata nel frattempo: Marta deve rileggerla prima di modificarla.',
    );
    expect(
      toolProblem(failure('vault_write', 'EXISTS', 'Notes/A.md already exists'), marta)?.text,
    ).toBe('Esiste già una nota con quel nome: Marta non l’ha sovrascritta.');
  });

  it('works from the error text alone, and leaves the unknown to the raw error', () => {
    expect(
      toolProblem(
        { tool: 'vault_edit', error: 'CONFLICT: Notes/A.md changed since you read it' },
        marta,
      )?.text,
    ).toMatch(/changed in the meantime/);
    // Another tool, another code, an unknown message, no error at all: null.
    expect(toolProblem(failure('shell', 'SETTING_OFF', 'marta cannot write x'), marta)).toBeNull();
    expect(toolProblem(failure('vault_read', 'INTERNAL', 'boom'), marta)).toBeNull();
    expect(
      toolProblem(failure('vault_read', 'NOT_FOUND', 'commit not found: abc'), marta),
    ).toBeNull();
    expect(toolProblem({ tool: 'vault_read' }, marta)).toBeNull();
  });
});

describe('the Activity details of a failed note tool', () => {
  it('say the problem in plain words first, the raw error after it', () => {
    const f = failure('vault_write', 'SETTING_OFF', 'marta cannot write Notes/A.md', writeHint);
    const fields = detailsOf(
      {
        id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        ts: 1,
        agent: 'marta',
        runId: null,
        parentId: null,
        type: 'tool_result',
        data: { callId: 'c', tool: f.tool, ok: false, error: f.error, output: f.output },
      } as never,
      () => 'Marta',
    );
    expect(fields.map((x) => x.label)).toEqual([
      'Tool',
      'Outcome',
      'Problem',
      'Technical error',
      'Result',
    ]);
    expect(fields[2]).toMatchObject({
      value: expect.stringContaining('Marta can’t edit this note') as unknown,
      link: { label: 'Open Marta’s settings' },
    });
    expect(fields[3]).toMatchObject({
      value: 'SETTING_OFF: marta cannot write Notes/A.md',
      code: true,
    });
  });
});
