import {
  TypeSafeKeyRequestSchema,
  type DecisionEngine,
  type InstinctUseView,
  type InstinctView,
} from '@monsters/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api.ts';
import { cn, domId } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { isTrial, modeWord, onMode, needsOf, titleOfUse } from '../../store/instinct.ts';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { instinctStrings } from './instinct.strings.ts';
import { DisclosureRow, fieldOnGroup, FormField, Group, Row, RowBody, Status } from './parts.tsx';
import { partsStrings } from './parts.strings.ts';

/*
 * Settings → Squad → Monsters’ decisions, the instinct (D-067, D-068): the quick decisions of the team,
 * who takes them (only the rules, a small model of yours, or Jev of TypeSafe)
 * and, in a drawer, what each of them does, with a lever. Small at the bottom,
 * what leaves the computer. The words come from shared/src/instinct.ts; none
 * of "System 1", "gate", "shadow" or thresholds reaches the screen.
 */

/** A short tag after a use's name: "On trial", "Notes only", "Needs Jev". */
function Tag({ children, tone }: { children: ReactNode; tone?: 'signal' }) {
  return (
    <span
      className={cn(
        'label rounded-[5px] px-1.5 py-px whitespace-nowrap shadow-[inset_0_0_0_1px_var(--seam)]',
        tone === 'signal' ? 'text-signal-ink' : 'text-ink-muted',
      )}
    >
      {children}
    </span>
  );
}

function keyError(err: unknown): string {
  const s = instinctStrings();
  if (err instanceof ApiError) {
    if (err.code === 'invalid_key') return s.invalidKey;
    if (err.code === 'verification_failed') return s.verificationFailed;
    if (err.code === 'key_from_env') return s.keyFromEnv;
  }
  return errorText(err);
}

function UseRow({
  use,
  view,
  busy,
  onChange,
}: {
  use: InstinctUseView;
  view: InstinctView;
  busy: boolean;
  onChange: (use: InstinctUseView, on: boolean) => void;
}) {
  const trial = isTrial(use);
  const s = instinctStrings();
  const needs = needsOf(use, view);
  const mode = modeWord(use);
  return (
    <li data-testid={`instinct-use-${use.id}`} data-mode={use.mode}>
      <Row
        label={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{titleOfUse(use)}</span>
            {trial && <Tag>{s.trial}</Tag>}
            {mode && !trial && <Tag>{mode}</Tag>}
            {needs && <Tag tone="signal">{needs}</Tag>}
          </span>
        }
        description={use.description}
      >
        <span className={cn(busy && 'pointer-events-none opacity-60')}>
          <Switch
            words
            checked={use.mode !== 'off'}
            label={titleOfUse(use)}
            onCheckedChange={(v) => onChange(use, v)}
          />
        </span>
      </Row>
    </li>
  );
}

