import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/utils.ts';

/*
 * The keys of the instrument (docs/design.md, "Tasto"): a cap with an edge and
 * 3 px of thickness; pressed, it sinks 2 px in two frames (styles.css `.key`).
 * `primary` is the signal orange with dark text, `danger` the stop red, `ghost`
 * has no cap (icons in the rail, quiet actions). Heights 40 / 44 / 48.
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-semibold disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'key key-primary disabled:opacity-100',
        secondary: 'key text-ink',
        ghost: 'key-ghost text-ink-muted hover:text-ink',
        danger: 'key key-danger',
        // A quiet red action (remove, revoke): a normal key with red words.
        dangerSoft: 'key text-stop-ink',
      },
      size: {
        sm: 'h-10 px-4 text-body',
        md: 'h-11 px-5 text-body',
        lg: 'h-12 px-6 text-large',
        icon: 'size-11',
        iconSm: 'size-9 rounded-[9px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, type = 'button', ref, ...props }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/**
 * A key cap with a letter or a shortcut (`⌘K`, `A`): a small tile in Martian
 * Mono. Decorative by default (the shortcut is said elsewhere, e.g. with
 * `aria-keyshortcuts`); pass `aria-hidden={false}` to have it read.
 */
export function KeyCap({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd aria-hidden className={cn('keycap', className)} {...props}>
      {children}
    </kbd>
  );
}

/**
 * A ghost key with an icon and its short name as a `.label` (an icon alone is
 * a guess): `inline` puts the name beside the icon, `stacked` under it (the
 * narrow rails of a phone), `icon` keeps the icon only and the name as
 * tooltip. The name is always the accessible name.
 */
export function LabeledKey({
  label,
  layout = 'inline',
  pressed,
  badge,
  className,
  children,
  ...props
}: Omit<ButtonProps, 'variant' | 'size'> & {
  label: string;
  layout?: 'inline' | 'stacked' | 'icon';
  /** A key that stays down while its view is open. */
  pressed?: boolean;
  /** A small count: after the name, or on the corner of the icon when there is no name beside it. */
  badge?: ReactNode;
}) {
  const corner = badge != null && layout !== 'inline';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'key-ghost inline-flex shrink-0 items-center justify-center text-ink-muted select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        layout === 'inline' && 'h-9 gap-2 rounded-[9px] px-2.5',
        layout === 'stacked' && 'h-11 min-w-11 flex-col gap-0.5 rounded-[9px] px-1.5',
        layout === 'icon' && 'size-9 rounded-[9px]',
        pressed && 'well text-ink hover:bg-well',
        className,
      )}
      {...props}
    >
      {corner ? (
        <span className="relative inline-flex">
          {children}
          <span className="absolute -top-1.5 -right-2.5">{badge}</span>
        </span>
      ) : (
        children
      )}
      {layout !== 'icon' && (
        <span aria-hidden className={cn('label', layout === 'stacked' && 'leading-3')}>
          {label}
        </span>
      )}
      {!corner && badge}
    </button>
  );
}
