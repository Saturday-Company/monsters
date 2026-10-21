import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SearchBackendConfigSchema } from '@monsters/tools';
import {
  appLang,
  DecisionEngineSchema,
  DEFAULT_TELEGRAM_PREFS,
  InstinctModeSchema,
  InstinctUseSchema,
  LangSchema,
  LOG_ARCHIVE_DEFAULT_DAYS,
  LOG_ARCHIVE_MIN_DAYS,
  PaidSearchEngineSchema,
  PaidSearchModeSchema,
  TelegramPrefsSchema,
  LEGACY_NOTES_DIR_NAME,
  VAULT_LAYOUTS,
  vaultLayout,
  isVaultLayoutId,
  type VaultLayout,
  type VaultLayoutId,
} from '@monsters/shared';
import { z } from 'zod';
import { ModelRefSchema } from '../agents/definition.ts';
import { McpServersSettingSchema } from '../mcp/config.ts';
import { DecisionRuleSchema } from './decision.ts';
import { JEV_DEFAULT_MODEL } from './jev.ts';
import { teamStrings } from './team.strings.ts';
import { DEFAULT_RUN_LIMITS, RunLimitsSchema } from './run-limits.ts';
import { DEFAULT_SPEND_SETTINGS, SpendSettingsSchema } from './spend.ts';

/** Jev settings of `decisions.jev` before D-067 (moved to `instinct.jev`). */
const LegacyJevSchema = z.object({
  model: z.string().min(1).max(60).optional(),
  timeoutMs: z.number().int().min(500).max(60_000).optional(),
  baseURL: z.url().optional(),
});

/*
 * User settings of the hub, in `MONSTERS_HOME/settings.json` (optional, every
 * field has a default). Server settings (host, port, origins) stay in config.ts.
 */

export const SETTINGS_FILE = 'settings.json';
/** Name of the notes folder of the Italian layout (`~/Monsters Note`), the one of every install before D-154. */
export const VAULT_DIR_NAME = VAULT_LAYOUTS.it.notesDir;
/** Name before 16/10 (the glossary has no "vault"): kept wherever that folder already exists. */
export const LEGACY_VAULT_DIR_NAME = LEGACY_NOTES_DIR_NAME;

/**
 * The layout a vault created now takes (D-154): the app's language, or
 * `MONSTERS_VAULT_LAYOUT` (`it`, `en`) when set (tests, trials). An existing
 * vault keeps its own (`detectVaultLayout`).
 */
export function newVaultLayout(env: NodeJS.ProcessEnv = process.env): VaultLayoutId {
  // The process environment counts too, as for MONSTERS_EMBEDDINGS (a test's own `env`).
  const forced = env['MONSTERS_VAULT_LAYOUT'] ?? process.env['MONSTERS_VAULT_LAYOUT'];
  return isVaultLayoutId(forced) ? forced : appLang();
}

/** The default folder named `wanted`, unless only the folder of the other layout exists (it is kept). */
function existingOr(parent: string, wanted: string, other: string): string {
  const own = join(parent, wanted);
  if (existsSync(own)) return own;
  const theirs = join(parent, other);
  return existsSync(theirs) ? theirs : own;
}

/**
 * Default folder of the vault: `~/Monsters Note` (`~/Monsters Notes` for a new
 * install in English, D-154) for the default data directory, the same name in
 * `<home>` for a custom `MONSTERS_HOME` (tests and trials never touch the real
 * vault). A folder that already exists is kept whatever the language: an
 * existing `Monsters Vault` first, then the name of either language, so nobody
 * loses their notes to a rename or to a change of language.
 */
export function defaultVaultDir(home: string, lang: VaultLayoutId = newVaultLayout()): string {
  const standard = resolve(join(homedir(), '.monsters'));
  const parent = resolve(home) === standard ? homedir() : home;
  const legacy = join(parent, LEGACY_VAULT_DIR_NAME);
  if (existsSync(legacy)) return legacy;
  const other = lang === 'it' ? 'en' : 'it';
  return existingOr(parent, VAULT_LAYOUTS[lang].notesDir, VAULT_LAYOUTS[other].notesDir);
}

/** Folder of the new project folders of the Italian layout (D-098): next to the notes. */
export const PROJECTS_DIR_NAME = VAULT_LAYOUTS.it.projectsDir;

/**
 * Folder of the new project folders a proposal asks for (D-098), next to the
 * notes: `~/Monsters Progetti` for the default data directory (`~/Monsters
 * Projects` with an English vault, D-154), next to a custom `MONSTERS_HOME`
 * otherwise (never inside it: a project cannot work in the data). The folder of
 * the other layout is kept when only that one exists.
 */