export function InstinctSection() {
  const s = instinctStrings();
  const common = partsStrings();
  const id = domId(useId());
  const [view, setView] = useState<InstinctView | null>(null);
  const [failed, setFailed] = useState(false);
  /** Jev asked for, but the core has no key yet: the key comes first. */
  const [wantJev, setWantJev] = useState(false);
  /** The 409 `no_key` of the core, said in words, above the field. */
  const [noKey, setNoKey] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyUse, setBusyUse] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getApi()
      .instinct()
      .then((v) => alive && (setView(v), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // The field of the key in sight and ready as soon as the core asks for it.
  useEffect(() => {
    if (!noKey) return;
    // Focus scrolls its own panel only as far as needed (scrollIntoView would move the frame).
    field.current?.focus();
  }, [noKey]);

  if (failed)
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        {s.failed}
      </p>
    );
  if (!view) return null;

  const engine: DecisionEngine = wantJev ? 'jev' : view.engine;
  const about = view.engines.find((e) => e.id === engine);

  const onEngine = async (next: DecisionEngine) => {
    setError(null);
    if (next !== 'jev') {
      setWantJev(false);
      setNoKey(false);
      setChangingKey(false);
    }
    try {
      setView(await getApi().setInstinct({ engine: next }));
      if (next === 'jev') {
        setWantJev(false);
        setNoKey(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_key') {
        setWantJev(true);
        setNoKey(true);
        return;
      }
      setError(errorText(err));
    }
  };

  const onKey = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = TypeSafeKeyRequestSchema.safeParse({ key });
    if (!parsed.success) {
      setError(s.keyIncomplete);
      return;
    }
    setSaving(true);
    try {
      await getApi().setTypeSafeKey(parsed.data.key);
      setView(wantJev ? await getApi().setInstinct({ engine: 'jev' }) : await getApi().instinct());
      setKey('');
      setWantJev(false);
      setNoKey(false);
      setChangingKey(false);
      notify(s.keySaved, 'success');
    } catch (err) {
      setError(keyError(err));
    } finally {
      setSaving(false);
    }
  };

  const onUse = async (use: InstinctUseView, on: boolean) => {
    setBusyUse(use.id);
    try {
      setView(await getApi().setInstinct({ uses: { [use.id]: on ? onMode(use) : 'off' } }));
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusyUse(null);
    }
  };

  const showForm = engine === 'jev' && (!view.jev.keySet || changingKey);
  const on = view.uses.filter((u) => u.mode !== 'off');
  const waiting = on.filter((u) => needsOf(u, view) !== null).length;
  const usesLine = [
    s.usesOn(on.length, view.uses.length),
    waiting > 0 ? s.usesWaiting(waiting) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Group
      title={view.title}
      id="settings-istinto"
      testId="instinct-section"
      description={view.description}
      footer={<PrivacyNote view={view} />}
    >
      <Row
        label={s.whoDecides}
        description={<span data-testid="instinct-engine-about">{about?.description}</span>}
        wrap
      >
        <Segmented<DecisionEngine>
          value={engine}
          onChange={(v) => void onEngine(v)}
          label={s.whoDecides}
          size="sm"
          options={view.engines.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Row>

      {engine === 'jev' && view.jev.keySet && !changingKey && (
        <Row
          label={s.keyLabel}
          description={
            view.jev.keySource === 'env'
              ? s.keyFromEnvStatus(view.jev.model)
              : s.keySavedStatus(view.jev.model)
          }
          testId="typesafe-key-status"
        >
          <span className="label inline-flex items-center gap-1.5 text-ink">
            <span aria-hidden className="led" data-tone="ok" />
            {s.active}
          </span>
          {view.jev.keySource !== 'env' && (
            <Button variant="secondary" size="sm" onClick={() => setChangingKey(true)}>
              {s.changeKey}
            </Button>
          )}
        </Row>
      )}

      {showForm && (
        <form onSubmit={(e) => void onKey(e)} noValidate data-testid="typesafe-key-form">
          <RowBody>
            {noKey ? (
              <p className="text-footnote leading-snug text-ink" role="alert" data-testid="no-key">
                {s.noKey}
              </p>
            ) : (
              !view.jev.keySet && <Status>{s.needKey}</Status>
            )}
            <FormField
              id={id}
              label={view.jev.keySet ? s.newKeyLabel : s.keyLabel}
              error={error}
              hint={s.keyHint}
            >
              <Input
                id={id}
                ref={field}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={s.keyPlaceholder}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={fieldOnGroup}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : `${id}-hint`}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving || !key.trim()}>
                {saving ? s.verifying : s.saveKey}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setWantJev(false);
                  setNoKey(false);
                  setChangingKey(false);
                  setError(null);
                }}
              >
                {common.cancel}
              </Button>
            </div>
          </RowBody>
        </form>
      )}

      {error && !showForm && (
        <RowBody>
          <p className="text-footnote text-stop-ink" role="alert">
            {error}
          </p>
        </RowBody>
      )}

      <DisclosureRow as="div" testId="instinct-uses" label={s.whatItDoes} description={usesLine}>
        <ul className="set-rows" aria-label={s.whatTheyDecide}>
          {view.uses.map((u) => (
            <UseRow
              key={u.id}
              use={u}
              view={view}
              busy={busyUse === u.id}
              onChange={(use, v) => void onUse(use, v)}
            />
          ))}
        </ul>
      </DisclosureRow>
    </Group>
  );
}

/** "What leaves the computer": small, under the module, what each use sends with Jev. */
function PrivacyNote({ view }: { view: InstinctView }) {
  const s = instinctStrings();
  return (
    <details className="group" data-testid="instinct-privacy">
      <summary className="cursor-pointer list-none font-medium text-ink-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block turn group-open:rotate-90">
          ›
        </span>
        {s.whatLeaves}
      </summary>
      <div className="mt-2 grid gap-2">
        <p>{s.privacy[view.engine]}</p>
        <dl className="grid gap-1.5">
          {view.uses.map((u) => (
            <div key={u.id} className="grid gap-0.5">
              <dt className="text-ink">{titleOfUse(u)}</dt>
              <dd>{u.sends}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
