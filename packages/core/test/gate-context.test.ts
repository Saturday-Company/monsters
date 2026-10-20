import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import type { GateRequest } from '../src/team/decision.ts';
import { askUserTool, type TeamToolsContext } from '../src/team/team-tools.ts';

/* AG-25: the gate decides with the request being worked on, not the first message of the run. */

describe('ask_user: context of the DecisionGate', () => {
  function tool(requestText: (() => string | undefined) | undefined) {
    const seen: GateRequest[] = [];
    const ctx = {
      run: { id: 'r1', goal: 'Primo messaggio del run: preparami la newsletter' },
      self: { config: { id: 'titan' } } as AgentDefinition,
      questions: { list: () => [], eventIdOf: () => undefined },
      gate: {
        decide: (r: GateRequest) => {
          seen.push(r);
          return Promise.resolve({
            outcome: 'proceed',
            choice: 'Inbox',
            decidedBy: 'rules',
            reason: 'local',
          });
        },
      },
      ...(requestText ? { requestText } : {}),
    } as unknown as TeamToolsContext;
    return { tool: askUserTool(ctx), seen };
  }
  const call = { callId: 'c1', signal: new AbortController().signal } as unknown as Parameters<
    ReturnType<typeof askUserTool>['execute']
  >[1];
  const input = { question: 'Salvo in Inbox o in Progetti?', options: ['Inbox', 'Progetti'] };

  it('uses the text of the current request', async () => {
    const { tool: t, seen } = tool(() => 'Seconda richiesta: riordina gli appunti di ieri');
    await t.execute(t.inputSchema.parse(input), call);
    expect(seen[0]?.context).toBe('Seconda richiesta: riordina gli appunti di ieri');
  });

  it('falls back to the goal of the run without it', async () => {
    const { tool: t, seen } = tool(undefined);
    await t.execute(t.inputSchema.parse(input), call);
    expect(seen[0]?.context).toBe('Primo messaggio del run: preparami la newsletter');
  });
});
