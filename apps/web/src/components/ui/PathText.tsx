import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { notify } from '../../store/app.ts';
import { cn } from '../../lib/utils.ts';
import { uiStrings } from './ui.strings.ts';

/**
 * A path shortened in the middle: "/home/andrea/…/Sito di Saturday" keeps the start (where it
 * lives) and the end (what it is). Short paths stay whole.
 */
export function middleEllipsis(path: string, max = 40): string {
  if (path.length <= max) return path;
  const parts = path.split('/');
  const last = parts.at(-1) ?? '';
  // Start: the first two segments ("/home/andrea"); end: the last one, or two when they fit.
  const head = parts.slice(0, parts[0] === '' ? 3 : 2).join('/');
  const tail = [parts.at(-2), last].filter(Boolean).join('/');
  const tailShown = head.length + 2 + tail.length <= max ? tail : last;
  if (head.length + 1 + tailShown.length >= path.length) return path;
  const room = Math.max(16, max - head.length - 4);
  return `${head}/…/${tailShown.length > room ? `${tailShown.slice(0, room - 1)}…` : tailShown}`;
}

/**
 * A path as a line of text with a key to copy it: the middle is cut with an ellipsis (the whole
 * path is the tooltip and what a screen reader says), never broken in the middle of a word.
 */
export function PathText({
  path,
  max = 40,
  className,
}: {
  path: string;
  max?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      notify(uiStrings().copyFailed, 'error');
    }
  };
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1', className)} data-testid="path">
      <span className="min-w-0 font-mono text-micro leading-5 break-keep text-ink" title={path}>
        <span aria-hidden>{middleEllipsis(path, max)}</span>
        <span className="sr-only">{path}</span>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? uiStrings().pathCopied : uiStrings().copyPath}
        title={copied ? uiStrings().copied : uiStrings().copyPath}
        data-testid="path-copy"
        className="key-ghost inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink"
      >
        {copied ? <Check size={14} weight="bold" aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </span>
  );
}
