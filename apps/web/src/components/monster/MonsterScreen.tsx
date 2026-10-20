import { DOT_H, DOT_W, type MonsterGenome } from '@monsters/monster-kit';
import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils.ts';
import type { LiveMood } from '../../store/derive.ts';
import { expressionFor, Monster } from './Monster.tsx';

/**
 * The width of the dot grid that fits a box with `pad` px all around, as large
 * as possible. From 2 px of pitch up it snaps to half pixels, so the dots of
 * the small screens fall on the same places of the pixel grid and stay crisp.
 */
export function fitDots(width: number, height: number, pad = 3): number {
  const pitch = Math.min((width - 2 * pad) / DOT_W, (height - 2 * pad) / DOT_H);
  const snapped = pitch >= 2 ? Math.floor(pitch * 2) / 2 : pitch;
  return Math.max(DOT_W, Math.round(snapped * DOT_W * 100) / 100);
}

/*
 * A monster on its small black screen (docs/design.md, "Schermo"): the strips
 * of the sidebar, the avatars of the chat, the @-menu. The creature fills the
 * screen (`fitDots`) and lives by frames:
 *   idle → blinks (visibility toggles, nearly free), working → think,
 *   talking → talk, done → happy, error → error, stopped → sleep.
 * `animated={false}` holds the first frame (avatars of old messages).
 */
export function MonsterScreen({
  genome,
  mood,
  width,
  height,
  animated = true,
  pad = 3,
  title,
  className,
  style,
  confused = false,
}: {
  genome: MonsterGenome;
  mood: LiveMood;
  /** Going round in circles (the instinct, D-067): the confused face. */
  confused?: boolean | undefined;
  /** Outer size of the screen, in px. */
  width: number;
  height: number;
  animated?: boolean;
  /** Room between the dots and the edge of the screen. */
  pad?: number;
  /** Accessible name; when omitted the screen is decorative. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const size = fitDots(width, height, pad);
  return (
    <span
      className={cn(
        'screen relative flex shrink-0 items-center justify-center overflow-hidden',
        className,
      )}
      style={{ width, height, borderRadius: Math.min(10, Math.round(height / 5)), ...style }}
      data-mood={mood}
      data-confused={confused ? 'true' : undefined}
      data-testid="monster-screen"
    >
      <Monster
        genome={genome}
        size={size}
        expression={expressionFor(mood, confused)}
        animated={animated}
        dimmed={mood === 'stopped'}
        {...(title ? { title } : {})}
      />
    </span>
  );
}
