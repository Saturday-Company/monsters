import { PASSWORD_MIN_LENGTH } from '@monsters/shared';
import type { Expression } from '@monsters/monster-kit';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MOCK_SETUP_CODE } from '../../lib/mock/constants.ts';
import { SetupBodySchema } from '../../lib/api.ts';
import { desktop } from '../../lib/desktop.ts';
import { errorText, login, setup } from '../../store/app.ts';
import { playSound } from '../../lib/sound.ts';
import { cn, domId } from '../../lib/utils.ts';
import { still } from '../../lib/motion.ts';
import '../../onboarding/boot.css';
import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/field.tsx';
import { Meter } from '../ui/Meter.tsx';
import { DeviceFrame, DeviceScreen } from './Device.tsx';
import { LanguageSwitch } from './LanguageSwitch.tsx';

/*
 * Account creation and sign-in (docs/design.md, "Accesso"): a small device in
 * the middle of the chassis. Its big screen shows the capo squadra asleep; under
 * it the sunk fields and the "Entra" key. When the sign-in succeeds the monster
 * wakes up (happy, ~600 ms), then the app opens. A refused password makes it
 * frown for a moment, then it goes back to sleep.
 * In the desktop app on this computer the user never sees the sign-in (D-057:
 * the app signs in by itself); it stays for browsers, phones and other computers.
 */

/** How long the monster stays awake and happy before the app opens. */
export const WAKE_MS = 600;
/** How long it frowns at a refused password. */
const FROWN_MS = 1400;

type Phase = 'asleep' | 'busy' | 'awake' | 'refused';

const SCREEN_LINE: Record<Phase, string> = {
  asleep: 'La squadra dorme',
  busy: 'Controllo…',
  awake: 'Ciao!',
  refused: 'Non ti riconosco',
};

function screenLine(phase: Phase, setupMode: boolean): string {
  if (!setupMode) return SCREEN_LINE[phase];
  return phase === 'asleep'
    ? 'Pronto per la prima accensione'
    : phase === 'refused'
      ? 'Manca qualcosa'
      : SCREEN_LINE[phase];
}

const EXPRESSION: Record<Phase, Expression> = {
  asleep: 'sleep',
  busy: 'sleep',
  awake: 'happy',
  refused: 'error',
};

