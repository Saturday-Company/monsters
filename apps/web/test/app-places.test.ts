import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_TABS,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  type SettingsSectionId,
  type SettingsTabId,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';

/*
 * The places the core sends the user to (D-133) are the screens of the app, word for word:
 * the tabs and the section titles render the shared constants, and each section is in the
 * tab the constant says. A renamed screen changes the constant, and with it every
 * "Impostazioni → …" the monsters write (review of 19/10: «External tools» did not exist,
 * «Altri programmi» was under Collegamenti, not Permessi).
 */

const components = join(import.meta.dirname, '..', 'src', 'components');
const source = (file: string) => readFileSync(join(components, file), 'utf8');

/** The panel of each settings tab (`SettingsView`'s `panel`). */
const TAB_FILE: Record<SettingsTabId, string> = {
  squadra: 'settings/TeamTab.tsx',
  modelli: 'settings/ModelsTab.tsx',
  permessi: 'settings/PermissionsTab.tsx',
  collegamenti: 'settings/LinksTab.tsx',
  generale: 'settings/GeneralTab.tsx',
};

/** The component that renders each section, and the one its tab renders it through. */
const SECTION_FILE: Record<SettingsSectionId, { file: string; via?: string }> = {
  abbonamenti: { file: 'settings/ModelsTab.tsx' },
  tettoDiSpesa: { file: 'settings/SpendSection.tsx', via: 'SpendSection' },
  teLoChiedonoSempre: { file: 'settings/AskAlwaysSection.tsx', via: 'AskAlwaysSection' },
  ilWeb: { file: 'settings/AgentPermissionsSettings.tsx', via: 'AgentPermissionsSettings' },
  terminale: { file: 'settings/AgentPermissionsSettings.tsx', via: 'AgentPermissionsSettings' },
  telegram: { file: 'settings/TelegramSection.tsx', via: 'TelegramSection' },
  ricercaWeb: { file: 'settings/WebSearchSection.tsx', via: 'WebSearchSection' },
  altriProgrammi: { file: 'settings/McpServersSection.tsx', via: 'McpServersSection' },
};

describe('the places of the app the monsters name (D-133)', () => {
  it('the settings tabs are the shared names, and their panels the expected ones', () => {
    const view = source('settings/SettingsView.tsx');
    for (const [id, label] of Object.entries(SETTINGS_TABS)) {
      expect(view, label).toContain(`label: SETTINGS_TABS.${id},`);
      expect(view).toContain(`case '${id}':`);
      const panel = TAB_FILE[id as SettingsTabId].replace(/^settings\/|\.tsx$/g, '');
      expect(view).toMatch(new RegExp(`case '${id}':\\s*return <${panel}`));
    }
  });

  it('every section title is rendered from its constant, inside the tab the constant names', () => {
    for (const [id, place] of Object.entries(SETTINGS_SECTIONS)) {
      const at = SECTION_FILE[id as SettingsSectionId];
      expect(source(at.file), place.label).toContain(`SETTINGS_SECTIONS.${id}.label`);
      if (at.via) expect(source(TAB_FILE[place.tab]), place.label).toContain(`<${at.via}`);
      else expect(at.file).toBe(TAB_FILE[place.tab]);
    }
  });

  it('the tabs of a project’s page are the shared names', () => {
    const view = source('projects/ProjectsView.tsx');
    for (const id of Object.keys(PROJECT_TABS)) {
      expect(view).toContain(`{ value: '${id}', label: PROJECT_TABS.${id} }`);
    }
  });
});
