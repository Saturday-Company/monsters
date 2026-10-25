import {
  ChatCircleText,
  ClockCountdown,
  GearSix,
  Files,
  ListBullets,
  MagnifyingGlass,
  Moon,
  NotePencil,
  Notebook,
  Play,
  Power,
  Sun,
  SidebarSimple,
  Newspaper,
  Tray,
  type Icon,
} from '@phosphor-icons/react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { plainText } from '../../lib/markdown.ts';
import {
  automationPath,
  openChat,
  openPage,
  PATHS,
  routeOf,
  settingsPath,
  vaultPath,
  type SettingsTab,
} from '../../lib/router.ts';
import { cn, domId } from '../../lib/utils.ts';
import { resumeAll, useApp } from '../../store/app.ts';
import { useAgents, useOrchestrator, type AgentView } from '../../store/hooks.ts';
import { setPrefs } from '../../store/prefs.ts';
import { usePreview } from '../../store/preview.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { KeyCap } from '../ui/button.tsx';
import { uiStrings } from '../ui/ui.strings.ts';
import { useLayer } from '../ui/layers.ts';
import { vaultApi } from '../vault/api.ts';
import { isMac } from '../chat/ChatList.tsx';
import { armKillSwitch } from './KillSwitch.tsx';
import { showNews } from './NewsSheet.tsx';
import { focusNotice } from './StatusLayer.tsx';
import { showReview } from './ReviewSheet.tsx';
import { shellStrings } from './shell.strings.ts';

/*
 * The palette of the instrument (docs/design.md, "La barra laterale" and
 * "Palette"): ⌘K / Ctrl K from anywhere, or the search key of the sidebar.
 * One field and the results in groups: Mostri (name or role), Note (the
 * search of the notes), Messaggi (the chats), Comandi (pages, the theme,
 * Ferma). Arrows move, Enter opens, Esc closes. A popover on the raised
 * material, rows like the @ menu, the shortcut on the right.
 */

let isOpen = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  if (isOpen === v) return;
  isOpen = v;
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Opens the palette (⌘K, the search key of the sidebar). */
export function openPalette(): void {
  setOpen(true);
}

export function closePalette(): void {
  setOpen(false);
}

/** How the shortcut of a page is written here (⌘2 on a Mac, Ctrl 2 elsewhere). */
const keyOf = (k: string) => (isMac ? `⌘${k}` : `Ctrl ${k}`);

