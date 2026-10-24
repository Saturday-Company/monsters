import { placesStrings, placesStringsOf } from './app-places.strings.ts';
import { instinctStrings } from './instinct.strings.ts';
import { LANGS } from './i18n.ts';

/*
 * The names of the app's places, word for word as the UI shows them (D-133).
 * The UI renders its tabs and section titles from these constants, and the
 * texts of the core that send the user somewhere ("Settings → Connections →
 * Apps and services", "the project page, Spending tab") are built from them, in the
 * language of the app (D-153): a renamed tab cannot leave a monster pointing at
 * a screen that does not exist (review of 19/10: «External tools»,
 * «Permessi → Altri programmi»).
 * A test of the web app checks the screens use them; a test of the core checks
 * every "Settings → …" left in the code names a real place.
 *
 * The ids (`squadra`, `altriProgrammi`…) are routes and keys: they stay Italian.
 * The names are objects with getters, so they are read in the language in use
 * each time (`SETTINGS_TABS.squadra`, `SETTINGS_SECTIONS.ilWeb.label`).
 */

/** The settings, as the bar on the left names them (in the language in use). */
export function settingsLabel(): string {
  return placesStrings().settings;
}

/** Tabs of the settings (`SettingsView`): the names follow the language when read. */
export const SETTINGS_TABS = {
  get squadra() {
    return placesStrings().tabs.squadra;
  },
  get modelli() {
    return placesStrings().tabs.modelli;
  },
  get permessi() {
    return placesStrings().tabs.permessi;
  },
  get collegamenti() {
    return placesStrings().tabs.collegamenti;
  },
  get generale() {
    return placesStrings().tabs.generale;
  },
};
export type SettingsTabId = keyof typeof SETTINGS_TABS;

type SettingsPlace = {
  readonly tab: SettingsTabId;
  readonly label: string;
  /** The section it sits inside (a drawer): its name comes between the tab and this one. */
  readonly under?: string;
};

/** Section titles of the settings, with the tab they are in (the labels follow the language). */
export const SETTINGS_SECTIONS = {
  /** Squadra: the closed drawer at the bottom, with the decisions and the scorecard (`TeamTab`). */
  avanzate: {
    tab: 'squadra',
    get label() {
      return placesStrings().sections.avanzate;
    },
  },
  /** Squadra, inside Advanced: who takes the quick decisions (`InstinctSection`). */
  istinto: {
    tab: 'squadra',
    under: 'avanzate',
    get label() {
      return instinctStrings().title;
    },
  },
  /** Modelli: Claude and ChatGPT plans (`ModelsTab`). */
  abbonamenti: {
    tab: 'modelli',
    get label() {
      return placesStrings().sections.abbonamenti;
    },
  },
  /** Modelli: the spending cap (`SpendSection`). */
  tettoDiSpesa: {
    tab: 'modelli',
    get label() {
      return placesStrings().sections.tettoDiSpesa;
    },
  },
  /** Permessi: what they always ask first (`AskAlwaysSection`). */
  teLoChiedonoSempre: {
    tab: 'permessi',
    get label() {
      return placesStrings().sections.teLoChiedonoSempre;
    },
  },
  /** Permessi: the web of each monster (`AgentPermissionsSettings`). */
  ilWeb: {
    tab: 'permessi',
    get label() {
      return placesStrings().sections.ilWeb;
    },
  },
  /** Permessi: terminal and folders (`AgentPermissionsSettings`). */
  terminale: {
    tab: 'permessi',
    get label() {
      return placesStrings().sections.terminale;
    },
  },
  /** Collegamenti: Telegram (`TelegramSection`). */
  telegram: {
    tab: 'collegamenti',
    get label() {
      return placesStrings().sections.telegram;
    },
  },
  /** Collegamenti: the web search backends (`WebSearchSection`). */
  ricercaWeb: {
    tab: 'collegamenti',
    get label() {
      return placesStrings().sections.ricercaWeb;
    },
  },
  /**
   * Collegamenti: the gallery of apps and services, the browser and the apps added by hand
   * (`McpServersSection`). The id is the old "other programs"; the group is one now.
   */
  altriProgrammi: {
    tab: 'collegamenti',
    get label() {
      return placesStrings().sections.altriProgrammi;
    },
  },
} as const satisfies Record<string, SettingsPlace>;
export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS;

