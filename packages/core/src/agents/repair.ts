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

/** One spelling of a tool name: case, camelCase and separators do not count. */
const spelling = (name: string): string =>
  snakeCase(name.trim()).replace(/_+/g, '_').replace(/^_|_$/g, '');

/** `mcp__<server>__<tool>`; server names have no underscore (`McpServerNameSchema`). */
const MCP_NAME = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/i;

/** Monsters' own tools, as harness-style models name them (`mcp__monsters__vault_read`). */
const OWN_SERVER = 'monsters';

/**
 * The tool a misspelt name means, or undefined when none matches for sure (D-064, D-163).
 *
 * Only safe repairs: another case, other separators (`vault-read`, `VaultRead`), a
 * `functions.` prefix, a missing `mcp__<server>__`, and a missing namespace head that the
 * server puts before its tools (`task_crea` for `anteiku_task_crea`). A name that carries a
 * server never lands on another server's tool (`mcp__gmail__send_message` is not Slack's
 * `send_message`), and a name is never stretched onto a longer one that only ends so
 * (`delete_contacts` is not `bulk_delete_contacts`): review of 25/10, C-1.
 */
export function matchToolName(name: string, names: readonly string[]): string | undefined {
  if (names.includes(name)) return name;
  const asked = name.trim().replace(/^(functions|tools|tool|default_api)[.:]/i, '');
  if (names.includes(asked)) return asked;
  const prefixed = MCP_NAME.exec(asked);
  const server = prefixed ? spelling(prefixed[1]!) : undefined;
  const key = spelling(prefixed ? prefixed[2]! : asked);
  if (key === '') return undefined;

  // Monsters' own tools: by their name alone, or under the `monsters` server of the harnesses.
  if (server === undefined || server === OWN_SERVER) {
    const own = names.filter((n) => !MCP_NAME.test(n) && spelling(n) === key);
    if (own.length === 1) return own[0];
    if (own.length > 1) return undefined;
  }

  const mcp = names.flatMap((n) => {
    const m = MCP_NAME.exec(n);
    return m ? [{ name: n, server: spelling(m[1]!), tool: spelling(m[2]!) }] : [];
  });
  // A named server is kept: its tools or nothing.
  const scope = server === undefined ? mcp : mcp.filter((t) => t.server === server);
  const whole = scope.filter((t) => t.tool === key);
  if (whole.length === 1) return whole[0]!.name;
  if (whole.length > 1) return undefined;

  // The server's namespace head left out. Never a lone word (`crea`): many tools end so.
  if (!key.includes('_')) return undefined;
  const headed = scope.filter((t) => {
    if (!t.tool.endsWith(`_${key}`)) return false;
    const head = t.tool.slice(0, -key.length - 1);
    if (head.includes('_')) return false;
    if (head === t.server || t.server.split('_').includes(head)) return true;
    // A head every tool of the server shares (three or more): its namespace, not a word.
    const own = mcp.filter((o) => o.server === t.server);
    return own.length >= 3 && own.every((o) => o.tool.startsWith(`${head}_`));
  });
  return headed.length === 1 ? headed[0]!.name : undefined;
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
