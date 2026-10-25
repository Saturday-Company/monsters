import type { AgentPermissions } from '@monsters/shared';

/*
 * What a monster may do, in three steps (C7, U2-5): "Notes only", "Notes and web", "Also runs
 * commands". A preset sets the web and the commands; whether the monster writes in the notes and
 * which folders it may use stay as they are, so "Apply to all" never undoes a choice made on one
 * monster. A mix the three do not describe (commands without the web) reads as "custom" and is
 * only reached through the switches behind the row.
 */

export type Full = Required<AgentPermissions>;

export function full(p: AgentPermissions): Full {
  return { vault: p.vault, web: p.web, shell: p.shell ?? false, folders: p.folders ?? [] };
}

export const PRESETS = ['notes', 'web', 'commands'] as const;
export type Preset = (typeof PRESETS)[number];

/** The preset that describes these permissions, or null for a mix of the switches. */
export function presetOf(p: AgentPermissions): Preset | null {
  const f = full(p);
  if (f.shell) return f.web ? 'commands' : null;
  return f.web ? 'web' : 'notes';
}

/** The permissions after choosing a preset: web and commands follow it, the rest stays. */
export function withPreset(p: AgentPermissions, preset: Preset): Full {
  return { ...full(p), web: preset !== 'notes', shell: preset === 'commands' };
}
