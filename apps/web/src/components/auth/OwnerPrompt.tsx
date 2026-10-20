import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { domId } from '../../lib/utils.ts';
import { answerOwnerPrompt, confirmOwner, errorText, useApp } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/field.tsx';

/*
 * "Conferma che sei tu" (review of 18/10, M1). Approvals, permissions, the cap, the
 * "Chiedi sempre" rules and Telegram need the user in person: a session opened with the
 * password. The desktop app opens one by itself on a core started from the terminal (or
 * reached over SSH) with the CLI token, a file a monster with the terminal can read too, so
 * that session reads and works but cannot approve. And the most sensitive changes (the
 * Terminal of a monster, pairing Telegram, "Strumenti per gli altri") want the password typed
 * in the last minutes. Here the password confirms this session, and the request goes again.
 */
export function OwnerPrompt() {
  const reason = useApp((s) => s.ownerPrompt);
  // A new dialog at every request: the password typed before is never kept.
  return reason ? <OwnerDialog reason={reason} /> : null;
}

function OwnerDialog({ reason }: { reason: 'owner' | 'recent' }) {
  const ids = domId(useId());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answerOwnerPrompt(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await confirmOwner(password);
      answerOwnerPrompt(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="owner-prompt-layer"
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-text`}
        data-testid="owner-prompt"
        className="raised relative m-0 w-[min(420px,100%)] rounded-[16px] p-6 text-ink"
      >
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <h2 id={`${ids}-title`} className="text-title2 font-semibold">
            Conferma che sei tu
          </h2>
          <p id={`${ids}-text`} className="text-body leading-snug text-ink-muted">
            {reason === 'owner'
              ? 'Questa la decidi solo tu. L’app è entrata da sola con il token del terminale, che anche un mostro con il Terminale può leggere: per approvare, dare permessi o cambiare Telegram serve la tua password.'
              : 'Dare il Terminale a un mostro, abbinare Telegram o accendere gli strumenti per gli altri vuole la tua password degli ultimi minuti: scrivila di nuovo.'}
          </p>
          <Field id={`${ids}-password`} label="Password" error={error}>
            <Input
              id={`${ids}-password`}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => answerOwnerPrompt(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={busy || !password}>
              {busy ? 'Controllo…' : 'Conferma'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>,
    document.body,
  );
}
