import type { PendingSend } from './derive.ts';

/*
 * What the user wrote and has not sent yet, kept across chat switches, page changes, a
 * language switch and a reload (W-6, W-7): the composer's draft of each chat and the
 * messages held while the monsters are stopped. Per account and per browser
 * (localStorage), a convenience: without storage they last as long as the tab, as before.
 */

const DRAFTS = 'monsters-drafts';
const HELD = 'monsters-held';

/** Longest draft kept (the core takes at most 20,000 characters per message). */
const MAX_DRAFT = 20_000;
/** At most this many held messages are kept per account. */
const MAX_HELD = 50;

function read(key: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function write(key: string, value: Record<string, unknown>): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // private mode or storage blocked: the text lasts as long as the tab
    return false;
  }
}

/** Drafts of one account: chat (agent id) → text. */
function draftsOf(all: Record<string, unknown>, account: string): Record<string, string> {
  const mine = all[account];
  if (!mine || typeof mine !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(mine)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

/** The draft of a chat ('' when none). */
export function draftOf(account: string | null, agentId: string): string {
  if (!account) return '';
  return draftsOf(read(DRAFTS), account)[agentId] ?? '';
}

/** Keeps (or, with an empty text, forgets) the draft of a chat. */
export function saveDraft(account: string | null, agentId: string, text: string): void {
  if (!account) return;
  const all = read(DRAFTS);
  const mine = draftsOf(all, account);
  if (text.trim()) mine[agentId] = text.slice(0, MAX_DRAFT);
  else if (mine[agentId] === undefined) return;
  else delete mine[agentId];
  write(DRAFTS, { ...all, [account]: mine });
}

/** A held message as kept in storage. */
type Held = Pick<PendingSend, 'tempId' | 'text' | 'to' | 'ts' | 'attachments'>;

function heldOf(all: Record<string, unknown>, account: string): Held[] {
  const mine = all[account];
  if (!Array.isArray(mine)) return [];
  return mine.flatMap((h: unknown): Held[] => {
    if (!h || typeof h !== 'object') return [];
    const r = h as Record<string, unknown>;
    if (typeof r['tempId'] !== 'string' || typeof r['text'] !== 'string') return [];
    const attachments = Array.isArray(r['attachments'])
      ? r['attachments'].filter((a): a is string => typeof a === 'string')
      : [];
    return [
      {
        tempId: r['tempId'],
        text: r['text'],
        ts: typeof r['ts'] === 'number' ? r['ts'] : 0,
        ...(typeof r['to'] === 'string' ? { to: r['to'] } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
    ];
  });
}

function writeHeld(all: Record<string, unknown>, account: string, list: readonly Held[]): boolean {
  const next = { ...all };
  if (list.length) next[account] = list;
  else delete next[account];
  return write(HELD, next);
}

/** The messages held for this account (by this tab or another one), oldest first. */
export function storedHeld(account: string | null): PendingSend[] {
  if (!account) return [];
  return heldOf(read(HELD), account).map((h) => ({ ...h, held: true }));
}

/** Adds a held message to storage; false when it could not be kept there. */
export function keepHeld(account: string | null, p: PendingSend): boolean {
  if (!account) return false;
  const all = read(HELD);
  const list = heldOf(all, account).filter((h) => h.tempId !== p.tempId);
  if (list.length >= MAX_HELD) return false;
  list.push({
    tempId: p.tempId,
    text: p.text,
    ts: p.ts,
    ...(p.to ? { to: p.to } : {}),
    ...(p.attachments?.length ? { attachments: p.attachments } : {}),
  });
  return writeHeld(all, account, list);
}

/**
 * Takes held messages out of storage, and says which of them were no longer there: another
 * tab that sent them first already took them, and they must not go twice.
 */
export function takeHeld(account: string | null, tempIds: readonly string[]): Set<string> {
  if (!account) return new Set();
  const all = read(HELD);
  const list = heldOf(all, account);
  const stored = new Set(list.map((h) => h.tempId));
  const wanted = new Set(tempIds);
  if (list.some((h) => wanted.has(h.tempId)))
    writeHeld(
      all,
      account,
      list.filter((h) => !wanted.has(h.tempId)),
    );
  return new Set(tempIds.filter((id) => !stored.has(id)));
}
