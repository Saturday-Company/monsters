import { CaretRight } from '@phosphor-icons/react';
import { useId, useState, type FormEvent } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { getApi } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { errorOf } from './mcp-parts.tsx';
import { FormField } from './parts.tsx';

/*
 * The way out when the page the service sends the browser back to does not
 * open (D-072): the core is reached on the network, or the tunnel dropped.
 * The user copies its address from the browser and pastes it here; the core
 * checks the same one-use `state` as the callback and finishes the sign-in.
 * Open by itself when the core says the page will not open (`paste`).
 */
export function OAuthPaste({
  open: openAtStart,
  onDone,
}: {
  open: boolean;
  /** The sign-in ended well: reload the servers. */
  onDone: () => void;
}) {
  const id = domId(useId());
  const [open, setOpen] = useState(openAtStart);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Incolla qui l’indirizzo della pagina.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await getApi().finishMcpOAuth(url.trim());
      if (res.ok) onDone();
      else setError(res.message);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2" data-testid="oauth-paste">
      {!openAtStart && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 justify-self-start rounded text-footnote font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
        >
          <CaretRight size={12} aria-hidden className={cn('turn', open && 'rotate-90')} />
          La pagina di ritorno non si apre?
        </button>
      )}
      {open && (
        <form className="grid gap-2" onSubmit={(e) => void send(e)} noValidate>
          <FormField
            id={id}
            label="Indirizzo della pagina di ritorno"
            error={error}
            hint="Dopo l’accesso il browser va su una pagina che non si carica: copia il suo indirizzo dalla barra in alto e incollalo qui."
          >
            <Input
              id={id}
              value={url}
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              placeholder="http://127.0.0.1:…/api/mcp-oauth/callback?code=…"
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={error ? true : undefined}
              className="font-mono text-footnote"
            />
          </FormField>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={busy}
            className="justify-self-start"
          >
            {busy ? 'Controllo…' : 'Completa l’accesso'}
          </Button>
        </form>
      )}
    </div>
  );
}
