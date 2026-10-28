import { ulid, type Channel, type RunSummary } from '@monsters/shared';
import type { StateStore } from '../db/state-store.ts';
import type { EventLog } from '../log/event-log.ts';
import { ControlScope, DEFAULT_KILL_GRACE_MS, KilledError } from './control-scope.ts';
import type { ProcessRegistry } from './process-registry.ts';

/** Thrown by `startRun` while the kill switch is engaged. */
export class HaltedError extends Error {
  readonly code: 'halted' | 'closing' = 'halted';
  constructor(message = 'Monsters is stopped: resume it before starting new work') {
    super(message);
    this.name = 'HaltedError';
  }
}

/**
 * Thrown by `startRun` (and `serviceScope`) once the core is closing (D-098): nothing new
 * starts that the shutdown would then wait for. A `HaltedError`, so every caller that
 * already refuses work while halted refuses it now too; what the user sent stays in the
 * log and the next start picks it up.
 */
export class ClosingError extends HaltedError {
  override readonly code = 'closing';
  constructor() {
    super('Monsters is closing: new work starts at the next start');
    this.name = 'ClosingError';
  }
}

export interface HaltState {
  halted: true;
  at: number;
  reason: string | null;
  by: Channel;
}

export interface KillReport {
  runsAborted: number;
  processesKilled: number;
  durationMs: number;
}

export type KillHook = (reason: string | undefined) => void | Promise<void>;

export interface RunControllerOptions {
  log: EventLog;
  state: StateStore;
  killGraceMs?: number;
  now?: () => number;
  /** On-disk registry of spawned process groups, to clean up after a crash. */
  processRegistry?: ProcessRegistry;
}

/** Fields the end event of a run carries besides its status (its taint, D-103). */
export type RunEndFacts = { tainted?: true; taintSource?: string };

const HALT_KEY = 'kill_switch';

/** How a run that was not stopped ends: `waiting_user`, with a question parked for the user (D-078). */
export type RunEndStatus = 'completed' | 'failed' | 'waiting_user';

/** A run: one goal pursued by an agent (usually the orchestrator) and its delegates. */
export class RunHandle extends ControlScope {
  readonly agentId: string;
  readonly goal: string | undefined;
  readonly startedAt: number;
  readonly #onFinish: (run: RunHandle, status: RunEndStatus, error?: string) => void;
  #finished = false;

  constructor(
    id: string,
    agentId: string,
    goal: string | undefined,
    parent: ControlScope,
    graceMs: number,
    startedAt: number,
    onFinish: (run: RunHandle, status: RunEndStatus, error?: string) => void,
  ) {
    super('run', id, parent, graceMs);
    this.agentId = agentId;
    this.goal = goal;
    this.startedAt = startedAt;
    this.#onFinish = onFinish;
  }

  /** Marks the run as finished and records it in the log. Idempotent. */
  finish(status: RunEndStatus = 'completed', error?: string): void {
    if (this.#finished || this.aborted) return;
    this.#finished = true;
    this.close();
    this.#onFinish(this, status, error);
  }
}

/**
 * Kill switch (ARCHITECTURE §5.2). Owns a global cancellation scope from which
 * every run, agent and tool call derives. `kill()` aborts everything, terminates
 * child processes and leaves the core "halted" (persisted) until `resume()`.
 */
export class RunController {
  readonly #log: EventLog;
  readonly #state: StateStore;
  readonly #graceMs: number;
  readonly #now: () => number;
  readonly #runs = new Map<string, RunHandle>();
  readonly #hooks = new Set<KillHook>();
  readonly #registry: ProcessRegistry | null;
  #endFacts: (run: RunHandle) => RunEndFacts | undefined = () => undefined;
  #root: ControlScope;
  #halt: HaltState | null;

  constructor(options: RunControllerOptions) {
    this.#log = options.log;
    this.#state = options.state;
    this.#graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.#now = options.now ?? Date.now;
    this.#registry = options.processRegistry ?? null;
    this.#root = this.#newRoot();
    this.#halt = this.#state.get<HaltState>(HALT_KEY) ?? null;
  }

  #closing = false;

  /** What the end event of a run says besides its status (the hub: the run's taint, D-103). */
  setEndFacts(fn: (run: RunHandle) => RunEndFacts | undefined): void {
    this.#endFacts = fn;
  }

  #facts(run: RunHandle): RunEndFacts {
    try {
      return this.#endFacts(run) ?? {};
    } catch {
      return {};
    }
  }

  get halted(): boolean {
    return this.#halt !== null;
  }

  get haltState(): HaltState | null {
    return this.#halt;
  }

  /** Signal of the current global scope (replaced after every kill). */
  get signal(): AbortSignal {
    return this.#root.signal;
  }

