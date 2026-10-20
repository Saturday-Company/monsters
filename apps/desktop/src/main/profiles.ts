import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { ConnectionProfileSchema, sshAliasFor, type ConnectionProfile } from '@monsters/remote';
import type { ThemeChoice } from './app-theme.ts';
import { readTextFile } from './home.ts';

/*
 * Connection profiles of the client mode (M3.3, D-047): the remote cores the app can use
 * through an SSH tunnel, plus the last choice ("Questo computer" or a profile). Stored in the
 * app's user data folder (`connections.json`, mode 600): no secrets in it, only where to
 * connect (SSH keys stay in ~/.ssh or in the agent; passwords are not supported), and the
 * theme chosen in the web UI's Settings when it is not "Sistema" (app-theme.ts, D-091).
 * The form of the connections page sends strings; `parseProfileForm` turns them into a
 * profile with Italian messages per field. Pure Node, no Electron.
 */

/** "Questo computer": the local core (attached or started by the app). */
export const LOCAL_CHOICE = 'local';
/** `local` or the id of a profile. */
export type TargetChoice = string;

export interface StoredProfile extends ConnectionProfile {
  id: string;
  /**
   * Automatic login: the app reads the remote CLI token over SSH, mints a single-use login
   * token through the tunnel and exchanges it for the session cookie (D-047). On by default for
   * new profiles (decided 15/10/2026); off: email and password once per device.
   */
  autoLogin: boolean;
}

export interface ConnectionsFile {
  version: 1;
  profiles: StoredProfile[];
  last: TargetChoice;
  /** The theme of the Settings; absent: "Sistema". Older apps ignore it. */
  theme?: 'light' | 'dark';
}

export const PROFILE_FIELDS = [
  'name',
  'host',
  'user',
  'sshPort',
  'identityFile',
  'remotePort',
  'remoteHome',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** What the connections page sends: strings as typed, plus the checkbox. */
export interface ProfileForm {
  id?: string;
  name?: string;
  host?: string;
  user?: string;
  sshPort?: string;
  identityFile?: string;
  remotePort?: string;
  remoteHome?: string;
  autoLogin?: boolean;
}

export type FormResult =
  | { ok: true; profile: Omit<StoredProfile, 'id'> }
  | { ok: false; errors: Partial<Record<ProfileField, string>> };

const MESSAGES: Record<ProfileField, string> = {
  name: 'Il nome può avere al massimo 80 caratteri.',
  host: 'Scrivi l’indirizzo dell’altro computer, per esempio 192.168.1.20 o pc-casa.local: senza spazi e senza "-" all’inizio.',
  user: 'Il nome utente non può contenere spazi né iniziare con "-".',
  sshPort: 'La porta è un numero tra 1 e 65535 (di solito 22).',
  identityFile: 'Il percorso della chiave è troppo lungo.',
  remotePort: 'La porta di Monsters è un numero tra 1 e 65535 (di solito 4747).',
  remoteHome: 'La cartella non può contenere virgolette, $ o \\.',
};

/** The host field holds what looks like the name of the connection, not an address. */
export const HOST_LOOKS_LIKE_NAME =
  'Questo sembra il nome della connessione. Qui serve l’indirizzo dell’altro computer, per esempio 192.168.1.20 o pc-casa.local.';

/** Another profile already has this name: the "Usa" menu would be ambiguous. */
export const DUPLICATE_NAME = 'C’è già una connessione con questo nome: scegline un altro.';

/**
 * A warning for the host field while the user types (shown, never blocking): spaces, or the
 * same text as the name ("Casa" in both fields). An alias of ~/.ssh/config may legitimately
 * equal the name, so this only warns; the check at save time (connection-check.ts) asks ssh
 * and the DNS.
 */
export function hostWarning(host: string, name: string): string | null {
  const h = host.trim();
  if (h === '') return null;
  if (/\s/.test(h)) return HOST_LOOKS_LIKE_NAME;
  const n = name.trim();
  if (n !== '' && h.toLowerCase() === n.toLowerCase() && !looksLikeAddress(h)) {
    return HOST_LOOKS_LIKE_NAME;
  }
  return null;
}

/** An IP address, or a name with a dot (pc-casa.local, casa.tailnet.ts.net). */
export function looksLikeAddress(host: string): boolean {
  return host.includes('.') || host.includes(':') || host.toLowerCase() === 'localhost';
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** `"" → undefined`, digits → number, anything else → NaN (refused by the schema). */
function port(v: unknown): number | undefined {
  const s = text(v);
  if (s === '') return undefined;
  return /^\d{1,5}$/.test(s) ? Number(s) : Number.NaN;
}

/**
 * Validates the form of the connections page. `utente@computer` in the host field is split
 * (the user field wins when both are given). The name is optional: empty, it is the address.
 * Automatic login is on unless the form turns it off.
 */
export function parseProfileForm(form: unknown): FormResult {
  const f = (typeof form === 'object' && form !== null ? form : {}) as ProfileForm;
  let host = text(f.host);
  let user = text(f.user);
  const at = host.lastIndexOf('@');
  if (at > 0) {
    if (user === '') user = host.slice(0, at);
    host = host.slice(at + 1);
  }
  const candidate = {
    name: text(f.name) || host,
    host,
    ...(user ? { user } : {}),
    ...(port(f.sshPort) !== undefined ? { sshPort: port(f.sshPort) } : {}),
    ...(text(f.identityFile) ? { identityFile: text(f.identityFile) } : {}),
    ...(port(f.remotePort) !== undefined ? { remotePort: port(f.remotePort) } : {}),
    ...(text(f.remoteHome) ? { remoteHome: text(f.remoteHome) } : {}),
  };
  const parsed = ConnectionProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors: Partial<Record<ProfileField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && (PROFILE_FIELDS as readonly string[]).includes(field)) {
        errors[field as ProfileField] ??= MESSAGES[field as ProfileField];
      }
    }
    if (Object.keys(errors).length === 0) errors.host = MESSAGES.host;
    // Spaces in the host: most likely the name of the connection typed in the wrong field.
    if (errors.host && /\s/.test(host)) errors.host = HOST_LOOKS_LIKE_NAME;
    // An empty name takes the host: its error belongs to the host field.
    if (errors.name && text(f.name) === '') delete errors.name;
    return { ok: false, errors };
  }
  return { ok: true, profile: { ...parsed.data, autoLogin: f.autoLogin !== false } };
}

