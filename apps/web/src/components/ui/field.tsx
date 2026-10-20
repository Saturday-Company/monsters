import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/utils.ts';

/*
 * Fields of the instrument (docs/design.md, "Campo"): sunk into the surface
 * (`.well`), radius 10, 44 px; focus is a 2 px ring in the signal ink. Labels
 * always sit above the field.
 */

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-footnote font-medium text-ink', className)} {...props} />;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(
        'well h-11 w-full rounded-[10px] px-3.5 text-body text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
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
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-footnote text-on-danger-soft" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-footnote text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
