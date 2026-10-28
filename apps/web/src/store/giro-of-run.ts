import { growing } from './derive.ts';

/** The giro of an automation a run of the core belongs to. */
export interface RunGiro {
  automationId: string;
  /** The giro: the id of its first run. */
  giro: string;
}

interface State {
  value: ReadonlyMap<string, RunGiro>;
  copied: boolean;
}

/**
 * The runs of the core that are part of an automation's giro, by run id. The questions of such a
 * run are not in any chat (the chats leave the giri out): they are answered on the giro's page.
 */
export const giroOfRun = growing<ReadonlyMap<string, RunGiro>, State>(
  () => ({ value: new Map(), copied: true }),
  (state, e) => {
    if (e.type !== 'automation_run_started' || !e.runId) return;
    if (!state.copied) {
      state.value = new Map(state.value);
      state.copied = true;
    }
    (state.value as Map<string, RunGiro>).set(e.runId, {
      automationId: e.data.automationId,
      giro: e.data.giro,
    });
  },
);
