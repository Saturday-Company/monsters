import { CaretRight } from '@phosphor-icons/react';
import type { VaultHistoryEntry, VaultVersion } from '@monsters/shared';
import { useEffect, useId, useState } from 'react';
import { notify } from '../../store/app.ts';
import { playSound } from '../../lib/sound.ts';
import { useNameOf } from '../../store/hooks.ts';
import { SCREEN_DIFF } from '../../theme/vault.ts';
import { cn, domId } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import { vaultApi, vaultError } from './api.ts';
import { noteStrings } from './note.strings.ts';
import { agoText, AuthorScreen, stampDate } from './shared.tsx';

/** What a commit message says, in words: "vault_edit: Risorse/x.md [agent=…]" → "Edited". */
export function actionLabel(message: string): string {
  const s = noteStrings().history;
  const tool = /^(\w+):/.exec(message)?.[1] ?? '';
  switch (tool) {
    case 'vault_write':
      return s.written;
    case 'vault_edit':
      return s.edited;
    case 'vault_move':
      return s.moved;
    case 'vault_delete':
      return s.deleted;
    case 'vault_restore':
      return s.restored;
    case 'vault_undo':
      return s.undone;
    case 'vault_apply_proposal':
      return s.applied;
    case 'vault_propose':
      return s.proposal;
    default:
      // i18n-ignore: words of the core's commit messages
      return /snapshot|esterna|outside/i.test(message) ? s.outside : s.edited;
  }
}

/** The line a hunk header points at ("@@ -1,3 +4,5 @@" → "4"); null for the bare "@@"; undefined for any other line. */
function hunkLine(line: string): string | null | undefined {
  if (!line.startsWith('@@')) return undefined;
  return /\+(\d+)/.exec(line)?.[1] ?? /(\d+)/.exec(line)?.[1] ?? null;
}

/**
 * A hunk header read for people: "@@ -1,3 +4,5 @@" becomes "· line 4 ·"; the
 * bare "@@" of the core (lines skipped) a quiet "· · ·". Null for any other line.
 */
export function hunkText(line: string): string | null {
  const at = hunkLine(line);
  if (at === undefined) return null;
  return at ? noteStrings().history.atLine(at) : '· · ·';
}

/**
 * The lines of a diff split into the note's properties (the YAML block between
 * `---` at the top) and its text. The properties are machinery ("author: rhea",
 * "sources: 3"): they stay folded under the text.
 */
export function splitDiff(diff: string): { body: string[]; meta: string[] } {
  const body: string[] = [];
  const meta: string[] = [];
  /** Where the YAML block is: before it, inside it, after it (or no block at all). */
  let state: 'start' | 'in' | 'out' = 'start';
  /** The hunk header of line 1 at the top: it goes with the properties if they come next. */
  let first: string | null = null;
  for (const line of diff.split('\n')) {
    const at = hunkLine(line);
    if (at !== undefined) {
      // A hunk past the top of the note cannot be in the properties.
      if (state === 'start' && at === '1' && first === null) first = line;
      else {
        if (state === 'start') state = 'out';
        if (state !== 'in') body.push(line);
      }
      continue;
    }
    const content = /^[+\- ]/.test(line) ? line.slice(1) : line;
    if (state === 'start') {
      if (content.trim() === '---') {
        state = 'in';
        if (first !== null) meta.push(first);
        meta.push(line);
        continue;
      }
      if (first !== null) body.push(first);
      state = 'out';
    } else if (state === 'in') {
      meta.push(line);
      if (content.trim() === '---') state = 'out';
      continue;
    }
    body.push(line);
  }
  return { body, meta };
}