interface Item {
  id: string;
  group: 'monsters' | 'notes' | 'messages' | 'commands';
  /** What the row says (and its accessible name). */
  label: string;
  /** A second line, quieter. */
  detail?: string | undefined;
  /** On the right: a shortcut cap or a short label. */
  keys?: string | undefined;
  icon?: Icon | undefined;
  agent?: AgentView | undefined;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** A piece of `text` around the first match of `q`, one line. */
function snippet(text: string, q: string, n = 72): string {
  const one = plainText(text).replace(/\s+/g, ' ').trim();
  const at = norm(one).indexOf(q);
  if (at < 0 || one.length <= n) return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  const start = Math.max(0, at - 24);
  const piece = one.slice(start, start + n);
  return `${start > 0 ? '…' : ''}${piece}${start + n < one.length ? '…' : ''}`;
}

function settings(tab: SettingsTab) {
  return () => openPage(settingsPath(tab));
}

function useCommands(): Item[] {
  const halted = useApp((s) => s.halted);
  const message = useApp((s) => s.notice?.text ?? null);
  return useMemo(() => {
    const c = shellStrings().palette.commands;
    const list: Item[] = [
      // The toast on screen, for the keyboard (W-18): the palette closes first, then the focus goes there.
      ...(message
        ? [
            {
              id: 'cmd-message',
              group: 'commands' as const,
              label: uiStrings().goToMessage,
              detail: message,
              keys: keyOf('⇧.'),
              icon: ChatCircleText,
              run: () => void setTimeout(focusNotice, 0),
            },
          ]
        : []),
      {
        id: 'cmd-new-note',
        group: 'commands',
        label: c.newNote.label,
        icon: NotePencil,
        run: () => openPage(vaultPath(null, 'nuova')),
      },
      {
        id: 'cmd-automations',
        group: 'commands',
        label: c.automations.label,
        detail: c.automations.detail,
        keys: keyOf('2'),
        icon: ClockCountdown,
        run: () => openPage(PATHS.automations),
      },
      {
        id: 'cmd-new-automation',
        group: 'commands',
        label: c.newAutomation.label,
        icon: ClockCountdown,
        run: () => openPage(automationPath(null, { mode: 'nuova' })),
      },
      {
        id: 'cmd-notes',
        group: 'commands',
        label: c.notes.label,
        keys: keyOf('3'),
        icon: Notebook,
        run: () => openPage(PATHS.vault),
      },
      {
        id: 'cmd-files',
        group: 'commands',
        label: c.files.label,
        detail: c.files.detail,
        keys: keyOf('4'),
        icon: Files,
        run: () => openPage(PATHS.files),
      },
      {
        id: 'cmd-log',
        group: 'commands',
        label: c.log.label,
        keys: keyOf('5'),
        icon: ListBullets,
        run: () => openPage(PATHS.log),
      },
      {
        id: 'cmd-review',
        group: 'commands',
        label: c.review.label,
        detail: c.review.detail,
        icon: Tray,
        run: showReview,
      },
      {
        id: 'cmd-news',
        group: 'commands',
        label: c.news.label,
        detail: c.news.detail,
        icon: Newspaper,
        run: showNews,
      },
      {
        id: 'cmd-dock',
        group: 'commands',
        label: c.dock.label,
        detail: c.dock.detail,
        keys: keyOf('J'),
        icon: SidebarSimple,
        run: () => usePreview.getState().toggle(),
      },
      halted
        ? {
            id: 'cmd-resume',
            group: 'commands',
            label: c.resume.label,
            icon: Play,
            run: () => void resumeAll(),
          }
        : {
            id: 'cmd-stop',
            group: 'commands',
            label: c.stop.label,
            detail: c.stop.detail,
            keys: keyOf('.'),
            icon: Power,
            run: armKillSwitch,
          },
      {
        id: 'cmd-settings',
        group: 'commands',
        label: c.settings.label,
        keys: keyOf(','),
        icon: GearSix,
        run: settings('squadra'),
      },
      {
        id: 'cmd-models',
        group: 'commands',
        label: c.models.label,
        icon: GearSix,
        run: settings('modelli'),
      },
      {
        id: 'cmd-permissions',
        group: 'commands',
        label: c.permissions.label,
        icon: GearSix,
        run: settings('permessi'),
      },
      {
        id: 'cmd-links',
        group: 'commands',
        label: c.links.label,
        detail: c.links.detail,
        icon: GearSix,
        run: settings('collegamenti'),
      },
      {
        id: 'cmd-light',
        group: 'commands',
        label: c.light.label,
        icon: Sun,
        run: () => setPrefs({ theme: 'light' }),
      },
      {
        id: 'cmd-dark',
        group: 'commands',
        label: c.dark.label,
        icon: Moon,
        run: () => setPrefs({ theme: 'dark' }),
      },
      {
        id: 'cmd-system',
        group: 'commands',
        label: c.system.label,
        icon: Sun,
        run: () => setPrefs({ theme: 'system' }),
      },
    ];
    return list;
  }, [halted, message]);
}

/** Notes found by the search of the notes, a moment after the last key (null: not asked). */
function useNoteHits(q: string): Item[] | null {
  const [hits, setHits] = useState<{ q: string; items: Item[] } | null>(null);
  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      vaultApi
        .search({ q, limit: 5 })
        .then((r) => {
          if (!alive) return;
          setHits({
            q,
            items: r.hits.map((h) => ({
              id: `note-${h.path}`,
              group: 'notes',
              label: h.title,
              detail: h.snippet ? snippet(h.snippet, norm(q)) : undefined,
              icon: Notebook,
              run: () => openPage(vaultPath(h.path)),
            })),
          });
        })
        .catch(() => alive && setHits({ q, items: [] }));
    }, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return q.length >= 2 && hits?.q === q ? hits.items : null;
}

/** Messages of the chats that contain the words (newest first, a few). */
function useMessageHits(q: string, agents: readonly AgentView[], lead: string | null): Item[] {
  const events = useApp((s) => s.events);
  return useMemo(() => {
    if (q.length < 2) return [];
    const byId = new Map(agents.map((a) => [a.id, a]));
    const out: Item[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 4; i--) {
      const e = events[i]!;
      if (e.type !== 'message' || e.data.partial || e.data.role === 'system') continue;
      if (!norm(e.data.text).includes(q)) continue;
      const chat = e.data.role === 'user' ? (e.data.to ?? lead) : e.agent;
      const agent = chat ? byId.get(chat) : undefined;
      if (!agent) continue;
      out.push({
        id: `msg-${e.id}`,
        group: 'messages',
        label: snippet(e.data.text, q),
        detail: e.data.role === 'user' ? shellStrings().palette.youTo(agent.name) : agent.name,
        icon: ChatCircleText,
        run: () => openChat(agent.id),
      });
    }
    return out;
  }, [q, events, agents, lead]);
}