/**
 * The form with the alias of the user's SSH config when the address typed is that alias's
 * HostName and the form has no user or key of its own (D-090): "Entra senza password" means
 * the user's own SSH access, and with the bare address ssh would log in with the local user
 * name (`bob` on the laptop instead of the `alice` of `Host my-desktop`).
 */
export function withSshAlias(form: unknown, sshConfig: string | null): unknown {
  if (sshConfig === null || typeof form !== 'object' || form === null) return form;
  const f = form as ProfileForm;
  const host = text(f.host);
  if (host === '' || host.includes('@') || text(f.user) !== '' || text(f.identityFile) !== '') {
    return form;
  }
  const alias = sshAliasFor(host, sshConfig);
  return alias ? { ...f, host: alias } : form;
}

const ID = /^[a-z0-9-]{8,64}$/;

/** A stored profile, or null when the entry is broken (dropped on load). */
function storedProfile(value: unknown): StoredProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, autoLogin, ...rest } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  const parsed = ConnectionProfileSchema.safeParse(rest);
  return parsed.success ? { ...parsed.data, id, autoLogin: autoLogin === true } : null;
}

/**
 * How a `connections.json` read: `damaged` when it does not parse or some of it was dropped
 * (kept aside before it is rewritten), `newer` when a newer app wrote it (never rewritten here:
 * its fields would be lost).
 */
export type ConnectionsFileState = 'missing' | 'ok' | 'damaged' | 'newer';

