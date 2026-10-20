import { CaretDown, FileText, Funnel, X } from '@phosphor-icons/react';
import type { LogEvent } from '@monsters/shared';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { noteKey, noteName } from '../../lib/markdown.ts';
import { PATHS, useHashParam, vaultPath } from '../../lib/router.ts';
import { cn, domId, formatDay } from '../../lib/utils.ts';
import { errorText, loadOlder, notify, useApp } from '../../store/app.ts';
import { withoutRepeatedStops, type EventCategory } from '../../store/derive.ts';
import { useAgents, useMediaQuery } from '../../store/hooks.ts';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { Button } from '../ui/button.tsx';
import { joinedKey, KeyLight, Segmented } from '../ui/controls.tsx';
import { MAIN_TYPES, matchesActivity, OTHER_TYPES } from './activity.ts';
import { ArchiveNote } from './ArchiveNote.tsx';
import { EventRow } from './EventRow.tsx';

export { isLoggable, touchesNote } from './activity.ts';

type Period = 'hour' | 'today' | 'week' | 'all';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Da sempre' },
  { value: 'hour', label: 'Ultima ora' },
  { value: 'today', label: 'Oggi' },
  { value: 'week', label: 'Ultimi 7 giorni' },
];

function periodStart(p: Period, now: number): number {
  switch (p) {
    case 'hour':
      return now - 3_600_000;
    case 'today': {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }
    case 'week':
      return now - 7 * 86_400_000;
    case 'all':
      return 0;
  }
}

const selectClass =
  'well tape-select h-10 cursor-pointer rounded-[10px] pr-9 pl-3.5 text-footnote font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-signal-ink';

