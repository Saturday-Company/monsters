import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERMISSIONS_REVISION,
  type AgentPermissions,
  type InstinctMode,
  type InstinctUse,
  type Lang,
  type TelegramPrefs,
} from '@monsters/shared';
import { writeSensitiveFile } from '../config.ts';
import type { DecisionRuleInput } from '../team/decision.ts';
import { SETTINGS_FILE } from '../team/settings.ts';

/*
 * Writes what the onboarding decides into `settings.json`, keeping every other
 * field as the user wrote it.
 */

export interface SettingsPatch {
  /** The app's language (D-153). */
  language?: Lang;
  userName?: string;
  orchestratorName?: string;
  /** The whole object: the team defaults and, when given, the permissions of each agent. */
  permissions?: AgentPermissions & { agents?: Record<string, AgentPermissions> };
  decisions?: { rules: DecisionRuleInput[]; disabled: string[] };
  /**
   * The instinct (D-067), merged into `instinct`: `engine: null` drops the
   * user's choice (back to the default: Jev with a key, the rules without),
   * `uses` are merged by use, `jev` replaces the Jev settings.
   */
  instinct?: {
    engine?: 'rules' | 'llm' | 'jev' | null;
    uses?: Partial<Record<InstinctUse, InstinctMode>>;
    jev?: Record<string, unknown>;
  };
  /** Drops the engine fields of `decisions` written before D-067 (moved to `instinct`). */
  dropLegacyEngine?: boolean;
  /** Telegram notifications (the whole object). */
  telegram?: TelegramPrefs;
  /** OpenRouter: merged into `openrouter`, limits untouched. */
  openrouter?: { freeOnly: boolean };
  /** Spending caps (D-070): the whole object. */
  spend?: Record<string, unknown>;
  /** Paid web search (D-071): merged into `paidSearch`. */
  paidSearch?: { mode?: 'auto' | 'on' | 'off'; engine?: 'parallel' | 'exa' };
}

export function readSettingsFile(home: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

/** Merges `patch` into `settings.json`. Decision rules replace the ones with the same id. */
export function patchSettingsFile(home: string, patch: SettingsPatch): Record<string, unknown> {
  const current = readSettingsFile(home);
  const next: Record<string, unknown> = { ...current };
  if (patch.language !== undefined) next['language'] = patch.language;
  if (patch.userName !== undefined) next['userName'] = patch.userName;
  if (patch.orchestratorName !== undefined) next['orchestratorName'] = patch.orchestratorName;
  if (patch.permissions !== undefined) {
    next['permissions'] = patch.permissions;
    // A choice of the user from now on: `openSavedPermissions` never changes it.
    next['permissionsRevision'] = PERMISSIONS_REVISION;
  }
  if (patch.telegram !== undefined) next['telegram'] = patch.telegram;
  if (patch.openrouter !== undefined) {
    const current = (next['openrouter'] ?? {}) as Record<string, unknown>;
    next['openrouter'] = { ...current, ...patch.openrouter };
  }
  if (patch.paidSearch !== undefined) {
    const current = (next['paidSearch'] ?? {}) as Record<string, unknown>;
    next['paidSearch'] = { ...current, ...patch.paidSearch };
  }
  if (patch.decisions) {
    const decisions = (current['decisions'] ?? {}) as Record<string, unknown>;
    const ids = new Set(patch.decisions.rules.map((r) => r.id));
    const kept = ((decisions['rules'] ?? []) as DecisionRuleInput[]).filter(
      (r) => !ids.has(r.id) && r.id !== 'user-ask',
    );
    next['decisions'] = {
      ...decisions,
      rules: [...kept, ...patch.decisions.rules],
      disabled: patch.decisions.disabled,
    };
  }
  if (patch.dropLegacyEngine && next['decisions'] && typeof next['decisions'] === 'object') {
    const decisions = { ...(next['decisions'] as Record<string, unknown>) };
    delete decisions['model'];
    delete decisions['engine'];
    delete decisions['jev'];
    next['decisions'] = decisions;
  }
  if (patch.instinct) {
    const instinct = { ...((next['instinct'] ?? {}) as Record<string, unknown>) };
    const { engine, uses, jev } = patch.instinct;
    if (engine === null) delete instinct['engine'];
    else if (engine !== undefined) instinct['engine'] = engine;
    if (uses) {
      instinct['uses'] = { ...((instinct['uses'] ?? {}) as Record<string, unknown>), ...uses };
    }
    if (jev) instinct['jev'] = jev;
    next['instinct'] = instinct;
  }
  if (patch.spend !== undefined) next['spend'] = patch.spend;
  writeSensitiveFile(join(home, SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Once per installation (D-1xx-tools): permissions saved when the terminal was off by default
 * get it on, for the team and for every monster with permissions of its own. Returns who got it
 * (`defaults` or an agent id), empty when nothing changed. Files without permissions (before
 * the onboarding) only get the revision: the defaults already have the terminal on.
 */
export function openSavedPermissions(home: string): string[] {
  const current = readSettingsFile(home);
  const revision = current['permissionsRevision'];
  if (typeof revision === 'number' && revision >= PERMISSIONS_REVISION) return [];
  const next: Record<string, unknown> = { ...current, permissionsRevision: PERMISSIONS_REVISION };
  const opened: string[] = [];
  const saved = current['permissions'];
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const permissions = { ...(saved as Record<string, unknown>) };
    if (permissions['shell'] !== true) {
      permissions['shell'] = true;
      opened.push('defaults');
    }
    const agents = permissions['agents'];
    if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
      const own: Record<string, unknown> = {};
      for (const [id, p] of Object.entries(agents as Record<string, unknown>)) {
        if (p && typeof p === 'object' && (p as Record<string, unknown>)['shell'] !== true) {
          own[id] = { ...(p as Record<string, unknown>), shell: true };
          opened.push(id);
        } else own[id] = p;
      }
      permissions['agents'] = own;
    }
    next['permissions'] = permissions;
  } else if (Object.keys(current).length === 0) {
    // No settings file yet: nothing to open, the revision comes with the first save.
    return [];
  }
  writeSensitiveFile(join(home, SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return opened;
}