/** "Ho dimenticato la password": the account lives on the computer, nothing goes by email (D-057). */
function ForgotPassword() {
  const id = domId(useId());
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The two ways open below the fold on a short window: bring them into sight (audit UI-16).
  useEffect(() => {
    if (!open) return;
    panel.current?.scrollIntoView({ block: 'nearest' });
    panel.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div className="grid gap-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="mx-auto text-footnote text-signal-ink hover:text-signal-ink"
      >
        Ho dimenticato la password
      </Button>
      {open && (
        <div
          id={id}
          ref={panel}
          tabIndex={-1}
          data-testid="forgot-password"
          className="well rise-in grid scroll-mb-4 gap-3 outline-none rounded-[12px] px-4 py-3.5 text-body leading-snug text-ink-muted"
        >
          <p>
            L’account vive solo sul computer dove gira Monsters: nessuna mail lo può reimpostare.
          </p>
          <div className="grid gap-0.5">
            <p className="label text-ink">Con l’app</p>
            <p>Apri l’app Monsters su quel computer: lì entri senza password.</p>
          </div>
          <div className="grid gap-0.5">
            <p className="label text-ink">Con il terminale</p>
            <p>
              Su quel computer esegui <code className="font-mono text-ink">monsters password</code>{' '}
              e scegline una nuova.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** The last email that entered from this browser: the sign-in starts from it (UX 9). */
const LAST_EMAIL = 'monsters:last-email';

function lastEmail(): string {
  try {
    return window.localStorage.getItem(LAST_EMAIL) ?? '';
  } catch {
    return '';
  }
}

function rememberEmail(email: string): void {
  try {
    window.localStorage.setItem(LAST_EMAIL, email);
  } catch {
    // private window, storage blocked: the field just starts empty next time
  }
}

export function AuthScreen({ mode, mock }: { mode: 'setup' | 'login'; mock: boolean }) {
  const uid = domId(useId());
  const [email, setEmail] = useState(() => (mode === 'login' ? lastEmail() : ''));
  // Known email: the password is what is left to type.
  const [knownEmail] = useState(() => email !== '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('asleep');
  // Fields left empty or invalid are "missing something"; "refused" is for data the core turned down.
  const [refusal, setRefusal] = useState<'missing' | 'refused'>('refused');
  const frown = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In the desktop app the setup code comes from the app (it reads it in the data directory):
  // nothing about it is shown (audit 2.13).
  const [appCode, setAppCode] = useState(false);

  useEffect(() => {
    const app = desktop();
    if (mode !== 'setup' || !app) return;
    let alive = true;
    app
      .setupCode()
      .then((c) => {
        if (!alive || !c) return;
        setCode(c);
        setAppCode(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(
    () => () => {
      if (frown.current) clearTimeout(frown.current);
    },
    [],
  );

  /** The monster wakes up, happy, then the app opens. */
  const wake = async () => {
    if (frown.current) clearTimeout(frown.current);
    setPhase('awake');
    playSound('done');
    // Reduced motion keeps the change of state, only shorter.
    await new Promise((r) => setTimeout(r, still() ? 250 : WAKE_MS));
  };

  /** A frown on the screen, then back to sleep. */
  const frownFor = (kind: 'missing' | 'refused' = 'refused') => {
    setRefusal(kind);
    setPhase('refused');
    if (frown.current) clearTimeout(frown.current);
    frown.current = setTimeout(() => setPhase('asleep'), FROWN_MS);
  };

  /** A refused attempt: the words under the fields, a frown on the screen. */
  const refuse = (message: string) => {
    setError(message);
    setBusy(false);
    frownFor();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    playSound('click');
    setError(null);
    setFieldErrors({});
    if (mode === 'setup') {
      const p = SetupBodySchema.safeParse({
        email: email.trim(),
        password,
        setupCode: code.trim(),
      });
      if (!p.success) {
        const errs: Record<string, string> = {};
        for (const issue of p.error.issues) {
          const k = String(issue.path[0]);
          if (errs[k]) continue;
          errs[k] =
            k === 'email'
              ? 'Serve un indirizzo email valido.'
              : k === 'password'
                ? `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`
                : 'Inserisci il codice di avvio (lo trovi dove hai lanciato “monsters start”).';
        }
        setFieldErrors(errs);
        frownFor('missing');
        return;
      }
      setBusy(true);
      setPhase('busy');
      try {
        await setup(p.data, {
          beforeEnter: async () => {
            rememberEmail(p.data.email);
            await wake();
          },
        });
      } catch (err) {
        refuse(errorText(err));
      }
      return;
    }
    if (!email.trim() || !password) {
      setError('Scrivi email e password.');
      frownFor('missing');
      return;
    }
    setBusy(true);
    setPhase('busy');
    try {
      await login(email.trim(), password, {
        beforeEnter: async () => {
          rememberEmail(email.trim());
          await wake();
        },
      });
    } catch (err) {
      refuse(errorText(err));
    }
  };

  const fe = (k: string) => fieldErrors[k];
  const describedBy = (k: string) => (fe(k) ? `${uid}-${k}-error` : `${uid}-${k}-hint`);
  const setupMode = mode === 'setup';
  const status: { tone?: string; text: string } =
    phase === 'awake'
      ? { tone: 'ok', text: 'Sveglio' }
      : phase === 'busy'
        ? { tone: 'signal', text: 'Controllo' }
        : phase === 'refused'
          ? { tone: 'stop', text: refusal === 'missing' ? 'Manca qualcosa' : 'Rifiutato' }
          : { text: 'In attesa' };

  return (
    <DeviceFrame testId="auth-device">
      {/* The top of the faceplate: what the device is doing, in words and a light. */}
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="label text-ink-muted">{setupMode ? 'Prima accensione' : 'Accesso'}</span>
        <span className="label flex items-center gap-2 text-ink-muted" role="status">
          {/* Checking is a wait: the dashes run in place of the light. */}
          {phase === 'busy' ? (
            <Meter active className="text-signal-ink" />
          ) : (
            <span aria-hidden className="led" data-tone={status.tone} />
          )}
          {status.text}
        </span>
      </div>
      <DeviceScreen
        expression={EXPRESSION[phase]}
        line={screenLine(phase, setupMode)}
        tone={phase === 'refused' ? 'stop' : phase === 'awake' ? 'ink' : 'muted'}
        phase={phase}
      />

      <div className="mt-6 text-center">
        <h1
          id={`${uid}-title`}
          className="text-title1 leading-tight font-bold tracking-[-0.02em] text-ink"
        >
          {setupMode ? 'Crea il tuo account' : 'Accedi'}
        </h1>
        <p className="mt-1.5 text-body text-balance text-ink-muted">
          {setupMode
            ? 'Monsters gira sul tuo computer. L’account serve solo a te, per entrare.'
            : 'Bentornato! Entra con l’email e la password che hai scelto al primo avvio.'}
        </p>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        aria-labelledby={`${uid}-title`}
        // The desktop e2e look for this mark: the code is in, nothing is shown about it.
        data-testid={setupMode && appCode ? 'setup-code-from-app' : undefined}
        className="mt-6 grid gap-4"
      >
        <Field id={`${uid}-email`} label="Email" error={fe('email')}>
          <Input
            id={`${uid}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fe('email') ? true : undefined}
            aria-describedby={fe('email') ? `${uid}-email-error` : undefined}
            autoFocus={!knownEmail}
          />
        </Field>
        <Field
          id={`${uid}-password`}
          label="Password"
          error={fe('password')}
          hint={setupMode ? `Almeno ${PASSWORD_MIN_LENGTH} caratteri.` : undefined}
        >
          <Input
            id={`${uid}-password`}
            type="password"
            autoComplete={setupMode ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fe('password') ? true : undefined}
            aria-describedby={setupMode ? describedBy('password') : undefined}
            autoFocus={knownEmail}
          />
        </Field>
        {setupMode && !appCode && (
          <Field
            id={`${uid}-setupCode`}
            label="Codice di avvio"
            error={fe('setupCode')}
            hint={
              import.meta.env.DEV && mock ? (
                <>
                  Modalità prova: il codice è{' '}
                  <strong className="font-mono font-semibold text-ink">{MOCK_SETUP_CODE}</strong>.
                </>
              ) : (
                <>
                  Lo trovi dove hai lanciato{' '}
                  <code className="font-mono text-ink-muted">monsters start</code>.
                </>
              )
            }
          >
            <Input
              id={`${uid}-setupCode`}
              autoComplete="one-time-code"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono tracking-[0.18em]"
              aria-invalid={fe('setupCode') ? true : undefined}
              aria-describedby={describedBy('setupCode')}
            />
          </Field>
        )}
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] bg-stop-soft px-3.5 py-2.5 text-body text-stop-ink"
          >
            <span aria-hidden className="led mt-[7px]" data-tone="stop" />
            <span>{error}</span>
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          data-pressed={phase === 'awake' ? 'true' : undefined}
          className={cn('mt-2 w-full', phase === 'awake' && 'disabled:opacity-100')}
        >
          {phase === 'awake'
            ? 'Entro…'
            : busy
              ? 'Un attimo…'
              : setupMode
                ? 'Crea account'
                : 'Entra'}
        </Button>
      </form>
      {!setupMode && (
        <div className="mt-4">
          <ForgotPassword />
        </div>
      )}
      <LanguageSwitch className="mt-4" />
    </DeviceFrame>
  );
}
