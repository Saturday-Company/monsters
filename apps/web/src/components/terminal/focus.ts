import { create } from 'zustand';
import { openTerminal } from '../../store/app.ts';

/*
 * Where "Dietro le quinte" should look when it opens: the run of a turn, from
 * the work strip of its turn in the chat (docs/design.md, "The chat"). The
 * nonce makes a second click on the same line scroll there again.
 */
export const useTerminalFocus = create<{ runId: string | null; nonce: number }>(() => ({
  runId: null,
  nonce: 0,
}));

/** Opens the terminal of a monster, scrolled to a run when one is given. */
export function openTerminalAt(agentId: string, runId?: string | null): void {
  useTerminalFocus.setState((s) => ({ runId: runId ?? null, nonce: s.nonce + 1 }));
  openTerminal(agentId);
}
