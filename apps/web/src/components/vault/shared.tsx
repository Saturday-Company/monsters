import { vaultLayout, appLang, formatDate, timeOptions } from '@monsters/shared';
import { Gear, LockSimple, User } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { noteName, plainText } from '../../lib/markdown.ts';
import type { AppState } from '../../store/app.ts';
import { useApp } from '../../store/app.ts';
import { useAgent } from '../../store/hooks.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { cn, formatAgo, formatListTime } from '../../lib/utils.ts';
import { vaultStrings } from './vault.strings.ts';

/** Id of the newest `vault_change` among the last events (the view reloads on a change). */
export function lastVaultChange(s: Pick<AppState, 'events'>): string | null {
  const events = s.events;
  for (let i = events.length - 1, seen = 0; i >= 0 && seen < 400; i--, seen++) {
    if (events[i]!.type === 'vault_change') return events[i]!.id;
  }
  return null;
}

export function useLastVaultChange(): string | null {
  return useApp(lastVaultChange);
}

/** Vault dates are local ISO date-times without a zone ("2026-10-14T10:20:00"). */
export function vaultTime(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

export function agoText(date: string | null | undefined, now = Date.now()): string {
  const t = vaultTime(date);
  return t === null ? '' : formatAgo(t, now);
}

/** The date of a list row, as Notes shows it: the time today, "Yesterday", the weekday, the day. */
export function listDate(date: string | null | undefined, now = Date.now()): string {
  const t = vaultTime(date);
  return t === null ? '' : formatListTime(t, now);
}

/** "October 15, 2026 at 3:31 PM": the date above a note, as Notes shows it. */
export function longDate(date: string | null | undefined): string {
  const t = vaultTime(date);
  return t === null
    ? ''
    : formatDate(t, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        ...timeOptions(),
      });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The stamp above a note, read like an instrument (Martian Mono): "15.10.2026 · 20:49" in Italian,
 * "Oct 15, 2026 · 8:49 PM" in English.
 */
export function stampDate(date: string | null | undefined): string {
  const t = vaultTime(date);
  if (t === null) return '';
  if (appLang() !== 'it')
    return `${formatDate(t, { day: 'numeric', month: 'short', year: 'numeric' })} · ${formatDate(t, timeOptions())}`;
  const d = new Date(t);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Notes the monsters keep for themselves (`Agenti/<nome>/…`, `Agents/…`: D-154): hidden unless asked for. */
export function isAgentNote(path: string): boolean {
  const folder = vaultLayout().agents;
  return path === folder || path.startsWith(`${folder}/`);
}

/** A preview line of a note: plain text, no `#`, `[[ ]]`, `**` or list marks. */
export function previewText(md: string | null | undefined, max = 160): string {
  if (!md) return '';
  // The summary joins the first lines: list marks may be in the middle ("… 2. Pastéis").
  const text = plainText(md.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, ''))
    .replace(/(^|\s)(?:[-*+]|\d{1,2}[.)])\s+(?=\S)/g, '$1')
    .replace(/(^|\s)\[[ xX]\](?=\s)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A search snippet without Markdown marks, keeping the `**word**` marks of the
 * matched words (they become highlights).
 */
export function cleanSnippet(text: string): string {
  return text
    .replace(/!?\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g, (_m, t: string, a?: string) =>
      a ? a : noteName(t),
    )
    .replace(/\[\[|\]\]/g, '')
    .replace(/(^|\s)(?:[-*+]\s+)?\[[ xX]\](?=\s)/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/(^|\s|…)#{1,6}\s+/g, '$1')
    .replace(/(^|\s)>\s+/g, '$1')
    .replace(/(^|\s)(?:[-*+]|\d+[.)])\s+(?=\S)/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Private" mark: the owner sees private notes, the agents do not. */
export function PrivateMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const s = vaultStrings().shared;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 font-medium text-ink-muted',
        compact ? 'size-4 justify-center' : 'label well h-6 rounded-[6px] px-2 text-ink-muted',
        className,
      )}
      title={s.privateTitle}
      data-testid="private-mark"
    >
      <LockSimple size={compact ? 12 : 12} weight={compact ? 'fill' : 'bold'} aria-hidden />
      {compact ? <span className="sr-only">{s.private}</span> : s.private}
    </span>
  );
}

/**
 * Who wrote (or changed) a note: a monster on its small screen, or a key cap
 * with you or the system. Decorative: the name is always written next to it.
 */
export function AuthorScreen({
  id,
  width = 34,
  height = 30,
}: {
  id: string;
  width?: number;
  height?: number;
}) {
  const agent = useAgent(id);
  if (agent)
    return <MonsterScreen genome={agent.genome} mood="idle" width={width} height={height} />;
  const Icon = id === 'user' ? User : Gear;
  return (
    <span
      aria-hidden
      className="well inline-flex shrink-0 items-center justify-center rounded-[8px] text-ink-muted"
      style={{ width, height }}
    >
      <Icon size={Math.round(height * 0.5)} weight="bold" />
    </span>
  );
}

/** A light in the colour of a group of the graph (a monster's LED, or the screen ink). */
export function GroupDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('led', className)}
      style={{ '--led': color } as CSSProperties}
    />
  );
}
