/*
 * The names of the hash routes, their query keys and the values of those keys, as they show in
 * the address bar. One table of pairs: the English name is what the app writes, the
 * Italian one is what the app wrote until alpha.24 and stays understood forever, because saved
 * links, notifications already delivered, Telegram messages and notes still carry it. The ids
 * inside the code stay the Italian ones (`'squadra'`, `'nuovo'`…, D-153): only this file
 * translates between the two. Pure: no React, no `window`.
 */

export type Route =
  'home' | 'automations' | 'project' | 'log' | 'vault' | 'files' | 'settings' | 'welcome';

/** The path of each route, as the app writes it. */
export const ROUTE_PATHS: Record<Route, string> = {
  home: '/',
  automations: '/automations',
  project: '/project',
  log: '/log',
  vault: '/notes',
  files: '/files',
  settings: '/settings',
  welcome: '/welcome',
};

/** The paths the app wrote before: still understood. */
const OLD_ROUTE_PATHS: Record<string, Route> = {
  '/automazioni': 'automations',
  '/progetto': 'project',
  '/note': 'vault',
  '/file': 'files',
  '/impostazioni': 'settings',
  '/benvenuto': 'welcome',
};

/** Every path that leads to a route, new and old (`''` is the home too). */
const ROUTES: Record<string, Route> = {
  '': 'home',
  ...Object.fromEntries(Object.entries(ROUTE_PATHS).map(([route, path]) => [path, route as Route])),
  ...OLD_ROUTE_PATHS,
};

/** The route a hash (`#/settings?section=models`) leads to; anything unknown is the home. */
export function routeOf(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  return ROUTES[path] ?? 'home';
}

/** The old query keys and the keys that replace them. */
const OLD_KEYS: Readonly<Record<string, string>> = {
  sezione: 'section',
  vista: 'view',
  nota: 'note',
  automazione: 'automation',
  giro: 'run',
  progetto: 'project',
  profilo: 'profile',
};
const NEW_KEY_OF_OLD = new Map(Object.entries(OLD_KEYS));
const OLD_KEY_OF_NEW = new Map(Object.entries(OLD_KEYS).map(([old, now]) => [now, old]));

/** The current name of a query key, given either the old or the current one. */
export function keyOf(name: string): string {
  return NEW_KEY_OF_OLD.get(name) ?? name;
}

/**
 * Values of the keys that name a place, per `<route>.<key>`: `[id in the code, name in the
 * address]`. Several ids may share a name (`accesso` and `account` both open `account`): the first
 * pair of a name is the id that name reads back as. A name that is also an old id (`account`,
 * `telegram`, `chat`) is written twice on purpose: it reads back unchanged.
 */
const VALUES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  // Tabs of the settings and the parts of them a link can point at.
  'settings.section': [
    ['squadra', 'squad'],
    ['modelli', 'models'],
    ['permessi', 'permissions'],
    ['collegamenti', 'apps'],
    ['generale', 'general'],
    ['aspetto', 'appearance'],
    ['account', 'account'],
    ['accesso', 'account'],
    ['telegram', 'telegram'],
    ['avanzate', 'advanced'],
    ['istinto', 'instinct'],
    ['pagella', 'scorecard'],
    ['abbonamenti', 'plans'],
    ['tetto', 'spend-cap'],
    ['limiti', 'limits'],
    ['pausa', 'paused'],
  ],
  // Tabs of a project's page and the parts of its Settings an old tab name points at.
  'project.section': [
    ['chat', 'chat'],
    ['squadra', 'squad'],
    ['note', 'notes'],
    ['automazioni', 'automations'],
    ['impostazioni', 'settings'],
    ['cartella', 'folder'],
    ['collegamenti', 'apps'],
    ['spesa', 'spending'],
    ['archivio', 'archive'],
  ],
  'project.view': [['nuovo', 'new']],
  'automations.view': [
    ['nuova', 'new'],
    ['modifica', 'edit'],
  ],
  'vault.view': [
    ['note', 'notes'],
    ['grafo', 'graph'],
    ['cestino', 'trash'],
    ['nuova', 'new'],
  ],
};

/** The id in the code behind a value of a key (written either way); an unknown value is unchanged. */
export function valueIdOf(route: Route, key: string, value: string): string {
  const pairs = VALUES[`${route}.${keyOf(key)}`];
  if (!pairs) return value;
  return pairs.find(([id, name]) => id === value || name === value)?.[0] ?? value;
}

/** The name written in the address for an id (or an old name) of a key; an unknown value is unchanged. */
export function valueNameOf(route: Route, key: string, value: string): string {
  const pairs = VALUES[`${route}.${keyOf(key)}`];
  if (!pairs) return value;
  const id = valueIdOf(route, key, value);
  return pairs.find(([i]) => i === id)?.[1] ?? value;
}

/** Splits a hash into its route path and query. */
function split(hash: string): { path: string; query: string | null } {
  const body = hash.replace(/^#/, '');
  const at = body.indexOf('?');
  return at < 0
    ? { path: body, query: null }
    : { path: body.slice(0, at), query: body.slice(at + 1) };
}

/**
 * A query parameter of the hash (`#/settings?section=models`), by its current name or by the
 * old one (`sezione`). The value comes back as the id the code uses (`modelli`), whichever way
 * the link wrote it. The current key wins when a link has both.
 */
export function hashParam(hash: string, name: string): string | null {
  const { query } = split(hash);
  if (!query) return null;
  const key = keyOf(name);
  const q = new URLSearchParams(query);
  const old = OLD_KEY_OF_NEW.get(key);
  const raw = q.get(key) ?? (old ? q.get(old) : null);
  return raw === null ? null : valueIdOf(routeOf(hash), key, raw);
}

/**
 * The hash of a route with its parameters, written the current way. `null` and `undefined`
 * leave a key out; values that name a place are written with their English name.
 */
export function hashOf(
  route: Route,
  params: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const q = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    const key = keyOf(name);
    q.set(key, valueNameOf(route, key, value));
  }
  const s = q.toString();
  return `#${ROUTE_PATHS[route]}${s ? `?${s}` : ''}`;
}

/**
 * The same address written the current way: a path, a key and a value from before are
 * replaced with today's, anything the table does not know is left as it is.
 */
export function canonicalHash(hash: string): string {
  if (!hash.startsWith('#/')) return hash;
  const { path, query } = split(hash);
  const route = ROUTES[path];
  if (route === undefined) return hash;
  const canonicalPath = `#${ROUTE_PATHS[route]}`;
  if (query === null) return canonicalPath;
  const q = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(query)) {
    const key = keyOf(name);
    // The current key wins when a link has both.
    if (key !== name && q.has(key)) continue;
    q.set(key, valueNameOf(route, key, value));
  }
  const s = q.toString().replace(/\+/g, '%20');
  return s ? `${canonicalPath}?${s}` : canonicalPath;
}

/** Whether an address is a link to a page of the app that notes and chats may carry (`APP_LINK`). */
export function isAppLinkPath(href: string): boolean {
  if (!href.startsWith('#/') || /\s/.test(href)) return false;
  const route = ROUTES[split(href).path];
  return route === 'settings' || route === 'vault' || route === 'log';
}
