import { ArrowLeft, FileText } from '@phosphor-icons/react';
import type { LogEvent, VaultTrashItem } from '@monsters/shared';
import { useEffect, useState } from 'react';
import { vaultPath } from '../../lib/router.ts';
import { playSound } from '../../lib/sound.ts';
import { notify, useApp } from '../../store/app.ts';
import { useNameOf } from '../../store/hooks.ts';
import { Button } from '../ui/button.tsx';
import { vaultApi, vaultError } from './api.ts';
import { folderLabel } from './NoteList.tsx';
import { agoText, PrivateMark } from './shared.tsx';
import { folderOf } from '../../lib/vault-markdown.ts';

const titleOfPath = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

/** True when the action that trashed the note was an undo (of its creation). */
export function trashedByUndo(actionId: string | null, events: readonly LogEvent[]): boolean {
  if (!actionId) return false;
  return events.some(
    (e) => e.type === 'vault_change' && e.data.actionId === actionId && e.data.action === 'undo',
  );
}

/** "cancellata da te", "cancellata da Dione", "tolta annullando la creazione". */
export function trashedText(
  item: Pick<VaultTrashItem, 'deletedBy'>,
  byUndo: boolean,
  nameOf: (id: string) => string,
): string {
  if (byUndo) return 'tolta annullando la creazione';
  if (!item.deletedBy) return 'cancellata';
  return item.deletedBy === 'user' ? 'cancellata da te' : `cancellata da ${nameOf(item.deletedBy)}`;
}

function Item({ item, onRestored }: { item: VaultTrashItem; onRestored: (path: string) => void }) {
  const nameOf = useNameOf();
  const byUndo = useApp((s) => trashedByUndo(item.actionId, s.events));
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    if (!item.originalPath) return;
    playSound('click');
    setBusy(true);
    try {
      const res = await vaultApi.restoreTrash(item.trashPath);
      notify(
        res.path === item.originalPath
          ? `“${item.title}” è tornata al suo posto.`
          : `“${item.title}” è tornata come “${titleOfPath(res.path)}”: al suo posto c’è un’altra nota.`,
        'success',
      );
      onRestored(res.path);
    } catch (err) {
      notify(vaultError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3.5 py-4" data-testid="vault-trash-item">
      <span
        aria-hidden
        className="well inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] text-ink-faint"
      >
        <FileText size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-body font-semibold text-ink">
          <span className="truncate">{item.title}</span>
          {item.private && <PrivateMark compact />}
        </p>
        <p className="mt-0.5 text-footnote text-ink-muted">
          {item.originalPath
            ? `Era in ${folderLabel(folderOf(item.originalPath))} · ${trashedText(item, byUndo, nameOf)}`
            : 'Cancellata fuori da Monsters (per esempio in Obsidian)'}
          {item.deletedAt && ` · ${agoText(item.deletedAt)}`}
        </p>
      </div>
      {item.originalPath ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void restore()}
          data-testid="vault-trash-restore"
        >
          Rimetti a posto
        </Button>
      ) : (
        <span className="max-w-[220px] text-right text-footnote text-ink-muted">
          Rimettila a posto da Obsidian: qui non so dove stava.
        </span>
      )}
    </li>
  );
}

/** The trash of the notes (`.trash/`, as in Obsidian): a note goes back where it was. */
export function TrashView({
  version,
  onChanged,
  onBack,
}: {
  version: number;
  onChanged: () => void;
  /** Narrow screens: back to the list. */
  onBack?: (() => void) | undefined;
}) {
  const [items, setItems] = useState<VaultTrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    vaultApi
      .trash()
      .then((i) => {
        if (!alive) return;
        setItems(i);
        setError(null);
      })
      .catch((err: unknown) => alive && setError(vaultError(err)));
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <section
      className="vault-sheet flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-labelledby="vault-trash-title"
      data-testid="vault-trash-view"
    >
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[calc(68ch+6rem)] px-5 pt-4 pb-10 sm:px-12 sm:pt-10">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="mb-3 -ml-2.5 px-2.5 text-signal-ink"
            >
              <ArrowLeft size={16} weight="bold" aria-hidden /> Note
            </Button>
          )}
          <p className="label text-ink-faint">
            {items ? `${items.length} ${items.length === 1 ? 'nota' : 'note'}` : 'Cestino'}
          </p>
          <h2
            id="vault-trash-title"
            className="mt-2 text-display leading-[36px] font-semibold tracking-[-0.02em] text-ink"
          >
            Cestino
          </h2>
          <p className="mt-1.5 text-body text-ink-muted">
            Le note cancellate restano qui: puoi rimetterle dov’erano.
          </p>
          {error ? (
            <p className="py-8 text-body text-ink-muted">{error}</p>
          ) : !items ? (
            <p className="py-8 text-body text-ink-muted" aria-busy="true">
              Guardo nel cestino…
            </p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-large text-ink-muted">Il cestino è vuoto.</p>
          ) : (
            <ul className="vault-rules seam-t mt-6">
              {items.map((i) => (
                <Item
                  key={i.trashPath}
                  item={i}
                  onRestored={(path) => {
                    onChanged();
                    window.location.hash = vaultPath(path);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
