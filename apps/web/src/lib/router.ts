import { useSyncExternalStore } from 'react';
// First to listen to `hashchange`, before any component: see the file.
import './navigation-guard.ts';

/*
 * Hash routes: the core serves a single static page, so `#/log` works without
 * any server-side fallback, also through an SSH tunnel. The names in the address are English
 * (`#/settings?section=models`); the Italian ones of alpha.24 and before still lead to the same
 * place. The table of names and aliases is `route-names.ts`.
 */
import {
  canonicalHash,
  hashOf,
  hashParam,
  ROUTE_PATHS,
  routeOf,
  valueIdOf,
  type Route,
} from './route-names.ts';

export { canonicalHash, hashParam, routeOf };
export type { Route };

export const PATHS: Record<Route, string> = Object.fromEntries(
  Object.entries(ROUTE_PATHS).map(([route, path]) => [route, `#${path}`]),
) as Record<Route, string>;

/**
 * A link from before (`#/impostazioni?sezione=modelli`), opened in this window or typed into the
 * address of a page already open, is rewritten the current way: the bar shows the English names.
 * Nothing depends on it (the readers take both), and `replaceState` makes no event and no history entry.
 */
function writeCurrentNames(): void {
  const now = canonicalHash(window.location.hash);
  if (now !== window.location.hash) window.history.replaceState(window.history.state, '', now);
}

if (typeof window !== 'undefined') {
  writeCurrentNames();
  // After the guard of unsaved forms (it is imported first and may stop the event), before the components.
  window.addEventListener('hashchange', writeCurrentNames);
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeOf(window.location.hash));
}

export function navigate(route: Route): void {
  window.location.hash = PATHS[route];
}

/** A note opened in the Notes page (`#/notes?note=…`), by path or by name: where the chips of the chat lead. */
export function notePath(target: string): string {
  return vaultPath(target);
}

/** The chat with one monster (`#/?chat=rhea`); without it the home shows the list (phone) or the orchestrator. */
export function chatPath(agentId?: string | null): string {
  return agentId ? `${PATHS.home}?chat=${encodeURIComponent(agentId)}` : PATHS.home;
}

/**
 * True while the page on screen was opened from the home with a history entry of
 * its own: on a phone the home is the sidebar, so Back returns to it.
 */
let fromHome = false;

/** Whether the hash is the home of a phone: the sidebar, no chat open. */
function atHome(hash: string): boolean {
  return routeOf(hash) === 'home' && hashParam(hash, 'chat') === null;
}

/**
 * Opens a chat. From the home (no chat open yet, as on a phone) it is a new page,
 * so Back returns to the list; between chats the entry is replaced, like tabs.
 */
export function openChat(agentId: string): void {
  const hash = chatPath(agentId);
  if (hashParam(window.location.hash, 'chat') === null) {
    fromHome = atHome(window.location.hash);
    window.location.hash = hash;
  } else replaceHash(hash);
}

/** Opens a page from the sidebar (Note, Attività, Impostazioni): a new history entry. */
export function openPage(hash: string): void {
  if (window.location.hash === hash) return;
  fromHome = atHome(window.location.hash);
  window.location.hash = hash;
}

/** Back to the sidebar (phone): the previous entry when the page came from it, else in place. */
export function goHome(): void {
  if (fromHome && !atHome(window.location.hash)) {
    fromHome = false;
    window.history.back();
  } else {
    fromHome = false;
    replaceHash(PATHS.home);
  }
}

/** Back to the list of chats (phone). */
export const closeChat = goHome;

/** Views of the Automations page besides the list and the detail of one. */
export type AutomationsMode = 'nuova' | 'modifica';

/**
 * A place in the Automations page (D-094): the list, one automation
 * (`?automation=…`), one of its runs (`&run=…`), the form (`?view=new`,
 * `&view=edit`).
 */
export function automationPath(
  id?: string | null,
  options: { giro?: string | null; mode?: AutomationsMode | null; project?: string | null } = {},
): string {
  return hashOf('automations', {
    automation: id,
    run: options.giro,
    view: options.mode,
    // A new automation from a project's page starts in its squad (D-100).
    project: options.project,
  });
}

