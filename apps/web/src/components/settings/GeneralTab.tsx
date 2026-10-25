import { Copy, Desktop, Moon, SignOut, Sun } from '@phosphor-icons/react';
import {
  LANGS,
  PASSWORD_MIN_LENGTH,
  setVaultLayout,
  type Lang,
  type SettingsResponse,
} from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { desktop, loginItemState, type DesktopLoginItem } from '../../lib/desktop.ts';
import { playSound } from '../../lib/sound.ts';
import { applyLang, LANG_NAMES, useAppLang } from '../../lib/i18n.ts';
import { domId } from '../../lib/utils.ts';
import { ApiError } from '../../lib/api.ts';
import { getApi, logout, notify, useApp } from '../../store/app.ts';
import { setPrefs, usePrefs, type ThemeChoice } from '../../store/prefs.ts';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { teamError, useSettings } from './data.ts';
import { generalStrings } from './general.strings.ts';
import { DisclosureRow, fieldOnGroup, FormField, Group, Row, RowBody } from './parts.tsx';

/*
 * Settings → Generale: appearance, the desktop app (only inside it: "Apri
 * all'accesso", D-095), the account (with "Cambia password", D-057), and one
 * "Advanced" drawer (D-181): sounds, the technical details, the notes folder
 * and where the keys are kept (D-042), with the commands only inside "Details".
 */

function Language() {
  const s = generalStrings().language;
  const lang = useAppLang();
  const [busy, setBusy] = useState(false);
  const change = async (next: Lang) => {
    if (next === lang) return;
    setBusy(true);
    try {
      const settings = await getApi().setLanguage(next);
      // A vault not used yet takes the language's folder names (D-154).
      if (settings.vaultLayout) setVaultLayout(settings.vaultLayout);
      // Remounts the UI in the new language: this row goes with it.
      applyLang(next);
    } catch {
      notify(s.failed, 'error');
      setBusy(false);
    }
  };
  return (
    <Row label={s.label} description={s.hint} wrap>
      <Segmented<Lang>
        value={lang}
        onChange={(v) => {
          if (!busy) void change(v);
        }}
        label={s.label}
        size="sm"
        options={LANGS.map((l) => ({ value: l, label: <span lang={l}>{LANG_NAMES[l]}</span> }))}
      />
    </Row>
  );
}

