import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.ts';
import { AutomationUpdateSchema, ProjectUpdateRequestSchema } from '../src/index.ts';

/**
 * Guard for a class of data bug (D-209): a request that changes some fields of a stored record must
 * not carry defaults. zod 4 keeps `.default()` under `.partial()` and `.optional()`, so
 * `ProjectConnectionsSchema.partial()` turned `{ mcp: ['a'] }` into `{ mcp: ['a'], claude: [] }`, and
 * the service, which merges by key, wiped the list that was not sent.
 *
 * Every export of the package whose name has `Update` or `Patch` in it is an update schema. A new
 * one is checked without touching this file; to fix a failure, use a schema with `.optional()`
 * fields and no `.default()` (see `ProjectConnectionsPatchSchema`).
 */

type Def = { type: string; [key: string]: unknown };
type Node = { _zod?: { def?: Def } };

/** Paths of every `.default()` / `.prefault()` reachable from a schema. */
function defaultsIn(schema: unknown, path: string, out: string[] = []): string[] {
  const def = (schema as Node | undefined)?._zod?.def;
  if (!def) return out;
  const walk = (child: unknown, suffix = '') => defaultsIn(child, path + suffix, out);
  switch (def.type) {
    case 'default':
    case 'prefault':
      out.push(path);
      walk(def.innerType);
      break;
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      walk(def.innerType);
      break;
    case 'object':
      for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
        defaultsIn(child, `${path}.${key}`, out);
      }
      break;
    case 'array':
      walk(def.element, '[]');
      break;
    case 'record':
      walk(def.valueType, '{}');
      break;
    case 'union':
      for (const option of def.options as unknown[]) walk(option);
      break;
    case 'intersection':
      walk(def.left);
      walk(def.right);
      break;
    case 'pipe':
      walk(def.in);
      walk(def.out);
      break;
    case 'tuple':
      for (const item of def.items as unknown[]) walk(item, '[]');
      break;
    default:
  }
  return out;
}

const updateSchemas = Object.entries(shared).filter(
  ([name, value]) => /Update|Patch/.test(name) && (value as Node)?._zod?.def !== undefined,
);

describe('update schemas carry no defaults (D-209)', () => {
  it('finds the update schemas of the package', () => {
    const names = updateSchemas.map(([name]) => name);
    // A floor, so that a rename of the convention cannot make this guard silently check nothing.
    for (const known of [
      'ProjectUpdateRequestSchema',
      'ProjectConnectionsPatchSchema',
      'AutomationUpdateSchema',
      'AutomationNotifyPatchSchema',
      'TeamMemberUpdateSchema',
      'TelegramPrefsUpdateSchema',
      'SpendUpdateSchema',
    ]) {
      expect(names).toContain(known);
    }
  });

  it.each(updateSchemas)('%s has no .default() at any depth', (name, schema) => {
    expect(defaultsIn(schema, name)).toEqual([]);
  });

  it('the guard sees a default under .partial() (the mistake it is for)', () => {
    const Connections = shared.ProjectConnectionsSchema;
    const broken = Connections.partial();
    expect(defaultsIn(broken, 'Broken')).toEqual(['Broken.mcp', 'Broken.claude']);
    expect(broken.parse({ mcp: ['a'] })).toEqual({ mcp: ['a'], claude: [] });
  });

  it('a partial update parses to exactly what was sent', () => {
    expect(ProjectUpdateRequestSchema.parse({ connectionsOff: { mcp: ['a'] } })).toEqual({
      connectionsOff: { mcp: ['a'] },
    });
    expect(ProjectUpdateRequestSchema.parse({ connectionsOff: { claude: ['b'] } })).toEqual({
      connectionsOff: { claude: ['b'] },
    });
    expect(AutomationUpdateSchema.parse({ notify: { telegram: true } })).toEqual({
      notify: { telegram: true },
    });
    expect(AutomationUpdateSchema.parse({ notify: { app: false } })).toEqual({
      notify: { app: false },
    });
  });
});
