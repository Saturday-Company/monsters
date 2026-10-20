import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { Component, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';

/*
 * When a part of the app does not load or breaks (M2.8 review, D-034).
 *
 * Every page is a chunk of its own: after an update of Monsters the old page
 * may ask for files that are gone. Vite reports it with `vite:preloadError`
 * (build only); the import then fails and the nearest `ErrorBoundary` shows a
 * plain message. Nothing reloads by itself (an open editor would lose its
 * text): the user is asked, once. When a reload made a minute ago did not
 * help, the message says so instead of asking again for the same thing.
 */

const RELOAD_KEY = 'monsters:reloaded-at';
const RELOAD_WINDOW_MS = 60_000;

/** A file of the app that did not load (usually: a new build replaced it). */
export function isChunkError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS|ChunkLoadError/i.test(
    text,
  );
}

function reloadedRecently(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_KEY));
    return at > 0 && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

export function reloadPage(): void {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Private mode: the reload still happens, only the "already tried" hint is lost.
  }
  window.location.reload();
}

/* --- chunk failures reported by Vite, shown once ---------------------------- */

const chunks = { failed: false, dismissed: false, onScreen: 0 };
let snapshot = { ...chunks };
const listeners = new Set<() => void>();
function update(change: Partial<typeof chunks>): void {
  Object.assign(chunks, change);
  snapshot = { ...chunks };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useChunks = () => useSyncExternalStore(subscribe, () => snapshot);

let installed = false;
/** Listens for `vite:preloadError`; the error still reaches the boundary of its page. */
export function installChunkErrorHandler(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('vite:preloadError', () => {
    if (!chunks.failed) update({ failed: true });
  });
}

/** Marks a boundary that already shows the chunk message (no second prompt). */
function OnScreen() {
  useEffect(() => {
    update({ onScreen: chunks.onScreen + 1 });
    return () => update({ onScreen: chunks.onScreen - 1 });
  }, []);
  return null;
}

/**
 * The prompt for a file that failed to load outside any page (a prefetch): a
 * new version is out, reload when you like. Shown once, never reloads by itself.
 */
export function UpdatePrompt() {
  const { failed, dismissed, onScreen } = useChunks();
  if (!failed || dismissed || onScreen > 0) return null;
  const again = reloadedRecently();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[64px] z-[60] flex justify-center px-4">
      <div
        role="alert"
        data-testid="update-prompt"
        className="raised pointer-events-auto flex max-w-[520px] flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-3 text-body text-ink"
      >
        <span className="min-w-0 flex-1">
          {again
            ? 'Una parte di Monsters non si carica nemmeno dopo aver ricaricato: controlla che il core sia acceso e aggiornato.'
            : 'C’è una versione nuova di Monsters: ricarica la pagina per usarla.'}
        </span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => update({ dismissed: true })}>
            Più tardi
          </Button>
          <Button size="sm" onClick={reloadPage}>
            <ArrowClockwise size={15} weight="bold" aria-hidden /> Ricarica
          </Button>
        </span>
      </div>
    </div>
  );
}

function Fallback({ error, full }: { error: unknown; full: boolean }) {
  const chunk = isChunkError(error);
  const again = chunk && reloadedRecently();
  const title = again
    ? 'Questa parte non si carica'
    : chunk
      ? 'C’è una versione nuova di Monsters'
      : 'Qualcosa si è rotto qui';
  const text = again
    ? 'Ho già ricaricato la pagina, ma non va ancora. Controlla che il core sia acceso e aggiornato, poi riprova.'
    : chunk
      ? 'Questa parte della pagina non si è caricata: succede dopo un aggiornamento. Ricarica la pagina per continuare.'
      : 'Questa parte di Monsters ha avuto un problema. Di solito basta ricaricare la pagina; i mostri intanto continuano il loro lavoro.';
  return (
    <div
      role="alert"
      data-testid="error-boundary"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        full ? 'relative z-[1] min-h-full' : 'min-h-0 flex-1',
      )}
    >
      {chunk && <OnScreen />}
      <WarningCircle size={34} weight="duotone" aria-hidden className="text-ink-faint" />
      <h2 className="text-title2 font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <p className="max-w-[440px] text-large text-ink-muted">{text}</p>
      <Button onClick={reloadPage}>
        <ArrowClockwise size={17} weight="bold" aria-hidden />{' '}
        {again ? 'Riprova' : 'Ricarica la pagina'}
      </Button>
    </div>
  );
}

/**
 * Keeps a failure inside its part of the app (a page, the graph, the whole app
 * as a last resort) with a plain message instead of a blank screen. Give it a
 * `key` that changes with the page, so moving elsewhere tries again.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; full?: boolean },
  { failed: boolean; error: unknown }
> {
  override state = { failed: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <Fallback error={this.state.error} full={this.props.full ?? false} />;
  }
}
