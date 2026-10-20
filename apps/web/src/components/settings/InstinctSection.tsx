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
import { DisclosureRow, fieldOnGroup, FormField, Group, Row, RowBody, Status } from './parts.tsx';

/*
 * Settings → Squadra → Istinto (D-067, D-068): the quick decisions of the team,
 * who takes them (only the rules, a small model of yours, or Jev of TypeSafe)
 * and, in a drawer, what each of them does, with a lever. Small at the bottom,
 * what leaves the computer. The words come from shared/src/instinct.ts; none
 * of "System 1", "gate", "shadow" or thresholds reaches the screen.
 */

/** A short tag after a use's name: "In prova", "Solo annota", "Serve Jev". */
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
  if (err instanceof ApiError) {
    if (err.code === 'invalid_key') return 'TypeSafe non riconosce questa chiave.';
    if (err.code === 'verification_failed')
      return 'Non riesco a verificare la chiave con TypeSafe. Controlla la connessione e riprova.';
    if (err.code === 'key_from_env')
      return 'La chiave viene da TYPESAFE_API_KEY sul computer: si cambia lì.';
  }
  return errorText(err);
}

/** What the module says when the core refuses Jev without a key (409 `no_key`). */
export const NO_KEY_TEXT =
  'Per usare il modello esperto serve prima la chiave di TypeSafe. Incollala qui sotto: appena è salvata, decide lui.';

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
  const needs = needsOf(use, view);
  const mode = modeWord(use);
  return (
    <li data-testid={`instinct-use-${use.id}`} data-mode={use.mode}>
      <Row
        label={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{titleOfUse(use)}</span>
            {trial && <Tag>In prova</Tag>}
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
        Non riesco a leggere le decisioni dei mostri adesso. Riprova tra poco.
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
      setError('Incolla la chiave completa, senza spazi.');
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
      notify('Chiave di TypeSafe salvata: decide il modello esperto.', 'success');
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
    `${on.length} su ${view.uses.length} accese`,
    waiting > 0 ? `${waiting} in attesa di un modello` : null,
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
        label="Chi decide"
        description={<span data-testid="instinct-engine-about">{about?.description}</span>}
        wrap
      >
        <Segmented<DecisionEngine>
          value={engine}
          onChange={(v) => void onEngine(v)}
          label="Chi decide"
          size="sm"
          options={view.engines.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Row>

      {engine === 'jev' && view.jev.keySet && !changingKey && (
        <Row
          label="Chiave di TypeSafe"
          description={
            view.jev.keySource === 'env'
              ? `Presa da TYPESAFE_API_KEY sul computer · ${view.jev.model}`
              : `Salvata su questo computer · ${view.jev.model}`
          }
          testId="typesafe-key-status"
        >
          <span className="label inline-flex items-center gap-1.5 text-ink">
            <span aria-hidden className="led" data-tone="ok" />
            Attiva
          </span>
          {view.jev.keySource !== 'env' && (
            <Button variant="secondary" size="sm" onClick={() => setChangingKey(true)}>
              Cambia chiave
            </Button>
          )}
        </Row>
      )}

      {showForm && (
        <form onSubmit={(e) => void onKey(e)} noValidate data-testid="typesafe-key-form">
          <RowBody>
            {noKey ? (
              <p className="text-footnote leading-snug text-ink" role="alert" data-testid="no-key">
                {NO_KEY_TEXT}
              </p>
            ) : (
              !view.jev.keySet && (
                <Status>
                  Per usare il modello esperto serve una chiave di TypeSafe: la crei su
                  console.typesafe.ai.
                </Status>
              )
            )}
            <FormField
              id={id}
              label={view.jev.keySet ? 'Nuova chiave di TypeSafe' : 'Chiave di TypeSafe'}
              error={error}
              hint="Resta su questo computer e non la mostriamo più dopo il salvataggio."
            >
              <Input
                id={id}
                ref={field}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Incolla qui la chiave"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={fieldOnGroup}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : `${id}-hint`}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving || !key.trim()}>
                {saving ? 'Verifico…' : 'Salva la chiave'}
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
                Annulla
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

      <DisclosureRow as="div" testId="instinct-uses" label="Cosa fa" description={usesLine}>
        <ul className="set-rows" aria-label="Cosa decidono i mostri">
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

const PRIVACY: Record<DecisionEngine, string> = {
  jev: 'Con il modello esperto, per ogni decisione va a TypeSafe solo quello che serve, già ripulito dalle chiavi; mai il contenuto delle tue note:',
  rules:
    'Adesso decide il computer da solo: non esce niente. Con il modello esperto uscirebbe solo questo, mai il contenuto delle tue note:',
  llm: 'Adesso decide uno dei tuoi modelli, come per il resto del lavoro. Con il modello esperto uscirebbe solo questo, mai il contenuto delle tue note:',
};

/** "Cosa esce dal computer": small, under the module, what each use sends with Jev. */
function PrivacyNote({ view }: { view: InstinctView }) {
  return (
    <details className="group" data-testid="instinct-privacy">
      <summary className="cursor-pointer list-none font-medium text-ink-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block turn group-open:rotate-90">
          ›
        </span>
        Cosa esce dal computer
      </summary>
      <div className="mt-2 grid gap-2">
        <p>{PRIVACY[view.engine]}</p>
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