/** The lines of a diff on a small black screen (also the proposals of CLAUDE.md, D-113). */
export function DiffLines({
  lines,
  testId = 'vault-diff',
}: {
  lines: readonly string[];
  testId?: string;
}) {
  const c = SCREEN_DIFF;
  const s = noteStrings().history;
  return (
    <pre
      className="screen scroll-soft max-h-[360px] overflow-auto rounded-[10px] py-2.5 font-mono text-micro leading-[1.7] text-screen-ink [scrollbar-color:rgba(255,255,255,.2)_transparent]"
      data-testid={testId}
    >
      {lines.map((line, i) => {
        const hunk = hunkText(line);
        if (hunk !== null)
          return (
            <span key={i} className="block px-3.5 text-screen-muted">
              {hunk}
            </span>
          );
        const add = line.startsWith('+');
        const del = line.startsWith('-');
        return (
          <span
            key={i}
            className="block px-3.5 whitespace-pre-wrap"
            style={
              add
                ? { background: c.addBg, color: c.addFg }
                : del
                  ? { background: c.delBg, color: c.delFg }
                  : undefined
            }
          >
            <span className="sr-only">{add ? s.added : del ? s.removed : ''}</span>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * A line diff (`-`/`+` lines) on a small black screen, in Martian Mono: the
 * hunk headers become "· line N ·", the properties of the note fold under it.
 */
export function Diff({
  diff,
  empty = noteStrings().history.unchanged,
}: {
  diff: string;
  empty?: string;
}) {
  if (!diff) return <p className="text-footnote text-ink-muted">{empty}</p>;
  const { body, meta } = splitDiff(diff);
  const changed = (ls: readonly string[]) => ls.some((l) => /^[+-]/.test(l));
  return (
    <div className="grid gap-2">
      {changed(body) ? (
        <DiffLines lines={body} />
      ) : (
        <p className="text-footnote text-ink-muted">{empty}</p>
      )}
      {changed(meta) && (
        <details className="group/meta">
          <summary className="label inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink [&::-webkit-details-marker]:hidden">
            <CaretRight
              size={10}
              weight="bold"
              aria-hidden
              className="turn group-open/meta:rotate-90"
            />
            {noteStrings().history.changedProps}
          </summary>
          <div className="mt-2">
            <DiffLines lines={meta} />
          </div>
        </details>
      )}
    </div>
  );
}

function Entry({
  entry,
  path,
  latest,
  onRestored,
}: {
  entry: VaultHistoryEntry;
  path: string;
  latest: boolean;
  onRestored: () => void;
}) {
  const s = noteStrings().history;
  const nameOf = useNameOf();
  const id = domId(useId());
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<VaultVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || version) return;
    let alive = true;
    vaultApi
      .version(path, entry.commit)
      .then((v) => alive && setVersion(v))
      .catch((err: unknown) => alive && setError(vaultError(err)));
    return () => {
      alive = false;
    };
  }, [open, version, path, entry.commit]);

  const restore = async () => {
    setBusy(true);
    try {
      await vaultApi.restore(path, entry.commit);
      notify(s.restoredDone, 'success');
      onRestored();
    } catch (err) {
      notify(vaultError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const author = entry.author;
  return (
    <li className="flex flex-col gap-2.5 py-4" data-testid="vault-history-entry">
      <div className="flex flex-wrap items-center gap-3">
        <AuthorScreen id={author} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-body text-ink">
            <span className="font-semibold">{nameOf(author)}</span>
            <span aria-hidden className="text-ink-faint">
              ·
            </span>
            <span>{actionLabel(entry.message)}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-ink-muted">
            <span
              className="vault-date text-ink-faint"
              // The version id is for whoever looks for it in git: in the tooltip only.
              title={s.version(agoText(entry.date), entry.commit.slice(0, 7))}
            >
              {stampDate(entry.date)}
            </span>
            {latest && (
              <span className="label inline-flex items-center gap-2 text-ink-muted">
                <span aria-hidden className="led size-1.5" data-tone="ok" />
                {s.current}
              </span>
            )}
          </p>
        </div>
        {!latest && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              playSound('click');
              void restore();
            }}
            data-testid="vault-restore-version"
          >
            {s.goBack}
          </Button>
        )}
      </div>
      <div className="pl-[46px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-diff`}
          onClick={() => setOpen((o) => !o)}
          className="label inline-flex items-center gap-1.5 rounded text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink"
        >
          <CaretRight
            size={10}
            weight="bold"
            aria-hidden
            className={cn('turn', open && 'rotate-90')}
          />
          {s.details}
        </button>
        {open && (
          <div id={`${id}-diff`} className="mt-2 flex flex-col gap-2">
            {error ? (
              <p className="text-footnote text-ink-muted">{error}</p>
            ) : version ? (
              <Diff diff={version.diff} />
            ) : (
              <p className="text-footnote text-ink-muted" aria-busy="true">
                {s.loadingChanges}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Versions of a note, newest first: what changed in each (under "Details") and
 * one action, back to that version. Undoing a single change lives in Activity.
 */
export function NoteHistory({
  path,
  version,
  onChanged,
}: {
  path: string;
  version: number;
  onChanged: () => void;
}) {
  // Tagged with their note: never show (and restore from) the versions of another path.
  const [loaded, setLoaded] = useState<{ path: string; entries: VaultHistoryEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = loaded?.path === path ? loaded.entries : null;
  const s = noteStrings().history;

  useEffect(() => {
    let alive = true;
    vaultApi
      .history(path)
      .then((e) => {
        if (!alive) return;
        setLoaded({ path, entries: e });
        setError(null);
      })
      .catch((err: unknown) => alive && setError(vaultError(err)));
    return () => {
      alive = false;
    };
  }, [path, version]);

  if (error) return <p className="py-6 text-body text-ink-muted">{error}</p>;
  if (!entries)
    return (
      <p className="py-6 text-body text-ink-muted" aria-busy="true">
        {s.loadingHistory}
      </p>
    );
  if (entries.length === 0) return <p className="py-6 text-body text-ink-muted">{s.none}</p>;
  return (
    <ol className="vault-rules" aria-label={s.versions} data-testid="vault-history">
      {entries.map((e, i) => (
        <Entry
          key={`${path}@${e.commit}`}
          entry={e}
          path={path}
          latest={i === 0}
          onRestored={onChanged}
        />
      ))}
    </ol>
  );
}
