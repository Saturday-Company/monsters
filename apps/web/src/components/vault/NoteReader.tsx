import {
  ArrowLeft,
  CaretRight,
  ClockCounterClockwise,
  FileText,
  ListBullets,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import {
  isMarkedMemoryLine,
  unmarkedMemoryLine,
  type VaultNote,
  type VaultSearchHit,
} from '@monsters/shared';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api.ts';
import { lineDiff } from '../../lib/line-diff.ts';
import { vaultPath } from '../../lib/router.ts';
import { folderOf, propertyText, withoutTitle } from '../../lib/vault-markdown.ts';
import { domId } from '../../lib/utils.ts';
import { playSound } from '../../lib/sound.ts';
import { getApi, notify } from '../../store/app.ts';
import { agentFileOf } from '../../store/derive.ts';
import { useAgents, useMediaQuery, useNameOf } from '../../store/hooks.ts';
import { noteActivityPath } from '../log/activity.ts';
import { Button, LabeledKey } from '../ui/button.tsx';
import { vaultApi, vaultError } from './api.ts';
import { Diff, NoteHistory } from './NoteHistory.tsx';
import { agoText, AuthorScreen, isAgentNote, longDate, PrivateMark, stampDate } from './shared.tsx';
import { VaultMarkdown } from './VaultMarkdown.tsx';

/** Frontmatter keys shown elsewhere in the header (not repeated in the properties). */
const HEADER_KEYS = new Set(['private']);

function Properties({ note, onTag }: { note: VaultNote; onTag: (t: string) => void }) {
  const entries = Object.entries(note.frontmatter).filter(([k]) => !HEADER_KEYS.has(k));
  if (entries.length === 0 && !note.frontmatterError) return null;
  return (
    <details className="group/props" data-testid="vault-properties">
      <summary className="label inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink [&::-webkit-details-marker]:hidden">
        <CaretRight
          size={10}
          weight="bold"
          aria-hidden
          className="turn group-open/props:rotate-90"
        />
        Proprietà ({entries.length})
      </summary>
      {note.frontmatterError && (
        <p className="mt-2 text-footnote text-stop-ink">
          Le proprietà non si leggono (YAML non valido): la nota è letta come testo.
        </p>
      )}
      <dl className="well mt-2.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2 rounded-[10px] px-4 py-3 text-body">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="label text-ink-muted">{k}</dt>
            <dd className="min-w-0 break-words text-ink">
              {(k === 'tags' || k === 'tag') && Array.isArray(v) ? (
                <span className="flex flex-wrap gap-1">
                  {v.map((t) => (
                    <button
                      key={String(t)}
                      type="button"
                      className="vault-tag"
                      onClick={() => onTag(String(t))}
                    >
                      #{String(t)}
                    </button>
                  ))}
                </span>
              ) : (
                propertyText(v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function LinkList({
  title,
  empty,
  items,
  testId,
}: {
  title: string;
  empty: string;
  items: { path: string; title: string; detail?: ReactNode }[] | null;
  testId: string;
}) {
  const id = domId(useId());
  return (
    <section aria-labelledby={id} className="min-w-0" data-testid={testId}>
      <h3 id={id} className="label mb-2 text-ink-faint">
        {title}
      </h3>
      {items === null ? (
        <p className="text-body text-ink-faint" aria-busy="true">
          Carico…
        </p>
      ) : items.length === 0 ? (
        <p className="text-body text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((i) => (
            <li key={i.path}>
              <a
                href={vaultPath(i.path)}
                className="row-key -mx-2 flex items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-signal-ink"
              >
                <FileText size={17} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.title}</span>
                  {i.detail && (
                    <span className="block text-footnote text-ink-muted">{i.detail}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The lines of a monster's memory written after third-party text (review of the waves 3 and
 * 4): the monster reads them as data, and the runs that read them keep the defenses on. «È mia»
 * takes the mark away when the line says what the user said or wants.
 */
export function MarkedMemoryLines({
  note,
  agents,
  onChanged,
}: {
  note: VaultNote;
  /** The monsters (`useAgents`): the note's folder names its owner. */
  agents: readonly { id: string; name: string }[];
  onChanged: () => void;
}) {
  const id = domId(useId());
  const [busy, setBusy] = useState<string | null>(null);
  const file = agentFileOf(note.path);
  if (file?.kind !== 'memory' || !note.content) return null;
  const agent = agents.find((a) => a.name.toLowerCase() === file.owner.toLowerCase());
  const lines = note.content.split('\n').filter(isMarkedMemoryLine);
  if (!agent || lines.length === 0) return null;
  const own = async (line: string) => {
    setBusy(line);
    try {
      await getApi().ownMemoryLine(agent.id, line);
      notify('Fatto: la riga è tua, senza segno.', 'success');
      onChanged();
    } catch (err) {
      notify(vaultError(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section
      aria-labelledby={id}
      className="well rounded-[10px] px-4 py-3"
      data-testid="memory-marked"
    >
      <h3 id={id} className="label mb-1 text-ink-faint">
        Righe da testo di terzi
      </h3>
      <p className="mb-2.5 text-footnote text-ink-muted">
        {agent.name} le ha scritte dopo aver letto pagine o messaggi di altri: le legge come dati,
        non come cose tue, e i lavori che le leggono hanno le difese accese. Se una riga dice una
        cosa tua, toccala con «È mia».
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((l) => {
          const text = unmarkedMemoryLine(l).replace(/^\s*[-*+]\s+/, '');
          return (
            <li key={l} className="flex items-start gap-3">
              <span className="min-w-0 flex-1 break-words text-body text-ink">{text}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void own(l)}
                aria-label={`È mia: ${text}`}
              >
                È mia
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Edits the text of a note. The version the edit starts from is fixed when the
 * editor opens: saving sends its hash, so a change made meanwhile (an agent,
 * Obsidian) is never overwritten silently. When the note changes under the
 * editor the draft stays and the user chooses: see the changes, overwrite
 * them with the draft, or drop the draft.
 */
function Editor({
  note,
  onSaved,
  onCancel,
  onStale,
}: {
  /** The note as it is now (reloaded when the vault changes). */
  note: VaultNote;
  onSaved: () => void;
  onCancel: () => void;
  /** The core refused a stale save: read the note again. */
  onStale: () => void;
}) {
  const id = domId(useId());
  const [base, setBase] = useState(note);
  const [text, setText] = useState(note.content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const changed = note.hash !== base.hash;

  const save = async (from: VaultNote) => {
    setBusy(true);
    setError(null);
    try {
      await vaultApi.save(from.path, text, from.hash);
      notify('Salvata. La trovi in Attività e si può annullare.', 'success');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') onStale();
      else setError(vaultError(err));
    } finally {
      setBusy(false);
    }
  };
  const overwrite = () => {
    setBase(note);
    setShowChanges(false);
    void save(note);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label htmlFor={`${id}-text`} className="sr-only">
        Testo della nota
      </label>
      {note.frontmatterError && (
        <p
          className="well rounded-[10px] px-3.5 py-2.5 text-body text-ink-muted"
          data-testid="vault-editor-broken-props"
        >
          Le proprietà di questa nota non sono scritte bene: salvo solo il testo e le lascio
          esattamente come sono. Per correggerle aprila in Obsidian.
        </p>
      )}
      {changed && (
        <div
          role="alert"
          className="card flex flex-col gap-3 rounded-[12px] bg-panel px-4 py-3.5"
          data-testid="vault-edit-conflict"
        >
          <p className="flex items-baseline gap-2.5 text-body text-ink">
            <span aria-hidden className="led translate-y-[-1px]" data-tone="signal" />
            <span>
              <span className="font-semibold">La nota è cambiata mentre la modificavi.</span> La tua
              bozza è qui sotto, intatta: scegli cosa tenere.
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showChanges}
              onClick={() => setShowChanges((v) => !v)}
            >
              Vedi le differenze
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={overwrite}>
              Sovrascrivi con la mia versione
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              Scarta la mia modifica
            </Button>
          </div>
          {showChanges && (
            <Diff
              diff={lineDiff(base.content ?? '', note.content ?? '')}
              empty="Il testo è lo stesso: sono cambiate solo le proprietà."
            />
          )}
        </div>
      )}
      <textarea
        id={`${id}-text`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-testid="vault-editor"
        spellCheck
        placeholder="Scrivi qui. Per collegare un’altra nota scrivi [[ e il suo titolo."
        className="well min-h-[360px] flex-1 resize-none rounded-[12px] px-5 py-4 text-large leading-[28px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
      />
      {error && (
        <p
          role="alert"
          className="rounded-[10px] bg-stop-soft px-3.5 py-2.5 text-body text-stop-ink"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {error ? 'Lascia stare e ricarica' : 'Annulla'}
        </Button>
        <Button
          onClick={() => {
            playSound('click');
            void save(base);
          }}
          disabled={busy || changed || text === base.content}
          data-testid="vault-save"
        >
          {busy ? 'Salvo…' : 'Salva'}
        </Button>
      </div>
    </div>
  );
}

export interface NoteReaderProps {
  path: string;
  version: number;
  resolve: (target: string) => string | null;
  onTag: (tag: string) => void;
  /** Last change, from the list (notes written by hand may have no `updated` property). */
  updated?: string | null | undefined;
  /** Narrow screens: back to the list. */
  onBack?: (() => void) | undefined;
  onChanged: () => void;
}

type Pane = 'nota' | 'cronologia';

/**
 * An action of the reader with its short name (UX: an icon alone is a guess):
 * beside the icon where the reader is wide, under it on a phone, as tooltip in
 * between. The full name (`label`) is the accessible one.
 */
function Action({
  label,
  short,
  layout,
  onClick,
  pressed,
  testId,
  children,
}: {
  label: string;
  short: string;
  layout: 'inline' | 'stacked' | 'icon';
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <LabeledKey
      label={short}
      aria-label={label}
      title={label}
      layout={layout}
      pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </LabeledKey>
  );
}

/**
 * One note, as Notes shows it: the date on top, the title, the text with
 * comfortable type; links to it and similar notes below. The actions (edit,
 * history, activity, trash) are icons above. Mounted once per path.
 */
export function NoteReader({
  path,
  version,
  resolve,
  onTag,
  updated: listed,
  onBack,
  onChanged,
}: NoteReaderProps) {
  const nameOf = useNameOf();
  const agents = useAgents();
  const [note, setNote] = useState<VaultNote | null>(null);
  const [error, setError] = useState<{ text: string; missing: boolean } | null>(null);
  const [relatedOf, setRelatedOf] = useState<{ hash: string; hits: VaultSearchHit[] } | null>(null);
  const [pane, setPane] = useState<Pane>('nota');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const phone = useMediaQuery('(max-width: 767px)');
  const roomy = useMediaQuery('(min-width: 1280px)');
  const layout = phone ? 'stacked' : roomy ? 'inline' : 'icon';

  useEffect(() => {
    let alive = true;
    vaultApi
      .note(path)
      .then((n) => {
        if (!alive) return;
        setNote(n);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setNote(null);
        const missing = err instanceof ApiError && err.code === 'not_found';
        setError({ text: vaultError(err), missing });
      });
    return () => {
      alive = false;
    };
  }, [path, version, reload]);

  useEffect(() => {
    if (!note) return;
    let alive = true;
    const hash = note.hash;
    vaultApi
      .related(note.path)
      .then((r) => alive && setRelatedOf({ hash, hits: r.hits }))
      .catch(() => alive && setRelatedOf({ hash, hits: [] }));
    return () => {
      alive = false;
    };
  }, [note]);
  const related = note && relatedOf?.hash === note.hash ? relatedOf.hits : null;

  const trash = async () => {
    if (!note) return;
    setBusy(true);
    try {
      await vaultApi.remove(note.path);
      notify(`“${note.title}” è nel cestino: puoi rimetterla a posto da lì.`, 'success');
      onChanged();
      window.location.hash = vaultPath(null, 'cestino');
    } catch (err) {
      notify(vaultError(err), 'error');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const back = onBack && (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1.5 px-2.5 text-signal-ink">
      <ArrowLeft size={16} weight="bold" aria-hidden /> Note
    </Button>
  );

  if (error)
    return (
      <div className="vault-sheet flex min-h-0 flex-1 flex-col gap-3 px-5 py-4 sm:px-10">
        {back && <div>{back}</div>}
        <p className="label pt-6 text-ink-faint">
          {error.missing ? 'Nota assente' : 'Errore di lettura'}
        </p>
        <h2 className="text-title1 font-semibold tracking-[-0.015em] text-ink">
          {error.missing ? 'Questa nota non c’è' : 'Non riesco ad aprire la nota'}
        </h2>
        <p className="max-w-[560px] text-large text-ink-muted">
          {error.missing
            ? `“${path}” non esiste (ancora): magari è un collegamento a una nota da scrivere, o è nel cestino.`
            : error.text}
        </p>
        <div>
          <a
            href={vaultPath(null, 'cestino')}
            className="text-body font-medium text-signal-ink underline underline-offset-3"
          >
            Guarda nel cestino
          </a>
        </div>
      </div>
    );
  if (!note)
    return (
      <div className="vault-sheet flex min-h-0 flex-1">
        <p className="label px-10 py-10 text-ink-faint" aria-busy="true">
          Apro la nota…
        </p>
      </div>
    );

  const folder = folderOf(note.path);
  const folderPath = folder ? folder.split('/').join(' › ') : 'Cartella principale';
  const updated =
    typeof note.frontmatter['updated'] === 'string'
      ? note.frontmatter['updated']
      : (listed ?? null);
  const history = pane === 'cronologia';

  return (
    <article
      className="vault-sheet flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-labelledby="vault-note-title"
      data-testid="vault-reader"
    >
      <div className="seam-b flex min-h-[54px] shrink-0 items-center gap-1 px-3 pt-1 pb-1.5 sm:px-4">
        {back}
        {!back && !phone && !confirmDelete && (
          <p className="label flex min-w-0 items-center gap-2 pl-2 text-ink-faint">
            <span className="truncate">{folderPath}</span>
          </p>
        )}
        <span className="flex-1" />
        {!editing &&
          (confirmDelete ? (
            <>
              <span className="mr-2 hidden text-footnote text-ink-muted sm:inline">
                La sposto nel cestino?
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Lascia stare
              </Button>
              <Button
                size="sm"
                variant="dangerSoft"
                disabled={busy}
                onClick={() => {
                  playSound('click');
                  void trash();
                }}
                data-testid="vault-trash-confirm"
              >
                Sì, nel cestino
              </Button>
            </>
          ) : (
            <>
              {!history && note.content !== null && !note.truncated && (
                <Action
                  label="Modifica"
                  short="Modifica"
                  layout={layout}
                  onClick={() => setEditing(true)}
                  testId="vault-edit"
                >
                  <PencilSimple size={20} aria-hidden />
                </Action>
              )}
              <Action
                label="Cronologia"
                short="Cronologia"
                layout={layout}
                pressed={history}
                onClick={() => setPane(history ? 'nota' : 'cronologia')}
                testId="vault-history-toggle"
              >
                <ClockCounterClockwise size={20} aria-hidden />
              </Action>
              <Action
                label="Attività sulla nota"
                short="Attività"
                layout={layout}
                onClick={() => {
                  window.location.hash = noteActivityPath(note.path);
                }}
                testId="vault-activity"
              >
                <ListBullets size={20} aria-hidden />
              </Action>
              <Action
                label="Sposta nel cestino"
                short="Cestino"
                layout={layout}
                onClick={() => setConfirmDelete(true)}
                testId="vault-trash"
              >
                <Trash size={20} aria-hidden />
              </Action>
            </>
          ))}
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[calc(68ch+6rem)] flex-col px-5 pt-7 pb-14 sm:px-12 sm:pt-10">
          {(back || phone) && <p className="label truncate pb-2 text-ink-faint">{folderPath}</p>}
          {updated && (
            <p
              className="vault-date text-ink-faint"
              title={`${longDate(updated)} · ${agoText(updated)}`}
            >
              {stampDate(updated)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h2
              id="vault-note-title"
              className="min-w-0 text-display leading-[36px] font-semibold tracking-[-0.02em] break-words text-ink"
            >
              {note.title}
            </h2>
            {note.private && <PrivateMark />}
          </div>
          {note.author && (
            <p className="mt-3.5 inline-flex items-center gap-2.5 text-footnote text-ink-muted">
              <AuthorScreen id={note.author} width={30} height={26} />
              {note.author === 'user' ? 'Scritta da te' : `Scritta da ${nameOf(note.author)}`}
            </p>
          )}
          <div className="mt-7 flex flex-col gap-6">
            {history ? (
              <>
                {/* The way out of the history in words, not only the pressed clock (UI-44). */}
                <div className="flex items-center justify-between gap-3">
                  <h3 className="label text-ink-faint">Cronologia</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPane('nota')}
                    data-testid="vault-history-close"
                  >
                    <ArrowLeft size={15} weight="bold" aria-hidden /> Torna alla nota
                  </Button>
                </div>
                <NoteHistory
                  path={note.path}
                  version={version + reload}
                  onChanged={() => {
                    setReload((r) => r + 1);
                    onChanged();
                  }}
                />
              </>
            ) : editing ? (
              <Editor
                note={note}
                onSaved={() => {
                  setEditing(false);
                  setReload((r) => r + 1);
                  onChanged();
                }}
                onCancel={() => {
                  setEditing(false);
                  setReload((r) => r + 1);
                }}
                onStale={() => setReload((r) => r + 1)}
              />
            ) : (
              <>
                {note.content === null ? (
                  <p className="text-large text-ink-muted">
                    Questo file non è una nota di testo: aprilo con Obsidian o con il suo programma.
                  </p>
                ) : note.content.trim() === '' ? (
                  <p className="text-large text-ink-muted">La nota è vuota.</p>
                ) : (
                  <VaultMarkdown
                    text={withoutTitle(note.content, note.title)}
                    resolve={resolve}
                    onTag={onTag}
                  />
                )}
                {note.truncated && (
                  <p className="text-footnote text-ink-muted">
                    La nota è molto lunga: qui ne vedi solo l’inizio. Aprila in Obsidian per il
                    resto.
                  </p>
                )}
                <MarkedMemoryLines
                  note={note}
                  agents={agents}
                  onChanged={() => {
                    setReload((r) => r + 1);
                    onChanged();
                  }}
                />
                <Properties note={note} onTag={onTag} />
                <div className="seam-t mt-3 grid gap-7 pt-6 sm:grid-cols-2">
                  <LinkList
                    title="Note che la citano"
                    empty="Nessuna nota la collega ancora."
                    items={note.backlinks.filter((b) => !isAgentNote(b.path))}
                    testId="vault-backlinks"
                  />
                  <LinkList
                    title="Note simili"
                    empty="Niente di simile, per ora."
                    items={
                      related
                        ?.filter((h) => !isAgentNote(h.path))
                        .map((h) => ({
                          path: h.path,
                          title: h.title,
                          detail: folderOf(h.path) || 'Cartella principale',
                        })) ?? null
                    }
                    testId="vault-related"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
