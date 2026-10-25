import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { joinedKey, KeyLight } from './controls.tsx';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** DOM ids that tie a tab to its panel (`aria-controls` / `aria-labelledby`). */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const panelId = (base: string, value: string) => `${base}-panel-${value}`;

/**
 * Index of the tab a key moves to in a horizontal tablist (WAI-ARIA tabs
 * pattern): arrows wrap around, Home and End go to the ends. `null` for any
 * other key, which the tablist leaves alone.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Accessible tablist with automatic activation: the arrows move focus and
 * select at once, only the selected tab is in the Tab order (roving
 * tabindex). A row of joined keys, the chosen one pressed (docs/design.md); on narrow screens it scrolls
 * sideways and keeps the selected tab in view. The panels are the caller's:
 * give each `role="tabpanel"`, `id={panelId(base, value)}` and
 * `aria-labelledby={tabId(base, value)}`.
 */
export function Tabs<T extends string>({
  base,
  items,
  value,
  onChange,
  label,
  className,
  fit = false,
}: {
  /** Prefix of the tab and panel ids: unique in the page. */
  base: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  /**
   * Few tabs that must all show on a phone: below `sm` they share the width
   * (no sideways scroll) and drop their icons.
   */
  fit?: boolean;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  // The selected tab stays visible in the sideways scroll (narrow screens, deep links).
  useEffect(() => {
    refs.current.get(value)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = tabKeyTarget(e.key, index, items.length);
    if (target === null) return;
    e.preventDefault();
    const next = items[target]!.value;
    refs.current.get(next)?.focus();
    if (next !== value) onChange(next);
  };

  const tab = (item: TabItem<T>, i: number, size: string) => {
    const active = item.value === value;
    return (
      <button
        key={item.value}
        ref={(el) => {
          if (el) refs.current.set(item.value, el);
          else refs.current.delete(item.value);
        }}
        type="button"
        role="tab"
        id={tabId(base, item.value)}
        aria-selected={active}
        aria-controls={panelId(base, item.value)}
        tabIndex={active ? 0 : -1}
        data-pressed={active ? 'true' : undefined}
        onClick={() => !active && onChange(item.value)}
        onKeyDown={(e) => onKeyDown(e, i)}
        className={cn(joinedKey(active, i === 0, i === items.length - 1), 'h-10 text-body', size)}
      >
        {active && <KeyLight />}
        {item.icon && (
          <span className={cn('inline-flex', fit && 'hidden @min-[680px]:inline-flex')}>
            {item.icon}
          </span>
        )}
        {item.label}
      </button>
    );
  };

  if (fit) {
    // Sized by the room it has (a container), not by the window: the settings
    // sit next to the sidebar. Narrow: the keys share the row, smaller words,
    // no icons; wide: their natural size with the icons.
    return (
      <div className={cn('@container flex w-full justify-center', className)}>
        <div
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          className="relative flex w-full items-center pb-[3px] @min-[680px]:inline-flex @min-[680px]:w-auto"
        >
          {items.map((item, i) =>
            tab(
              item,
              i,
              'min-w-0 flex-auto px-1 text-caption leading-tight whitespace-normal @min-[440px]:text-footnote @min-[680px]:flex-none @min-[680px]:px-4 @min-[680px]:text-body @min-[680px]:whitespace-nowrap',
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Scrolls sideways when the tabs do not fit; the edges fade instead of a scrollbar.
        '-mx-5 scroll-px-7 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden',
        '[mask-image:linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)] sm:[mask-image:none]',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="relative inline-flex items-center pt-0.5 pb-[3px]"
      >
        {items.map((item, i) => tab(item, i, 'shrink-0 px-4'))}
      </div>
    </div>
  );
}
