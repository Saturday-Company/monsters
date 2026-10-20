import { readFileSync, rmSync } from 'node:fs';
import { writeSensitiveFile } from '../config.ts';
import {
  bootId,
  isSameProcess,
  listProcesses,
  selfStartTime,
  verifiedGroupMembers,
  type ProcInfo,
} from './proc.ts';

/** A process group spawned by a core, kept on disk until it is gone. */
export interface ProcessGroupRecord {
  pgid: number;
  /** Start time of the group leader (see `proc.ts` for the unit). */
  leaderStart: number;
  spawnedAt: number;
  bootId: string | null;
  /** The core process that spawned it. */
  ownerPid: number;
  ownerStart: number | null;
}

export interface ReapReport {
  /** Process groups terminated because their core is gone. */
  killed: number[];
  /** Records dropped because the group no longer exists or is not ours. */
  dropped: number;
}

interface RegistryFile {
  version: 1;
  groups: ProcessGroupRecord[];
}

/**
 * On-disk registry of the process groups spawned by the core (POSIX only).
 * If the core crashes, its children survive in their own groups: at the next
 * start `reapOrphans()` terminates the groups whose owner is dead, after
 * checking (start times, boot id) that they are still the groups we spawned.
 */
export class ProcessRegistry {
  readonly path: string;
  readonly #ownerPid = process.pid;
  readonly #ownerStart = selfStartTime();
  readonly #bootId = bootId();

  constructor(path: string) {
    this.path = path;
  }

  /** Whether this platform uses the registry (Windows has no process groups). */
  static get supported(): boolean {
    return process.platform !== 'win32';
  }

  record(pgid: number, leaderStart: number): ProcessGroupRecord {
    return {
      pgid,
      leaderStart,
      spawnedAt: Date.now(),
      bootId: this.#bootId,
      ownerPid: this.#ownerPid,
      ownerStart: this.#ownerStart,
    };
  }

  add(rec: ProcessGroupRecord): void {
    const groups = this.list().filter((g) => g.pgid !== rec.pgid);
    groups.push(rec);
    this.#write(groups);
  }

  remove(pgid: number): void {
    const groups = this.list();
    const next = groups.filter((g) => !(g.pgid === pgid && g.ownerPid === this.#ownerPid));
    if (next.length !== groups.length) this.#write(next);
  }

  list(): ProcessGroupRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      return Array.isArray(parsed.groups) ? parsed.groups.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  /**
   * Terminates (SIGKILL) the process groups left behind by a core that is no
   * longer running. Groups of a live core (including this one) are kept.
   */
  reapOrphans(): ReapReport {
    const report: ReapReport = { killed: [], dropped: 0 };
    const groups = this.list();
    if (groups.length === 0 || !ProcessRegistry.supported) return report;
    const processes = listProcesses();
    const currentBoot = this.#bootId;
    const keep: ProcessGroupRecord[] = [];
    for (const g of groups) {
      if (isSameProcess(g.ownerPid, g.ownerStart, processes)) {
        keep.push(g);
        continue;
      }
      if (g.bootId && currentBoot && g.bootId !== currentBoot) {
        report.dropped++;
        continue;
      }
      if (this.#killOrphan(g, processes)) report.killed.push(g.pgid);
      else report.dropped++;
    }
    this.#write(keep);
    return report;
  }

  #killOrphan(g: ProcessGroupRecord, processes: ProcInfo[] | null): boolean {
    const members = verifiedGroupMembers(g.pgid, g.leaderStart, processes);
    // Without a way to verify the group (no /proc, no ps) we do not risk it.
    if (!members || members.length === 0) return false;
    try {
      process.kill(-g.pgid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }

  #write(groups: ProcessGroupRecord[]): void {
    if (groups.length === 0) {
      rmSync(this.path, { force: true });
      return;
    }
    const file: RegistryFile = { version: 1, groups };
    writeSensitiveFile(this.path, `${JSON.stringify(file)}\n`);
  }
}

function isRecord(v: unknown): v is ProcessGroupRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['pgid'] === 'number' &&
    Number.isInteger(r['pgid']) &&
    r['pgid'] > 1 &&
    typeof r['leaderStart'] === 'number' &&
    typeof r['ownerPid'] === 'number'
  );
}