/** Tabs of a project's page (`ProjectsView`): the names follow the language when read. */
export const PROJECT_TABS = {
  get chat() {
    return placesStrings().projectTabs.chat;
  },
  get squadra() {
    return placesStrings().projectTabs.squadra;
  },
  get note() {
    return placesStrings().projectTabs.note;
  },
  get cartella() {
    return placesStrings().projectTabs.cartella;
  },
  get collegamenti() {
    return placesStrings().projectTabs.collegamenti;
  },
  get automazioni() {
    return placesStrings().projectTabs.automazioni;
  },
  get spesa() {
    return placesStrings().projectTabs.spesa;
  },
};
export type ProjectTabId = keyof typeof PROJECT_TABS;

/**
 * "Settings → Connections", or "Settings → Connections → Apps and services" (Italian: "Impostazioni →
 * Collegamenti"); a section inside a drawer names it too ("Settings → Squad → Advanced →
 * Monsters’ decisions"). A text puts "in" before it, in both languages.
 */
export function settingsPath(
  place: SettingsTabId | SettingsSectionId,
  ...more: readonly string[]
): string {
  const section = (SETTINGS_SECTIONS as Record<string, SettingsPlace>)[place];
  const parent = section?.under
    ? (SETTINGS_SECTIONS as Record<string, SettingsPlace>)[section.under]
    : undefined;
  const parts = section
    ? [SETTINGS_TABS[section.tab], ...(parent ? [parent.label] : []), section.label]
    : [SETTINGS_TABS[place as SettingsTabId]];
  return [settingsLabel(), ...parts, ...more].join(' → ');
}

/**
 * A project's page and one of its tabs, as a noun phrase without article: the caller says
 * "the" (English: "the “X” project page, Spending tab") or "nella" (Italian: "nella pagina del
 * progetto «X», scheda Spesa").
 */
export function projectPagePath(project: string, tab: ProjectTabId): string {
  return placesStrings().projectPage(project, PROJECT_TABS[tab]);
}

/**
 * Where a spending cap is raised: a project's cap on its page (D-097), the others in
 * Settings → Models → Spending cap (review of 19/10, §2.3). `true`: a project whose name is not
 * known here. A project's page is a noun phrase without article, as `projectPagePath` ("the
 * Spending tab of the project page" / "la scheda Spesa della pagina del progetto").
 */
export function spendCapPath(project?: string | true): string {
  if (project === true) return placesStrings().projectTabOfPage(PROJECT_TABS.spesa);
  return project ? projectPagePath(project, 'spesa') : settingsPath('tettoDiSpesa');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a text names a tab of the settings the user can be sent to ("Settings → Models",
 * "Impostazioni → Modelli"), in any language: a text already in the log keeps the language it was
 * written in. `tab` is the id of the tab (the route's `sezione`).
 */
export function findSettingsPlaces(text: string): { index: number; text: string; tab: string }[] {
  const byName = new Map<string, string>();
  const settings = new Set<string>();
  for (const lang of LANGS) {
    const t = placesStringsOf(lang);
    settings.add(t.settings);
    for (const tab of ['modelli', 'permessi', 'collegamenti'] as const)
      byName.set(t.tabs[tab], tab);
  }
  // Tabs of earlier versions of the app: their route still leads somewhere.
  // i18n-ignore: names of screens of the first Italian app, matched in old texts
  byName.set('Aspetto', 'aspetto').set('Account', 'account');
  const pattern = new RegExp(
    `(?:${[...settings].map(escapeRegex).join('|')}) → (${[...byName.keys()].map(escapeRegex).join('|')})`,
    'g',
  );
  return [...text.matchAll(pattern)].map((m) => ({
    index: m.index,
    text: m[0],
    tab: byName.get(m[1]!)!,
  }));
}
