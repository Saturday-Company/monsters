import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { projectPagePath, type Project } from '@monsters/shared';
import { wrapExternalData } from '../agents/tool-adapter.ts';
import { accessStrings } from '../team/access.strings.ts';
import { projectPrompts, projectPromptsOf, type AccessThing } from './projects.prompts.ts';

/*
 * The "## Progetto" section of the system prompt of a project's monsters
 * (D-097): which project, where its notes and its folder are, and the
 * instructions written in the folder (CLAUDE.md, AGENTS.md of a real repo).
 * D-079 stays: the harness reads no instructions file of the folder itself
 * (Claude Code with `--setting-sources ""`, Codex without project docs) and
 * cannot write them. Their text reaches the monster here, as data of the
 * project inside `<dati_esterni>`, never as the user's instructions: a repo
 * cloned from the internet may say anything.
 */

/** Files of the folder read as notes of the project, in this order. */
export const PROJECT_DOC_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
/** Characters of those files that reach the prompt (all of them together). */
export const PROJECT_DOC_CHARS = 6000;
/** Bytes read of one file at most (a huge file is not read whole). */
const MAX_READ_BYTES = 64 * 1024;

/** Not on Windows: there the `lstat` before the open says whether it is a link. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** A FIFO put there never blocks the open. */
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/**
 * The start of a regular file at the top of the folder, read as `readFolderDoc`
 * of D-113 reads it: a link is never followed (`lstat`, then one descriptor
 * opened with `O_NOFOLLOW`), and what is read is what `fstat` says is a regular
 * file. A repo cloned with `CLAUDE.md -> ~/.ssh/id_ed25519` puts nothing in the
 * prompt, nor in the hash the user approves.
 */
function readHead(path: string, bytes: number): string | null {
  let fd: number;
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The instructions files of a project's folder, clipped: `{ file, text }`. */
export function projectDocs(
  folder: string,
  max = PROJECT_DOC_CHARS,
): { file: string; text: string }[] {
  return clipProjectDocs((file) => readHead(join(folder, file), MAX_READ_BYTES), max);
}

/**
 * What of CLAUDE.md and AGENTS.md reaches the prompt, from their texts
 * (`raw`: a file's text, null when it is not there): the same clipping as
 * `projectDocs`, so a text not yet written (a proposal applied, D-113) is
 * judged as the folder will be read.
 */
export function projectDocsOf(
  raw: (file: (typeof PROJECT_DOC_FILES)[number]) => string | null,
  max = PROJECT_DOC_CHARS,
): { file: string; text: string }[] {
  return clipProjectDocs((file) => {
    const text = raw(file);
    return text === null
      ? null
      : Buffer.from(text, 'utf8').subarray(0, MAX_READ_BYTES).toString('utf8');
  }, max);
}

function clipProjectDocs(
  read: (file: (typeof PROJECT_DOC_FILES)[number]) => string | null,
  max: number,
): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  let left = max;
  for (const file of PROJECT_DOC_FILES) {
    if (left <= 0) break;
    const raw = read(file);
    const text = raw?.trim();
    if (!text) continue;
    // The marker is part of the hash the user approves (D-103): it is always the Italian one, so
    // a change of the app's language does not make the docs look changed. The prompt swaps it
    // for its family's own (`docForPrompt`).
    const clipped =
      text.length > left
        ? `${text.slice(0, left)}${projectPromptsOf('it').docClipped(file)}`
        : text;
    left -= Math.min(text.length, left);
    out.push({ file, text: clipped });
  }
  return out;
}

/**
 * The hash of what of CLAUDE.md and AGENTS.md reaches the prompt (D-103):
 * the user approves it, a change makes the runs of the project tainted.
 */
export function projectDocsHash(folder: string): string {
  return hashOf(projectDocs(folder));
}

/** The hash of what reaches the prompt (D-103), from `projectDocs` or `projectDocsOf`. */
export function hashOf(docs: { file: string; text: string }[]): string {
  return createHash('sha256').update(JSON.stringify(docs)).digest('hex');
}

/**
 * The docs of the project's folder that reach the prompt are not those the
 * user approved (D-103). None there: nothing reaches the prompt, nothing changed.
 */
export function projectDocsChanged(project: Project): boolean {
  if (!project.folder) return false;
  const docs = projectDocs(project.folder);
  return docs.length > 0 && project.folderDocs?.hash !== hashOf(docs);
}

/**
 * What the account has and this project does not give its monster (D-129):
 * said in the section, so the monster never says "not connected" for a
 * service the user did connect, and says where it is turned on.
 */
export interface ProjectAccessNotes {
  /** Connected to the account and given to the whole team, not chosen by the project. */
  notHere: readonly string[];
  /** The browser of Monsters is on, but this monster does not get it. */
  browser?: boolean;
  /** The project's "Ricerca sul web" is off. */
  webOff?: boolean;
  /** Who asks the user: the capo itself (`access_request`), or the name of its capo. */
  asker: { self: true } | { capo: string };
}

/** The text of a clipped doc with the clipping note in the language of the prompts. */
function docForPrompt(d: { file: string; text: string }): string {
  const marker = projectPromptsOf('it').docClipped(d.file);
  return d.text.endsWith(marker)
    ? `${d.text.slice(0, -marker.length)}${projectPrompts().docClipped(d.file)}`
    : d.text;
}

/** The lines of `ProjectAccessNotes`, in the app's words. */
export function accessLines(project: Project, notes: ProjectAccessNotes): string[] {
  const p = projectPrompts();
  const where = p.where(projectPagePath(project.name, 'impostazioni'));
  const grant = accessStrings().grant;
  const ask = (thing: AccessThing) =>
    'self' in notes.asker
      ? p.askSelf(thing, where, grant)
      : p.askCapo(thing, notes.asker.capo, where);
  const lines: string[] = [];
  const notHere = [...new Set(notes.notHere)];
  if (notHere.length > 0) {
    const one = notHere.length === 1;
    lines.push(p.notHere(p.list(notHere), one, ask(one ? 'service' : 'services')));
  }
  if (notes.browser) lines.push(p.browser(ask('browser')));
  if (notes.webOff) lines.push(p.webOff(where, ask('web')));
  return lines;
}

/** The section for a monster of `project` (`lead`: the name of its capo, when it is not the capo). */
export function projectSection(
  project: Project,
  options: { lead?: string | undefined; access?: ProjectAccessNotes | undefined } = {},
): string {
  const p = projectPrompts();
  const lines = [
    p.sectionHeading,
    p.working(project.name, options.lead, project.vaultArea),
    ...(options.access ? accessLines(project, options.access) : []),
  ];
  if (project.folder) {
    lines.push(p.folder(project.folder));
    const docs = projectDocs(project.folder);
    if (docs.length > 0) {
      lines.push(p.docsIntro(docs.map((d) => d.file)));
      for (const d of docs) lines.push(wrapExternalData(p.docLabel(d.file), docForPrompt(d)));
    }
  }
  return lines.join('\n');
}
