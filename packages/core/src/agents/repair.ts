import type { ToolCallRepairFunction, ToolSet } from 'ai';

/*
 * Deterministic repair of malformed tool calls (D-064, AG-17). Free models get
 * the same things wrong again and again: a tool name in another case or with a
 * prefix (`Delegate`, `vault-read`, `functions.vault_read`), JSON with text or a
 * code fence around it, trailing commas, Python literals, keys in camelCase
 * (`contextLinks` for `context_links`), a list passed as a JSON string. Each
 * of them would cost a step (the model reads the error and calls again): they
 * are fixed here without a model, and every fix is logged with the call.
 */

/** `contextLinks` → `context_links`. */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .toLowerCase();
}

/** `context_links` → `contextLinks`. */
export function camelCase(name: string): string {
  return name.replace(/[_-]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The tool a misspelt name means, or undefined when none matches for sure. */
export function matchToolName(name: string, names: readonly string[]): string | undefined {
  if (names.includes(name)) return name;
  const candidates = [name, name.replace(/^(functions|tools|tool|default_api)[.:]/i, '')];
  // `mcp__server__tool` from harness-style models.
  const mcp = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(name);
  if (mcp?.[1]) candidates.push(mcp[1]);
  for (const c of candidates) {
    const key = snakeCase(c.trim());
    const hit = names.find((n) => n.toLowerCase() === key);
    if (hit) return hit;
  }
  // An MCP tool without its `mcp__<server>__` (the card lists the names, D-163): `anteiku_task_crea`,
  // or `task_crea` when one tool only ends so. Never a lone word (`crea`): many tools end so.
  for (const c of candidates) {
    const key = snakeCase(c.trim());
    const tool = (n: string) => n.toLowerCase().replace(/^mcp__.+?__/, '');
    const whole = names.filter((n) => n.startsWith('mcp__') && tool(n) === key);
    if (whole.length === 1) return whole[0];
    if (!key.includes('_')) continue;
    const tail = names.filter((n) => n.startsWith('mcp__') && tool(n).endsWith(`_${key}`));
    if (tail.length === 1) return tail[0];
  }
  return undefined;
}

/** Python and JavaScript literals outside strings, made JSON. */
function fixLiterals(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    const rest = text.slice(i);
    const lit = /^(True|False|None|undefined)\b/.exec(rest);
    if (lit) {
      out += lit[1] === 'True' ? 'true' : lit[1] === 'False' ? 'false' : 'null';
      i += lit[1]!.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Closes the strings, arrays and objects left open at the end (a cut-off answer). */
function closeOpen(text: string): string {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  return `${text}${inString ? '"' : ''}${stack.reverse().join('')}`;
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The JSON a model meant, as text, or null when it cannot be recovered. Tries,
 * in order: as it is; without a code fence; the object between the first `{`
 * and its last `}` (text before or after); without trailing commas; with JSON
 * literals; with what was left open closed.
 */
export function repairJson(raw: string): string | null {
  let text = raw.trim();
  if (text === '') return '{}';
  if (parses(text)) return text;
  const fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence?.[1] !== undefined) text = fence[1].trim();
  if (parses(text)) return text;
  const start = text.indexOf('{');
  if (start >= 0) {
    const end = text.lastIndexOf('}');
    text = end > start ? text.slice(start, end + 1) : text.slice(start);
  }
  if (parses(text)) return text;
  const steps = [
    (t: string) => t.replace(/,\s*([}\]])/g, '$1'),
    fixLiterals,
    (t: string) => closeOpen(t.replace(/,\s*$/, '')),
  ];
  for (const step of steps) {
    text = step(text);
    if (parses(text)) return text;
  }
  return null;
}

/** JSON schema properties of an object schema, as far as needed here. */
interface PropertySchema {
  type?: string | string[];
  items?: unknown;
}
export interface ObjectSchema {
  type?: string | string[];
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

const typeOf = (p: PropertySchema | undefined): string[] =>
  p?.type === undefined ? [] : Array.isArray(p.type) ? p.type : [p.type];

/**
 * Arguments with the keys the schema expects: `contextLinks` becomes
 * `context_links` (and the other way round) when only the other spelling is in
 * the schema; a list or an object passed as a JSON string is parsed; a number
 * or a boolean passed as a string is converted. Returns what was changed.
 */
export function normalizeInput(
  input: unknown,
  schema: ObjectSchema | undefined,
): { input: unknown; fixed: string[] } {
  const props = schema?.properties;
  if (!props || !input || typeof input !== 'object' || Array.isArray(input)) {
    return { input, fixed: [] };
  }
  const fixed = new Set<string>();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    let name = key;
    if (!(key in props)) {
      const alt = [snakeCase(key), camelCase(key)].find((k) => k in props && !(k in input));
      if (alt) {
        name = alt;
        fixed.add('keys');
      }
    }
    out[name] = coerce(value, props[name], fixed);
  }
  return { input: out, fixed: [...fixed] };
}

function coerce(value: unknown, prop: PropertySchema | undefined, fixed: Set<string>): unknown {
  const types = typeOf(prop);
  if (typeof value !== 'string' || types.length === 0 || types.includes('string')) return value;
  const text = value.trim();
  if (
    (types.includes('array') && text.startsWith('[')) ||
    (types.includes('object') && text.startsWith('{'))
  ) {
    try {
      const parsed: unknown = JSON.parse(text);
      fixed.add('values');
      return parsed;
    } catch {
      return value;
    }
  }
  if ((types.includes('number') || types.includes('integer')) && /^-?\d+(\.\d+)?$/.test(text)) {
    fixed.add('values');
    return Number(text);
  }
  if (types.includes('boolean') && /^(true|false)$/i.test(text)) {
    fixed.add('values');
    return text.toLowerCase() === 'true';
  }
  return value;
}

/**
 * The repair hook of `streamText`: a wrong tool name or JSON that does not
 * parse is fixed when it can be done for sure; otherwise null, and the model
 * gets the SDK's error as before. `onRepaired` receives what was fixed.
 */
export function createToolCallRepair<TOOLS extends ToolSet>(
  onRepaired: (callId: string, what: string[]) => void,
): ToolCallRepairFunction<TOOLS> {
  return ({ toolCall, tools }) => {
    const what: string[] = [];
    const name = matchToolName(toolCall.toolName, Object.keys(tools));
    if (!name) return Promise.resolve(null);
    if (name !== toolCall.toolName) what.push('name');
    let input = toolCall.input;
    if (!parses(input)) {
      const json = repairJson(input);
      if (json === null) return Promise.resolve(null);
      input = json;
      what.push('json');
    }
    if (what.length === 0) return Promise.resolve(null);
    onRepaired(toolCall.toolCallId, what);
    return Promise.resolve({ ...toolCall, toolName: name, input });
  };
}
