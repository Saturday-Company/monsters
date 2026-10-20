import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils.ts';

/*
 * The level meter (docs/design.md, "Misuratore"): four segments 3×10 px in the
 * monster's colour. While the monster works they light in turns, by frames
 * (styles.css `.meter`, opacity only); at rest they are off. Decorative: the
 * words next to it say what happens.
 */
export function Meter({
  active,
  color,
  className,
}: {
  /** Lit and moving (the monster works). */
  active: boolean;
  /** The colour of the segments; defaults to the text colour. */
  color?: string;
  className?: string;
}) {
  const style = color ? ({ '--meter': color } as CSSProperties) : undefined;
  return (
    <span
      aria-hidden
      data-testid="meter"
      data-on={active ? '' : undefined}
      className={cn('meter', className)}
      style={style}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