function Appearance() {
  const s = generalStrings().appearance;
  const theme = usePrefs((p) => p.theme);
  const still = usePrefs((p) => p.reduceMotion);
  return (
    <Group title={s.title} id="settings-aspetto" testId="settings-appearance">
      <Language />
      <Row label={s.theme} description={s.themeHint} wrap>
        <Segmented<ThemeChoice>
          value={theme}
          onChange={(v) => setPrefs({ theme: v })}
          label={s.theme}
          size="sm"
          options={[
            {
              value: 'light',
              label: (
                <>
                  <Sun size={16} aria-hidden /> {s.light}
                </>
              ),
            },
            {
              value: 'dark',
              label: (
                <>
                  <Moon size={16} aria-hidden /> {s.dark}
                </>
              ),
            },
            {
              value: 'system',
              label: (
                <>
                  <Desktop size={16} aria-hidden /> {s.system}
                </>
              ),
            },
          ]}
        />
      </Row>
      <Row label={s.reduceMotion} description={s.reduceMotionHint} htmlFor="reduce-motion">
        <Switch
          words
          id="reduce-motion"
          checked={still}
          onCheckedChange={(v) => setPrefs({ reduceMotion: v })}
          label={s.reduceMotion}
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
  const s = generalStrings().app;
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
        notify(next?.note ?? s.refused, 'error');
      }
    } catch {
      notify(s.refused, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title={s.title} id="settings-app" testId="settings-desktop-app" footer={s.footer}>
      <Row
        label={s.openAtLogin}
        description={state.supported ? (state.note ?? s.openAtLoginHint) : state.note}
        htmlFor="open-at-login"
      >
        <Switch
          words
          id="open-at-login"
          checked={state.enabled}
          disabled={!state.supported || busy}
          onCheckedChange={(v) => void change(v)}
          label={s.openAtLogin}
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
  const s = generalStrings().password;
  const id = domId(useId());
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!current) found['current'] = s.currentMissing;
    if (next.length < PASSWORD_MIN_LENGTH) {
      found['next'] = s.minLength(PASSWORD_MIN_LENGTH);
    } else if (next === current) {
      found['next'] = s.same;
    }
    if (!found['next'] && again !== next) found['again'] = s.mismatch;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const closed = await submit(current, next);
      notify(closed > 0 ? s.changedOthers(closed) : s.changed, 'success');
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
        {field('current', s.current, current, setCurrent, 'current-password')}
        {field('next', s.next, next, setNext, 'new-password', s.minLength(PASSWORD_MIN_LENGTH))}
        {field('again', s.again, again, setAgain, 'new-password')}
        {errors['form'] && (
          <p className="text-footnote text-stop-ink" role="alert">
            {errors['form']}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy} onClick={() => playSound('click')}>
            {busy ? s.changing : s.change}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

function Account() {
  const s = generalStrings().account;
  const email = useApp((s) => s.email);
  const [changing, setChanging] = useState(false);
  return (
    <Group title={s.title} id="settings-account" testId="settings-account" footer={s.footer}>
      <Row label={s.yours} description={email ?? s.signedIn} testId="account-email">
        <Button variant="secondary" size="sm" onClick={() => void logout()}>
          <SignOut size={16} aria-hidden />
          {s.signOut}
        </Button>
      </Row>
      <div>
        <Row label={s.password}>
          {!changing && (
            <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
              {generalStrings().password.change}
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

/** The notes folder: its path as a readout, to copy (a row of the advanced drawer). */
function NotesFolder({ settings }: { settings: SettingsResponse | null }) {
  const s = generalStrings().notes;
  const copy = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.vaultPath);
      notify(s.copied, 'success');
    } catch {
      notify(s.copyFailed, 'error');
    }
  };
  return (
    <Row
      label={s.folder}
      description={
        <>
          {s.footer}
          {/* The path as a readout on a small screen: it is the instrument's own data. */}
          <span
            className="screen mt-1.5 block rounded-[8px] px-3 py-2 font-mono text-caption leading-[1.5] break-all text-screen-ink"
            data-testid="vault-path"
          >
            {settings?.vaultPath ?? '…'}
          </span>
        </>
      }
    >
      <Button
        variant="ghost"
        size="iconSm"
        aria-label={s.copyLabel}
        title={s.copyTitle}
        disabled={!settings}
        onClick={() => void copy()}
      >
        <Copy size={18} aria-hidden />
      </Button>
    </Row>
  );
}

/** Where keys and tokens are kept (D-042): a row of the account group, plus what cannot be read now. */
function Secrets({ settings }: { settings: SettingsResponse | null }) {
  const t = generalStrings().secrets;
  const s = settings?.secrets;
  if (!s) return null;
  const keychain = s.backend === 'keychain';
  const detail = t.detail[s.reason];
  return (
    <div data-testid="secrets-status" data-backend={s.backend}>
      <Row
        label={t.where}
        leading={<span aria-hidden className="led" data-tone={keychain ? 'ok' : 'signal'} />}
        description={
          keychain ? (
            // The name of the system's keychain ("Secret Service") only on hover: it is jargon.
            <span title={s.keychain ?? undefined}>{t.keychain}</span>
          ) : (
            t.files(t.why[s.reason])
          )
        }
      />
      {detail && (
        <DisclosureRow as="div" testId="secrets-details" label={t.details}>
          <RowBody>
            <p className="text-footnote leading-snug text-ink-muted">{detail}</p>
          </RowBody>
        </DisclosureRow>
      )}
      {(s.unreadable.length > 0 || (s.quarantined?.length ?? 0) > 0) && (
        <RowBody className="set-seam-t">
          {s.unreadable.length > 0 && (
            <p className="text-footnote text-stop-ink" role="status">
              {t.unreadable(s.unreadable.join(', '))} {keychain ? t.saveAgain : t.waitKeychain}
            </p>
          )}
          {s.quarantined && s.quarantined.length > 0 && (
            <p className="text-footnote text-stop-ink" role="status">
              {t.quarantined(s.quarantined.join(', '))}
            </p>
          )}
        </RowBody>
      )}
    </div>
  );
}

/** Sounds and the technical details (rows of the advanced drawer). */
function Switches() {
  const s = generalStrings().appearance;
  const sounds = usePrefs((p) => p.sounds);
  const details = usePrefs((p) => p.showDetails);
  return (
    <>
      <Row label={s.sounds} description={s.soundsHint} htmlFor="sounds">
        <Switch
          words
          id="sounds"
          checked={sounds}
          onCheckedChange={(v) => {
            setPrefs({ sounds: v });
            // The lever of the switch itself says the sounds are on.
            if (v) playSound('lever', { force: true });
          }}
          label={s.sounds}
        />
      </Row>
      <Row label={s.details} description={s.detailsHint} htmlFor="show-details">
        <Switch
          words
          id="show-details"
          checked={details}
          onCheckedChange={(v) => setPrefs({ showDetails: v })}
          label={s.details}
        />
      </Row>
    </>
  );
}

/** What most people never change, behind one closed row (wave C). */
function MoreOptions({ settings }: { settings: SettingsResponse | null }) {
  const s = generalStrings().more;
  return (
    <Group testId="settings-more" label={s.title}>
      <DisclosureRow
        as="div"
        advanced
        testId="general-advanced"
        label={s.title}
        description={s.hint}
      >
        <div className="set-rows">
          <Switches />
          <NotesFolder settings={settings} />
          <Secrets settings={settings} />
        </div>
      </DisclosureRow>
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
      <MoreOptions settings={settings} />
    </>
  );
}
