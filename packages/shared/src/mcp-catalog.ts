import { z } from 'zod';
import { settingsPath } from './app-places.ts';
import { catalogStrings, catalogStringsOf } from './mcp-catalog.strings.ts';
import { McpCatalogIdSchema } from './mcp.ts';
import { LANGS } from './i18n.ts';

/*
 * The gallery of apps and services to connect in a few clicks (D-063): a list
 * of data, checked on the vendors' documentation on 16/10/2026 (sources in
 * `docs`). Each entry says how the core reaches the server and what the user
 * must give: nothing, a sign-in (OAuth with dynamic client registration), or
 * a token pasted once. A service that only lets approved apps sign in, with no
 * token to paste, is `soon`: shown, not connectable yet.
 *
 * To add a service: one entry here (the test checks addresses, ids and
 * duplicates), then `pnpm --filter @monsters/web icons` if it has a new
 * simple-icons slug.
 */

export const McpCatalogCategorySchema = z.enum([
  'sviluppo',
  'lavoro',
  'dati',
  'pagamenti',
  'ricerca',
  'automazioni',
  'design',
]);
export type McpCatalogCategory = z.infer<typeof McpCatalogCategorySchema>;

/** The names of the categories: they follow the app's language when read. */
export const MCP_CATEGORY_LABEL: Record<McpCatalogCategory, string> = {
  get sviluppo() {
    return catalogStrings().categories.sviluppo;
  },
  get lavoro() {
    return catalogStrings().categories.lavoro;
  },
  get dati() {
    return catalogStrings().categories.dati;
  },
  get pagamenti() {
    return catalogStrings().categories.pagamenti;
  },
  get ricerca() {
    return catalogStrings().categories.ricerca;
  },
  get automazioni() {
    return catalogStrings().categories.automazioni;
  },
  get design() {
    return catalogStrings().categories.design;
  },
};

const HttpsUrl = z.url({ protocol: /^https$/ });

/**
 * The company of a service with one address per company (Anteiku, WitDesk:
 * `https://<azienda>.anteiku.it/mcp`): one DNS label, lower case.
 */
export const McpTenantSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, { error: () => catalogStrings().tenantChars });

/** Where the company goes in an address of the gallery. */
export const TENANT_PLACEHOLDER = '{azienda}';

/** An https address with the company as the first label of the host. */
const TenantUrl = z
  .string()
  .regex(/^https:\/\/\{azienda\}\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s{}]*)?$/);

/** How the user connects: in the order the panel offers them (the first is the default). */
export const McpCatalogAuthSchema = z.discriminatedUnion('kind', [
  /** Nothing to give. */
  z.object({ kind: z.literal('none'), url: HttpsUrl.optional() }),
  /** Sign-in in the browser (OAuth 2.1, dynamic client registration). */
  z.object({ kind: z.literal('oauth'), url: HttpsUrl.optional() }),
  /** A token pasted once, sent as a header of every request (http). */
  z.object({
    kind: z.literal('token'),
    /** Another address for this method (some services have one per method). */
    url: HttpsUrl.optional(),
    header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/),
    /** Written before the token, e.g. `Bearer `. */
    prefix: z.string().max(20).default(''),
    /** What to call it in the panel ("Personal token", "API key"). */
    label: z.string().min(3).max(40),
    /** Page where the user creates it (with `{azienda}` on a service per company). */
    createUrl: z.union([HttpsUrl, TenantUrl]),
    /** Which permissions to give it, in plain words (in the app's language). */
    hint: z.string().max(200).optional(),
  }),
]);
export type McpCatalogAuth = z.infer<typeof McpCatalogAuthSchema>;

/**
 * A service the monsters on the Claude plan reach "tramite Claude" (D-069):
 * Claude is an approved app of the service, so the user connects it once on
 * their Claude account and Claude Code brings it into the runs. Monsters sees
 * no token: it only admits the chosen connectors in the agent's run.
 */
export const McpViaClaudeSchema = z
  .object({
    /**
     * claude.ai connectors: the name after "claude.ai " (as Claude names it)
     * and the address pattern that admits it (`allowedMcpServers`).
     */
    connectors: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 .-]{0,39}$/),
          url: z.string().regex(/^https:\/\/[a-z0-9.*-]+\.[a-z]{2,}(\/[^\s]*|\*)?$/),
        }),
      )
      .default([]),
    /** A first-party server Claude Code signs in to itself (Claude Design). */
    server: z
      .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), url: HttpsUrl })
      .optional(),
    /** How the user connects it: on claude.ai, or with `/design-login` in Claude Code. */
    login: z.enum(['claude-ai', 'design-login']),
  })
  .refine((v) => v.connectors.length > 0 || v.server !== undefined, {
    message: 'a service via Claude needs a connector or a server',
  });
