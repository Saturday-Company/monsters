import { Copy, Desktop, Moon, SignOut, Sun } from '@phosphor-icons/react';
import { PASSWORD_MIN_LENGTH, type SettingsResponse } from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { desktop, loginItemState, type DesktopLoginItem } from '../../lib/desktop.ts';
import { playSound } from '../../lib/sound.ts';
import { domId } from '../../lib/utils.ts';
import { ApiError } from '../../lib/api.ts';
import { getApi, logout, notify, useApp } from '../../store/app.ts';
import { setPrefs, usePrefs, type ThemeChoice } from '../../store/prefs.ts';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { teamError, useSettings } from './data.ts';
import { fieldOnGroup, FormField, Group, Row, RowBody } from './parts.tsx';

/*
 * Settings → Generale: appearance, the desktop app (only inside it: "Apri
 * all'accesso", D-095), the account (with "Cambia password", D-057), the notes
 * folder and where the keys are kept (D-042).
 */

function Appearance() {
  const theme = usePrefs((p) => p.theme);
  const still = usePrefs((p) => p.reduceMotion);
  const sounds = usePrefs((p) => p.sounds);
  const details = usePrefs((p) => p.showDetails);
  return (
    <Group title="Aspetto" id="settings-aspetto" testId="settings-appearance">
      <Row label="Tema" description="Chiaro, scuro o come il resto del computer." wrap>
        <Segmented<ThemeChoice>
          value={theme}
          onChange={(v) => setPrefs({ theme: v })}
          label="Tema"
          size="sm"
          options={[
            {
              value: 'light',
              label: (
                <>
                  <Sun size={16} aria-hidden /> Chiaro
                </>
              ),
            },
            {
              value: 'dark',
              label: (
                <>
                  <Moon size={16} aria-hidden /> Scuro
                </>
              ),
            },
            {
              value: 'system',
              label: (
                <>
                  <Desktop size={16} aria-hidden /> Sistema
                </>
              ),
            },
          ]}
        />
      </Row>
      <Row
        label="Riduci movimento"
        description="I mostri restano fermi e le animazioni diventano semplici cambi di stato."
        htmlFor="reduce-motion"
      >
        <Switch
          words
          id="reduce-motion"
          checked={still}
          onCheckedChange={(v) => setPrefs({ reduceMotion: v })}
          label="Riduci movimento"
        />
      </Row>
      <Row
        label="Suoni"
        description="Piccoli clic dei tasti e della leva, e un segnale quando un mostro ti chiede qualcosa."
        htmlFor="sounds"
      >
        <Switch
          words
          id="sounds"
          checked={sounds}
          onCheckedChange={(v) => {
            setPrefs({ sounds: v });
            // The lever of the switch itself says the sounds are on.
            if (v) playSound('lever', { force: true });
          }}
          label="Suoni"
        />
      </Row>
      <Row
        label="Mostra i dettagli tecnici"
        description="Sotto le risposte dei mostri: strumenti usati, tempo, costo e modello."
        htmlFor="show-details"
      >
        <Switch
          words
          id="show-details"
          checked={details}
          onCheckedChange={(v) => setPrefs({ showDetails: v })}
          label="Mostra i dettagli tecnici"
        />
      </Row>
    </Group>
  );
}

/**
 * "Apri all'accesso" of this computer's app (D-095): the system has the choice, the row reads
 * it when shown and when the app's menus change it. Only in an app that has the bridge.
 */