/** A row of joined keys that toggle (several can be down): the filters of the tape. */
function KeyRow<T extends string>({
  label,
  items,
  isOn,
  onToggle,
  className,
  separate = false,
}: {
  label: string;
  items: readonly { value: T; label: string }[];
  isOn: (v: T) => boolean;
  onToggle: (v: T) => void;
  className?: string;
  /** Keys apart (a wrapping row in the phone's drawer): each with its own corners. */
  separate?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex pb-[3px]', separate && 'gap-x-2 gap-y-2.5', className)}
    >
      {items.map((t, i) => {
        const on = isOn(t.value);
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={on}
            data-pressed={on ? 'true' : undefined}
            onClick={() => onToggle(t.value)}
            className={cn(
              separate ? joinedKey(on, true, true) : joinedKey(on, i === 0, i === items.length - 1),
              'h-10 px-3.5 text-footnote',
            )}
          >
            {on && <KeyLight />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A single key that stays down while on (with its light). */
function ToggleKey({
  on,
  onClick,
  children,
  className,
  ...rest
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}) {
  const expandable = rest['aria-expanded'] !== undefined;
  return (
    <button
      type="button"
      aria-pressed={expandable ? undefined : on}
      {...rest}
      data-pressed={on ? 'true' : undefined}
      onClick={onClick}
      className={cn(joinedKey(on, true, true), 'h-10 shrink-0 px-3.5 text-footnote', className)}
    >
      {on && <KeyLight />}
      {children}
    </button>
  );
}

/** A native select sunk in a well, with its caret. */
function Picker({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Attività (`#/log`): what the monsters and you did, newest first. A segment
 * says what is shown: "Importanti" (what had an effect: notes, files, commands,
 * questions, errors, changes to the setup) or "Tutto" (replies, jobs and
 * reading tools too). The types narrow it; who and the rest sit beside them,
 * and on a phone every filter but the segment is in one "Filtri" drawer.
 */
export function LogView() {
  const events = useApp((s) => s.events);
  const hasOlder = useApp((s) => s.hasOlder);
  const agents = useAgents();
  const id = domId(useId());
  const [who, setWho] = useState<string>('');
  const [types, setTypes] = useState<Set<EventCategory>>(new Set());
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  const [period, setPeriod] = useState<Period>('all');
  const [loading, setLoading] = useState(false);
  const [now] = useState(() => Date.now());
  const phone = useMediaQuery('(max-width: 767px)');
  const note = useHashParam('nota');
  const key = note ? noteKey(note) : null;

  const filtered = useMemo(() => {
    const filter = { who: who || null, types, all, since: periodStart(period, now), note: key };
    return withoutRepeatedStops(events)
      .filter((e) => matchesActivity(e, filter))
      .reverse()
      .slice(0, 600);
  }, [events, who, types, all, period, now, key]);

  const groups = useMemo(() => {
    const out: { day: string; items: LogEvent[] }[] = [];
    for (const e of filtered) {
      const day = formatDay(e.ts, now);
      const g = out.at(-1);
      if (g && g.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [filtered, now]);

  const toggle = (c: EventCategory) => {
    const next = new Set(types);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setTypes(next);
  };
  const otherCount = OTHER_TYPES.filter((t) => types.has(t.value)).length;
  const filtering = who !== '' || types.size > 0 || period !== 'all';
  /** Filters on besides the segment: the count on the phone's "Filtri" key. */
  const active = (who !== '' ? 1 : 0) + types.size + (period !== 'all' ? 1 : 0);
  const clear = () => {
    setWho('');
    setTypes(new Set());
    setPeriod('all');
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      await loadOlder();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const people = [
    { value: '', label: 'Tutti' },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
    { value: 'user', label: 'Tu' },
    { value: 'system', label: 'Sistema' },
  ];
  const whoPicker = (
    <Picker
      label="Chi"
      value={who}
      onChange={setWho}
      options={people.map((p) => ({
        value: p.value,
        label: p.value ? p.label : 'Chi: tutti',
      }))}
      testId="activity-who"
    />
  );
  const mainTypes = (
    <KeyRow
      label="Filtra per tipo"
      items={MAIN_TYPES}
      isOn={(v) => types.has(v)}
      onToggle={toggle}
      className={phone ? 'flex-wrap' : 'shrink-0'}
      separate={phone}
    />
  );
  const otherOn = otherCount + (period !== 'all' ? 1 : 0);

  return (
    <section
      aria-labelledby="log-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="activity-view"
    >
      <ToolbarContent>
        <ToolbarTitle id="log-title">Attività</ToolbarTitle>
      </ToolbarContent>
      <div className="seam-b flex shrink-0 flex-col gap-3 px-4 pt-3 pb-3.5 sm:px-6">
        {/*
          Aligned on the top edge: the well of "Chi" and the faces of the keys
          start together, the thickness of the keys hangs below (audit UI-33).
        */}
        <div className="flex flex-wrap items-start gap-2">
          <Segmented<'important' | 'all'>
            label="Cosa mostrare"
            size="sm"
            value={all ? 'all' : 'important'}
            onChange={(v) => setAll(v === 'all')}
            options={[
              { value: 'important', label: 'Importanti' },
              { value: 'all', label: 'Tutto' },
            ]}
            className="shrink-0"
          />
          {!phone && mainTypes}
          {!phone && whoPicker}
          <ToggleKey
            on={more || (phone ? active > 0 : otherOn > 0)}
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-controls={`${id}-more`}
            className={cn(phone && 'ml-auto')}
          >
            {phone && <Funnel size={15} aria-hidden />}
            {phone ? 'Filtri' : 'Altri filtri'}
            {(phone ? active : otherOn) > 0 && (
              <span className="font-mono text-caption text-ink-muted tabular-nums">
                {phone ? active : otherOn}
              </span>
            )}
            <CaretDown
              size={11}
              weight="bold"
              aria-hidden
              className={cn('turn', more && 'rotate-180')}
            />
          </ToggleKey>
        </div>
        {more && (
          <div
            id={`${id}-more`}
            className={cn(
              'flex flex-wrap items-start gap-2',
              // The phone's drawer: every filter but the segment, one group per line.
              phone && 'well flex-col gap-3 rounded-[12px] p-3',
            )}
            data-testid="activity-more"
          >
            {phone && whoPicker}
            {phone && mainTypes}
            <KeyRow
              label="Altri tipi"
              items={OTHER_TYPES}
              isOn={(v) => types.has(v)}
              onToggle={toggle}
              className="flex-wrap"
              separate={phone}
            />
            <Picker
              label="Periodo"
              value={period}
              onChange={(v) => setPeriod(v as Period)}
              options={PERIODS}
            />
            {phone && filtering && (
              <Button size="sm" variant="ghost" onClick={clear} className="-ml-2">
                Togli i filtri
              </Button>
            )}
          </div>
        )}
        {note && (
          <p
            className="flex flex-wrap items-center gap-3 text-body text-ink"
            data-testid="note-filter"
          >
            <span className="well inline-flex h-10 items-center gap-2 rounded-[10px] pr-1.5 pl-3 font-medium">
              <FileText size={16} aria-hidden className="text-ink-muted" />
              Solo la nota “{noteName(note)}”
              <a
                href={PATHS.log}
                aria-label="Mostra tutta l’attività"
                className="key inline-flex size-7 items-center justify-center rounded-[7px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
              >
                <X size={12} weight="bold" aria-hidden />
              </a>
            </span>
            <a
              href={vaultPath(note)}
              className="font-medium text-signal-ink underline decoration-1 underline-offset-2 hover:decoration-2"
            >
              Apri la nota
            </a>
          </p>
        )}
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-large text-ink-muted">
              {note
                ? `Niente da mostrare sulla nota “${noteName(note)}”.`
                : filtering
                  ? 'Niente da mostrare con questi filtri.'
                  : 'Ancora nessuna azione con un effetto.'}
            </p>
            {!all && types.size === 0 && (
              <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
                Mostra tutto
              </Button>
            )}
            {filtering && (
              <Button size="sm" variant="ghost" onClick={clear}>
                Togli i filtri
              </Button>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <section key={`${g.day}-${g.items[0]?.id ?? ''}`} aria-label={g.day}>
              <h2 className="tape-day label sticky top-0 z-[1] -mx-4 px-4 pt-5 pb-2 text-ink-muted sm:-mx-6 sm:px-6">
                {g.day}
                <span className="text-ink-faint"> · {g.items.length}</span>
              </h2>
              <ol className="tape">
                {g.items.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ol>
            </section>
          ))
        )}
        {hasOlder && (
          <div className="flex justify-center pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loading}
            >
              {loading ? 'Carico…' : 'Carica l’attività più vecchia'}
            </Button>
          </div>
        )}
        {!hasOlder && groups.length > 0 && <ArchiveNote />}
      </div>
    </section>
  );
}
