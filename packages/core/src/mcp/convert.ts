import { createHash } from 'node:crypto';
import {
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from '@modelcontextprotocol/client';
import { z } from 'zod';

/*
 * From MCP to what the agents use: tool names every provider accepts, JSON
 * Schemas checked before they reach a model (an invalid one skips the tool,
 * it never breaks the run), results turned into text.
 */

/** Prefix of every MCP tool: `mcp__<server>__<tool>`. */
export const MCP_TOOL_PREFIX = 'mcp__';

/** OpenAI, Anthropic and Google all accept `[A-Za-z0-9_-]{1,64}`. */
export const MAX_TOOL_NAME = 64;

const shortHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 6);

/**
 * Name of an MCP tool for the agents. Characters providers refuse become `_`;
 * a name too long, or already taken, is shortened and gets a short hash of the
 * original name, so it stays stable across restarts.
 */
export function agentToolName(server: string, tool: string, taken: ReadonlySet<string>): string {
  const head = `${MCP_TOOL_PREFIX}${server}__`;
  const clean = tool.replace(/[^A-Za-z0-9_-]/g, '_') || 'tool';
  let name = `${head}${clean}`;
  if (name.length > MAX_TOOL_NAME || taken.has(name)) {
    const tail = `_${shortHash(tool)}`;
    name = `${head}${clean.slice(0, Math.max(1, MAX_TOOL_NAME - head.length - tail.length))}${tail}`;
  }
  return name.slice(0, MAX_TOOL_NAME);
}

/**
 * Agent names of all the tools of a server, independent of the order the
 * server lists them in: names that need no change are given first (they keep
 * their name), then the others in alphabetical order.
 */
export function agentToolNames(server: string, tools: readonly string[]): Map<string, string> {
  const untouched = (tool: string) => /^[A-Za-z0-9_-]+$/.test(tool);
  const order = [...new Set(tools)].sort(
    (a, b) => Number(untouched(b)) - Number(untouched(a)) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const tool of order) {
    const name = agentToolName(server, tool, taken);
    taken.add(name);
    names.set(tool, name);
  }
  return names;
}

/** Server and tool of an agent tool name, for the speech bubble and the log. */
export function splitAgentToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const i = rest.indexOf('__');
  if (i <= 0) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

const MAX_SCHEMA_CHARS = 60_000;
const MAX_SCHEMA_DEPTH = 32;

export type SchemaCheck =
  | { ok: true; schema: Record<string, unknown>; input: z.ZodType<Record<string, unknown>> }
  | { ok: false; reason: string };

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_SCHEMA_DEPTH || !value || typeof value !== 'object') return depth;
  let max = depth;
  for (const v of Object.values(value)) max = Math.max(max, depthOf(v, depth + 1));
  return max;
}

function refs(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    if (k === '$ref' && typeof v === 'string') out.push(v);
    else refs(v, out);
  }
  return out;
}

/**
 * Checks the input schema of an MCP tool and prepares it for the models: an
 * object schema, no remote `$ref`, not too large or deep, accepted by a JSON
 * Schema validator (which then checks the model's input before the call).
 */
export function checkInputSchema(raw: unknown): SchemaCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'lo schema degli argomenti non è un oggetto JSON' };
  }
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    return { ok: false, reason: 'lo schema degli argomenti non è JSON' };
  }
  if (json.length > MAX_SCHEMA_CHARS) {
    return { ok: false, reason: 'lo schema degli argomenti è troppo grande' };
  }
  const schema = JSON.parse(json) as Record<string, unknown>;
  if (depthOf(schema) > MAX_SCHEMA_DEPTH) {
    return { ok: false, reason: 'lo schema degli argomenti è troppo annidato' };
  }
  if (schema['type'] === undefined) schema['type'] = 'object';
  if (schema['type'] !== 'object') {
    return { ok: false, reason: 'gli argomenti non sono un oggetto' };
  }
  if (refs(schema).some((r) => !r.startsWith('#'))) {
    return { ok: false, reason: 'lo schema rimanda a file esterni' };
  }
  // Some providers refuse these at the top level of a tool schema.
  delete schema['$schema'];
  delete schema['$id'];
  if (
    !schema['properties'] ||
    typeof schema['properties'] !== 'object' ||
    Array.isArray(schema['properties'])
  ) {
    schema['properties'] = {};
  }
  let validate: (value: unknown) => unknown;
  try {
    const std = fromJsonSchema(schema as JsonSchemaType)['~standard'];
    validate = (value) => std.validate(value);
    validate({});
  } catch (err) {
    return {
      ok: false,
      reason: `lo schema degli argomenti non è valido (${(err as Error).message.slice(0, 200)})`,
    };
  }
  const input = z
    .unknown()
    .transform((v) => (v === undefined || v === null ? {} : v))
    .superRefine((value, ctx) => {
      const result = validate(value) as {
        issues?: readonly { message: string; path?: readonly unknown[] }[];
      };
      for (const issue of result.issues ?? []) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: (issue.path ?? []).map((p) =>
            p && typeof p === 'object' && 'key' in p
              ? String(p.key)
              : typeof p === 'number'
                ? p
                : String(p),
          ),
        });
      }
    }) as unknown as z.ZodType<Record<string, unknown>>;
  return { ok: true, schema, input };
}

/** Most characters of a result given to a model: a page snapshot can be huge. */
export const MAX_RESULT_CHARS = 30_000;

const kb = (base64: string) => `${Math.max(1, Math.round((base64.length * 3) / 4 / 1024))} KB`;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[… testo troncato: ${text.length - max} caratteri in più]`;
}

/**
 * Text of an MCP result for the model: text blocks as they are, images and
 * audio as a short description (the models here read text), resources as
 * their text or a description, structured content as JSON when there is no
 * text.
 */
export function resultText(
  result: CallToolResult,
  max = MAX_RESULT_CHARS,
  /** Keeps an image (as a file, D-075) and says where: its text replaces the description. */
  image?: (block: { mimeType: string; data: string }) => string | undefined,
): string {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'image':
        parts.push(
          image?.(block) ??
            `[immagine ${block.mimeType}, ${kb(block.data)}: non visibile come testo]`,
        );
        break;
      case 'audio':
        parts.push(`[audio ${block.mimeType}, ${kb(block.data)}]`);
        break;
      case 'resource_link':
        parts.push(
          `[risorsa: ${block.name}${block.title ? ` (${block.title})` : ''} ${block.uri}${block.mimeType ? `, ${block.mimeType}` : ''}]`,
        );
        break;
      case 'resource': {
        const r = block.resource;
        if ('text' in r && typeof r.text === 'string') {
          parts.push(`[risorsa ${r.uri}]\n${r.text}`);
        } else if ('blob' in r && typeof r.blob === 'string') {
          parts.push(`[risorsa ${r.uri}${r.mimeType ? `, ${r.mimeType}` : ''}, ${kb(r.blob)}]`);
        } else {
          parts.push(`[risorsa ${r.uri}]`);
        }
        break;
      }
      default:
        parts.push(`[contenuto di tipo ${(block as { type: string }).type}]`);
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {
      parts.push('[dati strutturati non leggibili]');
    }
  }
  return clip(parts.join('\n\n'), max);
}
