import type { AgentSummary } from '@monsters/shared';
import type { MonsterGenome } from '@monsters/monster-kit';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { genomeOf } from '../lib/monsters.ts';
import type { ConnectionState } from '../lib/stream.ts';
import type { ThemeName } from '../theme/tokens.ts';
import { useApp } from './app.ts';
import { ASKED_ACTIVITY, CONFUSED_TEXT, DONE_MS, makeNameOf, type LiveState } from './derive.ts';
import { usePrefs } from './prefs.ts';

export interface AgentView extends AgentSummary {
  genome: MonsterGenome;
}

const genomeCache = new WeakMap<AgentSummary, MonsterGenome>();

function view(a: AgentSummary): AgentView {
  let g = genomeCache.get(a);
  if (!g) {
    g = genomeOf(a);
    genomeCache.set(a, g);
  }
  return { ...a, genome: g };
}

export function useAgents(): AgentView[] {
  const agents = useApp((s) => s.agents);
  const order = useApp((s) => s.agentOrder);
  return useMemo(
    () => order.flatMap((id) => (agents[id] ? [view(agents[id])] : [])),
    [agents, order],
  );
}

export function useAgent(id: string | null | undefined): AgentView | null {
  const a = useApp((s) => (id ? s.agents[id] : undefined));
  return useMemo(() => (a ? view(a) : null), [a]);
}

export function useOrchestrator(): AgentView | null {
  const agents = useAgents();
  return agents.find((a) => a.isOrchestrator) ?? agents[0] ?? null;
}

export function useNameOf() {
  const agents = useApp((s) => s.agents);
  return useMemo(() => makeNameOf(agents), [agents]);
}

/**
 * Live state of an agent, with `done` turning back into `idle` after a moment
 * (the happy face is a short celebration, not a permanent state).
 */
export function useLive(id: string): LiveState {
  const live = useApp((s) => s.live[id]);
  const halted = useApp((s) => s.halted);
  const [expired, setExpired] = useState<number | null>(null);
  const since = live?.since ?? 0;
  const isDone = live?.mood === 'done';
  useEffect(() => {
    if (!isDone) return;
    const left = Math.max(0, DONE_MS - (Date.now() - since));
    const t = setTimeout(() => setExpired(since), left + 30);
    return () => clearTimeout(t);
  }, [isDone, since]);
  if (halted) return { mood: 'stopped', since };
  if (!live) return { mood: 'idle', since: 0 };
  if (live.mood === 'done' && expired === since) return { mood: 'idle', since };
  return live;
}

/** Neutral forms: they read well whatever the monster's name and gender. */
const MOOD_TEXT: Record<LiveState['mood'], string> = {
  idle: 'disponibile',
  working: 'al lavoro',
  talking: 'sta scrivendo',
  waiting: 'in attesa',
  done: 'ha finito',
  error: 'ha un problema',
  stopped: 'in pausa',
};

export function moodText(mood: LiveState['mood']): string {
  return MOOD_TEXT[mood];
}

/** True when the monster waits for the user's answer to its question (see `applyLive`). */
export function waitsForUser(live: LiveState): boolean {
  return live.mood === 'waiting' && live.activity === ASKED_ACTIVITY;
}

/** The state of a monster in a few words: "al lavoro: Cerco “Lisbona”", "aspetta una tua risposta". */
export function statusText(live: LiveState): string {
  if (waitsForUser(live)) return 'aspetta una tua risposta';
  const busy = live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting';
  if (busy && live.confused) return CONFUSED_TEXT;
  return busy && live.activity ? `${MOOD_TEXT[live.mood]}: ${live.activity}` : MOOD_TEXT[live.mood];
}

function subscribeDark(cb: () => void) {
  const q = window.matchMedia('(prefers-color-scheme: dark)');
  q.addEventListener('change', cb);
  return () => q.removeEventListener('change', cb);
}

/**
 * The state of the link to the core for the places that show it: a stream that keeps failing
 * (3 attempts or 10 s) reads as `closed`, "non collegato", everywhere at once.
 */
export function useConnection(): ConnectionState {
  return useApp((s) => (s.linkLost && s.connection === 'reconnecting' ? 'closed' : s.connection));
}

export function useResolvedTheme(): ThemeName {
  const choice = usePrefs((p) => p.theme);
  const systemDark = useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia(query);
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

function subscribeMotion(cb: () => void) {
  const q = window.matchMedia('(prefers-reduced-motion: reduce)');
  q.addEventListener('change', cb);
  return () => q.removeEventListener('change', cb);
}

export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
}
