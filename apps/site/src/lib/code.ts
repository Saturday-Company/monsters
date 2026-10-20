/*
 * Real code for the file windows, read from the repository at build time and highlighted with
 * shiki (no JavaScript in the browser). Excerpts are cut by markers in the source, not by line
 * numbers, so they follow the code; a marker that disappears fails the build instead of
 * showing stale code. Colours are classes (`.tk-*` in global.css), not inline styles.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHighlighter, type ThemeRegistrationRaw } from 'shiki';
import { DEFAULT_PORT } from '@monsters/shared';
import { renderAgentFiles } from '../../../../packages/core/src/agents/templates.ts';
import { rheaBlueprint } from '../../../../packages/core/src/agents/archetypes.ts';

/** The repository root: the folder with pnpm-workspace.yaml above the working directory. */
const ROOT = (() => {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('site: repository root not found above the working directory');
    dir = up;
  }
  return `${dir}/`;
})();

/** Theme colour → class. The colours only exist to be swapped for classes. */
const TOKENS = {
  '#ff6a1f': 'tk-k', // keywords, YAML keys
  '#4fd98a': 'tk-s', // strings
  '#2fd0c2': 'tk-n', // numbers, constants
  '#8f8b81': 'tk-c', // comments
  '#ffd9a8': 'tk-f', // functions, types
  '#b9b3a6': 'tk-p', // punctuation
} as const;

const THEME: ThemeRegistrationRaw = {
  name: 'monsters-screen',
  type: 'dark',
  settings: [
    { settings: { foreground: '#efe9dc', background: '#0d0d0c' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#8f8b81' } },
    {
      scope: ['string', 'string.quoted', 'string.unquoted.plain'],
      settings: { foreground: '#4fd98a' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.other', 'support.constant'],
      settings: { foreground: '#2fd0c2' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'variable.language.this',
        'entity.name.tag.yaml',
        'support.type.property-name',
      ],
      settings: { foreground: '#ff6a1f' },
    },
    {
      scope: [
        'entity.name.function',
        'entity.name.type',
        'support.class',
        'entity.name.class',
        'support.function',
        'support.type.primitive',
      ],
      settings: { foreground: '#ffd9a8' },
    },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: '#b9b3a6' },
    },
  ],
};

let highlighter: ReturnType<typeof createHighlighter> | null = null;
const getHighlighter = () =>
  (highlighter ??= createHighlighter({ themes: [THEME], langs: ['typescript', 'yaml', 'json'] }));

export type CodeLang = 'typescript' | 'yaml' | 'json';

/** Highlighted lines as HTML (one string per source line), colours as classes. */
export async function highlight(code: string, lang: CodeLang, context?: string): Promise<string[]> {
  const hl = await getHighlighter();
  const src = (context ? `${context}\n` : '') + code.replace(/\n$/, '');
  const html = hl.codeToHtml(src, { lang, theme: 'monsters-screen' });
  const classed = html.replace(/style="color:(#[0-9a-fA-F]{6})"/g, (_m, hex: string) => {
    const cls = TOKENS[hex.toLowerCase() as keyof typeof TOKENS];
    return cls ? `class="${cls}"` : '';
  });
  const bare = classed.replace(/<span\s*>([^<]*)<\/span>/g, '$1');
  const lines = [...bare.matchAll(/<span class="line">([\s\S]*?)<\/span>(?=\n|<\/code>)/g)].map(
    (m) => m[1] ?? '',
  );
  return context ? lines.slice(context.split('\n').length) : lines;
}

export interface Excerpt {
  file: string;
  /** 1-based line number of the first line. */
  start: number;
  code: string;
}

/**
 * Lines of a repository file from the first line matching `from` to the first line after it
 * matching `to` (inclusive), with lines matching `skip` dropped (and marked by `// …`).
 */
export function excerpt(file: string, from: RegExp, to: RegExp, skip?: RegExp): Excerpt {
  const lines = readFileSync(ROOT + file, 'utf8').split('\n');
  const a = lines.findIndex((l) => from.test(l));
  if (a < 0) throw new Error(`site excerpt: ${from} not found in ${file}`);
  const b = lines.findIndex((l, i) => i > a && to.test(l));
  if (b < 0) throw new Error(`site excerpt: ${to} not found after ${from} in ${file}`);
  const kept: string[] = [];
  let skipping = false;
  for (const l of lines.slice(a, b + 1)) {
    if (skip?.test(l)) {
      if (!skipping) kept.push(`${l.match(/^\s*/)?.[0] ?? ''}// …`);
      skipping = true;
      continue;
    }
    skipping = false;
    kept.push(l);
  }
  return { file, start: a + 1, code: kept.join('\n') };
}

/** The real `monsters help` text of packages/cli, with the version and port filled in. */
export function cliHelp(version: string): string {
  const src = readFileSync(ROOT + 'packages/cli/src/main.ts', 'utf8');
  const m = /const HELP = `([\s\S]*?)`;/.exec(src);
  if (!m?.[1]) throw new Error('site: HELP not found in packages/cli/src/main.ts');
  return m[1]
    .replace(/\$\{CORE_VERSION\}/g, version)
    .replace(/\$\{DEFAULT_PORT\}/g, String(DEFAULT_PORT))
    .replace(/\$\{DEFAULT_HOST\}/g, '127.0.0.1');
}

/**
 * The Claude Desktop block of docs/mcp-vault.md, with the Italian placeholders in English and
 * without the optional MONSTERS_HOME line.
 */
export function mcpConfig(): string {
  const doc = readFileSync(ROOT + 'docs/mcp-vault.md', 'utf8');
  const m = /## Claude Desktop[\s\S]*?```json\n([\s\S]*?)```/.exec(doc);
  if (!m?.[1]) throw new Error('site: the Claude Desktop block is gone from docs/mcp-vault.md');
  return m[1].replace(/\/percorso\/di\//g, '/path/to/').replace(/,\n\s*"env": \{[^}]*\}/, '');
}

/** Rhea's agent.yaml exactly as the onboarding writes it (the core's own template). */
export function rheaAgentYaml(): string {
  const files = renderAgentFiles(rheaBlueprint({ user: 'you' }));
  const yaml = files['agent.yaml'];
  if (!yaml) throw new Error('site: the core wrote no agent.yaml');
  return yaml;
}
