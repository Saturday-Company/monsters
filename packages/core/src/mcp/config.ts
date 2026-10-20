import { join } from 'node:path';
import { McpServerNameSchema } from '@monsters/shared';
import { nodeRuntime, type NodeRuntime } from '@monsters/shared/node';
import { z } from 'zod';
import { ToolError } from '@monsters/shared';
import { resolvePublic, systemResolver, type Resolver } from '@monsters/tools';
import { secretStoreFor } from '../secrets/store.ts';

/*
 * MCP servers in `settings.json` (`mcpServers`, by name) and their secrets:
 * values of variables and headers live in the secret `mcp-<name>.json`
 * (keychain or file backend, D-042), settings keep only their names. The browser preset keeps no command:
 * the core builds it at every start, so a new version of the package needs no
 * migration.
 */

export const McpServerSettingSchema = z.object({
  label: z.string().max(60).optional(),
  preset: z.literal('browser').optional(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(2000)).max(50).default([]),
  cwd: z.string().max(1024).optional(),
  url: z.string().max(2000).optional(),
  envKeys: z.array(z.string()).default([]),
  headerKeys: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  /** Agent ids, or `*` for the whole team. */
  agents: z.array(z.string()).default([]),
  /** Only these tools; empty = all. */
  tools: z.array(z.string()).default([]),
  timeoutSec: z.number().int().min(1).max(600).default(60),
  showWindow: z.boolean().optional(),
  /** http: OAuth sign-in (tokens in the secret `mcp-oauth-<name>.json`, see `oauth.ts`). */
  oauth: z.boolean().optional(),
  /** Gallery entry it was added from. */
  catalog: z.string().max(24).optional(),
});
export type McpServerSetting = z.infer<typeof McpServerSettingSchema>;

export const McpServersSettingSchema = z
  .record(McpServerNameSchema, McpServerSettingSchema)
  .default({});

export interface McpSecrets {
  env: Record<string, string>;
  headers: Record<string, string>;
}

/** Name of the secret holding the variables and headers of a server. */
export function mcpSecretName(name: string): string {
  McpServerNameSchema.parse(name);
  return `mcp-${name}.json`;
}

const SecretsFileSchema = z.object({
  env: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
});

/**
 * Secrets of a server, and whether they could be read: `unreadable` means a
 * file is there but cannot be opened (keychain away, damaged or hand-edited
 * JSON), which is not the same as "no secrets" and must never be saved over.
 */
export interface McpSecretsState {
  secrets: McpSecrets;
  unreadable: boolean;
}

export function inspectMcpSecrets(secretsDir: string, name: string): McpSecretsState {
  const empty: McpSecrets = { env: {}, headers: {} };
  const store = secretStoreFor(secretsDir);
  const file = mcpSecretName(name);
  let raw: string | null;
  try {
    raw = store.read(file);
  } catch {
    return { secrets: empty, unreadable: true };
  }
  if (raw === null) return { secrets: empty, unreadable: store.list().includes(file) };
  try {
    const parsed = SecretsFileSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { secrets: parsed.data, unreadable: false }
      : { secrets: empty, unreadable: true };
  } catch {
    return { secrets: empty, unreadable: true };
  }
}

export function readMcpSecrets(secretsDir: string, name: string): McpSecrets {
  return inspectMcpSecrets(secretsDir, name).secrets;
}

export function saveMcpSecrets(secretsDir: string, name: string, secrets: McpSecrets): void {
  const store = secretStoreFor(secretsDir);
  if (Object.keys(secrets.env).length === 0 && Object.keys(secrets.headers).length === 0) {
    store.remove(mcpSecretName(name));
    return;
  }
  store.write(mcpSecretName(name), `${JSON.stringify(secrets, null, 2)}\n`);
}

export function removeMcpSecrets(secretsDir: string, name: string): void {
  secretStoreFor(secretsDir).remove(mcpSecretName(name));
}

// --- browser preset ------------------------------------------------------------

/**
 * Playwright MCP, exact version (published 28/09/2026), installed once in
 * `browser/package` (see `browser-package.ts`).
 */
export const PLAYWRIGHT_MCP_VERSION = '0.0.83';
export const PLAYWRIGHT_MCP_PACKAGE = `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;

/** Folder of the browser: its own profile, never the user's Chrome profile. */
export function browserDir(home: string): string {
  return join(home, 'browser');
}

/**
 * Working directory of the browser. Playwright MCP limits file access (uploads,
 * files saved by name) to it and to `output/`, and blocks `file://` pages:
 * kept apart from the profile, which holds cookies and saved logins.
 */
export function browserFilesDir(home: string): string {
  return join(browserDir(home), 'files');
}

/** Where the browser package is installed, with its lockfile. */
export function browserPackageDir(home: string): string {
  return join(browserDir(home), 'package');
}

export function browserCli(home: string): string {
  return join(browserPackageDir(home), 'node_modules', '@playwright', 'mcp', 'cli.js');
}

/** Tools of the browser a free model gets: enough to open, read and use a page. */
export const BROWSER_CORE_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_navigate_back',
  'browser_wait_for',
  'browser_tabs',
  'browser_close',
];

/**
 * Browser tools no agent gets, whatever the settings say:
 * `browser_run_code_unsafe` runs arbitrary JavaScript in the server process
 * (outside the file limits), and the package has no option to turn it off.
 */
