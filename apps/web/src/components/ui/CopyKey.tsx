import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from '../../lib/copy.ts';
import { cn } from '../../lib/utils.ts';
import { notify } from '../../store/app.ts';
import { uiStrings } from './ui.strings.ts';

/** How long the key says "Copied". */
const SAID_MS = 1600;

/**
 * A small key that copies a text: the icon turns into a tick for a moment, and a hidden status
 * says it for screen readers. The label is the tooltip and the accessible name, never drawn
 * beside the icon (unless `children` say it).
 */
export function CopyKey({
  text,
  label,
  className,
  children,
  testId = 'copy-key',
}: {
  /** What goes on the clipboard (read when pressed, so a long text is not built until then). */
  text: string | (() => string);
  label: string;
  className?: string;
  children?: ReactNode;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const press = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (!ok) {
      notify(uiStrings().copyFailed, 'error');
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), SAID_MS);
  };
  return (
    <button
      type="button"
      onClick={() => void press()}
      aria-label={label}
      title={copied ? uiStrings().copied : label}
      data-testid={testId}
      data-copied={copied ? '' : undefined}
      className={cn(
        'key-ghost inline-flex size-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] text-ink-muted select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-ink',
        className,
      )}
    >
      {copied ? <Check size={16} weight="bold" aria-hidden /> : <Copy size={16} aria-hidden />}
      {children}
      <span className="sr-only" role="status">
        {copied ? uiStrings().copied : ''}
      </span>
    </button>
  );
}
