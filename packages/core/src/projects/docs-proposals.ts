import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  defineTool,
  MAX_PROJECT_DOC_BYTES,
  MAX_PROJECT_DOC_READ_BYTES,
  PROJECT_DOC_PROPOSAL_FILES,
  textDiff,
  ToolError,
  type Channel,
  type DraftView,
  type LogEvent,
  type MonstersTool,
  type Project,
  type ProjectView,
} from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import type { TeamService } from '../team/team-service.ts';
import { hashOf, projectDocsOf } from './context.ts';
import { projectStrings } from './projects.strings.ts';
import type { ProjectService } from './service.ts';

/*
 * Proposals for CLAUDE.md and AGENTS.md of a project's folder (D-113). A
 * monster never writes them (D-079, D-103: the lock of instruction-files.ts
 * stays); a monster of the project, its lead or the orchestrator proposes the
 * whole new text with `project_docs_propose`, and the user applies it with one
 * tap from "Da rivedere", the project's page or Telegram, after seeing the
 * diff. The proposals are `project_docs_proposal` events, as the monsters'
 * proposals (D-075); the core writes the file only when the user applies it,
 * if the file is still the one the proposal was written on.
 */

export const DOCS_PROPOSE = 'project_docs_propose';

export type DocFile = (typeof PROJECT_DOC_PROPOSAL_FILES)[number];

/** Open proposals of one project at most: beyond, the monsters wait for the user. */
export const MAX_OPEN_DOCS_PROPOSALS = 5;

/** Characters of the current file the draft carries, for the diff. */
export const DOCS_CURRENT_CHARS = 64 * 1024;

export type DocsErrorCode =
  | 'unknown_proposal'
  | 'proposal_closed'
  | 'docs_changed'
  | 'no_folder'
  | 'not_file'
  | 'unchanged'
  | 'too_large'
  | 'too_many'
  | 'empty'
  | 'invisible';

export class DocsError extends Error {
  readonly code: DocsErrorCode;
  constructor(code: DocsErrorCode, message: string) {
    super(message);
    this.name = 'DocsError';
    this.code = code;
  }
}

/** The messages of a proposal that went stale (picked when they are needed). */
export const docsChangedMessage = (): string => projectStrings().docsChanged;
export const docsFolderMovedMessage = (): string => projectStrings().docsFolderMoved;

// --- the file in the folder -------------------------------------------------------------

/** The file at the top of the folder as it is now (a link is never followed). */
export type FolderDoc =
  | { state: 'file'; bytes: Buffer; mode: number }
  | { state: 'missing' }
  | { state: 'link' }
  | { state: 'not_file' }
  | { state: 'too_large' }
  | { state: 'no_folder' };

/** Not on Windows: there the `lstat` before the open says whether it is a link. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** A FIFO put there never blocks the open. */
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/**
 * Reads the file through one descriptor opened without following a link
 * (`O_NOFOLLOW`, an `lstat` first where it does not exist): what is checked
 * (a regular file, its size) is what is read. Bigger than 1 MB: not read.
 */
export function readFolderDoc(folder: string, file: DocFile): FolderDoc {
  try {
    if (!statSync(folder).isDirectory()) return { state: 'no_folder' };
  } catch {
    return { state: 'no_folder' };
  }
  const path = join(folder, file);
  let fd: number;
  try {
    if (lstatSync(path).isSymbolicLink()) return { state: 'link' };
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT'
      ? { state: 'missing' }
      : code === 'ELOOP'
        ? { state: 'link' }
        : { state: 'not_file' };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { state: 'not_file' };
    if (st.size > MAX_PROJECT_DOC_READ_BYTES) return { state: 'too_large' };
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      // Grown past the limit while it was read.
      if (total > MAX_PROJECT_DOC_READ_BYTES) return { state: 'too_large' };
      chunks.push(buf.subarray(0, n));
    }
    return { state: 'file', bytes: Buffer.concat(chunks), mode: st.mode & 0o7777 };
  } catch {
    return { state: 'not_file' };
  } finally {
    closeSync(fd);
  }
}

/** sha256 (hex) of the file's bytes; null when it is not there. */
export function docHash(doc: FolderDoc): string | null {
  if (doc.state === 'missing') return null;
  if (doc.state !== 'file') return `unreadable:${doc.state}`;
  return createHash('sha256').update(doc.bytes).digest('hex');
}

/**
 * Writes the file atomically: a temporary file in the same folder, then a
 * rename over the old one (or over a link put there meanwhile: never
 * followed). `mode`: the old file's permissions, kept (never setuid, setgid
 * or sticky); absent, 0644 (less what the umask takes). A failure leaves no
 * temporary file behind.
 */