export function readConnectionsFile(raw: string | null): {
  data: ConnectionsFile;
  state: ConnectionsFileState;
} {
  const empty: ConnectionsFile = { version: 1, profiles: [], last: LOCAL_CHOICE };
  if (!raw) return { data: empty, state: 'missing' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { data: empty, state: 'damaged' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { data: empty, state: 'damaged' };
  }
  const d = data as { version?: unknown; profiles?: unknown; last?: unknown; theme?: unknown };
  const newer = typeof d.version === 'number' && d.version > 1;
  let dropped = !Array.isArray(d.profiles);
  const profiles: StoredProfile[] = [];
  for (const p of Array.isArray(d.profiles) ? d.profiles : []) {
    const ok = storedProfile(p);
    if (ok && !profiles.some((q) => q.id === ok.id)) profiles.push(ok);
    else dropped = true;
  }
  const last =
    typeof d.last === 'string' && profiles.some((p) => p.id === d.last) ? d.last : LOCAL_CHOICE;
  // Any other theme (none, "system", something unknown) is "Sistema": never a reason to
  // call the file damaged.
  const theme = d.theme === 'light' || d.theme === 'dark' ? d.theme : null;
  return {
    data: { version: 1, profiles, last, ...(theme ? { theme } : {}) },
    state: newer ? 'newer' : dropped ? 'damaged' : 'ok',
  };
}

export function parseConnectionsFile(raw: string | null): ConnectionsFile {
  return readConnectionsFile(raw).data;
}

/** `<file>.corrupt-<YYYYMMDD-HHMMSS>`: where a damaged file is kept. */
export function corruptCopyPath(path: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${path}.corrupt-${stamp}`;
}

/** Shown when a newer app wrote the profiles: they are used, never rewritten. */
export const NEWER_FILE_MESSAGE =
  'Le connessioni sono state salvate da una versione più recente di Monsters: aggiorna l’app per modificarle.';

/** `utente@computer:porta` as shown in lists. */
export function profileAddress(p: ConnectionProfile): string {
  return `${p.user ? `${p.user}@` : ''}${p.host}${p.sshPort ? `:${p.sshPort}` : ''}`;
}

export class ProfileStore {
  readonly #path: string;
  readonly #newId: () => string;
  readonly #log: (line: string) => void;
  #data: ConnectionsFile;
  /** The file on disk differs from what it should hold (missing, damaged). */
  #stale = false;
  /** Written in this run (a first start creates the file with the first choice). */
  #written = false;
  /** Written by a newer app: read only. */
  readonly readOnly: boolean;
  /**
   * No connections.json yet: the app has never been told where the monsters work. The first
   * start asks (audit UX 1.2) and the file is written by the first choice (`setLast`).
   */
  readonly firstStart: boolean;

  constructor(
    path: string,
    opts: { newId?: () => string; log?: (line: string) => void; now?: () => Date } = {},
  ) {
    this.#path = path;
    this.#newId = opts.newId ?? (() => randomUUID());
    this.#log = opts.log ?? (() => {});
    const raw = readTextFile(path);
    const { data, state } = readConnectionsFile(raw);
    this.#data = data;
    let readOnly = state === 'newer';
    if (state === 'newer') {
      this.#log('connections.json: written by a newer version of the app, read only');
    } else if (state === 'damaged' && raw !== null) {
      // Kept aside before the next write replaces it (a crash, a sync tool, a disk error…).
      const copy = corruptCopyPath(path, (opts.now ?? (() => new Date()))());
      try {
        writeFileSync(copy, raw, { mode: 0o600, flag: 'wx' });
        this.#log(`connections.json: damaged, kept as ${copy}`);
      } catch (err) {
        // No copy, no rewrite: the file stays as it is.
        readOnly = true;
        this.#log(`connections.json: damaged, cannot keep a copy: ${(err as Error).message}`);
      }
    }
    this.readOnly = readOnly;
    this.firstStart = state === 'missing';
    this.#stale = state !== 'ok';
  }

  list(): StoredProfile[] {
    return this.#data.profiles.map((p) => ({ ...p }));
  }

  get(id: string): StoredProfile | null {
    const p = this.#data.profiles.find((q) => q.id === id);
    return p ? { ...p } : null;
  }

  /** The last target chosen (what the app opens at start). */
  get last(): TargetChoice {
    return this.#data.last;
  }

  setLast(choice: TargetChoice): void {
    const valid = choice === LOCAL_CHOICE || this.#data.profiles.some((p) => p.id === choice);
    const last = valid ? choice : LOCAL_CHOICE;
    // Not rewritten at every start when nothing changed.
    if (last === this.#data.last && !this.#stale) return;
    this.#data.last = last;
    this.#write();
  }

  /** The theme of the web UI's Settings (D-091), applied at start. */
  get theme(): ThemeChoice {
    return this.#data.theme ?? 'system';
  }

  setTheme(choice: ThemeChoice): void {
    const next = choice === 'light' || choice === 'dark' ? choice : undefined;
    if (next === this.#data.theme) return;
    if (next) this.#data.theme = next;
    else delete this.#data.theme;
    // No connections.json yet: the file is what says the first start is over, so the theme
    // waits in memory for the first choice to write it.
    if (this.firstStart && !this.#written) return;
    this.#write();
  }

  /** Adds (no id) or replaces (id of an existing profile) a profile from the form. */
  save(form: unknown): { ok: true; profile: StoredProfile } | Extract<FormResult, { ok: false }> {
    if (this.readOnly) return { ok: false, errors: { name: NEWER_FILE_MESSAGE } };
    const result = parseProfileForm(form);
    if (!result.ok) return result;
    const id = (form as ProfileForm).id;
    const index = typeof id === 'string' ? this.#data.profiles.findIndex((p) => p.id === id) : -1;
    const sameName = (n: string) => n.trim().toLowerCase() === result.profile.name.toLowerCase();
    if (this.#data.profiles.some((p, i) => i !== index && sameName(p.name))) {
      return {
        ok: false,
        errors: { [text((form as ProfileForm).name) ? 'name' : 'host']: DUPLICATE_NAME },
      };
    }
    const profile: StoredProfile = {
      ...result.profile,
      id: index >= 0 ? this.#data.profiles[index]!.id : this.#newId(),
    };
    if (index >= 0) this.#data.profiles[index] = profile;
    else this.#data.profiles.push(profile);
    this.#write();
    return { ok: true, profile: { ...profile } };
  }

  remove(id: string): boolean {
    if (this.readOnly) return false;
    const before = this.#data.profiles.length;
    this.#data.profiles = this.#data.profiles.filter((p) => p.id !== id);
    if (this.#data.profiles.length === before) return false;
    if (this.#data.last === id) this.#data.last = LOCAL_CHOICE;
    this.#write();
    return true;
  }

  #write(): void {
    // A file of a newer app (or a damaged one that could not be kept aside) is never replaced:
    // the last choice lives in memory only.
    if (this.readOnly) return;
    this.#stale = false;
    this.#written = true;
    // Write and rename: a crash never leaves half a file.
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.#data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
