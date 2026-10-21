import { ArrowLeft } from '@phosphor-icons/react';
import { useId, useState, type FormEvent } from 'react';
import { playSound } from '../../lib/sound.ts';
import { domId } from '../../lib/utils.ts';
import { notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/field.tsx';
import { vaultApi, vaultError } from './api.ts';
import { folderLabel } from './NoteList.tsx';
import { vaultStrings } from './vault.strings.ts';

/** Characters Obsidian does not accept in a note name (as the vault checks them). */
const FORBIDDEN = /[#|^:%[\]\\/?*"<>]/;
/** The same for a folder, where `/` separates the folders inside it. */
const FORBIDDEN_FOLDER = /[#|^:%[\]\\?*"<>]/;
/** Value of the "New folder…" entry of the menu (never a real folder: it has a `:`). */
const NEW_FOLDER = ':nuova';

export function titleProblem(title: string): string | null {
  if (FORBIDDEN.test(title)) return vaultStrings().newNote.forbiddenTitle;
  return null;
}

export function folderProblem(folder: string): string | null {
  const f = folder.trim();
  const s = vaultStrings().newNote;
  if (!f) return s.folderEmpty;
  if (FORBIDDEN_FOLDER.test(f)) return s.forbiddenFolder;
  if (f.split('/').some((part) => part.trim() === '' || part.startsWith('.')))
    return s.folderInvalid;
  // i18n-ignore: the vault's folder of the monsters, data
  if (/^agenti(\/|$)/i.test(f)) return s.folderAgents;
  return null;
}

/**
 * A new note written by the user: title, a folder (an existing one or a new
 * one) and the text. It goes through the core like every change of the user
 * (commit, `vault_change` in Activity, undoable) and never replaces a note.
 */
export function NewNote({
  folders,
  onCreated,
  onCancel,
}: {
  /** Existing folders ("" is the main folder, always offered). */
  folders: string[];
  onCreated: (path: string) => void;
  onCancel: () => void;
}) {
  const s = vaultStrings().newNote;
  const id = domId(useId());
  const [title, setTitle] = useState('');
  // Inbox/ until the user picks a folder (the list may arrive after the form opens).
  const [chosen, setFolder] = useState<string | null>(null);
  const picked = chosen ?? (folders.includes('Inbox') ? 'Inbox' : '');
  const [newFolder, setNewFolder] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingFolder = picked === NEW_FOLDER;
  const folder = creatingFolder ? newFolder.trim().replace(/^\/+|\/+$/g, '') : picked;
  const problem = titleProblem(title);
  const folderError = creatingFolder && newFolder ? folderProblem(newFolder) : null;
  const options =
    folders.includes(picked) || picked === '' || creatingFolder ? folders : [picked, ...folders];
  const ready =
    !!title.trim() && !problem && (!creatingFolder || folderProblem(newFolder) === null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    playSound('click');
    setBusy(true);
    setError(null);
    try {
      const res = await vaultApi.create(folder, title.trim(), text);
      notify(s.created, 'success');
      onCreated(res.path);
    } catch (err) {
      setError(vaultError(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="vault-sheet scroll-soft flex min-h-0 flex-1 flex-col overflow-y-auto"
      aria-labelledby={`${id}-heading`}
      data-testid="vault-new-note"
    >
      <div className="mx-auto flex w-full max-w-[calc(68ch+6rem)] flex-1 flex-col gap-5 px-5 pt-4 pb-8 sm:px-12 sm:pt-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="-ml-2.5 self-start px-2.5 text-signal-ink min-[900px]:hidden"
        >
          <ArrowLeft size={16} weight="bold" aria-hidden /> {vaultStrings().notes}
        </Button>
        <div>
          <p className="label text-ink-faint">
            {s.goesIn(creatingFolder && !folder ? null : folderLabel(folder))}
          </p>
          <h2
            id={`${id}-heading`}
            className="mt-2 text-display leading-[36px] font-semibold tracking-[-0.02em] text-ink"
          >
            {s.heading}
          </h2>
        </div>
        <div className="grid items-start gap-4 min-[700px]:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
          <Field id={`${id}-title`} label={s.title} error={title ? problem : null}>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              autoFocus
              placeholder={s.titlePlaceholder}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-title-error` : undefined}
              data-testid="vault-new-title"
            />
          </Field>
          <Field id={`${id}-folder`} label={s.folder}>
            <select
              id={`${id}-folder`}
              value={picked}
              onChange={(e) => setFolder(e.target.value)}
              data-testid="vault-new-folder"
              className="well h-11 w-full rounded-[10px] px-3 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
            >
              <option value="">{vaultStrings().mainFolder}</option>
              {options.map((f) => (
                <option key={f} value={f}>
                  {folderLabel(f)}
                </option>
              ))}
              <option value={NEW_FOLDER}>{s.newFolder}</option>
            </select>
          </Field>
        </div>
        {creatingFolder && (
          <Field id={`${id}-new-folder`} label={s.newFolderName} error={folderError}>
            <Input
              id={`${id}-new-folder`}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder={s.newFolderPlaceholder}
              aria-invalid={folderError ? true : undefined}
              aria-describedby={folderError ? `${id}-new-folder-error` : undefined}
              data-testid="vault-new-folder-name"
            />
          </Field>
        )}
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-text`} className="text-footnote font-medium text-ink">
            {s.text}
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${id}-text-hint`}
            data-testid="vault-new-text"
            spellCheck
            className="well min-h-[260px] flex-1 resize-none rounded-[12px] px-5 py-4 text-large leading-[28px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
          />
          <p id={`${id}-text-hint`} className="text-footnote text-ink-muted">
            {s.hint}
          </p>
        </div>
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
            {s.cancel}
          </Button>
          <Button type="submit" disabled={busy || !ready} data-testid="vault-new-save">
            {busy ? s.creating : s.create}
          </Button>
        </div>
      </div>
    </form>
  );
}
