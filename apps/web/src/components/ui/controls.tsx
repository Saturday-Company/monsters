import { useId, type ReactNode } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { uiStrings } from './ui.strings.ts';

/*
 * Controls of the instrument (docs/design.md, "Interruttore"): a lever in a
 * sunk track with its light beside it; segments and chips as rows of joined
 * keys, the chosen one pressed with an orange light on it. Movement by frames
 * (`steps()`), transforms only.
 */

/** A lever switch on a native button (role="switch"): the cap slides in a well, a light says on. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
  disabled = false,
  words = false,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  /** Says "On" / "Off" beside the lever (settings rows): the state is not told by a colour alone. */
  words?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex shrink-0 items-center gap-2.5 rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={cn(
          'well relative block h-[30px] w-[52px] rounded-[9px]',
          // On, the track takes a tint of the "on" light; the lever carries a bar, off it carries ridges.
          checked && 'bg-[color-mix(in_oklab,var(--ok)_18%,var(--well))]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'lever absolute top-[3px] left-[3px] block h-[21px] w-[24px] rounded-[6px]',
            checked ? 'translate-x-[22px]' : 'translate-x-0',
          )}
        >
          {checked ? (
            // On: a bar, "|".
            <span className="absolute inset-y-[5px] left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-ink" />
          ) : (
            // Off: two grip ridges on the cap.
            <span className="absolute inset-y-[6px] left-1/2 w-[5px] -translate-x-1/2 border-x border-[var(--lever-edge)]" />
          )}
        </span>
      </span>
      <span aria-hidden className="led" data-tone={checked ? 'ok' : undefined} />
      {words && (
        <span
          aria-hidden
          className={cn(
            'label w-[4.6em] text-left whitespace-nowrap',
            checked ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {checked ? uiStrings().on : uiStrings().off}
        </span>
      )}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible label when `label` is only an icon. */
  ariaLabel?: string;
}

/**
 * Classes of one key in a row of joined keys: square inner corners, shared
 * edges, the chosen one pressed (sunk, `--panel` cap, an orange light on top).
 */
export function joinedKey(active: boolean, first: boolean, last: boolean): string {
  return cn(
    'key relative z-0 inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
    !first && '-ml-px',
    first && last
      ? 'rounded-[10px]'
      : first
        ? 'rounded-l-[10px] rounded-r-none'
        : last
          ? 'rounded-r-[10px] rounded-l-none'
          : 'rounded-none',
    active ? 'font-semibold text-ink [--cap:var(--panel)]' : 'text-ink-muted hover:text-ink',
  );
}

/** The orange light of the chosen key. */
export function KeyLight() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[5px] left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-full bg-signal"
    />
  );
}

/**
 * Segmented control: a row of joined keys, one pressed. `value: null` selects
 * none (e.g. a bar on a page that is not one of its options).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
  fill = false,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: readonly SegmentOption<T>[];
  label: string;
  className?: string;
  size?: 'sm' | 'md';
  /** Take the width of the parent and share it between the keys (labels truncate), never overflow. */
  fill?: boolean;
}) {
  const group = domId(useId());
  return (
    <div
      role="radiogroup"
      aria-label={label}
      id={group}
      className={cn(
        'relative items-center pb-[3px]',
        fill ? 'flex w-full min-w-0' : 'inline-flex',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            data-pressed={active ? 'true' : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              joinedKey(active, i === 0, i === options.length - 1),
              size === 'sm' ? 'h-10 px-3.5 text-body' : 'h-11 px-4 text-body',
              fill && 'min-w-0 flex-1 px-2',
            )}
          >
            {active && <KeyLight />}
            {fill ? <span className="min-w-0 truncate">{o.label}</span> : o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A chip (toggle, or radio when `role="radio"`): a key, pressed when on, with its light.
 * `sm` is the small filter chip (the light shows only when on); `lg` is the big option of the
 * first run and of the forms (the light is always there, off when not chosen).
 */
export function Chip({
  pressed,
  onClick,
  children,
  className,
  size = 'sm',
  role,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'lg';
  role?: 'radio';
}) {
  const lg = size === 'lg';
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : pressed}
      aria-checked={role ? pressed : undefined}
      data-pressed={pressed ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'key inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        lg
          ? 'min-h-11 gap-2 px-4 py-2 text-left text-large leading-tight font-medium'
          : 'h-9 gap-1.5 rounded-[9px] px-3.5 text-footnote font-medium',
        pressed ? 'font-semibold text-ink [--cap:var(--panel)]' : 'text-ink-muted hover:text-ink',
        className,
      )}
    >
      {(pressed || lg) && (
        <span
          aria-hidden
          className={cn('led', !lg && 'size-1.5')}
          data-tone={pressed ? 'signal' : undefined}
        />
      )}
      {children}
    </button>
  );
}
