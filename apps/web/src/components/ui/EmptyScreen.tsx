import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { useOrchestrator } from '../../store/hooks.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';

/**
 * An empty state: a small black screen with the first monster, a short title in dots and one
 * or two lines on what goes here (docs/design.md, "Stati vuoti"). One action at most, as
 * `children`: the same one the rail would offer, never twice.
 */
export function EmptyScreen({
  title,
  text,
  children,
  testId,
  maxWidth = 520,
  className,
}: {
  title: string;
  text: ReactNode;
  children?: ReactNode;
  testId?: string;
  maxWidth?: number;
  className?: string;
}) {
  const orch = useOrchestrator();
  return (
    <div
      className={cn('flex flex-1 items-start justify-center px-4 pt-10', className)}
      data-testid={testId}
    >
      <div
        className="screen screen-lines flex w-full flex-col items-center gap-4 rounded-[14px] px-6 py-8 text-center"
        style={{ maxWidth }}
      >
        {orch && <MonsterScreen genome={orch.genome} mood="idle" width={96} height={80} pad={4} />}
        <p className="font-mono text-micro tracking-[0.08em] text-screen-ink uppercase">{title}</p>
        <p className="max-w-[44ch] text-body text-screen-muted">{text}</p>
        {children}
      </div>
    </div>
  );
}