export type McpViaClaude = z.infer<typeof McpViaClaudeSchema>;

/** Where the user connects services to their Claude account. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

/** A tool name of the server, `*` for any run of characters (`jump_to_*`). */
const ToolPattern = z.string().regex(/^[a-z0-9_*-]{1,64}$/);

/**
 * Hints of the gallery over the server's own (D-092): checked on its tools,
 * they decide what the brake makes of them.
 */
export const McpToolHintsSchema = z.object({
  /**
   * Tools that only look or move the view (Blender's `jump_to_*`, marked
   * destructive by their server): read-only, whatever the server says.
   */
  readOnly: z.array(ToolPattern).default([]),
  /**
   * Tools that write a file at the path in `arg` (a render): checked like a
   * file write of the monsters, never by the server's hints.
   */
  writesPath: z
    .array(z.object({ tool: ToolPattern, arg: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/) }))
    .default([]),
});
export type McpToolHints = z.infer<typeof McpToolHintsSchema>;

// The pattern has only letters, digits, `_`, `-` and `*`: nothing else to escape.
const patternMatches = (pattern: string, name: string) =>
  new RegExp(`^${pattern.split('*').join('.*')}$`).test(name);

/** What the hints of an entry say of one tool of its server (nothing: the server's hints hold). */
export function toolHintsOf(
  hints: McpToolHints | undefined,
  tool: string,
): { readOnly: true } | { writesPath: string } | undefined {
  if (!hints) return undefined;
  const writes = hints.writesPath.find((w) => patternMatches(w.tool, tool));
  if (writes) return { writesPath: writes.arg };
  return hints.readOnly.some((p) => patternMatches(p, tool)) ? { readOnly: true } : undefined;
}

