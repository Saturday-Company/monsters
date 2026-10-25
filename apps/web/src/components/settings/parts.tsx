import { CaretDown, Info } from '@phosphor-icons/react';
import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { playSound } from '../../lib/sound.ts';
import { cn, domId } from '../../lib/utils.ts';
import { useAgent } from '../../store/hooks.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button } from '../ui/button.tsx';
import { Label } from '../ui/field.tsx';
import { partsStrings } from './parts.strings.ts';
import './settings.css';

/*
 * The building blocks of the settings (docs/design.md, "Impostazioni"): each
 * group is a module of the instrument (raised, radius 14, a seam around it)
 * with its `.label` in the top-left corner and rows of 52 px split by seams:
 * the words on the left, the control (a lever, a field sunk in a well, keys)
 * on the right. Nothing inside a row is a card of its own: an expanded row
 * just shows more lines below, in the same module.
 */

/** A titled part of a tab (e.g. "Collegamenti"): a heading over one or more groups. */
export function Section({
  id,
  title,
  description,
  children,
  testId,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const headingId = `${domId(useId())}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-testid={testId}
      className="grid scroll-mt-4 gap-5"
    >
      <div className="grid gap-1 px-1">
        <h2 id={headingId} className="text-title3 font-semibold text-ink">
          {title}
        </h2>
        {description && (
          <p className="max-w-[62ch] text-footnote leading-snug text-ink-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A group of rows: one module, its `.label` heading in the top-left corner,
 * an optional note below. `as="ul"` makes the rows a list (each row an `li`).
 */
export function Group({
  title,
  description,
  footer,
  children,
  testId,
  id,
  label,
  as = 'div',
  level = 2,
}: {
  title?: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  id?: string;
  /** Accessible name of the list when there is no heading. */
  label?: string;
  as?: 'div' | 'ul';
  level?: 2 | 3;
}) {
  const headingId = `${domId(useId())}-title`;
  const Heading = level === 2 ? 'h2' : 'h3';
  const Rows = as;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : label}
      data-testid={testId}
      className="grid scroll-mt-4 gap-2"
    >
      <div className="set-module overflow-hidden">
        {(title || description) && (
          <div className="grid gap-1 px-4 pt-3.5 pb-1.5">
            {title && (
              <Heading id={headingId} className="label text-ink-muted">
                {title}
              </Heading>
            )}
            {description && (
              <p className="max-w-[62ch] text-footnote leading-snug text-ink-muted">
                {description}
              </p>
            )}
          </div>
        )}
        <Rows className="set-rows" aria-label={as === 'ul' && title ? title : undefined}>
          {children}
        </Rows>
      </div>
      {footer && (
        <div className="max-w-[62ch] px-1 text-footnote leading-snug text-ink-muted">{footer}</div>
      )}
    </section>
  );
}

/**
 * One row: label and description on the left, the control on the right. On a
 * phone a wide control wraps under the text. `htmlFor` ties the label to a
 * form control; a switch takes its name from its own `label`.
 */
export function Row({
  label,
  description,
  children,
  htmlFor,
  leading,
  as = 'div',
  testId,
  className,
  wrap = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  /** An icon or avatar before the text. */
  leading?: ReactNode;
  as?: 'div' | 'li';
  testId?: string;
  className?: string;
  /** The control goes under the text below `sm` (segmented controls, button pairs). */
  wrap?: boolean;
}) {
  const Tag = as;
  return (
    <Tag
      data-testid={testId}
      className={cn(
        'flex min-h-[52px] items-center gap-x-4 gap-y-2.5 px-4 py-2.5',
        wrap && 'flex-wrap sm:flex-nowrap',
        className,
      )}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <div className={cn('min-w-0 flex-1', wrap && 'basis-[14rem]')}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body text-ink">
            {label}
          </label>
        ) : (
          <div className="text-body text-ink">{label}</div>
        )}
        {description && (
          <div className="text-footnote leading-snug text-ink-muted">{description}</div>
        )}
      </div>
      {children != null && children !== false && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
      )}
    </Tag>
  );
}

/**
 * A row that opens to show more below it, in the same group (a monster's
 * permissions, a server's settings). The whole row is the button.
 */
export function DisclosureRow({
  label,
  description,
  leading,
  trailing,
  children,
  testId,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  as = 'li',
}: {
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  /** Shown before the chevron (a status pill). */
  trailing?: ReactNode;
  /** What opens under the row; leave it out when the caller shows the content itself. */
  children?: ReactNode;
  testId?: string;
  defaultOpen?: boolean;
  /** Controlled: the caller holds the state (a link can open the row). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  as?: 'div' | 'li';
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const setOpen = (next: (o: boolean) => boolean) => {
    const value = next(open);
    setOwn(value);
    onOpenChange?.(value);
  };
  const panelId = domId(useId());
  const Tag = as;
  return (
    <Tag data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={children != null ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="row-key flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
      >
        {leading && <span className="flex shrink-0 items-center">{leading}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink">{label}</span>
          {description && (
            <span className="block truncate text-footnote text-ink-muted">{description}</span>
          )}
        </span>
        {trailing}
        <CaretDown
          size={14}
          aria-hidden
          className={cn('shrink-0 text-ink-muted turn', open && 'rotate-180')}
        />
      </button>
      {open && children != null && (
        <div id={panelId} className="set-seam-t bg-panel">
          {children}
        </div>
      )}
    </Tag>
  );
}

/** Lines inside an open row or under a row: same padding as the rows, no surface of their own. */
export function RowBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-3 px-4 py-3', className)}>{children}</div>;
}

/** A short status line with a check (done) or an info mark. */
export function Status({
  ok,
  children,
  testId,
}: {
  ok?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p
      className="flex items-start gap-1.5 text-footnote leading-snug text-ink-muted"
      data-testid={testId}
    >
      {ok ? (
        <span aria-hidden className="mx-[4.5px] mt-[6px] flex shrink-0">
          <span className="led" data-tone="ok" />
        </span>
      ) : (
        <Info size={17} aria-hidden className="mt-px shrink-0" />
      )}
      <span>{children}</span>
    </p>
  );
}

/** Label, field, hint or error: like `Field`, with the hint readable on a module. */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-footnote leading-snug text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A field in a module: sunk in its well like every field (`Input` already is);
 * kept as a hook for the fields of the settings.
 */
export const fieldOnGroup = 'well';

/**
 * A read that failed, said where the content is: a line with "Try again". Kept above forms that
 * stay mounted when a refresh fails after the first load, so what is being typed is not lost.
 */
export function LoadNotice({
  text,
  onRetry,
  testId = 'load-notice',
}: {
  text: string;
  onRetry: () => void;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-stop-soft px-3.5 py-2.5 text-body text-stop-ink"
    >
      <span className="min-w-0 flex-1 basis-[16rem]">{text}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {partsStrings().retry}
      </Button>
    </div>
  );
}

/**
 * A first read that failed (U2-25, U2-27): "Couldn't load the limits." and "Try again", which runs
 * the read again. One voice for every module that reads something; `what` reads after "load".
 */
export function LoadFailed({
  what,
  onRetry,
  testId = 'load-failed',
}: {
  what: string;
  onRetry: () => void;
  testId?: string;
}) {
  return <LoadNotice text={partsStrings().loadFailed(what)} onRetry={onRetry} testId={testId} />;
}

/**
 * Reading again on demand: `attempt` goes in the dependencies of the effect that reads, and
 * `retry` is what "Try again" calls (`onRetry` runs first, to clear the failure).
 */
export function useRetry(onRetry?: () => void): [attempt: number, retry: () => void] {
  const [attempt, setAttempt] = useState(0);
  return [
    attempt,
    () => {
      onRetry?.();
      setAttempt((n) => n + 1);
    },
  ];
}

/**
 * A button with a confirmation in place ("Disconnect"): the first press asks, the
 * second does it; "Cancel" goes back.
 */
export function ConfirmButton({
  label,
  question,
  confirm,
  onConfirm,
  busy = false,
}: {
  label: string;
  question: string;
  confirm: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const s = partsStrings();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-footnote text-ink-muted">{question}</span>
      <Button
        variant="dangerSoft"
        size="sm"
        disabled={busy}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirm}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        {s.cancel}
      </Button>
    </span>
  );
}

/** A small sunk tile with an icon before a row's text (neutral, not coloured). */
export function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="well flex size-8 items-center justify-center rounded-[8px] text-ink-muted"
      aria-hidden
    >
      {children}
    </span>
  );
}

/**
 * A model service in Settings → Modelli: name, a small tag, one status line,
 * its buttons on the right; whatever it opens (a key form, the details) below,
 * in the same row.
 */
export function ServiceRow({
  testId,
  configured,
  title,
  tag,
  status,
  actions,
  children,
}: {
  testId: string;
  configured?: boolean;
  title: ReactNode;
  tag?: string;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      data-testid={testId}
      data-configured={configured === undefined ? undefined : configured ? 'yes' : 'no'}
    >
      <Row
        label={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{title}</span>
            {tag && (
              <span className="label rounded-[5px] px-1.5 py-px whitespace-nowrap text-ink-muted shadow-[inset_0_0_0_1px_var(--seam)]">
                {tag}
              </span>
            )}
          </span>
        }
        description={status}
        wrap
      >
        {actions}
      </Row>
      {children && <div className="set-seam-t">{children}</div>}
    </li>
  );
}

/** A multi-line field in a group. */
export const textareaClass =
  'well w-full resize-y rounded-[10px] px-3.5 py-2.5 text-body leading-snug text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop';

/** A native select in a group. */
export const selectClass =
  'well set-select h-10 max-w-full cursor-pointer rounded-[10px] pr-9 pl-3.5 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink';

/**
 * A value with "Cambia" next to it; pressed, a field with Salva and Annulla.
 * `onSave` rejects with the text to show (e.g. the core refused the name).
 */
export function InlineEdit({
  value,
  label,
  onSave,
  check,
  maxLength = 24,
  testId,
  before,
}: {
  value: string;
  /** What is edited, lower case after the verb (e.g. "your name"). */
  label: string;
  onSave: (next: string) => Promise<void>;
  /** A problem with the new value, or null. */
  check?: (next: string) => string | null;
  maxLength?: number;
  testId?: string;
  /** Shown before the value (an avatar). */
  before?: ReactNode;
}) {
  const s = partsStrings();
  const id = domId(useId());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setEditing(false);
    setProblem(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = draft.replace(/\s+/g, ' ').trim();
    if (next === value) return close();
    const p = check?.(next) ?? null;
    if (p) return setProblem(p);
    setBusy(true);
    try {
      await onSave(next);
      close();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-2" data-testid={testId}>
        {before}
        <span className="text-body text-ink-muted">{value}</span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={s.changeWhat(label)}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {s.change}
        </Button>
      </span>
    );
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid justify-items-end gap-1"
      noValidate
      data-testid={testId}
    >
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        <label htmlFor={id} className="sr-only">
          {label.charAt(0).toUpperCase() + label.slice(1)}
        </label>
        <input
          id={id}
          value={draft}
          maxLength={maxLength}
          autoFocus
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : undefined}
          className="well h-10 w-44 rounded-[10px] px-3.5 text-body text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop"
        />
        <Button type="submit" size="sm" disabled={busy} onClick={() => playSound('click')}>
          {busy ? s.saving : s.save}
        </Button>
        <Button variant="ghost" size="sm" onClick={close}>
          {s.cancel}
        </Button>
      </span>
      {problem && (
        <span id={`${id}-error`} role="alert" className="text-footnote text-stop-ink">
          {problem}
        </span>
      )}
    </form>
  );
}

/**
 * A monster of the team on its small black screen, before its row (permissions,
 * models). A monster the UI does not know yet shows a light in its colour.
 */
export function AgentMark({
  id,
  color,
  width = 40,
  height = 34,
}: {
  id: string;
  color: string;
  width?: number;
  height?: number;
}) {
  const agent = useAgent(id);
  if (agent)
    return <MonsterScreen genome={agent.genome} mood="idle" width={width} height={height} />;
  return <span aria-hidden className="led" style={{ '--led': color } as CSSProperties} />;
}

/** A text setting: its value as a line, "Change" opens a text box with Save. */
export function TextSetting({
  label,
  value,
  empty,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  empty: string;
  placeholder: string;
  onSave: (v: string) => Promise<void>;
}) {
  const s = partsStrings();
  const id = domId(useId());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(draft.trim());
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Row
        label={label}
        description={<span className="line-clamp-2 whitespace-pre-line">{value || empty}</span>}
      >
        {!open && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={s.changeLabel(label)}
            onClick={() => {
              setDraft(value);
              setOpen(true);
            }}
          >
            {s.change}
          </Button>
        )}
      </Row>
      {open && (
        <form onSubmit={(e) => void submit(e)} className="set-seam-t" noValidate>
          <RowBody>
            <label htmlFor={id} className="sr-only">
              {label}
            </label>
            <textarea
              id={id}
              rows={3}
              maxLength={1000}
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              className={textareaClass}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-footnote text-stop-ink">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? s.saving : s.save}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {s.cancel}
              </Button>
            </div>
          </RowBody>
        </form>
      )}
    </div>
  );
}