function DesktopApp() {
  const d = desktop();
  const [state, setState] = useState<DesktopLoginItem | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!d?.loginItem) return;
    let live = true;
    void d
      .loginItem()
      .then((s) => {
        if (live) setState(loginItemState(s));
      })
      .catch(() => {});
    const stop = d.onLoginItemChange?.((s) => setState(loginItemState(s)));
    return () => {
      live = false;
      stop?.();
    };
  }, [d]);
  if (!d?.loginItem || !d.setLoginItem || !state) return null;
  const set = d.setLoginItem.bind(d);
  const change = async (enabled: boolean) => {
    setBusy(true);
    try {
      const next = loginItemState(await set(enabled));
      if (next) setState(next);
      if (!next || next.enabled !== enabled) {
        notify(next?.note ?? 'Il sistema non mi ha lasciato cambiarlo. Riprova.', 'error');
      }
    } catch {
      notify('Il sistema non mi ha lasciato cambiarlo. Riprova.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group
      title="App"
      id="settings-app"
      testId="settings-desktop-app"
      footer="Vale per l’app di questo computer, anche quando mostra un altro computer."
    >
      <Row
        label="Apri all’accesso"
        description={
          state.supported
            ? (state.note ??
              'Quando entri nel computer Monsters si apre da solo, senza finestra: resta l’icona vicino all’orologio e i mostri lavorano anche se non lo apri tu.')
            : state.note
        }
        htmlFor="open-at-login"
      >
        <Switch
          words
          id="open-at-login"
          checked={state.enabled}
          disabled={!state.supported || busy}
          onCheckedChange={(v) => void change(v)}
          label="Apri all’accesso"
        />
      </Row>
    </Group>
  );
}

/** The change of password (D-057): the other sessions are closed by the core. */
type ChangePassword = (current: string, next: string) => Promise<number>;

const changePassword: ChangePassword = async (current, next) =>
  (await getApi().changePassword(current, next)).sessionsClosed;

function PasswordForm({
  submit,
  onDone,
  onCancel,
}: {
  submit: ChangePassword;
  onDone: () => void;
  onCancel: () => void;
}) {
  const id = domId(useId());
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!current) found['current'] = 'Scrivi la password che usi adesso.';
    if (next.length < PASSWORD_MIN_LENGTH) {
      found['next'] = `Almeno ${PASSWORD_MIN_LENGTH} caratteri.`;
    } else if (next === current) {
      found['next'] = 'È uguale a quella di adesso.';
    }
    if (!found['next'] && again !== next) found['again'] = 'Le due password non sono uguali.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const closed = await submit(current, next);
      notify(
        closed > 0
          ? `Password cambiata. Gli altri accessi (${closed}) dovranno entrare con quella nuova.`
          : 'Password cambiata.',
        'success',
      );
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') {
        setErrors({ current: teamError(err) });
      } else setErrors({ form: teamError(err) });
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    auto: string,
    hint?: string,
  ) => (
    <FormField id={`${id}-${key}`} label={label} error={errors[key]} hint={hint}>
      <Input
        id={`${id}-${key}`}
        type="password"
        autoComplete={auto}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={fieldOnGroup}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={
          errors[key] ? `${id}-${key}-error` : hint ? `${id}-${key}-hint` : undefined
        }
      />
    </FormField>
  );

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate data-testid="password-form">
      <RowBody className="sm:max-w-[420px]">
        {field('current', 'Password attuale', current, setCurrent, 'current-password')}
        {field(
          'next',
          'Nuova password',
          next,
          setNext,
          'new-password',
          `Almeno ${PASSWORD_MIN_LENGTH} caratteri.`,
        )}
        {field('again', 'Ripeti la nuova password', again, setAgain, 'new-password')}
        {errors['form'] && (
          <p className="text-footnote text-stop-ink" role="alert">
            {errors['form']}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy} onClick={() => playSound('click')}>
            {busy ? 'Cambio…' : 'Cambia password'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Annulla
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

function Account() {
  const email = useApp((s) => s.email);
  const [changing, setChanging] = useState(false);
  return (
    <Group
      title="Accesso"
      id="settings-account"
      testId="settings-account"
      footer="La password serve per entrare dal browser, dal telefono o da un altro computer. L’app sul computer dove gira Monsters entra da sola."
    >
      <Row
        label="Il tuo account"
        description={email ?? 'Hai fatto l’accesso.'}
        testId="account-email"
      >
        <Button variant="secondary" size="sm" onClick={() => void logout()}>
          <SignOut size={16} aria-hidden />
          Esci
        </Button>
      </Row>
      <div>
        <Row label="Password">
          {!changing && (
            <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
              Cambia password
            </Button>
          )}
        </Row>
        {changing && (
          <div className="set-seam-t">
            <PasswordForm
              submit={changePassword}
              onDone={() => setChanging(false)}
              onCancel={() => setChanging(false)}
            />
          </div>
        )}
      </div>
    </Group>
  );
}

function NotesFolder({ settings }: { settings: SettingsResponse | null }) {
  const copy = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.vaultPath);
      notify('Percorso copiato.', 'success');
    } catch {
      notify('Non riesco a copiarlo: selezionalo e copialo a mano.', 'error');
    }
  };
  return (
    <Group
      title="Note"
      footer="Una cartella normale di file Markdown: la puoi aprire anche con Obsidian."
    >
      <Row
        label="Cartella delle note"
        description={
          // The path as a readout on a small screen: it is the instrument's own data.
          <span
            className="screen mt-1.5 block rounded-[8px] px-3 py-2 font-mono text-caption leading-[1.5] break-all text-screen-ink"
            data-testid="vault-path"
          >
            {settings?.vaultPath ?? '…'}
          </span>
        }
      >
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Copia il percorso della cartella delle note"
          title="Copia il percorso"
          disabled={!settings}
          onClick={() => void copy()}
        >
          <Copy size={18} aria-hidden />
        </Button>
      </Row>
    </Group>
  );
}

