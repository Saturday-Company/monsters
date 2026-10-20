/*
 * The names of the app's places, word for word as the UI shows them (D-133).
 * The UI renders its tabs and section titles from these constants, and the
 * texts of the core that send the user somewhere ("Impostazioni → Collegamenti
 * → Altri programmi", "la pagina del progetto, scheda Spesa") are built from
 * them: a renamed tab cannot leave a monster pointing at a screen that does not
 * exist (review of 19/10: «External tools», «Permessi → Altri programmi»).
 * A test of the web app checks the screens use them; a test of the core checks
 * every "Impostazioni → …" left in the code names a real place.
 */

/** The settings, as the bar on the left names them. */
export const SETTINGS_LABEL = 'Impostazioni';

/** Tabs of the settings (`SettingsView`). */
export const SETTINGS_TABS = {
  squadra: 'Squadra',
  modelli: 'Modelli',
  permessi: 'Permessi',
  collegamenti: 'Collegamenti',
  generale: 'Generale',
} as const;
export type SettingsTabId = keyof typeof SETTINGS_TABS;

/** Section titles of the settings, with the tab they are in. */
export const SETTINGS_SECTIONS = {
  /** Modelli: Claude and ChatGPT plans (`ModelsTab`). */
  abbonamenti: { tab: 'modelli', label: 'Un abbonamento che hai già' },
  /** Modelli: the spending cap (`SpendSection`). */
  tettoDiSpesa: { tab: 'modelli', label: 'Tetto di spesa' },
  /** Permessi: what they always ask first (`AskAlwaysSection`). */
  teLoChiedonoSempre: { tab: 'permessi', label: 'Te lo chiedono sempre' },
  /** Permessi: the web of each monster (`AgentPermissionsSettings`). */
  ilWeb: { tab: 'permessi', label: 'Il web' },
  /** Permessi: terminal and folders (`AgentPermissionsSettings`). */
  terminale: { tab: 'permessi', label: 'Terminale' },
  /** Collegamenti: Telegram (`TelegramSection`). */
  telegram: { tab: 'collegamenti', label: 'Telegram' },
  /** Collegamenti: the web search backends (`WebSearchSection`). */
  ricercaWeb: { tab: 'collegamenti', label: 'Ricerca sul web' },
  /** Collegamenti: MCP servers and the browser (`McpServersSection`). */
  altriProgrammi: { tab: 'collegamenti', label: 'Altri programmi' },
} as const satisfies Record<string, { tab: SettingsTabId; label: string }>;
export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS;

/** Tabs of a project's page (`ProjectsView`). */
export const PROJECT_TABS = {
  chat: 'Chat',
  squadra: 'Squadra',
  note: 'Note',
  cartella: 'Cartella',
  collegamenti: 'Collegamenti',
  automazioni: 'Automazioni',
  spesa: 'Spesa',
} as const;
export type ProjectTabId = keyof typeof PROJECT_TABS;

/** "Impostazioni → Collegamenti", or "Impostazioni → Collegamenti → Altri programmi". */
export function settingsPath(
  place: SettingsTabId | SettingsSectionId,
  ...more: readonly string[]
): string {
  const section = (SETTINGS_SECTIONS as Record<string, { tab: SettingsTabId; label: string }>)[
    place
  ];
  const parts = section
    ? [SETTINGS_TABS[section.tab], section.label]
    : [SETTINGS_TABS[place as SettingsTabId]];
  return [SETTINGS_LABEL, ...parts, ...more].join(' → ');
}

/** "pagina del progetto «X», scheda Spesa" (the caller says "nella"). */
export function projectPagePath(project: string, tab: ProjectTabId): string {
  return `pagina del progetto «${project}», scheda ${PROJECT_TABS[tab]}`;
}

/**
 * Where a spending cap is raised: a project's cap on its page (D-097), the others in
 * Impostazioni → Modelli → Tetto di spesa (review of 19/10, §2.3). `true`: a project whose
 * name is not known here.
 */
export function spendCapPath(project?: string | true): string {
  if (project === true) return `scheda ${PROJECT_TABS.spesa} della pagina del progetto`;
  return project ? projectPagePath(project, 'spesa') : settingsPath('tettoDiSpesa');
}