export const BROWSER_BLOCKED_TOOLS: ReadonlySet<string> = new Set(['browser_run_code_unsafe']);

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i).join(',');

/** Names that are local by definition, with and without the trailing dot. */
const LOCAL_NAMES = ['localhost', '*.localhost', '*.local', '*.internal', '*.home.arpa'].flatMap(
  (n) => [n, `${n}.`],
);

/** Any octet: a numeric label, so `0.gravatar.com` or `10.example.com` are not caught. */
const OCTET = `{${range(0, 256)}}`;

/**
 * Hosts whose last label is a wildcard: the `*` of the glob also takes the
 * `:port`, so one entry covers every port. Every IPv4 prefix has two numeric
 * labels before the wildcard (review of 19/10, item 12: `10.*` also took public
 * names). IPv6 literals are written without the closing bracket for the same
 * reason (`[fd*` is fd00::/8 on any port); `[::7f*` is 127.0.0.0/8 written as an
 * IPv4-compatible address, `[64:ff9b:*` the NAT64 prefix that maps any IPv4.
 */
const LOCAL_PREFIXES = [
  `0.${OCTET}.*`,
  `127.${OCTET}.*`,
  `10.${OCTET}.*`,
  `192.168.${OCTET}.*`,
  `169.254.${OCTET}.*`,
  `172.{${range(16, 16)}}.${OCTET}.*`,
  `100.{${range(64, 64)}}.${OCTET}.*`,
  '[::ffff:*',
  '[::7f*',
  '[64:ff9b:*',
  '[fc*',
  '[fd*',
  '[fe8*',
  '[fe9*',
  '[fea*',
  '[feb*',
];

/**
 * Origins the browser may not request, in the form Playwright MCP's
 * `--blocked-origins` turns into a route glob (`originOrHostGlob`): an entry
 * without a scheme becomes `*://<entry>/**`, so it covers http, https and ws.
 * An exact host needs two entries, `host` (default port: the glob wants `/`
 * right after it) and `host:*` (any explicit port); `http://host:*` alone
 * misses `http://host/`, and `http://[::1]:*` is not read as an origin at all.
 * Checked against Playwright's own matcher in `mcp-browser-package.test.ts`.
 * This machine and the local networks, for pages and for what they load or
 * redirect to. A name that merely resolves to a private address is stopped
 * before the visit by `assertPublicBrowserUrl`, not here (no DNS in a glob).
 */
export const BROWSER_BLOCKED_ORIGINS: readonly string[] = [
  ...[...LOCAL_NAMES, '[::1]', '[::]'].flatMap((h) => [h, `${h}:*`]),
  ...LOCAL_PREFIXES,
];

/**
 * Command line of the browser preset: the Node that runs JavaScript children (see
 * `nodeRuntime`: the one running the core, or the `node` on the PATH inside the
 * desktop app; `node` when there is none, for display) on the installed
 * package, never `npx` (which resolves the package again at every start). No
 * `--allow-unrestricted-file-access`: files stay confined.
 */
export function browserLaunch(
  home: string,
  showWindow: boolean,
  runtime: NodeRuntime | null = nodeRuntime(),
): { command: string; args: string[] } {
  const dir = browserDir(home);
  return {
    command: runtime?.command ?? 'node',
    args: [
      browserCli(home),
      '--user-data-dir',
      join(dir, 'profile'),
      '--output-dir',
      join(dir, 'output'),
      // Pages must not add tools of their own (WebMCP) to the agents' list.
      '--no-webmcp',
      // No page, redirect or subresource reaches this machine or the local network (M7).
      '--blocked-origins',
      BROWSER_BLOCKED_ORIGINS.join(';'),
      ...(showWindow ? [] : ['--headless']),
    ],
  };
}

/**
 * Environment of the browser: no `PLAYWRIGHT_MCP_*` variables, which would
 * change its configuration (unrestricted file access among them).
 */
export function browserEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^PLAYWRIGHT_MCP_/i.test(k)));
}

// --- browser: where it may go ---------------------------------------------------

/**
 * Refuses `browser_navigate` to a page on this machine or the local network,
 * like `web_fetch` does: the literal host, and what a name resolves to
 * (so a public name pointing at 127.0.0.1 is stopped too). The browser itself
 * only gets `--blocked-origins`, which does not resolve names.
 */
export async function assertPublicBrowserUrl(
  raw: string,
  options: { resolver?: Resolver; signal?: AbortSignal } = {},
): Promise<void> {
  const text = raw.trim();
  let url: URL | undefined;
  try {
    url = new URL(text);
  } catch {
    url = undefined;
  }
  // `localhost:3000` parses as the scheme "localhost:": without "://", look at it as a host.
  if (
    (!url || !/^https?:$/.test(url.protocol)) &&
    !/^(?:about|data|blob|file|javascript|chrome):/i.test(text)
  ) {
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return;
    }
  }
  if (!url || !/^https?:$/.test(url.protocol)) return;
  try {
    await resolvePublic(url, {
      resolver: options.resolver ?? systemResolver,
      allowPrivate: false,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    // A name that does not resolve is the browser's to report; only a private target is refused here.
    if (err instanceof ToolError && err.code === 'BLOCKED_BY_POLICY') {
      throw new ToolError('BLOCKED_BY_POLICY', err.message, {
        hint: 'The browser only opens public web pages, not this computer or the local network.',
      });
    }
  }
}