/** Tabs of a project's page (D-100), in order (the first is the default). */
export const PROJECT_TABS = ['chat', 'squadra', 'note', 'automazioni', 'impostazioni'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/**
 * Names of the old tabs (Cartella, Collegamenti, Spesa) and of the archive: each opens the
 * project's Settings, scrolled to its part (`project-settings-<part>`).
 */
export const PROJECT_ALIASES = {
  cartella: { tab: 'impostazioni', part: 'cartella' },
  collegamenti: { tab: 'impostazioni', part: 'collegamenti' },
  spesa: { tab: 'impostazioni', part: 'spesa' },
  archivio: { tab: 'impostazioni', part: 'archivio' },
} as const satisfies Record<string, { tab: ProjectTab; part: string }>;

/** A tab, or an old name that opens Settings at one part (`projectPath(id, 'spesa')`). */
export type ProjectPlace = ProjectTab | keyof typeof PROJECT_ALIASES;

function projectAliasOf(param: string | null): { tab: ProjectTab; part: string } | undefined {
  return param && Object.hasOwn(PROJECT_ALIASES, param)
    ? PROJECT_ALIASES[param as keyof typeof PROJECT_ALIASES]
    : undefined;
}

/** The tab named by `?section=…` (or an old name of it); anything else is the chat. */
export function projectTabOf(param: string | null): ProjectTab {
  return PROJECT_TABS.find((t) => t === param) ?? projectAliasOf(param)?.tab ?? PROJECT_TABS[0];
}

/** The part of Settings an old name points to (`?section=spending` → `spesa`); a tab has no part. */
export function projectPartOf(param: string | null): string | null {
  return projectAliasOf(param)?.part ?? null;
}

/**
 * A project's page (`#/project?id=…&section=squad`, D-100), or the form of a
 * new one (`#/project?view=new`). An old tab name keeps working in links
 * (`projectPath(id, 'spesa')`: Settings, at the spending).
 */
export function projectPath(id?: string | null, tab?: ProjectPlace | null): string {
  return id
    ? hashOf('project', { id, section: tab && tab !== PROJECT_TABS[0] ? tab : null })
    : hashOf('project', { view: 'nuovo' });
}

/** Views of the vault page besides the note list. */
export type VaultTab = 'note' | 'grafo' | 'cestino' | 'nuova';

/** A note opened in the vault view (`#/notes?note=…`), optionally on another tab. */
export function vaultPath(note?: string | null, tab?: VaultTab | null): string {
  return hashOf('vault', { note, view: tab && tab !== 'note' ? tab : null }).replace(/\+/g, '%20');
}

/** The notes carrying a tag (`#/notes?tag=…`). */
export function tagPath(tag: string): string {
  return hashOf('vault', { tag });
}

export function useHashParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => hashParam(window.location.hash, name));
}

/** Tabs of the settings page, in the order they are shown (the first is the default). */
export const SETTINGS_TABS = [
  'squadra',
  'modelli',
  'permessi',
  'collegamenti',
  'generale',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * Names of the old tabs (D-052) and of parts, still in links and messages:
 * each opens the tab that holds it now, scrolled to its part when it has one
 * (`#settings-<part>`).
 */
export const SETTINGS_ALIASES: Readonly<Record<string, { tab: SettingsTab; part?: string }>> = {
  aspetto: { tab: 'generale', part: 'aspetto' },
  account: { tab: 'generale', part: 'account' },
  accesso: { tab: 'generale', part: 'account' },
  telegram: { tab: 'collegamenti', part: 'telegram' },
  // Squad → Advanced holds both: the link opens the drawer and scrolls to the one it names.
  avanzate: { tab: 'squadra', part: 'avanzate' },
  istinto: { tab: 'squadra', part: 'istinto' },
  pagella: { tab: 'squadra', part: 'pagella' },
  abbonamenti: { tab: 'modelli' },
  tetto: { tab: 'modelli', part: 'tetto' },
  // The closed row of the limits of each job, under the spending cap: the link opens it.
  limiti: { tab: 'modelli', part: 'limiti' },
  pausa: { tab: 'collegamenti', part: 'pausa' },
};

function aliasOf(param: string | null) {
  return param && Object.hasOwn(SETTINGS_ALIASES, param) ? SETTINGS_ALIASES[param] : undefined;
}

/** The settings tab named by `?section=…` (or an old name of it); anything else is the first tab. */
export function settingsTabOf(param: string | null): SettingsTab {
  return SETTINGS_TABS.find((t) => t === param) ?? aliasOf(param)?.tab ?? SETTINGS_TABS[0];
}

/** The part of a tab an old name points to (`?section=instinct` → `istinto`, a tab has no part). */
export function settingsPartOf(param: string | null): string | null {
  return aliasOf(param)?.part ?? null;
}

/**
 * Settings opened on one tab (`#/settings?section=permissions`; a `SettingsTab`), or on a part of
 * one by its id (`settingsPath('istinto')`, `'tetto'`, `'pausa'`: see `SETTINGS_ALIASES`): links from
 * elsewhere use it, never a hand-written `?section=`.
 */
export function settingsPath(place?: string | null): string {
  const id = place ? valueIdOf('settings', 'section', place) : null;
  return hashOf('settings', { section: id && id !== SETTINGS_TABS[0] ? id : null });
}

/** Settings → Modelli → Tetto di spesa (D-070): "Alza il tetto" in the chat and the toasts. */
export const SPEND_CAP_PATH = settingsPath('tetto');
/** Settings → Collegamenti → Strumenti in pausa (D-070). */
export const MCP_PAUSED_PATH = settingsPath('pausa');
/** Settings → Collegamenti, where "Collega" is: a service asks to sign in again. */
export const MCP_SIGN_IN_PATH = settingsPath('collegamenti');

/**
 * Moves to another hash without a new history entry (switching tabs is not a
 * page of its own: Back leaves the page). `replaceState` fires no
 * `hashchange`, so the hooks above are told by hand.
 */
export function replaceHash(hash: string): void {
  if (window.location.hash === hash) return;
  window.history.replaceState(window.history.state, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
