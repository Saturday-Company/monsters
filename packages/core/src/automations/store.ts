import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutomationSchema, type Automation } from '@monsters/shared';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { chmodSafe } from '../config.ts';

/*
 * The definitions of the automations (D-094): one YAML file each in
 * `<home>/automations/<id>.yaml`, like the agents, checked with the shared
 * schema when read. Written whole to a temporary file and renamed, so a
 * crash never leaves half a file. A file that does not pass the schema is
 * left where it is and reported (it is not lost, it does not run).
 */

export const AUTOMATIONS_DIR = 'automations';
const SUFFIX = '.yaml';

export interface AutomationFileError {
  file: string;
  message: string;
}

export class AutomationStore {
  readonly dir: string;
  readonly #items = new Map<string, Automation>();

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Reads every file again. Returns the files that could not be used. */
  load(): AutomationFileError[] {
    this.#items.clear();
    const errors: AutomationFileError[] = [];
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith(SUFFIX));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    for (const name of names.sort()) {
      const file = join(this.dir, name);
      try {
        const parsed = AutomationSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
        if (!parsed.success) {
          const why = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          errors.push({ file, message: why.join('; ') });
          continue;
        }
        if (`${parsed.data.id}${SUFFIX}` !== name) {
          errors.push({ file, message: `the id "${parsed.data.id}" is not the file's name` });
          continue;
        }
        this.#items.set(parsed.data.id, parsed.data);
      } catch (err) {
        errors.push({ file, message: (err as Error).message });
      }
    }
    return errors;
  }

  list(): Automation[] {
    return [...this.#items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Automation | undefined {
    return this.#items.get(id);
  }

  has(id: string): boolean {
    return this.#items.has(id);
  }

  save(automation: Automation): Automation {
    const valid = AutomationSchema.parse(automation);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSafe(this.dir, 0o700);
    const file = join(this.dir, `${valid.id}${SUFFIX}`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, stringifyYaml(valid), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
    this.#items.set(valid.id, valid);
    return valid;
  }

  remove(id: string): boolean {
    if (!this.#items.delete(id)) return false;
    rmSync(join(this.dir, `${id}${SUFFIX}`), { force: true });
    return true;
  }
}

/** A free id from a name: "Post della settimana" → "post-della-settimana", then "-2", "-3"… */
export function automationIdFor(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'automazione';
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken(id)) return id;
  }
}