export function defaultProjectsDir(home: string, layout: VaultLayout = vaultLayout()): string {
  const standard = resolve(join(homedir(), '.monsters'));
  const parent = resolve(home) === standard ? homedir() : dirname(resolve(home));
  const other = VAULT_LAYOUTS[layout.id === 'it' ? 'en' : 'it'];
  return existingOr(parent, layout.projectsDir, other.projectsDir);
}

/** Permissions of one agent (or the team's defaults) in `settings.json`. */
export const AgentPermissionsSettingSchema = z.object({
  vault: z.boolean().default(true),
  web: z.boolean().default(true),
  /** Terminal and CLIs: off unless the user turns it on. */
  shell: z.boolean().default(false),
  folders: z
    .array(z.object({ path: z.string().min(1).max(1024), write: z.boolean().default(false) }))
    .max(20)
    .default([]),
});
export type AgentPermissionsSetting = z.infer<typeof AgentPermissionsSettingSchema>;

export const HubSettingsSchema = z.object({
  /**
   * The app's language (D-153): UI, the core's messages, Telegram. Written at the
   * first start (`resolveAppLanguage`), changed from the settings.
   */
  language: LangSchema.optional(),
  /** Folder of the vault (created if missing). Default: see `defaultVaultDir`. */
  vault: z.string().min(1).optional(),
  /** How the agents address the user (until the onboarding sets it). */
  userName: z
    .string()
    .min(1)
    .max(60)
    .default(() => teamStrings().userName),
  /** Name of the orchestrator created by the default team. */
  orchestratorName: z.string().min(1).max(40).default('Titan'),
  /** Concept variant of the roster genomes used by the default team. */
  monsterVariant: z.enum(['A', 'B']).default('A'),
  /** Turns of recent conversation (user + agent) given to an agent at each run. */
  conversationTurns: z.number().int().min(0).max(100).default(12),
  /**
   * Past those turns (or near the model's window) the older ones become a
   * summary instead of being forgotten (C.3, D-082). Off: the latest turns only.
   */
  conversationSummary: z.boolean().default(true),
  /**
   * Who may write the summary: `provider` (default) the links of the monster's
   * chain on its first link's provider; `chain` every link, cheapest first.
   */
  conversationSummaryModels: z.enum(['provider', 'chain']).default('provider'),
  /** Watch the vault for changes made outside Monsters (Obsidian). */
  watchVault: z.boolean().default(true),
  /**
   * Search the vault also by meaning: a local embedding model (~120 MB) is
   * downloaded at first use into `<home>/models`. Off = full-text only.
   */
  semanticSearch: z.boolean().default(true),
  /**
   * What external AI clients (Claude Desktop, Codex, Cursor… through
   * `monsters mcp`) may change in the vault, like a sub-agent: their area
   * `Agenti/MCP/` (`Agents/MCP/` in an English vault), new notes in `Inbox/`, plus these globs.
   */
  mcp: z
    .object({
      write: z.array(z.string().min(1)).default([]),
      delete: z.array(z.string().min(1)).default([]),
    })
    .default({ write: [], delete: [] }),
  openrouter: z
    .object({
      /** Refuse paid models (spending cap 0 $). */
      freeOnly: z.boolean().default(true),
      rpm: z.number().int().min(1).optional(),
      rpd: z.number().int().min(1).optional(),
    })
    .default({ freeOnly: true }),
  /**
   * Other providers (M2.2), by id: the address of a local server (Ollama, LM
   * Studio) and limits chosen by the user. Keys live in `secrets/`, not here.
   */
  providers: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
      z.object({
        baseURL: z.string().min(1).max(300).optional(),
        rpm: z.number().int().min(1).optional(),
        rpd: z.number().int().min(1).optional(),
      }),
    )
    .default({}),
  decisions: z
    .object({
      /** Minimum confidence for the model to decide without asking. */
      threshold: z.number().min(0).max(1).default(0.8),
      /** Fallback chain of the small model of the gate. Default: the orchestrator's. */
      models: z.array(ModelRefSchema).optional(),
      /** Rules that replace (same id) or extend the default ones. */
      rules: z.array(DecisionRuleSchema).default([]),
      /** Ids of default rules to turn off. */
      disabled: z.array(z.string()).default([]),
      /**
       * Legacy (before D-067), moved to `instinct` at startup: `model: false` was
       * "only the rules", `engine` the user's engine, `jev` the Jev settings.
       */
      model: z.boolean().optional(),
      engine: z.enum(['llm', 'jev']).optional(),
      jev: LegacyJevSchema.optional(),
    })
    .default({ threshold: 0.8, rules: [], disabled: [] }),
  /**
   * The team's instinct (System 1, D-067): the engine of every quick decision
   * and the mode of each use. The TypeSafe key lives in `secrets/typesafe.key`
   * or `TYPESAFE_API_KEY`.
   */
  instinct: z
    .object({
      /**
       * `rules`, `llm` (the small model) or `jev` (TypeSafe, the small model as
       * fallback of the gate). Unset: Jev with a TypeSafe key, the rules without.
       */
      engine: DecisionEngineSchema.optional(),
      /** Mode of each use; a use left out has its default (`INSTINCT_SPECS`). */
      uses: z.partialRecord(InstinctUseSchema, InstinctModeSchema).default({}),
      jev: z
        .object({
          /** Pinned: the thresholds are measured on this version. */
          model: z.string().min(1).max(60).default(JEV_DEFAULT_MODEL),
          /** Longest wait of a call off the critical path (the critical uses wait 1.5 s). */
          timeoutMs: z.number().int().min(500).max(60_000).default(8_000),
          baseURL: z.url().optional(),
          /** The gate proceeds on Jev's word only with p("the user decides") ≤ maxP. */
          maxP: z.number().min(0).max(1).default(0.45),
        })
        .default({ model: JEV_DEFAULT_MODEL, timeoutMs: 8_000, maxP: 0.45 }),
    })
    .default({ uses: {}, jev: { model: JEV_DEFAULT_MODEL, timeoutMs: 8_000, maxP: 0.45 } }),
  /**
   * Search backends for `web_search`, in order of preference. Default: DuckDuckGo, then
   * Wikipedia; a Brave key saved from the settings goes first.
   */
  webSearch: z.array(SearchBackendConfigSchema).optional(),
  /**
   * Paid web search on OpenRouter, first in the chain (D-071): `auto` is on
   * when paid models are allowed (`openrouter.freeOnly` off), `on`/`off` are
   * the user's choice. Used only with an OpenRouter key that has credit.
   */
  paidSearch: z
    .object({
      mode: PaidSearchModeSchema.default('auto'),
      engine: PaidSearchEngineSchema.default('parallel'),
    })
    .default({ mode: 'auto', engine: 'parallel' }),
  /** Cost limits of one run of the orchestrator (delegations, open questions, steps, tokens). */
  limits: RunLimitsSchema.default(DEFAULT_RUN_LIMITS),
  /** Spending caps in euros, per day and per month, for the team and per monster (D-070). */
  spend: SpendSettingsSchema.default(DEFAULT_SPEND_SETTINGS),
  /**
   * What the agents may do (granted at the onboarding, editable in the
   * settings): the team's defaults, and `agents[id]` replacing them for one
   * agent. Reading the vault is always allowed. Files written before Phase 2
   * (`{ vault, web }`) stay valid: no terminal, no folders.
   */
  /**
   * External MCP servers (M2.5), by name: how to start or reach them and which
   * agents may use them. Values of variables and headers live in `secrets/`.
   */
  mcpServers: McpServersSettingSchema,
  permissions: AgentPermissionsSettingSchema.extend({
    agents: z.record(z.string(), AgentPermissionsSettingSchema).default({}),
  }).default({ vault: true, web: true, shell: false, folders: [], agents: {} }),
  /** Telegram notifications (M2.6): quiet hours and which kinds to send. */
  telegram: TelegramPrefsSchema.default(DEFAULT_TELEGRAM_PREFS),
  /**
   * Archive of the event log (log/archive.ts): the bulky events (usage of the models, results
   * of the tools, streamed text…) older than `days` move to `archive/events-YYYY-MM.jsonl.gz`,
   * at most once a day. Off: they move only with `monsters log archive`.
   */
  logArchive: z
    .object({
      enabled: z.boolean().default(true),
      days: z.number().int().min(LOG_ARCHIVE_MIN_DAYS).max(3650).default(LOG_ARCHIVE_DEFAULT_DAYS),
    })
    .default({ enabled: true, days: LOG_ARCHIVE_DEFAULT_DAYS }),
});
export type HubSettings = z.infer<typeof HubSettingsSchema>;
export type HubSettingsInput = z.input<typeof HubSettingsSchema>;

function expand(path: string): string {
  const p = path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
  return isAbsolute(p) ? p : resolve(p);
}

/**
 * Reads `settings.json` (missing file = defaults), then applies overrides and
 * `MONSTERS_VAULT`. Throws on an invalid file: better than running with a
 * configuration the user did not mean.
 */
export function loadHubSettings(
  home: string,
  overrides: HubSettingsInput = {},
  env: NodeJS.ProcessEnv = process.env,
): HubSettings & { vault: string } {
  let raw: unknown = {};
  const file = join(home, SETTINGS_FILE);
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`${file}: ${(err as Error).message}`, { cause: err });
    }
  }
  const merged = { ...(raw as object), ...overrides };
  const parsed = HubSettingsSchema.safeParse(merged);
  if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
  const vault = expand(
    overrides.vault ??
      env['MONSTERS_VAULT'] ??
      parsed.data.vault ??
      defaultVaultDir(home, newVaultLayout(env)),
  );
  return { ...parsed.data, vault };
}