export function writeFolderDoc(
  folder: string,
  file: DocFile,
  content: string,
  mode?: number,
  /** For the tests: what renames the temporary file. */
  rename: (from: string, to: string) => void = renameSync,
): void {
  const target = join(folder, file);
  const tmp = join(folder, `.${file}.monsters-${randomBytes(6).toString('hex')}.tmp`);
  let made = false;
  try {
    const fd = openSync(tmp, 'wx', mode === undefined ? 0o644 : mode & 0o777);
    made = true;
    try {
      // The umask does not take away what the old file had.
      if (mode !== undefined) fchmodSync(fd, mode & 0o777);
      const bytes = Buffer.from(content, 'utf8');
      let at = 0;
      while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    rename(tmp, target);
  } catch (err) {
    if (made) rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * The first character of `text` that does not show (D-113): format
 * characters (zero-width, bidi controls, Unicode tags), smuggled selectors,
 * controls other than tab and newlines. Null when there is none.
 */
export function invisibleIn(text: string): string | null {
  // eslint-disable-next-line no-misleading-character-class
  const m = /[\p{Cf}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|(?![\t\n\r])\p{Cc}/u.exec(text);
  return m ? `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : null;
}

/** The same text but for the newline at the end: no change worth a proposal. */
function sameButFinalNewline(a: string, b: string): boolean {
  const trim = (t: string) => t.replace(/\r?\n$/, '');
  return trim(a) === trim(b);
}

/** The text of the file for the draft: clipped, and whether it was. */
export function currentText(doc: FolderDoc): { text: string | null; clipped: boolean } {
  if (doc.state !== 'file') return { text: null, clipped: false };
  const text = doc.bytes.toString('utf8');
  return text.length > DOCS_CURRENT_CHARS
    ? { text: text.slice(0, DOCS_CURRENT_CHARS), clipped: true }
    : { text, clipped: false };
}

/** One line: no control or invisible characters, spaces collapsed. */
function oneLine(text: string, max: number): string {
  const line = text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Why a file is not changed with a proposal. */
function unwritable(state: 'link' | 'not_file' | 'too_large'): string {
  const s = projectStrings();
  return state === 'link' ? s.docsLink : state === 'too_large' ? s.docsTooLarge : s.docsSpecial;
}

/**
 * The approval of the folder's instructions after a proposal is applied
 * (D-103, D-113), from the texts read before the write and the one written,
 * never from a new read of the folder: the hash of what reaches the prompt
 * now, or null to leave them to approve. Approved only when they were
 * approved before and the other file reaches the prompt exactly as it did:
 * the user saw the new text, never a part of the other file that was cut off
 * before (6000 characters together) and would come in now.
 */
export function approvalAfter(
  p: Project,
  file: DocFile,
  before: FolderDoc,
  written: string,
  other: FolderDoc,
): string | null {
  // A link or a special file in place of the other one: `projectDocs` would read it, we do not.
  if (other.state !== 'file' && other.state !== 'missing') return null;
  const text = (d: FolderDoc) => (d.state === 'file' ? d.bytes.toString('utf8') : null);
  const otherText = text(other);
  const was = projectDocsOf((f) => (f === file ? text(before) : otherText));
  const approved = was.length === 0 || hashOf(was) === p.folderDocs?.hash;
  if (!approved) return null;
  const now = projectDocsOf((f) => (f === file ? written : otherText));
  const part = (docs: { file: string; text: string }[]) =>
    docs.find((d) => d.file !== file)?.text ?? null;
  return part(was) === part(now) ? hashOf(now) : null;
}

// --- the proposals ------------------------------------------------------------------------

export interface DocsProposalsOptions {
  log: EventLog;
  team: TeamService;
  projects: ProjectService;
}

export interface DocsProposalInput {
  project: Project;
  file: DocFile;
  content: string;
  reason: string;
}

export interface DocsProposalOrigin {
  agent: string;
  runId?: string | null;
  parentId?: string | null;
  /** The source of the run's taint, when it had read third-party text (D-103). */
  taint?: string | undefined;
}

export interface DocsProposal {
  /** Id of the `project_docs_proposal` event. */
  id: string;
  /** The file is not there: applying it creates it. */
  created: boolean;
  /** The monster's earlier proposal for the same file, closed by this one. */
  replaced?: string;
  /** The same text was already proposed and waits for the user. */
  repeated?: boolean;
}

type ProposalEvent = LogEvent<'project_docs_proposal'>;

export class DocsProposals {
  readonly #o: DocsProposalsOptions;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: DocsProposalsOptions) {
    this.#o = options;
  }

  /** `work` after the answers that came before it: a double tap applies once. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work, work);
    this.#chain = next.catch(() => undefined);
    return next;
  }

  /** `project_docs_proposal` events of the log, oldest first. */
  #events(): ProposalEvent[] {
    return this.#o.log
      .query({ type: 'project_docs_proposal', limit: 1000, order: 'desc' })
      .reverse() as ProposalEvent[];
  }

  /** Proposals nobody answered or replaced yet, oldest first. */
  open(): ProposalEvent[] {
    const events = this.#events();
    const closed = new Set(events.map((e) => e.data.proposalId).filter(Boolean));
    return events.filter((e) => e.data.action === 'proposed' && !closed.has(e.id));
  }

  /** A `proposed` event of the log, open or not. */
  known(id: string): boolean {
    const e = this.#o.log.get(id);
    return e?.type === 'project_docs_proposal' && e.data.action === 'proposed';
  }

  /**
   * A new proposal (checked: the folder and the file, a text that changes
   * something, the size, the open proposals of the project). The monster's
   * open proposal for the same file is closed as `superseded`.
   */
  propose(input: DocsProposalInput, origin: DocsProposalOrigin): DocsProposal {
    const { project, file, content } = input;
    if (!project.folder) {
      throw new DocsError('no_folder', projectStrings().docsNoFolder(project.name));
    }
    if (!content.trim()) throw new DocsError('empty', projectStrings().docsEmpty(file));
    const unseen = invisibleIn(content);
    if (unseen) {
      throw new DocsError('invisible', projectStrings().docsInvisible(file, unseen));
    }
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_PROJECT_DOC_BYTES) {
      throw new DocsError(
        'too_large',
        projectStrings().docsTooBig(
          file,
          Math.ceil(bytes.length / 1024),
          MAX_PROJECT_DOC_BYTES / 1024,
        ),
      );
    }
    const doc = readFolderDoc(project.folder, file);
    if (doc.state === 'no_folder') {
      throw new DocsError('no_folder', projectStrings().docsFolderGone(project.folder));
    }
    if (doc.state === 'link' || doc.state === 'not_file' || doc.state === 'too_large') {
      throw new DocsError(
        'not_file',
        projectStrings().docsNotFileProposal(file, unwritable(doc.state)),
      );
    }
    if (doc.state === 'file' && sameButFinalNewline(doc.bytes.toString('utf8'), content)) {
      throw new DocsError('unchanged', projectStrings().docsUnchanged(file));
    }
    const baseHash = docHash(doc);
    const open = this.open().filter((e) => e.data.project === project.id);
    const previous = open.find((e) => e.data.from === origin.agent && e.data.file === file);
    if (previous && previous.data.content === content && previous.data.baseHash === baseHash) {
      return { id: previous.id, created: doc.state === 'missing', repeated: true };
    }
    if (open.filter((e) => e !== previous).length >= MAX_OPEN_DOCS_PROPOSALS) {
      throw new DocsError(
        'too_many',
        projectStrings().docsTooMany(project.name, MAX_OPEN_DOCS_PROPOSALS),
      );
    }
    const envelope = {
      agent: origin.agent,
      runId: origin.runId ?? null,
      parentId: origin.parentId ?? null,
    };
    const base = { project: project.id, name: project.name, file, from: origin.agent };
    if (previous) {
      this.#o.log.append({
        ...envelope,
        type: 'project_docs_proposal',
        data: { action: 'superseded', ...base, proposalId: previous.id },
      });
    }
    const taint = origin.taint?.trim();
    const event = this.#o.log.append({
      ...envelope,
      type: 'project_docs_proposal',
      data: {
        action: 'proposed',
        ...base,
        content,
        baseHash,
        folder: project.folder,
        reason: oneLine(input.reason, 300),
        ...(taint ? { tainted: true as const, taintSource: taint.slice(0, 200) } : {}),
      },
    });
    return {
      id: event.id,
      created: doc.state === 'missing',
      ...(previous ? { replaced: previous.id } : {}),
    };
  }

  /** An open proposal by id (`unknown_proposal`, `proposal_closed`). */
  #proposal(id: string): ProposalEvent {
    if (!this.known(id))
      throw new DocsError('unknown_proposal', projectStrings().docsUnknownProposal);
    const e = this.open().find((o) => o.id === id);
    if (!e) {
      throw new DocsError('proposal_closed', projectStrings().docsProposalClosed);
    }
    return e;
  }

  /**
   * The user applies a proposal: the file is written if it is still the one
   * the proposal was written on (`docs_changed` otherwise), never through a
   * link. The approval of the folder's instructions follows D-113
   * (`ProjectService.applyFolderDoc`).
   */
  apply(id: string, by: Channel): Promise<ProjectView> {
    return this.#serial(async () => {
      const e = this.#proposal(id);
      const { project, file, content, baseHash } = e.data;
      const view = await this.#o.projects.applyFolderDoc(
        project,
        (p) => {
          if (e.data.folder !== undefined && e.data.folder !== p.folder) {
            throw new DocsError('docs_changed', docsFolderMovedMessage());
          }
          const doc = readFolderDoc(p.folder, file);
          if (doc.state === 'no_folder') {
            throw new DocsError('no_folder', projectStrings().docsProjectFolderGone);
          }
          if (doc.state === 'link' || doc.state === 'not_file' || doc.state === 'too_large') {
            throw new DocsError(
              'not_file',
              projectStrings().docsNotFileWrite(file, unwritable(doc.state)),
            );
          }
          if (docHash(doc) !== (baseHash ?? null)) {
            throw new DocsError('docs_changed', docsChangedMessage());
          }
          const other = readFolderDoc(p.folder, file === 'CLAUDE.md' ? 'AGENTS.md' : 'CLAUDE.md');
          const text = content ?? '';
          writeFolderDoc(p.folder, file, text, doc.state === 'file' ? doc.mode : undefined);
          return approvalAfter(p, file, doc, text, other);
        },
        by,
      );
      this.#o.log.append({
        agent: 'user',
        type: 'project_docs_proposal',
        data: {
          action: 'applied',
          project,
          name: view.name,
          file,
          from: e.data.from,
          proposalId: id,
          by,
        },
      });
      return view;
    });
  }

  /** The draft of an open proposal, with the file as it is now (null: the project is not active). */
  view(e: ProposalEvent, p: Project | undefined, who: string | undefined): DraftView | null {
    const d = e.data;
    if (!p || p.status !== 'active' || p.archivedAt !== undefined || !p.folder) return null;
    const folderMoved = d.folder !== undefined && d.folder !== p.folder;
    const doc = readFolderDoc(p.folder, d.file);
    const tooLarge = doc.state === 'too_large';
    const whole = doc.state === 'file' ? doc.bytes.toString('utf8') : null;
    const now = currentText(doc);
    const reason = d.reason ?? '';
    const proposed = d.content ?? '';
    return {
      kind: 'docs',
      id: e.id,
      title: projectStrings().docsTitle(p.name, d.file),
      summary: projectStrings().docsSummary(
        who,
        doc.state === 'missing',
        p.name,
        d.file,
        reason.replace(/[.!]$/, ''),
      ),
      from: d.from,
      ...(who ? { fromName: who } : {}),
      project: p.id,
      createdAt: e.ts,
      docs: {
        file: d.file,
        current: now.text,
        ...(now.clipped ? { currentClipped: true as const } : {}),
        proposed,
        // On the whole file, also past the clip of `current`.
        diff: tooLarge ? '' : textDiff(whole, proposed),
        reason,
        stale: !folderMoved && !tooLarge && docHash(doc) !== (d.baseHash ?? null),
        ...(folderMoved ? { folderMoved: true as const } : {}),
        ...(tooLarge ? { tooLarge: true as const } : {}),
        ...(d.tainted ? { tainted: true as const } : {}),
        ...(d.taintSource ? { source: d.taintSource } : {}),
      },
    };
  }

  /** The user leaves a proposal aside: the file stays, the proposer reads it at its next turn. */
  discard(id: string, by: Channel): Promise<{ ok: true }> {
    return this.#serial(() => {
      const e = this.#proposal(id);
      const { project, name, file, from } = e.data;
      this.#o.log.append({
        agent: 'user',
        type: 'project_docs_proposal',
        data: {
          action: 'discarded',
          project,
          name: this.#o.team.project(project)?.name ?? name,
          file,
          from,
          proposalId: id,
          by,
        },
      });
      return Promise.resolve({ ok: true as const });
    });
  }
}

// --- the tool ---------------------------------------------------------------------------

export const ProposeDocsInput = z.object({
  file: z.enum(PROJECT_DOC_PROPOSAL_FILES).describe('At the top of the project folder'),
  content: z
    .string()
    .min(1)
    .max(MAX_PROJECT_DOC_BYTES)
    .describe('The WHOLE new text of the file (max 32 KB), not a diff or a part'),
  reason: z.string().min(3).max(300).describe('Why, one short line in the user’s language'),
  project: z
    .string()
    .max(80)
    .optional()
    .describe('Which project, only if you are not one of its monsters'),
});

/** Active projects with a folder: where a proposal can go. */
function withFolder(team: TeamService): Project[] {
  return team.activeProjects().filter((p) => p.folder !== undefined);
}

export function docsProposeTool(ctx: {
  run: RunHandle;
  self: AgentDefinition;
  team: TeamService;
  proposals: DocsProposals;
  userName?: string | undefined;
  /** The source of the run's taint, when it had read third-party text (D-103). */
  taint?: () => string | undefined;
}): MonstersTool {
  const user = ctx.userName?.trim() || 'the user';
  const orchestrator = ctx.self.config.kind === 'orchestrator';
  return defineTool({
    name: DOCS_PROPOSE,
    description:
      `Propose a change to the instructions of ${orchestrator ? 'a' : 'your'} project: CLAUDE.md or AGENTS.md at the top of its folder (you cannot write them). ` +
      `Read the current file first, then send its whole new text. ${user} sees the diff and applies it with one tap; nothing is written before. Returns at once.`,
    inputSchema: ProposeDocsInput,
    execute: (input, tc) =>
      Promise.resolve().then(() => {
        const { team, self } = ctx;
        const names = () =>
          withFolder(team)
            .map((p) => p.name)
            .join(', ') || 'none';
        let project: Project | undefined;
        if (!orchestrator) {
          project = team.projectOf(self.config.id);
          if (!project || project.status !== 'active') {
            throw new ToolError('UNAVAILABLE', 'you are not in an active project', {
              hint: `Only a project's monsters propose its instructions: tell ${user} what to change.`,
            });
          }
        } else if (input.project) {
          const p = team.project(input.project);
          project = p && p.status === 'active' && p.archivedAt === undefined ? p : undefined;
          if (!project) {
            throw new ToolError('NOT_FOUND', `no active project called "${input.project}"`, {
              hint: `Projects with a folder: ${names()}.`,
            });
          }
        } else {
          const list = withFolder(team);
          if (list.length !== 1) {
            throw new ToolError('INVALID_INPUT', 'which project? say it in "project"', {
              hint: `Projects with a folder: ${names()}.`,
            });
          }
          project = list[0];
        }
        if (!project?.folder) {
          throw new ToolError('NOT_FOUND', `project ${project?.name ?? ''} has no folder`, {
            hint: `${user} chooses it in the project's page (Cartella del progetto).`,
          });
        }
        try {
          const p = ctx.proposals.propose(
            { project, file: input.file, content: input.content, reason: input.reason },
            {
              agent: self.config.id,
              runId: ctx.run.id,
              parentId: tc.callEventId ?? null,
              taint: ctx.taint?.(),
            },
          );
          return {
            status: p.repeated ? 'already_proposed' : p.replaced ? 'replaced' : 'proposed',
            proposal_id: p.id,
            project: project.name,
            file: input.file,
            ...(p.created ? { new_file: true } : {}),
            note:
              `Proposal sent to ${user}${p.replaced ? ' (it replaces your earlier one for this file)' : ''}: ` +
              `${user} sees the diff and applies it with one tap. Tell ${user} in one line what you proposed and why, and stop: the file changes only after the tap.`,
          };
        } catch (err) {
          if (!(err instanceof DocsError)) throw err;
          const hints: Partial<Record<DocsErrorCode, [ToolError['code'], string]>> = {
            unchanged: ['INVALID_INPUT', 'Nothing changes: do not propose it again.'],
            too_large: ['INVALID_INPUT', 'Keep the file shorter: move the details to notes.'],
            empty: ['INVALID_INPUT', 'Send the whole new text of the file.'],
            invisible: [
              'INVALID_INPUT',
              'Write it with visible characters only: no zero-width, bidi or tag characters, no controls.',
            ],
            too_many: ['LIMIT_REACHED', `Wait for ${user} to answer the open ones; tell them.`],
            no_folder: ['NOT_FOUND', `Tell ${user}: the project's folder is missing.`],
            not_file: ['BLOCKED_BY_POLICY', `Tell ${user} what to change in it instead.`],
          };
          const [code, hint] = hints[err.code] ?? ['INVALID_INPUT', 'Fix it and call again once.'];
          throw new ToolError(code, err.message, { hint });
        }
      }),
  });
}