  /** Nothing new may start: the kill switch is engaged, or the core is closing. */
  #refuseNewWork(): void {
    if (this.#halt) throw new HaltedError();
    if (this.#closing) throw new ClosingError();
  }

  /**
   * Starts a run. Throws `HaltedError` while the kill switch is engaged, `ClosingError` (a
   * `HaltedError`) once the core is closing: the one gate every new job passes.
   */
  startRun(params: {
    agent: string;
    goal?: string;
    runId?: string;
    /** The Telegram chat of a dedicated bot the run works for (D-107). */
    thread?: string;
  }): RunHandle {
    this.#refuseNewWork();
    const id = params.runId ?? ulid();
    if (this.#runs.has(id)) throw new Error(`run ${id} already exists`);
    const run = new RunHandle(
      id,
      params.agent,
      params.goal,
      this.#root,
      this.#graceMs,
      this.#now(),
      (r, status, error) => {
        this.#runs.delete(r.id);
        this.#log.append({
          agent: r.agentId,
          runId: r.id,
          type: 'run',
          data: { status, ...(error !== undefined ? { error } : {}), ...this.#facts(r) },
        });
      },
    );
    this.#root.attach(run);
    this.#runs.set(id, run);
    this.#log.append({
      agent: params.agent,
      runId: id,
      type: 'run',
      data: {
        status: 'started',
        ...(params.goal !== undefined ? { goal: params.goal } : {}),
        ...(params.thread !== undefined ? { thread: params.thread } : {}),
      },
    });
    return run;
  }

  /**
   * Scope of a long-lived helper process that belongs to no run (an MCP
   * server): a child of the global scope, so the kill switch and the shutdown
   * stop it with its descendants. Throws `HaltedError` while halted or closing.
   */
  serviceScope(id: string): ControlScope {
    this.#refuseNewWork();
    return this.#root.child('tool', id);
  }

  getRun(id: string): RunHandle | undefined {
    return this.#runs.get(id);
  }

  activeRuns(): RunSummary[] {
    return [...this.#runs.values()].map((r) => ({
      id: r.id,
      agent: r.agentId,
      ...(r.goal !== undefined ? { goal: r.goal } : {}),
      startedAt: r.startedAt,
      pendingCalls: r.countDescendants('tool'),
      processes: r.countProcesses(),
    }));
  }

  /** Registers a hook run on every global kill (e.g. to flush provider queues). */
  onKill(hook: KillHook): () => void {
    this.#hooks.add(hook);
    return () => {
      this.#hooks.delete(hook);
    };
  }

  /**
   * Emergency stop: persists the halted state first (so nothing new can start),
   * aborts every run, agent and tool call, terminates child processes and
   * records a `kill` event. Resolves when the processes are gone.
   */
  async kill(params: { by: Channel; reason?: string | undefined }): Promise<KillReport> {
    const started = this.#now();
    const halt: HaltState = {
      halted: true,
      at: started,
      reason: params.reason ?? null,
      by: params.by,
    };
    this.#halt = halt;
    this.#state.set(HALT_KEY, halt);

    const runs = [...this.#runs.values()];
    this.#runs.clear();
    const processes = this.#root.countProcesses();
    const oldRoot = this.#root;
    this.#root = this.#newRoot();
    // Before any line below: the calls in flight log their result inside the abort, so every
    // `tool_result` of a run comes before its `run aborted`.
    const aborting = oldRoot.abort(new KilledError('global', params.reason));

    this.#log.append({
      agent: 'system',
      type: 'kill',
      data: {
        scope: 'global',
        by: params.by,
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
        runsAborted: runs.length,
        processesKilled: processes,
      },
    });
    for (const r of runs) {
      this.#log.append({
        agent: r.agentId,
        runId: r.id,
        type: 'run',
        data: { status: 'aborted', ...this.#facts(r) },
      });
    }

    const hooks = [...this.#hooks].map(async (h) => h(params.reason));
    const results = await Promise.allSettled([aborting, ...hooks]);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.#log.append({
          agent: 'system',
          type: 'error',
          data: { message: `kill hook failed: ${String(r.reason)}`, code: 'kill_hook' },
        });
      }
    }
    return {
      runsAborted: runs.length,
      processesKilled: processes,
      durationMs: this.#now() - started,
    };
  }

  /** Stops a single run without engaging the global kill switch. */
  async killRun(runId: string, params: { by: Channel; reason?: string }): Promise<boolean> {
    const run = this.#runs.get(runId);
    if (!run) return false;
    this.#runs.delete(runId);
    const processes = run.countProcesses();
    const aborting = run.abort(new KilledError('run', params.reason));
    this.#log.append({
      agent: 'system',
      runId,
      type: 'kill',
      data: {
        scope: 'run',
        target: runId,
        by: params.by,
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
        runsAborted: 1,
        processesKilled: processes,
      },
    });
    this.#log.append({
      agent: run.agentId,
      runId,
      type: 'run',
      data: { status: 'aborted', ...this.#facts(run) },
    });
    await aborting;
    return true;
  }

  /**
   * "Stop" in one monster's chat (F-1), not the kill switch: nothing stays halted. Its runs end
   * (the turn of its chat with the delegations and teammate questions it started, a run of its
   * automations, a chat of its Telegram bot); its part in the runs of other monsters (a child
   * scope of such a run for which `partOf` is true: a task delegated to it) stops while those
   * runs go on. One `kill` event (`scope: 'agent'`, `target` the monster) per run touched:
   * `runsAborted: 1` before the `run aborted` of a run that ended, `0` for a part. Resolves when
   * their processes are gone.
   */
  async stopAgent(
    agentId: string,
    params: {
      by: Channel;
      reason?: string | undefined;
      partOf?: ((scope: ControlScope) => boolean) | undefined;
    },
  ): Promise<{ runs: string[]; parts: number; processesKilled: number }> {
    const pending: Promise<unknown>[] = [];
    const runs: string[] = [];
    let parts = 0;
    let processesKilled = 0;
    const kill = (runId: string, runsAborted: 0 | 1, processes: number) =>
      this.#log.append({
        agent: agentId,
        runId,
        type: 'kill',
        data: {
          scope: 'agent',
          target: agentId,
          by: params.by,
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
          runsAborted,
          processesKilled: processes,
        },
      });
    for (const run of [...this.#runs.values()]) {
      if (run.agentId === agentId) {
        this.#runs.delete(run.id);
        const processes = run.countProcesses();
        // Aborted first, as in `killRun`: the calls in flight log their result inside the abort.
        pending.push(run.abort(new KilledError('run', params.reason)));
        kill(run.id, 1, processes);
        this.#log.append({
          agent: run.agentId,
          runId: run.id,
          type: 'run',
          data: { status: 'aborted', ...this.#facts(run) },
        });
        runs.push(run.id);
        processesKilled += processes;
        continue;
      }
      const mine = params.partOf ? run.children().filter(params.partOf) : [];
      if (mine.length === 0) continue;
      let processes = 0;
      for (const scope of mine) {
        processes += scope.countProcesses();
        pending.push(scope.abort(new KilledError('agent', params.reason)));
      }
      kill(run.id, 0, processes);
      parts += mine.length;
      processesKilled += processes;
    }
    await Promise.all(pending);
    return { runs, parts, processesKilled };
  }

  /** Clears the halted state. Returns false if the core was not halted. */
  resume(params: { by: Channel }): boolean {
    if (!this.#halt) return false;
    this.#halt = null;
    this.#state.delete(HALT_KEY);
    this.#log.append({ agent: 'system', type: 'resume', data: { by: params.by } });
    return true;
  }

  /**
   * Closes with `run aborted` (reason `restart`) the runs that the log still
   * shows as started but this controller does not know: a previous core died
   * while they were running. Call at startup. Returns how many.
   */
  closeLeftoverRuns(): number {
    let closed = 0;
    for (const r of this.#log.openRuns()) {
      if (this.#runs.has(r.runId)) continue;
      this.#log.append({
        agent: r.agent,
        runId: r.runId,
        type: 'run',
        data: { status: 'aborted', reason: 'restart' },
      });
      closed++;
    }
    return closed;
  }

  /** True once `shutdown` started: nothing waiting should start any more (D-098). */
  get closing(): boolean {
    return this.#closing;
  }

  /** Aborts everything without engaging the kill switch (used on shutdown). */
  async shutdown(): Promise<void> {
    this.#closing = true;
    const runs = [...this.#runs.values()];
    this.#runs.clear();
    const oldRoot = this.#root;
    this.#root = this.#newRoot();
    // Aborted first, as in `kill`: the calls in flight log their result inside the abort, before
    // the end of their run. The waits reject in a later microtask, after the lines below: the
    // questions of these runs are still parked before (D-078).
    const aborting = oldRoot.abort(new KilledError('global', 'shutdown'));
    for (const r of runs) {
      this.#log.append({
        agent: r.agentId,
        runId: r.id,
        type: 'run',
        data: { status: 'aborted', reason: 'shutdown', ...this.#facts(r) },
      });
    }
    await aborting;
  }

  #newRoot(): ControlScope {
    return new ControlScope('global', 'global', null, this.#graceMs, this.#registry);
  }
}
