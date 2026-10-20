import { useSyncExternalStore } from 'react';

/*
 * Hash routes: the core serves a single static page, so `#/log` works without
 * any server-side fallback, also through an SSH tunnel.
 */
export type Route =
  'home' | 'automations' | 'project' | 'log' | 'vault' | 'files' | 'settings' | 'welcome';

const ROUTES: Record<string, Route> = {
  '': 'home',
  '/': 'home',
  '/log': 'log',
  '/automazioni': 'automations',
  '/progetto': 'project',
  '/note': 'vault',
  '/file': 'files',
  '/impostazioni': 'settings',
  '/benvenuto': 'welcome',
};

export const PATHS: Record<Route, string> = {
  home: '#/',
  automations: '#/automazioni',
  project: '#/progetto',
  log: '#/log',
  vault: '#/note',
  files: '#/file',
  settings: '#/impostazioni',
  welcome: '#/benvenuto',
};

export function routeOf(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  return ROUTES[path] ?? 'home';
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

/** A note opened in the Note page (`#/note?nota=…`), by path or by name: where the chips of the chat lead. */
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

/** Views of the Automazioni page besides the list and the detail of one. */
export type AutomationsMode = 'nuova' | 'modifica';

/**
 * A place in the Automazioni page (D-094): the list, one automation
 * (`?automazione=…`), one of its runs (`&giro=…`), the form (`?vista=nuova`,
 * `&vista=modifica`).
 */
export function automationPath(
  id?: string | null,
  options: { giro?: string | null; mode?: AutomationsMode | null; project?: string | null } = {},
): string {
  const q = new URLSearchParams();
  if (id) q.set('automazione', id);
  if (options.giro) q.set('giro', options.giro);
  if (options.mode) q.set('vista', options.mode);
  // A new automation from a project's page starts in its squad (D-100).
  if (options.project) q.set('progetto', options.project);
  const s = q.toString();
  return s ? `${PATHS.automations}?${s}` : PATHS.automations;
}

/** Sections of a project's page (D-100), in the order of its tabs (the first is the default). */
export const PROJECT_TABS = [
  'chat',
  'squadra',
  'note',
  'cartella',
  'collegamenti',
  'automazioni',
  'spesa',
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** The tab named by `?sezione=…`; anything else is the chat. */
export function projectTabOf(param: string | null): ProjectTab {
  return PROJECT_TABS.find((t) => t === param) ?? PROJECT_TABS[0];
}

/**
 * A project's page (`#/progetto?id=…&sezione=squadra`, D-100), or the form of a
 * new one (`#/progetto?vista=nuovo`).
 */
export function projectPath(id?: string | null, tab?: ProjectTab | null): string {
  const q = new URLSearchParams();
  if (id) q.set('id', id);
  else q.set('vista', 'nuovo');
  if (id && tab && tab !== PROJECT_TABS[0]) q.set('sezione', tab);
  return `${PATHS.project}?${q.toString()}`;
}

/** Views of the vault page besides the note list. */
export type VaultTab = 'note' | 'grafo' | 'cestino' | 'nuova';

/** A note opened in the vault view (`#/note?nota=…`), optionally on another tab. */
export function vaultPath(note?: string | null, tab?: VaultTab | null): string {
  const q = new URLSearchParams();
  if (note) q.set('nota', note);
  if (tab && tab !== 'note') q.set('vista', tab);
  const s = q.toString().replace(/\+/g, '%20');
  return s ? `${PATHS.vault}?${s}` : PATHS.vault;
}

/** A query parameter of the hash route (`#/log?nota=…`). */
export function hashParam(hash: string, name: string): string | null {
  const q = hash.replace(/^#/, '').split('?')[1];
  return q ? new URLSearchParams(q).get(name) : null;
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
  istinto: { tab: 'squadra', part: 'istinto' },
  pagella: { tab: 'squadra', part: 'pagella' },
  abbonamenti: { tab: 'modelli' },
  tetto: { tab: 'modelli', part: 'tetto' },
  pausa: { tab: 'collegamenti', part: 'pausa' },
};

/** Settings → Modelli → Tetto di spesa (D-070): "Alza il tetto" in the chat and the toasts. */
export const SPEND_CAP_PATH = `${PATHS.settings}?sezione=tetto`;
/** Settings → Collegamenti → Strumenti in pausa (D-070). */
export const MCP_PAUSED_PATH = `${PATHS.settings}?sezione=pausa`;
/** Settings → Collegamenti, where "Collega" is: a service asks to sign in again. */
export const MCP_SIGN_IN_PATH = `${PATHS.settings}?sezione=collegamenti`;

function aliasOf(param: string | null) {
  return param && Object.hasOwn(SETTINGS_ALIASES, param) ? SETTINGS_ALIASES[param] : undefined;
}

/** The settings tab named by `?sezione=…` (or an old name of it); anything else is the first tab. */
export function settingsTabOf(param: string | null): SettingsTab {
  return SETTINGS_TABS.find((t) => t === param) ?? aliasOf(param)?.tab ?? SETTINGS_TABS[0];
}

/** The part of a tab an old tab name points to (`?sezione=collegamenti` → `collegamenti`). */
export function settingsPartOf(param: string | null): string | null {
  return aliasOf(param)?.part ?? null;
}

/** Settings opened on one tab (`#/impostazioni?sezione=permessi`): links from elsewhere use it. */
export function settingsPath(tab?: SettingsTab | null): string {
  return tab && tab !== SETTINGS_TABS[0] ? `${PATHS.settings}?sezione=${tab}` : PATHS.settings;
}

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