export const McpCatalogEntrySchema = z
  .object({
    id: McpCatalogIdSchema,
    name: z.string().min(2).max(30),
    /** One sentence: what the monsters can do with it. */
    description: z.string().min(10).max(60),
    category: McpCatalogCategorySchema,
    transport: z.enum(['http', 'stdio']),
    /** http: the Streamable HTTP address. */
    url: HttpsUrl.optional(),
    /**
     * http, one server per company: the address with `{azienda}`
     * (`https://{azienda}.anteiku.it/mcp`); the panel asks the company first.
     */
    urlTemplate: TenantUrl.optional(),
    /** What the panel calls the company ("Your company"). */
    tenantLabel: z.string().min(3).max(30).optional(),
    /** Where the user finds it, in plain words (in the app's language). */
    tenantHint: z.string().max(160).optional(),
    /** A company to show as an example in the field. */
    tenantExample: McpTenantSchema.optional(),
    /** stdio: the program and its arguments, with exact versions. */
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    auth: z.array(McpCatalogAuthSchema).min(1),
    /** simple-icons slug (`apps/web/src/components/settings/brand-icons.ts`), or a generic icon. */
    icon: z.string().regex(/^[a-z0-9]+$/),
    /** Official documentation the entry was checked on. */
    docs: HttpsUrl,
    /** Something to know before connecting (plan, admin approval…). */
    note: z.string().max(160).optional(),
    /** Not connectable yet: the reason, shown in the panel. */
    soon: z.string().max(200).optional(),
    /** Reachable "tramite Claude" by the monsters on the Claude plan (D-069). */
    viaClaude: McpViaClaudeSchema.optional(),
    /** Longest wait for one call, in seconds, when the default 60 is too short (Blender renders). */
    timeoutSec: z.number().int().min(5).max(600).optional(),
    /** What the gallery knows of the server's tools better than their own hints (D-092). */
    toolHints: McpToolHintsSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.urlTemplate !== undefined) {
      if (e.transport !== 'http' || e.url !== undefined || e.auth.some((a) => a.url)) {
        ctx.addIssue({
          code: 'custom',
          message: `${e.id}: an address per company is the only address of an http entry`,
        });
      }
      if (!e.tenantLabel) {
        ctx.addIssue({ code: 'custom', message: `${e.id}: a company field needs its label` });
      }
    } else if (
      e.tenantLabel !== undefined ||
      e.auth.some((a) => a.kind === 'token' && a.createUrl.includes(TENANT_PLACEHOLDER))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${e.id}: a company without an address per company`,
      });
    }
    if (e.transport === 'http' && !e.url && !e.urlTemplate && !e.auth.every((a) => a.url)) {
      ctx.addIssue({ code: 'custom', message: `${e.id}: an http entry needs an address` });
    }
    if (e.transport === 'stdio' && !e.command) {
      ctx.addIssue({ code: 'custom', message: `${e.id}: a stdio entry needs a command` });
    }
    if (e.transport === 'stdio' && e.auth.some((a) => a.kind !== 'none')) {
      ctx.addIssue({ code: 'custom', message: `${e.id}: stdio entries take no sign-in here` });
    }
  });
export type McpCatalogEntry = z.infer<typeof McpCatalogEntrySchema>;
export type McpCatalogEntryInput = z.input<typeof McpCatalogEntrySchema>;

/** Entries that cannot be connected yet, and why: the words are in `mcp-catalog.strings.ts`. */
const SOON_KIND: Record<string, 'approved' | 'own' | 'claude-design'> = {
  slack: 'approved',
  google: 'own',
  figma: 'approved',
  canva: 'approved',
  asana: 'approved',
  hubspot: 'approved',
  vercel: 'approved',
  'claude-design': 'claude-design',
};

type TokenAuthData = Omit<
  Extract<z.input<typeof McpCatalogAuthSchema>, { kind: 'token' }>,
  'label' | 'hint'
>;
type AuthData = Exclude<z.input<typeof McpCatalogAuthSchema>, { kind: 'token' }> | TokenAuthData;

/** An entry as data: everything but the words, which come from the dictionary of the language. */
type EntryData = Omit<
  McpCatalogEntryInput,
  'description' | 'tenantLabel' | 'tenantHint' | 'note' | 'soon' | 'auth'
> & { auth: AuthData[] };

/** A service reached through one claude.ai connector (D-069). */
const claudeAi = (name: string, url: string) => ({
  connectors: [{ name, url }],
  login: 'claude-ai' as const,
});

/**
 * `uvx --exclude-newer`: uv resolves the indirect Python packages as they were on this day, so a
 * version published later (and compromised) never runs (review of 18/10, M10). Hashes would need
 * `--require-hashes`, which uv does not allow together with a source from a repository: see
 * docs/security-model.md. Moved forward whenever the entry's commit is.
 */
export const UV_EXCLUDE_NEWER = '2026-10-18';

const ENTRIES: EntryData[] = [
  // Saturday's own products first (D-075): one server per company, OAuth 2.1 of the Saturday Standard (§12).
  {
    id: 'anteiku',
    name: 'Anteiku',
    category: 'lavoro',
    transport: 'http',
    urlTemplate: 'https://{azienda}.anteiku.it/mcp',
    tenantExample: 'saturday',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://{azienda}.anteiku.it/sistema/connessioni',
      },
    ],
    icon: 'anteiku',
    docs: 'https://anteiku.it',
  },
  {
    id: 'witdesk',
    name: 'WitDesk',
    category: 'lavoro',
    transport: 'http',
    urlTemplate: 'https://{azienda}.witdesk.it/api/saturday/mcp',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://{azienda}.witdesk.it/preferenze',
      },
    ],
    icon: 'witdesk',
    docs: 'https://witdesk.it',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'sviluppo',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: [
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://github.com/settings/personal-access-tokens/new',
      },
    ],
    icon: 'github',
    docs: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'notion',
    docs: 'https://developers.notion.com/guides/mcp/get-started-with-mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://linear.app/settings/account/security',
      },
    ],
    icon: 'linear',
    docs: 'https://linear.app/docs/mcp',
  },
  {
    id: 'atlassian',
    name: 'Jira and Confluence',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'atlassian',
    docs: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'sviluppo',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'sentry',
    docs: 'https://mcp.sentry.dev',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'dati',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'supabase',
    docs: 'https://supabase.com/docs/guides/getting-started/mcp',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'pagamenti',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://dashboard.stripe.com/apikeys',
      },
    ],
    icon: 'stripe',
    docs: 'https://docs.stripe.com/mcp',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'sviluppo',
    transport: 'http',
    url: 'https://mcp.cloudflare.com/mcp',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      },
    ],
    icon: 'cloudflare',
    docs: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'dati',
    transport: 'http',
    url: 'https://mcp.airtable.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'airtable',
    docs: 'https://airtable.com/developers/agents/mcp/getting-started',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'automazioni',
    transport: 'http',
    url: 'https://mcp.zapier.com/api/v1/connect',
    auth: [{ kind: 'oauth' }],
    icon: 'zapier',
    docs: 'https://docs.zapier.com/mcp/home',
  },
  {
    id: 'context7',
    name: 'Context7',
    category: 'sviluppo',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    auth: [{ kind: 'none' }],
    icon: 'context7',
    docs: 'https://context7.com/docs/resources/all-clients',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'ricerca',
    transport: 'http',
    url: 'https://huggingface.co/mcp',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://huggingface.co/settings/tokens',
      },
    ],
    icon: 'huggingface',
    docs: 'https://huggingface.co/docs/hub/hf-mcp-server',
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'dati',
    transport: 'http',
    url: 'https://mcp.neon.tech/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'neon',
    docs: 'https://neon.com/docs/ai/neon-mcp-server',
  },
  {
    id: 'exa',
    name: 'Exa',
    category: 'ricerca',
    transport: 'http',
    url: 'https://mcp.exa.ai/mcp',
    auth: [
      { kind: 'none' },
      {
        kind: 'token',
        header: 'x-api-key',
        createUrl: 'https://dashboard.exa.ai/api-keys',
      },
    ],
    icon: 'exa',
    docs: 'https://exa.ai/docs/reference/exa-mcp',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    category: 'ricerca',
    transport: 'http',
    url: 'https://mcp.firecrawl.dev/v2/mcp-oauth',
    auth: [
      { kind: 'oauth' },
      {
        kind: 'token',
        url: 'https://mcp.firecrawl.dev/v2/mcp',
        header: 'Authorization',
        prefix: 'Bearer ',
        createUrl: 'https://www.firecrawl.dev/app/api-keys',
      },
    ],
    icon: 'firecrawl',
    docs: 'https://docs.firecrawl.dev/mcp-server',
  },
  {
    id: 'todoist',
    name: 'Todoist',
    category: 'lavoro',
    transport: 'http',
    url: 'https://ai.todoist.net/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'todoist',
    docs: 'https://developer.todoist.com/guides/',
  },
  {
    id: 'monday',
    name: 'monday.com',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.monday.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'monday',
    docs: 'https://developer.monday.com/api-reference/docs/integrate-with-monday-mcp',
  },
  {
    id: 'shopify',
    name: 'Shopify Dev',
    category: 'sviluppo',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@shopify/dev-mcp@1.16.0'],
    auth: [{ kind: 'none' }],
    icon: 'shopify',
    docs: 'https://shopify.dev/docs/apps/build/devmcp',
  },
  // The official server of Blender Lab (D-092), not the community `blender-mcp` on PyPI: it is
  // not on PyPI, so uv takes it from Blender's repository at the commit of tag v1.0.3. The core
  // does not run this line: it installs the same commit once with hashes (`pinned-python.ts`).
  {
    id: 'blender',
    name: 'Blender',
    category: 'design',
    transport: 'stdio',
    command: 'uvx',
    args: [
      '--exclude-newer',
      UV_EXCLUDE_NEWER,
      '--from',
      'git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp',
      'blender-mcp',
    ],
    auth: [{ kind: 'none' }],
    // A render of a real scene takes minutes: 60 s would report a timeout while Blender still works.
    timeoutSec: 600,
    icon: 'blender',
    docs: 'https://www.blender.org/lab/mcp-server/',
    // The server marks the moves of the view destructive; its renders write where they are told.
    toolHints: {
      readOnly: ['jump_to_*'],
      writesPath: [{ tool: 'render_*_to_path', arg: 'output_path' }],
    },
  },
  // Only approved apps may sign in, no token to paste: shown as "Presto".
  {
    id: 'slack',
    name: 'Slack',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.slack.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'slack',
    docs: 'https://docs.slack.dev/ai/mcp-server/',
    viaClaude: claudeAi('Slack', 'https://mcp.slack.com/*'),
  },
  {
    id: 'google',
    name: 'Gmail, Drive and Calendar',
    category: 'lavoro',
    transport: 'http',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    auth: [{ kind: 'oauth' }],
    icon: 'google',
    docs: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
    viaClaude: {
      connectors: [
        { name: 'Gmail', url: 'https://gmailmcp.googleapis.com/*' },
        { name: 'Google Drive', url: 'https://drivemcp.googleapis.com/*' },
        { name: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/*' },
      ],
      login: 'claude-ai',
    },
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'design',
    transport: 'http',
    url: 'https://mcp.figma.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'figma',
    docs: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    viaClaude: claudeAi('Figma', 'https://mcp.figma.com/*'),
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'design',
    transport: 'http',
    url: 'https://mcp.canva.com/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'canva',
    docs: 'https://www.canva.dev/docs/mcp/verify-integration/',
    viaClaude: claudeAi('Canva', 'https://mcp.canva.com/*'),
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.asana.com/v2/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'asana',
    docs: 'https://developers.asana.com/docs/using-asanas-mcp-server',
    viaClaude: claudeAi('Asana', 'https://mcp.asana.com/*'),
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'lavoro',
    transport: 'http',
    url: 'https://mcp.hubspot.com/',
    auth: [{ kind: 'oauth' }],
    icon: 'hubspot',
    docs: 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server',
    viaClaude: claudeAi('HubSpot', 'https://mcp.hubspot.com/*'),
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'sviluppo',
    transport: 'http',
    url: 'https://mcp.vercel.com',
    auth: [{ kind: 'oauth' }],
    icon: 'vercel',
    docs: 'https://vercel.com/docs/agent-resources/vercel-mcp',
    viaClaude: claudeAi('Vercel', 'https://mcp.vercel.com*'),
  },
  // Only through Claude (D-069): Claude Code signs in to it with the user's Claude login.
  {
    id: 'claude-design',
    name: 'Claude Design',
    category: 'design',
    transport: 'http',
    url: 'https://api.anthropic.com/v1/design/mcp',
    auth: [{ kind: 'oauth' }],
    icon: 'claude',
    docs: 'https://claude.ai/design',
    viaClaude: {
      server: { name: 'claude-design', url: 'https://api.anthropic.com/v1/design/mcp' },
      login: 'design-login',
    },
  },
];

/**
 * The programs that start the stdio servers of the gallery, and where to get
 * them: without it the panel and the start error say what to install (D-092).
 */
export const STDIO_LAUNCHERS: Readonly<Record<string, { needs: string; url: string }>> = {
  npx: {
    needs: 'Node.js',
    get url() {
      return catalogStrings().nodeDownload;
    },
  },
  uvx: { needs: 'uv', url: 'https://docs.astral.sh/uv/getting-started/installation/' },
  uv: { needs: 'uv', url: 'https://docs.astral.sh/uv/getting-started/installation/' },
};

/** What a stdio command needs installed (`uvx`, `/usr/bin/npx`, `npx.cmd`), if it is a known one. */
export function launcherOf(command: string): { needs: string; url: string } | undefined {
  const base = command
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(?:exe|cmd|bat)$/i, '');
  return Object.hasOwn(STDIO_LAUNCHERS, base) ? STDIO_LAUNCHERS[base] : undefined;
}

/** The words of an entry in the language in use (undefined where the entry has none). */
function textsOf(id: string, lang?: (typeof LANGS)[number]) {
  const dict = lang ? catalogStringsOf(lang) : catalogStrings();
  const texts = dict.entries[id];
  if (!texts) throw new Error(`mcp-catalog: no words for ${id}`);
  const kind = SOON_KIND[id];
  const soon =
    texts.soon ??
    (kind === 'approved'
      ? dict.soonApproved
      : kind === 'claude-design'
        ? dict.soonClaudeDesign(settingsPath('modelli'))
        : undefined);
  return { dict, texts, soon };
}

/** The entry as the schema reads it, with the words of one language (to check them). */
function withTexts(e: EntryData, lang: (typeof LANGS)[number]): McpCatalogEntryInput {
  const { texts, soon } = textsOf(e.id, lang);
  return {
    ...e,
    ...(texts.name !== undefined ? { name: texts.name } : {}),
    description: texts.description,
    ...(texts.tenantLabel !== undefined ? { tenantLabel: texts.tenantLabel } : {}),
    ...(texts.tenantHint !== undefined ? { tenantHint: texts.tenantHint } : {}),
    ...(texts.note !== undefined ? { note: texts.note } : {}),
    ...(soon !== undefined ? { soon } : {}),
    auth: e.auth.map((a) =>
      a.kind === 'token'
        ? {
            ...a,
            label: texts.token?.label ?? '',
            ...(texts.token?.hint !== undefined ? { hint: texts.token.hint } : {}),
          }
        : a,
    ),
  };
}

/**
 * Makes the words of a parsed entry follow the language: `description`, `name` (where it has
 * words), the company field, the token's label and hint, `note` and `soon` are read from the
 * dictionary each time. Copy an entry with its descriptors, not a spread, to keep that.
 */
function localized(entry: McpCatalogEntry): McpCatalogEntry {
  const text = () => textsOf(entry.id).texts;
  const words: PropertyDescriptorMap = {
    description: { enumerable: true, get: () => text().description },
  };
  const own = (key: 'tenantLabel' | 'tenantHint' | 'note') => {
    if (entry[key] !== undefined) {
      words[key] = { enumerable: true, get: () => text()[key] ?? entry[key] };
    }
  };
  if (textsOf(entry.id).texts.name !== undefined) {
    words['name'] = { enumerable: true, get: () => text().name ?? entry.name };
  }
  own('tenantLabel');
  own('tenantHint');
  own('note');
  if (entry.soon !== undefined) {
    words['soon'] = { enumerable: true, get: () => textsOf(entry.id).soon ?? entry.soon };
  }
  for (const auth of entry.auth) {
    if (auth.kind !== 'token') continue;
    Object.defineProperty(auth, 'label', {
      enumerable: true,
      get: () => text().token?.label ?? '',
    });
    if (auth.hint !== undefined) {
      Object.defineProperty(auth, 'hint', {
        enumerable: true,
        get: () => text().token?.hint ?? auth.hint,
      });
    }
  }
  return Object.defineProperties(entry, words);
}

// Every language's words must pass the schema (lengths, the company field), not only the one in use.
for (const lang of LANGS) for (const e of ENTRIES) McpCatalogEntrySchema.parse(withTexts(e, lang));

/** The gallery, parsed (and so checked) once; the words follow the app's language when read. */
export const MCP_CATALOG: readonly McpCatalogEntry[] = ENTRIES.map((e) =>
  localized(McpCatalogEntrySchema.parse(withTexts(e, 'en'))),
);

/** The entry asks for the company before connecting (one server per company). */
export function needsTenant(entry: McpCatalogEntry): boolean {
  return entry.urlTemplate !== undefined;
}

const fillTenant = (template: string, tenant: string) =>
  template.replace(TENANT_PLACEHOLDER, tenant);

/**
 * Address of an entry for one way of connecting (some services have one per
 * method). An entry per company needs a valid `tenant`, otherwise undefined.
 */
export function catalogUrl(
  entry: McpCatalogEntry,
  auth: McpCatalogAuth,
  tenant?: string,
): string | undefined {
  if (entry.urlTemplate) {
    return tenant !== undefined && McpTenantSchema.safeParse(tenant).success
      ? fillTenant(entry.urlTemplate, tenant)
      : undefined;
  }
  return ('url' in auth && auth.url) || entry.url;
}

/** The page where the user creates a token, with the company filled in. */
export function catalogCreateUrl(
  auth: Extract<McpCatalogAuth, { kind: 'token' }>,
  tenant?: string,
): string | undefined {
  if (!auth.createUrl.includes(TENANT_PLACEHOLDER)) return auth.createUrl;
  return tenant !== undefined && McpTenantSchema.safeParse(tenant).success
    ? fillTenant(auth.createUrl, tenant)
    : undefined;
}

/**
 * What the user typed as their company, made a company: the name itself
 * (`Acme ` → `acme`), or the address they copied from the browser
 * (`https://acme.anteiku.it/oggi` → `acme`) when it is the service's.
 * Undefined when it is neither.
 */
export function parseTenant(entry: McpCatalogEntry, input: string): string | undefined {
  const raw = input.trim().toLowerCase();
  if (!raw) return undefined;
  if (McpTenantSchema.safeParse(raw).success) return raw;
  if (!entry.urlTemplate) return undefined;
  const suffix = new URL(fillTenant(entry.urlTemplate, 'x')).hostname.slice(1);
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return undefined;
  }
  if (!host.endsWith(suffix)) return undefined;
  const label = host.slice(0, -suffix.length);
  return McpTenantSchema.safeParse(label).success ? label : undefined;
}

/** The company of a server added from an entry per company (from its address). */
export function tenantOfUrl(entry: McpCatalogEntry, url: string | undefined): string | undefined {
  if (!entry.urlTemplate || !url) return undefined;
  const [head, tail] = entry.urlTemplate.split(TENANT_PLACEHOLDER) as [string, string];
  if (!url.startsWith(head) || !url.endsWith(tail)) return undefined;
  const tenant = url.slice(head.length, url.length - tail.length);
  return McpTenantSchema.safeParse(tenant).success ? tenant : undefined;
}
