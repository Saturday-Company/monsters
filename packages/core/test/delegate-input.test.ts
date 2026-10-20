import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import {
  completeBrief,
  delegateInputSchema,
  delegateTool,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';

const member = (id: string, name: string, kind = 'subagent') =>
  ({ config: { id, name, kind, role: name } }) as unknown as AgentDefinition;

describe('delegate input', () => {
  // Only the schema is exercised: the context gives the team's names, nothing else.
  const tool = delegateTool({
    self: member('titan', 'Titan', 'orchestrator'),
    team: {
      list: () => [member('titan', 'Titan'), member('rhea', 'Rhea'), member('dione', 'Dione')],
    },
  } as unknown as TeamToolsContext);

  it('accepts a single string where small models forget the list', () => {
    const parsed = tool.inputSchema.parse({
      agent: 'Rhea',
      goal: 'Trova 3 fatti',
      constraints: 'solo fonti ufficiali',
      context_links: '[[Encelado]]',
    });
    expect(parsed).toMatchObject({
      constraints: ['solo fonti ufficiali'],
      context_links: ['[[Encelado]]'],
    });
  });

  it('still accepts lists and omitted fields', () => {
    expect(
      tool.inputSchema.parse({ agent: 'Dione', goal: 'Bozza', constraints: ['breve'] }),
    ).toMatchObject({
      constraints: ['breve'],
    });
    expect(tool.inputSchema.parse({ agent: 'Dione', goal: 'Bozza' })).not.toHaveProperty(
      'constraints',
    );
  });

  it('shows the team names as an enum, and still takes "rhea" (resolved by name later)', () => {
    const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as unknown as {
      properties: { agent: { enum?: string[] } };
    };
    // Everybody but the orchestrator itself.
    expect(schema.properties.agent.enum).toEqual(['Rhea', 'Dione']);
    expect(tool.inputSchema.safeParse({ agent: 'rhea', goal: 'x' }).success).toBe(true);
    // A team of one: no enum, any string.
    const alone = z.toJSONSchema(delegateInputSchema([]), { io: 'input' }) as unknown as {
      properties: { agent: { enum?: string[] } };
    };
    expect(alone.properties.agent.enum).toBeUndefined();
  });
});

describe('brief defaults (AG-11)', () => {
  const defaults = {
    request: 'Preparami 3 post per il menu autunnale, senza emoji',
    user: 'Giulio',
    area: 'Inbox/Bozze',
    report: 'il testo o il percorso della bozza, le scelte fatte, cosa resta da decidere',
  };

  it('a brief with only the goal gets the user’s words, "done when" and the format', () => {
    const { brief, filled } = completeBrief(
      { agent: 'Dione', goal: 'Tre post sul menu' },
      defaults,
    );
    expect(filled).toEqual([]);
    expect(brief).toEqual({
      goal: 'Tre post sul menu',
      why: 'Richiesta di Giulio: «Preparami 3 post per il menu autunnale, senza emoji»',
      doneWhen: 'il risultato è salvato in Inbox/Bozze/ e il rapporto è pronto',
      outputFormat: defaults.report,
    });
  });

  it('what the orchestrator wrote wins, and is listed as filled', () => {
    const { brief, filled } = completeBrief(
      {
        agent: 'Dione',
        goal: 'Tre post sul menu',
        why: 'per Instagram',
        done_when: 'tre post in una nota',
        output_format: 'una nota con tre sezioni',
        context_links: ['[[Menu autunnale]]'],
      },
      defaults,
    );
    expect(filled).toEqual(['why', 'context_links', 'output_format', 'done_when']);
    expect(brief.why).toBe(
      'per Instagram\nRichiesta di Giulio: «Preparami 3 post per il menu autunnale, senza emoji»',
    );
    expect(brief.doneWhen).toBe('tre post in una nota');
    expect(brief.outputFormat).toBe('una nota con tre sezioni');
  });

  it('the request is not repeated when the goal already is the request, and is clipped', () => {
    const same = completeBrief({ agent: 'Dione', goal: defaults.request }, defaults);
    expect(same.brief.why).toBeUndefined();
    const long = completeBrief(
      { agent: 'Dione', goal: 'Riassunto' },
      { ...defaults, request: 'a'.repeat(2000) },
    );
    expect(long.brief.why!.length).toBeLessThan(650);
  });
});
