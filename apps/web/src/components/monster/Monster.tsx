import { dotCss, renderDots, type Expression, type MonsterGenome } from '@monsters/monster-kit';
import { memo, useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import type { LiveMood } from '../../store/derive.ts';
import './monster.css';

/*
 * A monster from the kit as a creature of luminous dots (docs/design.md, "I mostri a punti",
 * D-062): `renderDots` draws every frame of the expression in one SVG and `dotCss` (installed
 * once per page) switches the frames with steps. The UI only picks the expression from the
 * live state; the black screen around it is `MonsterScreen`.
 */

const STYLE_ID = 'monsters-kit-css';

/** Adds the kit's frame stylesheet to the page, once. */
export function installMonsterCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = dotCss;
  doc.head.append(style);
}

/** Set on a monster out of the viewport: its frames rest (monster.css). */
const OFFSCREEN = 'data-offscreen';

let observer: IntersectionObserver | null = null;

/**
 * One observer for every monster on the page: the ones scrolled out of sight
 * (a long chat, the bottom of the sidebar) stop animating, so the page only
 * pays for what is on screen (docs/design.md, "Mostri e prestazioni").
 */
function watchOffscreen(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.target.toggleAttribute(OFFSCREEN, !e.isIntersecting);
    },
    { rootMargin: '64px' },
  );
  observer.observe(el);
  return () => observer?.unobserve(el);
}

/** The face of a live state; a monster at work that goes round in circles looks confused. */
export function expressionFor(mood: LiveMood, confused = false): Expression {
  if (confused && (mood === 'working' || mood === 'talking' || mood === 'waiting'))
    return 'confused';
  switch (mood) {
    case 'working':
      return 'think';
    case 'talking':
      return 'talk';
    case 'done':
      return 'happy';
    case 'error':
      return 'error';
    case 'stopped':
      return 'sleep';
    default:
      return 'idle';
  }
}

export interface MonsterProps {
  genome: MonsterGenome;
  expression?: Expression;
  size: number;
  /** Accessible name; when omitted the monster is decorative. */
  title?: string;
  /** CSS motion (breathing, thinking, talking). Off for small avatars: only the eyes blink. */
  animated?: boolean;
  dimmed?: boolean;
  className?: string;
}

export const Monster = memo(function Monster({
  genome,
  expression = 'idle',
  size,
  title,
  animated = true,
  dimmed = false,
  className,
}: MonsterProps) {
  const prefix = `m${domId(useId())}`;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    return el ? watchOffscreen(el) : undefined;
  }, []);
  const svg = useMemo(
    () =>
      renderDots(genome, {
        expression,
        size,
        idPrefix: prefix,
        animated,
        ...(title ? { title } : {}),
      }),
    [genome, expression, size, prefix, title, animated],
  );
  const style: CSSProperties = { width: size, height: Math.round((size * 15) / 17) };
  return (
    <span
      ref={ref}
      className={cn('monster', className)}
      data-expression={expression}
      data-animated={animated ? 'on' : 'off'}
      data-dimmed={dimmed ? 'on' : undefined}
      style={style}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
