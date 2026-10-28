import type { Channel, DraftView, LogEvent } from '@monsters/shared';
import type { EventLog } from '../log/event-log.ts';
import { shouldRemember } from './memory.ts';
import type { TeamService } from './team-service.ts';
import { teamStrings } from './team.strings.ts';

/*
 * Memory that waits for the user (review of 18/10, A2, and of the waves 3 and
 * 4). The «Da ricordare:» lines that a person who is not the user asked for
 * (D-107), of a Telegram group, or of a run that read third-party text when
 * they name a site, an address or read as an order (`memoryLineNeedsReview`)
 * do not go into the monster's MEMORY.md by themselves: the memory reaches the
 * prompt of every later run, so a page or a person of a group would write
 * there once and speak in all the user's runs. (The other lines of a tainted
 * run go by themselves with the mark, and the prompt gives them as data.) They
 * become a draft (D-098, "Da rivedere" and Telegram); confirming appends them, with
 * `MEMORY_TAINT_MARK` when they carry third-party text, so a run that reads
 * them still starts tainted. The drafts are `memory` events (`proposed`,
 * closed by `remembered` or `discarded` with `proposalId`), like the
 * proposals of CLAUDE.md (D-113).
 */

/** Open drafts of memory of one monster at most: past it, the oldest expires (with a notice). */
export const MAX_OPEN_MEMORY_PROPOSALS = 5;

type MemoryEvent = LogEvent<'memory'>;

export class MemoryProposalError extends Error {
  readonly code: 'unknown_proposal' | 'proposal_closed' | 'not_saved';
  constructor(code: MemoryProposalError['code'], message: string) {
    super(message);
    this.name = 'MemoryProposalError';
    this.code = code;
  }
}

export class MemoryProposals {
  readonly #log: EventLog;
  readonly #team: TeamService;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: { log: EventLog; team: TeamService }) {
    this.#log = options.log;
    this.#team = options.team;
  }

  /** `work` after the answers that came before it: a double tap confirms once. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work, work);
    this.#chain = next.catch(() => undefined);
    return next;
  }

  /**
   * Drafts nobody answered yet, oldest first: every draft of the log, each without an answer
   * that names it (D-215). One pass over the `memory` events (a query per draft grew with the
   * square of the drafts, and `open` runs at every proposal and every list of drafts).
   */
  open(): MemoryEvent[] {
    const drafts: MemoryEvent[] = [];
    const answered = new Set<string>();
    for (const e of this.#log.all({ type: 'memory' })) {
      if (e.type !== 'memory') continue;
      if (e.data.action === 'proposed') drafts.push(e);
      if (e.data.proposalId) answered.add(e.data.proposalId);
    }
    return drafts.filter((d) => !answered.has(d.id));
  }

  /** A `proposed` event of the log, open or not. */
  known(id: string): boolean {
    const e = this.#log.get(id);
    return e?.type === 'memory' && e.data.action === 'proposed';
  }

  /**
   * New lines for the memory of `agentId`, waiting for the user. Only the
   * lines not there yet and kept by the instinct's filter (as `appendMemory`
   * would add them); the same lines already waiting are not proposed again.
   * Returns the draft's id, or null when nothing is left to propose.
   */
  async propose(
    agentId: string,
    lines: readonly string[],
    origin: {
      source: string;
      tainted: boolean;
      runId: string;
      parentId?: string | null;
      signal?: AbortSignal;
    },
  ): Promise<string | null> {
    const agent = this.#team.get(agentId);
    if (!agent) return null;
    const fresh = await this.#team.newMemory(agentId, lines, {
      runId: origin.runId,
      parentId: origin.parentId ?? null,
      ...(origin.signal ? { signal: origin.signal } : {}),
    });
    const id = agent.config.id;
    const open = this.open().filter((e) => e.agent === id);
    const waiting = new Set(open.flatMap((e) => e.data.lines ?? []));
    const kept = fresh.filter((l) => !waiting.has(l));
    if (kept.length === 0) return null;
    const path = this.#team.memoryPath(agent);
    // Past the limit the oldest draft expires, said in the Activity with its lines (never in
    // silence, review of the waves 3 and 4): a chat cannot pile them up.
    for (const old of open.slice(0, Math.max(0, open.length - MAX_OPEN_MEMORY_PROPOSALS + 1))) {
      this.#log.append({
        agent: id,
        type: 'memory',
        data: { action: 'discarded', path, proposalId: old.id, by: 'system', expired: true },
      });
      const gone = old.data.lines ?? [];
      const name = agent.config.name;
      this.#log.append({
        agent: 'system',
        runId: origin.runId,
        parentId: origin.parentId ?? null,
        type: 'instinct',
        data: {
          use: 'memory',
          action: 'memory_skipped',
          message: teamStrings().memoryExpired(
            name,
            gone.length === 1 ? teamStrings().oneLine : teamStrings().nLines(gone.length),
            MAX_OPEN_MEMORY_PROPOSALS,
          ),
          subject: id,
          details: { lines: gone, proposalId: old.id, expired: true },
        },
      });
    }
    const event = this.#log.append({
      agent: id,
      runId: origin.runId,
      parentId: origin.parentId ?? null,
      type: 'memory',
      data: {
        action: 'proposed',
        path,
        lines: kept,
        source: origin.source.slice(0, 200),
        ...(origin.tainted ? { tainted: true as const } : {}),
      },
    });
    return event.id;
  }

  /** The draft of an open proposal (null: its monster is gone). */
  view(e: MemoryEvent): DraftView | null {
    const agent = this.#team.byId(e.agent);
    if (!agent) return null;
    const lines = e.data.lines ?? [];
    const name = agent.config.name;
    return {
      kind: 'memory',
      id: e.id,
      title: teamStrings().memoryTitle(name),
      summary: teamStrings().memorySummary(
        name,
        lines.length,
        e.data.source ?? teamStrings().notFromYou,
      ),
      from: e.agent,
      fromName: name,
      createdAt: e.ts,
      memory: {
        agent: e.agent,
        lines,
        source: e.data.source ?? teamStrings().notFromYou,
        ...(e.data.tainted ? { tainted: true as const } : {}),
      },
    };
  }

  #proposal(id: string): MemoryEvent {
    if (!this.known(id)) {
      throw new MemoryProposalError('unknown_proposal', teamStrings().proposalUnknown);
    }
    const e = this.open().find((o) => o.id === id);
    if (!e) {
      throw new MemoryProposalError('proposal_closed', teamStrings().proposalClosed);
    }
    return e;
  }

  /** The user confirms: the lines go into the monster's MEMORY.md (marked when tainted). */
  confirm(id: string, by: Channel): Promise<{ agent: string; lines: string[] }> {
    return this.#serial(async () => {
      const e = this.#proposal(id);
      const lines = await this.#team.appendMemory(e.agent, e.data.lines ?? [], {
        // The user read them: the instinct does not take one out now.
        filter: shouldRemember,
        mark: e.data.tainted === true,
        proposal: { id, by },
      });
      if (this.open().some((o) => o.id === id)) {
        throw new MemoryProposalError('not_saved', teamStrings().memoryNotSaved);
      }
      return { agent: e.agent, lines };
    });
  }

  /** The user leaves the lines aside: the memory stays as it is. */
  discard(id: string, by: Channel): Promise<{ ok: true }> {
    return this.#serial(() => {
      const e = this.#proposal(id);
      this.#log.append({
        agent: e.agent,
        type: 'memory',
        data: { action: 'discarded', path: e.data.path, proposalId: id, by },
      });
      return Promise.resolve({ ok: true as const });
    });
  }
}
