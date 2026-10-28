import { formatList } from '@monsters/shared';
import { toolProblemStrings } from './tool-problem.strings.ts';

/*
 * A failed tool in one plain sentence. The log keeps the core's error as the model read it
 * (`CODE: message`, with a `hint` in the output): English, written for the model. For the cases
 * the person can act on (a note the monster may not edit, a section that is not there, a note
 * that changed meanwhile) this says it in the app's language; anything else stays the raw error.
 * Pure: the callers show the sentence first and the raw error below it.
 */

/** A failed tool call as the log has it. */
export interface FailedTool {
  tool: string;
  /** The `error` of the `tool_result` (`CODE: message`). */
  error?: string | undefined;
  /** Its `output`: for a failure `{ error: { code, message, hint } }`. */
  output?: unknown;
}

export interface ToolProblem {
  /** One or two plain sentences, in the app's language. */
  text: string;
  /** When a setting of the monster changes it: the label of the link to Settings → Squad. */
  settingsLabel?: string;
}

interface Parsed {
  code: string;
  message: string;
  hint: string;
}

function parse(f: FailedTool): Parsed | null {
  const out = f.output;
  if (typeof out === 'object' && out !== null && 'error' in out) {
    const e = out.error;
    if (typeof e === 'object' && e !== null) {
      const { code, message, hint } = e as Record<string, unknown>;
      if (typeof code === 'string' && typeof message === 'string')
        return { code, message, hint: typeof hint === 'string' ? hint : '' };
    }
  }
  const m = /^([A-Z][A-Z_]+): ([\s\S]+)$/.exec(f.error ?? '');
  return m ? { code: m[1]!, message: m[2]!, hint: '' } : null;
}

/** "Agenti/Marta/" and the extra areas of the monster, from the hint the vault gives for a refusal. */
function areasOf(hint: string): string[] {
  const own = /(?:write freely in|inside) (.+?\/)(?:,| and |\.)/.exec(hint)?.[1];
  const extra = /edit your own notes there, and in (.+?)\. The user can/.exec(hint)?.[1];
  return [...(own ? [own] : []), ...(extra ? extra.split(', ') : [])];
}

/** The title of a note, as the monster saw it: no folders, no `.md`. */
function noteTitle(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/**
 * The plain sentence for a failed note tool, or null when the case is not one of the known
 * ones (the raw error then stands alone). `agent` is the monster that made the call.
 */
export function toolProblem(
  failed: FailedTool,
  agent: { id: string; name: string },
): ToolProblem | null {
  // The note tools only: the same codes mean other things for the terminal, the files, the apps.
  if (!/^vault_/.test(failed.tool)) return null;
  const p = parse(failed);
  if (!p) return null;
  const s = toolProblemStrings();
  const { name } = agent;
  const m = (re: RegExp) => re.exec(p.message);
  switch (p.code) {
    case 'SETTING_OFF': {
      const areas = areasOf(p.hint);
      const list = areas.length > 0 ? formatList(areas) : null;
      const text = m(/ cannot write /)
        ? s.cannotWrite(name, list)
        : m(/ cannot delete or move /)
          ? s.cannotDelete(name, list)
          : m(/ cannot move notes to /)
            ? s.cannotMove(name, list)
            : null;
      return text
        ? { text: `${text} ${s.whereToChange(name)}`, settingsLabel: s.openSettings(name) }
        : null;
    }
    case 'NOT_FOUND': {
      const section = m(/^section "([\s\S]+)" not found in /);
      if (section) return { text: s.noSection(section[1]!) };
      const missing = m(/^note not found: ([\s\S]+)$/);
      if (missing) return { text: s.noteMissing(name, noteTitle(missing[1]!)) };
      if (m(/ does not exist$/)) return { text: s.noteNotThere(name) };
      return null;
    }
    case 'BLOCKED_BY_POLICY':
      if (m(/ is private$/)) return { text: s.privateNote };
      if (m(/managed by the system/)) return { text: s.systemFolder };
      if (m(/ is not reachable in this chat$/)) return { text: s.notReachable };
      return null;
    case 'CONFLICT':
      return m(/ changed since /) ? { text: s.changedMeanwhile(name) } : null;
    case 'EXISTS':
      return m(/ already exists$/) ? { text: s.alreadyExists(name) } : null;
    default:
      return null;
  }
}
