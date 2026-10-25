import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectSchema, type Project } from '@monsters/shared';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { chmodSafe } from '../config.ts';

/*
 * The projects (D-097): `<home>/projects/<id>/project.yaml`, read with the
 * shared schema, written whole to a temporary file and renamed (as the
 * automations). A file that does not pass the schema stays where it is and is
 * reported: the project is not lost, its monsters work as the Squadra
 * personale's until it is fixed. A folder per project leaves room for what a
 * project may keep later (its own notes of the core, a picture).
 */

export const PROJECTS_DIR = 'projects';
export const PROJECT_YAML = 'project.yaml';

export interface ProjectFileError {
  file: string;
  message: string;
}

/** A project file that still has the allow-list `connections` of before D-164 (dropped, C-8). */
export interface LegacyConnections {
  id: string;
  name: string;
  /** What the old list allowed: names of MCP servers and ids of services through Claude. */
  allowed: string[];
}

export class ProjectStore {
  readonly dir: string;
  readonly #items = new Map<string, Project>();
  #legacy: LegacyConnections[] = [];

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Reads every project again. Returns the files that could not be used. */
  load(): ProjectFileError[] {
    this.#items.clear();
    this.#legacy = [];
    const errors: ProjectFileError[] = [];
    let names: string[];
    try {
      names = readdirSync(this.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    for (const name of names.sort()) {
      const file = join(this.dir, name, PROJECT_YAML);
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        errors.push({ file, message: (err as Error).message });
        continue;
      }
      try {
        const raw: unknown = parseYaml(text);
        const parsed = ProjectSchema.safeParse(raw);
        if (!parsed.success) {
          const why = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          errors.push({ file, message: why.join('; ') });
          continue;
        }
        if (parsed.data.id !== name) {
          errors.push({ file, message: `the id "${parsed.data.id}" is not the folder's name` });
          continue;
        }
        this.#items.set(parsed.data.id, parsed.data);
        const old = legacyAllowList(raw);
        if (old) this.#legacy.push({ id: parsed.data.id, name: parsed.data.name, allowed: old });
      } catch (err) {
        errors.push({ file, message: (err as Error).message });
      }
    }
    return errors;
  }

  /**
   * The projects whose file still has the old `connections` allow-list, found by the last
   * `load`; read once (the next save drops the key, D-164).
   */
  takeLegacyConnections(): LegacyConnections[] {
    const out = this.#legacy;
    this.#legacy = [];
    return out;
  }

  /** Every project, oldest first. */
  list(): Project[] {
    return [...this.#items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Project | undefined {
    return this.#items.get(id);
  }

  has(id: string): boolean {
    return this.#items.has(id) || existsDir(join(this.dir, id));
  }

  save(project: Project): Project {
    const valid = ProjectSchema.parse(project);
    const folder = join(this.dir, valid.id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSafe(this.dir, 0o700);
    const file = join(folder, PROJECT_YAML);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, stringifyYaml(valid), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
    this.#items.set(valid.id, valid);
    return valid;
  }
}

/** The names in the `connections` allow-list of a file of before D-164, or null when it has none. */
function legacyAllowList(raw: unknown): string[] | null {
  if (typeof raw !== 'object' || raw === null || !('connections' in raw)) return null;
  const c = raw.connections;
  if (typeof c !== 'object' || c === null) return [];
  const names = Object.values(c).flatMap((v) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
  );
  return [...new Set(names)];
}

function existsDir(path: string): boolean {
  try {
    return readdirSync(path) !== undefined;
  } catch {
    return false;
  }
}

/** A free id from a name: "Social di Saturday" → "social-di-saturday", then "-2", "-3"… */
export function projectIdFor(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'progetto';
  const base = /^[a-z]/.test(slug) ? slug : `p-${slug}`.slice(0, 40);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken(id)) return id;
  }
}
