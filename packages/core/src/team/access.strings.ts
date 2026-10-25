import { formatList, pick, projectPagePath, settingsPath } from '@monsters/shared';

/*
 * What the person reads about the accesses of the monsters (D-153): the card of an access
 * request ("Can I give …?"), what it changes, and the line in Activity when a claim about
 * accesses is corrected. The reminders and the reasons the monsters read are not here.
 */

const en = {
  grant: 'Yes, grant',
  deny: 'No',
  denyDescription: 'Everything stays as it is.',
  question: (summary: string, why: string) => `Can I give ${summary}? ${why}`,
  summaryWeb: (monster: string, project: string | undefined) =>
    `${monster} web access${project ? ` (project “${project}”)` : ''}`,
  summaryService: (service: string, project: string) => `${service} to the project “${project}”`,
  summaryBrowserProject: (project: string) => `the Monsters browser to the project “${project}”`,
  summaryBrowserMonsters: (names: readonly string[], project: string | undefined) =>
    `the Monsters browser to ${formatList(names)}${project ? ` (project “${project}”)` : ''}`,
  changeAgentWeb: (monster: string) => `Permissions: web access for ${monster}`,
  changeProjectWeb: (project: string) =>
    `${projectPagePath(project, 'impostazioni')}: web search turned on`,
  changeProjectLink: (project: string, label: string) =>
    `${projectPagePath(project, 'impostazioni')}: ${label} turned on`,
  changeServerAgent: (server: string, monster: string, browser: boolean) =>
    `${settingsPath('collegamenti', browser ? 'Browser' : server)}: ${monster} can use it too`,
  changesTail: (parts: readonly string[]) =>
    `${parts.join('; ')}. You can turn it off any time from the same place.`,
  stepMonsterGone: 'the monster is gone',
  stepProjectGone: 'the project is gone',
  stepLinkNotTeamWide: 'the app is no longer given to all monsters',
  stepServerGone: (server: string) => `${server} is no longer connected`,
  stepProjectsNotReady: 'projects aren’t ready',
  claimCorrected: (monster: string) =>
    `${monster} said an access was missing or denied, but the log doesn’t show it: I had it corrected.`,
  claimNote: (monster: string, truth: string) =>
    `${monster} wrote that an access was missing or denied, but the log doesn’t show it: ${truth}`,
};

const it: typeof en = {
  grant: 'Sì, concedi',
  deny: 'No',
  denyDescription: 'Resta tutto com’è.',
  question: (summary, why) => `Posso dare ${summary}? ${why}`,
  summaryWeb: (monster, project) =>
    `a ${monster} il web${project ? ` (progetto «${project}»)` : ''}`,
  summaryService: (service, project) => `${service} al progetto «${project}»`,
  summaryBrowserProject: (project) => `il browser di Monsters al progetto «${project}»`,
  summaryBrowserMonsters: (names, project) =>
    `il browser di Monsters a ${formatList(names)}${project ? ` (progetto «${project}»)` : ''}`,
  changeAgentWeb: (monster) => `Permessi: il web per ${monster}`,
  changeProjectWeb: (project) =>
    `${projectPagePath(project, 'impostazioni')}: ricerca sul web accesa`,
  changeProjectLink: (project, label) =>
    `${projectPagePath(project, 'impostazioni')}: ${label} acceso`,
  changeServerAgent: (server, monster, browser) =>
    `${settingsPath('collegamenti', browser ? 'Browser' : server)}: lo usa anche ${monster}`,
  changesTail: (parts) => `${parts.join('; ')}. Lo togli quando vuoi dallo stesso posto.`,
  stepMonsterGone: 'il mostro non c’è più',
  stepProjectGone: 'il progetto non c’è più',
  stepLinkNotTeamWide: 'l’app non è più data a tutti i mostri',
  stepServerGone: (server) => `${server} non è più collegato`,
  stepProjectsNotReady: 'i progetti non sono pronti',
  claimCorrected: (monster) =>
    `${monster} diceva che un accesso mancava o era stato negato, ma nel registro non risulta: gliel’ho fatto correggere.`,
  claimNote: (monster, truth) =>
    `${monster} ha scritto che un accesso mancava o era stato negato, ma nel registro non risulta: ${truth}`,
};

export const accessStrings = () => pick({ en, it });