function PaletteBody() {
  const s = shellStrings().palette;
  const agents = useAgents();
  const lead = useOrchestrator()?.id ?? null;
  const commands = useCommands();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // A modal layer: Escape closes only the palette, Tab stays inside, the focus goes back to the opener.
  useLayer({ ref: dialog, trap: true, onEscape: closePalette });
  const listId = `${domId(useId())}-list`;
  const q = norm(text.trim());
  const notes = useNoteHits(q);
  const messages = useMessageHits(q, agents, lead);

  const items = useMemo(() => {
    const monsters: Item[] = agents
      .filter((a) => !q || norm(a.name).includes(q) || norm(a.role).includes(q))
      .map((a) => ({
        id: `agent-${a.id}`,
        group: 'monsters',
        label: a.name,
        detail: a.isOrchestrator ? shellStrings().palette.lead : a.role,
        agent: a,
        run: () => openChat(a.id),
      }));
    const cmds = commands.filter(
      (c) => !q || norm(c.label).includes(q) || norm(c.detail ?? '').includes(q),
    );
    return [...monsters, ...(notes ?? []), ...messages, ...cmds];
  }, [agents, commands, notes, messages, q]);

  useEffect(() => input.current?.focus(), []);
  const at = Math.min(active, Math.max(0, items.length - 1));

  const run = (item: Item | undefined) => {
    if (!item) return;
    closePalette();
    item.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (text) setText('');
      else closePalette();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((at + d + items.length) % items.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(items[at]);
    }
  };

  // The row under the arrows stays in sight.
  useEffect(() => {
    document.getElementById(`${listId}-${at}`)?.scrollIntoView({ block: 'nearest' });
  }, [at, listId]);

  const groups: { name: Item['group']; rows: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const g = groups.at(-1);
    if (g && g.name === item.group) g.rows.push({ item, index });
    else groups.push({ name: item.group, rows: [{ item, index }] });
  });
  const searchingNotes = q.length >= 2 && notes === null;

  return (
    <>
      {/* Click away closes; no veil over the instrument (solid colours only). */}
      <div aria-hidden className="fixed inset-0 z-40" onMouseDown={closePalette} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={s.dialog}
        data-testid="palette"
        className="popover drop-in fixed top-[60px] left-1/2 z-40 flex max-h-[min(560px,calc(100dvh-80px))] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px]"
      >
        <div className="p-2">
          <label className="well relative flex h-11 items-center rounded-[10px] focus-within:outline-2 focus-within:outline-signal-ink">
            <span className="sr-only">{s.label}</span>
            <MagnifyingGlass
              size={18}
              aria-hidden
              className="pointer-events-none absolute left-3 text-ink-muted"
            />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={items.length > 0 ? `${listId}-${at}` : undefined}
              aria-autocomplete="list"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={s.placeholder}
              autoComplete="off"
              spellCheck={false}
              data-testid="palette-input"
              className="h-11 w-full rounded-[10px] bg-transparent pr-14 pl-10 text-large text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <KeyCap className="pointer-events-none absolute right-2.5">{s.esc}</KeyCap>
          </label>
        </div>
        <div aria-hidden className="seam-h" />
        <ul
          id={listId}
          role="listbox"
          aria-label={s.results}
          className="scroll-soft min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {groups.map((g) => (
            <li key={g.name} role="presentation" className="pb-1">
              <p role="presentation" className="label px-2.5 pt-2 pb-1 text-ink-muted">
                {s.groups[g.name]}
              </p>
              <ul role="group" aria-label={s.groups[g.name]}>
                {g.rows.map(({ item, index }) => (
                  <Row
                    key={item.id}
                    id={`${listId}-${index}`}
                    item={item}
                    active={index === at}
                    onHover={() => setActive(index)}
                    onRun={() => run(item)}
                  />
                ))}
              </ul>
            </li>
          ))}
          {searchingNotes && (
            <li role="presentation" className="label px-2.5 py-2 text-ink-muted">
              {s.searchingNotes}
            </li>
          )}
          {items.length === 0 && !searchingNotes && (
            <li role="presentation" className="px-2.5 py-4 text-body text-ink-muted">
              {s.nothing(text.trim())}
            </li>
          )}
        </ul>
        <div aria-hidden className="seam-h" />
        <p className="label flex items-center gap-3 px-3.5 py-2 text-ink-muted max-sm:hidden">
          <span>{s.hintChoose}</span>
          <span>{s.hintOpen}</span>
          <span>{s.hintClose}</span>
        </p>
      </div>
    </>
  );
}

function Row({
  id,
  item,
  active,
  onHover,
  onRun,
}: {
  id: string;
  item: Item;
  active: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  const Glyph = item.icon;
  let lead: ReactNode = null;
  if (item.agent)
    lead = <MonsterScreen genome={item.agent.genome} mood="idle" width={40} height={34} pad={2} />;
  else if (Glyph)
    lead = (
      <span className="flex h-[34px] w-10 shrink-0 items-center justify-center text-ink-muted">
        <Glyph size={20} aria-hidden />
      </span>
    );
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      data-testid="palette-item"
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-1',
        active && 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]',
      )}
    >
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{item.label}</span>
        {item.detail && (
          <span className="block truncate text-footnote text-ink-muted">{item.detail}</span>
        )}
      </span>
      {item.keys && <KeyCap className="shrink-0">{item.keys}</KeyCap>}
      {active && !item.keys && <KeyCap className="shrink-0">↵</KeyCap>}
    </li>
  );
}

/** Mounted once by the shell: nothing until it is opened. */
export function CommandPalette() {
  const open = useSyncExternalStore(subscribe, () => isOpen);
  // Another page under it (a link, Back): the palette has done its job. A page
  // that only tidies its own address (a note's name becoming its path) is not one.
  useEffect(() => {
    if (!open) return;
    const at = routeOf(window.location.hash);
    const close = () => {
      if (routeOf(window.location.hash) !== at) closePalette();
    };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [open]);
  return open ? <PaletteBody /> : null;
}