const FALLBACK_WHY: Record<NonNullable<SettingsResponse['secrets']>['reason'], string> = {
  keychain: '',
  forced: 'Scelto con MONSTERS_SECRETS=file.',
  unavailable: 'Su questo computer il portachiavi non è disponibile.',
  timeout: 'Il portachiavi non ha risposto in tempo: forse è bloccato.',
  error: 'Il portachiavi ha dato una chiave non valida.',
  'missing-key':
    'Il portachiavi non ha la chiave di questa cartella: le chiavi cifrate restano dove sono e non ' +
    'le sostituisco da solo. Salvale di nuovo; se la chiave è persa davvero, da terminale: ' +
    'monsters secrets reset.',
};

/** Where keys and tokens are kept (D-042): one row, plus what cannot be read now. */
function Secrets({ settings }: { settings: SettingsResponse | null }) {
  const s = settings?.secrets;
  if (!s) return null;
  const keychain = s.backend === 'keychain';
  return (
    <Group title="Chiavi">
      <div data-testid="secrets-status" data-backend={s.backend}>
        <Row
          label="Dove stanno le chiavi"
          leading={<span aria-hidden className="led" data-tone={keychain ? 'ok' : 'signal'} />}
          description={
            keychain ? (
              // The name of the system's keychain ("Secret Service") only on hover: it is jargon.
              <span title={s.keychain ?? undefined}>
                Cifrate, con la chiave nel portachiavi del sistema.
              </span>
            ) : (
              `In file protetti, leggibili solo dal tuo utente, non nel portachiavi. ${FALLBACK_WHY[s.reason]}`
            )
          }
        />
        {(s.unreadable.length > 0 || (s.quarantined?.length ?? 0) > 0) && (
          <RowBody className="set-seam-t">
            {s.unreadable.length > 0 && (
              <p className="text-footnote text-stop-ink" role="status">
                Non leggibili adesso: {s.unreadable.join(', ')}.{' '}
                {keychain
                  ? 'Salvale di nuovo.'
                  : 'Sono cifrate col portachiavi: tornano quando il portachiavi risponde, oppure salvale di nuovo.'}
              </p>
            )}
            {s.quarantined && s.quarantined.length > 0 && (
              <p className="text-footnote text-stop-ink" role="status">
                Il portachiavi non aveva più la chiave di: {s.quarantined.join(', ')}. Vanno
                inserite di nuovo.
              </p>
            )}
          </RowBody>
        )}
      </div>
    </Group>
  );
}

export function GeneralTab() {
  const [settings] = useSettings();
  return (
    <>
      <Appearance />
      <DesktopApp />
      <Account />
      <NotesFolder settings={settings} />
      <Secrets settings={settings} />
    </>
  );
}
