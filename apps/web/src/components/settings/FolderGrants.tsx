import { FolderSimple, Plus, X } from '@phosphor-icons/react';
import type { FolderGrant } from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { domId, folderKey } from '../../lib/utils.ts';
import { errorText } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { fieldOnGroup } from './parts.tsx';
import { permissionsStrings } from './permissions.strings.ts';

/**
 * Folders of the computer an agent may use, outside the vault: a list with
 * "can edit" and remove, plus a field to add one by path. `onChange`
 * may reject (e.g. the core refuses a folder): the error shows under the field.
 */
export function FolderGrants({
  folders,
  onChange,
  placeholder,
  label,
  home,
  disabled = false,
}: {
  folders: FolderGrant[];
  onChange: (next: FolderGrant[]) => Promise<void> | void;
  placeholder: string;
  label?: string;
  /** The user's home, to recognise `~/x` as a folder already in the list. */
  home?: string;
  disabled?: boolean;
}) {
  const s = permissionsStrings().folders;
  const shownLabel = label ?? s.granted;
  const id = domId(useId());
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (next: FolderGrant[]): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await onChange(next);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = path.trim();
    if (!p) return;
    if (!p.startsWith('/') && !p.startsWith('~') && !/^[A-Za-z]:[\\/]/.test(p)) {
      setError(s.needFullPath);
      return;
    }
    if (folders.some((f) => folderKey(f.path, home) === folderKey(p, home))) {
      setError(s.alreadyThere);
      return;
    }
    if (await apply([...folders, { path: p, write: false }])) setPath('');
  };

  return (
    <div className="grid gap-2" data-testid="folder-grants">
      <p id={`${id}-label`} className="text-footnote font-medium text-ink">
        {shownLabel}
      </p>
      {folders.length > 0 ? (
        <ul className="set-rows" aria-labelledby={`${id}-label`}>
          {folders.map((f) => (
            <li key={f.path} className="flex items-center gap-3 py-1.5" data-testid="folder-grant">
              <FolderSimple
                size={16}
                weight="bold"
                aria-hidden
                className="shrink-0 text-ink-muted"
              />
              <span className="min-w-0 flex-1 font-mono text-footnote break-all text-ink">
                {f.path}
              </span>
              <span className="hidden text-caption text-ink-muted sm:inline">
                {f.write ? s.canEdit : s.readOnly}
              </span>
              <Switch
                words
                checked={f.write}
                onCheckedChange={(v) =>
                  void apply(folders.map((x) => (x.path === f.path ? { ...x, write: v } : x)))
                }
                label={s.canEditFiles(f.path)}
                disabled={disabled || busy}
              />
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={s.remove(f.path)}
                disabled={disabled || busy}
                onClick={() => void apply(folders.filter((x) => x.path !== f.path))}
              >
                <X size={14} weight="bold" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-footnote text-ink-muted">{s.none}</p>
      )}
      {folders.some((f) => f.write) && (
        <p className="text-footnote leading-snug text-ink-muted" data-testid="launch-files-note">
          {s.launchFiles}
        </p>
      )}
      <form onSubmit={(e) => void add(e)} className="flex gap-2" noValidate>
        <Input
          id={id}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-label={s.addTo(shownLabel)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-10 font-mono text-footnote ${fieldOnGroup}`}
          disabled={disabled}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          className="h-9"
          disabled={disabled || busy || !path.trim()}
        >
          <Plus size={16} aria-hidden /> {s.add}
        </Button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-footnote text-stop-ink">
          {error}
        </p>
      )}
    </div>
  );
}
