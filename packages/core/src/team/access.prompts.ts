import { PROJECT_TABS, formatList, pick, projectPagePath, settingsPath } from '@monsters/shared';

/*
 * What the models read about their accesses (D-153, wave 3): the reasons an access is missing
 * (`access-state.ts`), the reminder and the note that correct a claim the log does not back
 * (`access-claims.ts`), the "Done" and "Not granted" notes after an access request and what the
 * tool tells the model (`access-requests.ts`). Two families: the one of the app's language at
 * the moment the text is produced. The Italian one is byte for byte what it was; the English
 * one quotes the places and labels of the English app (`@monsters/shared` app places, the
 * access card's labels in `access.strings.ts`), never retyped. The word matchers that read what
 * the monsters write are in `access-claims.ts`: they cover both families.
 */

const en = {
  // --- why an access is missing (`access-state.ts`)
  /** After "…is on but not given to you": a monster that can ask for it, or must tell its lead. */
  askHow: (canAsk: boolean, lead: boolean): string =>
    canAsk ? ' (you can ask for it with `access_request`)' : lead ? '' : ' (ask your squad lead)',
  webPermissionOff: () =>
    `the web permission is off: the user turns it on in ${settingsPath('ilWeb')}`,
  webOffInProject: (project: string) =>
    `web search is off in the project “${project}”: it is turned on in the project page, ${PROJECT_TABS.impostazioni} tab`,
  webNotInRun: (others: readonly string[]) =>
    others.length
      ? `it is not among the tools of this job (not because the user said no: the permission is on), ${formatList(others)} ${others.length === 1 ? 'has' : 'have'} it`
      : 'it is not among the tools of this job (not because the user said no: the permission is on)',
  terminalPermissionOff: () =>
    `the terminal permission is off: the user turns it on in ${settingsPath('terminale')}`,
  terminalOthersAsk: 'other people write in this Telegram chat: the terminal and files are closed',
  terminalNotInRun: 'they are not among the tools of this job (not because the user said no)',
  browserOff: () =>
    `the Monsters browser is off: the user turns it on in ${settingsPath('altriProgrammi')}`,
  browserNeedsWeb: 'the browser needs the web permission, which is off',
  browserNotResponding: 'the browser is not responding now',
  browserNotGivenProject: (project: string) =>
    `the browser is on but not given to you: it is given on the ${projectPagePath(project, 'impostazioni')}`,
  browserNotGiven: () =>
    `the browser is on but not given to you: the user gives it in ${settingsPath('collegamenti')}`,
  serviceOnlyProject: (name: string, project: string, ask: string) =>
    `${name} is connected to the user’s account but not to this project: it is given on the ${projectPagePath(project, 'impostazioni')}${ask}`,
  serviceNotResponding: (label: string) =>
    `${label} is not responding now (sign-in expired or an error): it is reconnected in ${settingsPath('collegamenti')}`,
  serverOff: (label: string) => `${label} is off in ${settingsPath('altriProgrammi')}`,
  serviceNotGiven: (label: string) =>
    `${label} is connected to the user’s account but not given to you: the user gives it in ${settingsPath('collegamenti')}`,
  viaClaudeReconnect: (name: string) =>
    `${name} (through Claude) needs to be reconnected: ${settingsPath('collegamenti')}`,
  viaClaudeOnlyClaude: (name: string) =>
    `${name} is connected through Claude: it only reaches the monsters that work with Claude`,
  serviceNotConnected: (name: string) =>
    `${name} is not connected to the account: the user connects it in ${settingsPath('collegamenti')}`,
  // --- the accesses of a monster as a fingerprint and the note of its change (D-141)
  capWeb: 'web access',
  capTerminal: 'terminal and files',
  capBrowser: 'the Monsters browser',
  accessChanged: (gained: readonly string[], lost: readonly string[]) => {
    const parts = [
      ...(gained.length ? [`from now on you have ${formatList(gained)}`] : []),
      ...(lost.length ? [`you no longer have ${formatList(lost)}`] : []),
    ];
    return `[Access changed] The user has changed your accesses: ${parts.join('; ')}. The “## Monsters” section as it is now applies: what memory, notes and the conversation say about accesses is from before the change.`;
  },
  // --- the facts a reminder is made of (`access-claims.ts`)
  defaultWhy: 'you don’t have it in this job',
  webOf: (member: string) => `${member}’s web access`,
  hasIt: (member: string) => `${member} has it`,
  youHaveIt: 'you have it in this job',
  youHaveThem: 'you have them in this job',
  whatWeb: 'web access',
  whatTerminal: 'terminal and files',
  whatBrowser: 'the Monsters browser',
  noUserNo:
    'There is no “no” from the user in the log of this job: they have not refused or denied anything.',
  noSession:
    'In Monsters there is no “don’t ask” mode and no session that denies access: the accesses are the ones in the “## Monsters” section, and a refusal from Claude Code or Codex is a rule of the configuration, not a permission from the user.',
  squadWeb: (who: readonly string[]) => `In the squad, web access is had by: ${who.join(', ')}.`,
  squadYou: 'you',
  userNoQuestion: (question: string | undefined) => `“${question ?? 'a question'}”: no`,
  userNoAccess: (summary: string) => `access “${summary}”: no`,
  // --- the reminder at the end of the turn and the note after the answer
  reminderHead: (said: string) =>
    `[System check] Your answer says things about accesses that the log of this job does not confirm: ${said}`,
  reminderTruth: 'How things really are:',
  reminderTools: 'What the tools answered:',
  reminderTail:
    'Rewrite the answer with these causes, as the system gave them to you: do not blame the user for refusals and do not say an access is denied, blocked or not connected if it is not so. If you can now do what was missing with the tools you have, do it.',
  quote: (s: string) => `“${s}”`,
  correctionHead:
    '[Note from Monsters] What this answer says about accesses does not match the log. How things really are:',
  // --- `access_request` (`access-requests.ts`)
  parked: (grant: string, deny: string) =>
    `The request is now with the user, as a card with "${grant}" and "${deny}". End your turn now with one ` +
    'short line saying what you asked and that you wait; do not ask it again. Their answer starts a new ' +
    'turn: once granted, the monster has it from its next job (delegate again).',
  toolDescription: (grant: string, deny: string) =>
    'Ask the user for an access that a monster of your squad lacks, with one tap: the web for a monster, ' +
    'a service already connected to the account (given to the whole team) for your project, or the browser ' +
    `of Monsters. The user sees a card with "${grant}" and "${deny}"; you never grant anything yourself. ` +
    'Use it when the work needs it, instead of explaining the settings. A service not connected to the ' +
    'account cannot be asked: the result says where the user connects it. Example: ' +
    '{"access": "service", "service": "Canva", "why": "To read the club’s graphics for the posts"}',
  theUser: 'the user',
  // --- what `access_request` throws (the text, the same in both families, is English)
  onlyForProject: (name: string) => `You ask for “${name}” only.`,
  monsterNotOfProject: (monster: string, project: string) => `${monster} is not of “${project}”`,
  notGranted: (summary: string) =>
    `Not granted: ${summary} stays as it is. Go on without it and do not ask for it again.`,
  grantedNotApplied: (message: string) =>
    `Granted, but Monsters could not apply it: ${message}. Tell the user.`,
  granted: (summary: string) =>
    `Done: Monsters has granted ${summary}. It applies from the next job of whoever uses it: delegate again (you have it from your next turn).`,
  // The labels of the web app's settings (`mcp.strings.ts`): “Show the browser window”.
  browserNotSetUp: (user: string) =>
    `Tell ${user} to turn it on in ${settingsPath('altriProgrammi', 'Browser')} (with “Show the browser window” to sign in to sites). You cannot ask it here.`,
  browserIsOff: () =>
    `Tell the user to turn it on in ${settingsPath('altriProgrammi', 'Browser')}.`,
  serviceReaches: (label: string) =>
    `${label} reaches the monsters of the personal squad already when it is given to the whole team: if its tools are missing, it is not signed in (${settingsPath('collegamenti')}).`,
  serviceYours: (label: string, prefix: string, unlinked: boolean) =>
    unlinked
      ? `${label} is yours already, but it is not responding now (sign-in expired or an error): tell the user to reconnect it in ${settingsPath('collegamenti')}. No card was shown.`
      : `${label} is yours already: its tools are yours in this job (\`${prefix}…\`, call them by name or find them with \`tools_search\`). No card was shown to the user: go on with the work.`,
  serviceOnAlready: (label: string, project: string, viaClaude: boolean) =>
    `${label} is on for “${project}” already. If its tools are missing, the user signs in again in ${settingsPath('collegamenti')}${viaClaude ? ' (and only monsters working with Claude get it)' : ''}.`,
  onlyUserChanges: (where: string, user: string) =>
    `Only the user changes who uses it, in ${where}: tell ${user}.`,
  viaClaudeLabel: 'through Claude',
  notConnectedHint: (name: string, user: string, viaClaude: boolean, connected: string) =>
    `Do not ask it: tell ${user} to connect ${name} in ${settingsPath('collegamenti')}` +
    `${viaClaude ? ' (“Connect through Claude”, with the Claude subscription)' : ''}; then you can ask it for the project. ` +
    `Connected now: ${connected}.`,
  browserOwnAccess: 'Ask with {"access": "browser"}.',
};

const it: typeof en = {
  askHow: (canAsk, lead) =>
    canAsk ? ' (puoi chiederlo con `access_request`)' : lead ? '' : ' (chiedilo al tuo capo)',
  webPermissionOff: () =>
    'il permesso «Il web» è spento: lo accende l’utente in Impostazioni → Permessi',
  webOffInProject: (project) =>
    `la ricerca sul web è spenta nel progetto «${project}»: si accende nella pagina del progetto, scheda Impostazioni`,
  webNotInRun: (others) => {
    // The Italian list: "A, B e C".
    const list =
      others.length < 2
        ? (others[0] ?? '')
        : `${others.slice(0, -1).join(', ')} e ${others.at(-1)!}`;
    return others.length
      ? `non è tra gli strumenti di questo lavoro (non per un no dell’utente: il permesso è acceso), ce l’hanno ${list}`
      : 'non è tra gli strumenti di questo lavoro (non per un no dell’utente: il permesso è acceso)';
  },
  terminalPermissionOff: () =>
    'il permesso «Terminale e cartelle» è spento: lo accende l’utente in Impostazioni → Permessi',
  terminalOthersAsk:
    'in questa chat di Telegram scrivono altre persone: terminale e file sono chiusi',
  terminalNotInRun: 'non sono tra gli strumenti di questo lavoro (non per un no dell’utente)',
  browserOff: () =>
    'il browser di Monsters è spento: lo accende l’utente in Impostazioni → Collegamenti → App e servizi',
  browserNeedsWeb: 'il browser vuole il permesso del web, che è spento',
  browserNotResponding: 'il browser non risponde ora',
  browserNotGivenProject: (project) =>
    `il browser è acceso ma non è dato a te: si dà nella pagina del progetto «${project}», scheda Impostazioni`,
  browserNotGiven: () =>
    'il browser è acceso ma non è dato a te: lo dà l’utente in Impostazioni → Collegamenti',
  serviceOnlyProject: (name, project, ask) =>
    `${name} è collegato all’account dell’utente ma non a questo progetto: si dà nella pagina del progetto «${project}», scheda Impostazioni${ask}`,
  serviceNotResponding: (label) =>
    `${label} non risponde ora (accesso scaduto o un errore): si ricollega in Impostazioni → Collegamenti`,
  serverOff: (label) => `${label} è spento in Impostazioni → Collegamenti → App e servizi`,
  serviceNotGiven: (label) =>
    `${label} è collegato all’account dell’utente ma non è dato a te: lo dà l’utente in Impostazioni → Collegamenti`,
  viaClaudeReconnect: (name) =>
    `${name} (tramite Claude) va ricollegato: Impostazioni → Collegamenti`,
  viaClaudeOnlyClaude: (name) =>
    `${name} è collegato tramite Claude: arriva solo ai mostri che lavorano con Claude`,
  serviceNotConnected: (name) =>
    `${name} non è collegato all’account: lo collega l’utente in Impostazioni → Collegamenti`,
  capWeb: 'il web',
  capTerminal: 'terminale e file',
  capBrowser: 'il browser di Monsters',
  accessChanged: (gained, lost) => {
    const list = (items: readonly string[]) =>
      items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)!}`;
    const parts = [
      ...(gained.length ? [`da ora hai ${list(gained)}`] : []),
      ...(lost.length ? [`non hai più ${list(lost)}`] : []),
    ];
    return `[Accessi cambiati] L’utente ha cambiato i tuoi accessi: ${parts.join('; ')}. Vale la sezione «## Monsters» di adesso: quello che memoria, note e conversazione dicono sugli accessi è di prima del cambio.`;
  },
  defaultWhy: 'non ce l’hai in questo lavoro',
  webOf: (member) => `il web di ${member}`,
  hasIt: (member) => `${member} ce l’ha`,
  youHaveIt: 'ce l’hai in questo lavoro',
  youHaveThem: 'ce li hai in questo lavoro',
  whatWeb: 'il web',
  whatTerminal: 'terminale e file',
  whatBrowser: 'il browser di Monsters',
  noUserNo:
    'Nel registro di questo lavoro non c’è nessun no dell’utente: non ha rifiutato né negato niente.',
  noSession:
    'In Monsters non c’è una «modalità don’t ask» né una sessione che nega accessi: gli accessi sono quelli della sezione «## Monsters», e un rifiuto di Claude Code o Codex è una regola della configurazione, non un permesso dell’utente.',
  squadWeb: (who) => `Il web nella squadra ce l’hanno: ${who.join(', ')}.`,
  squadYou: 'tu',
  userNoQuestion: (question) => `«${question ?? 'una domanda'}»: no`,
  userNoAccess: (summary) => `accesso «${summary}»: no`,
  reminderHead: (said) =>
    `[Controllo del sistema] La tua risposta dice cose sugli accessi che il registro di questo lavoro non conferma: ${said}`,
  reminderTruth: 'Come stanno davvero:',
  reminderTools: 'Cosa hanno risposto gli strumenti:',
  reminderTail:
    'Riscrivi la risposta con queste cause, come te le ha date il sistema: non attribuire rifiuti all’utente e non dire che un accesso è negato, bloccato o non collegato se non è così. Se ora puoi fare quello che mancava con gli strumenti che hai, fallo.',
  quote: (s) => `«${s}»`,
  correctionHead:
    '[Nota di Monsters] Quello che questa risposta dice sugli accessi non risulta dal registro. Come stanno davvero:',
  parked: (grant, deny) =>
    `The request is now with the user, as a card with "${grant}" and "${deny}". End your turn now with one ` +
    'short line saying what you asked and that you wait; do not ask it again. Their answer starts a new ' +
    'turn: once granted, the monster has it from its next job (delegate again).',
  toolDescription: (grant, deny) =>
    'Ask the user for an access that a monster of your squad lacks, with one tap: the web for a monster, ' +
    'a service already connected to the account (given to the whole team) for your project, or the browser ' +
    `of Monsters. The user sees a card with "${grant}" and "${deny}"; you never grant anything yourself. ` +
    'Use it when the work needs it, instead of explaining the settings. A service not connected to the ' +
    'account cannot be asked: the result says where the user connects it. Example: ' +
    '{"access": "service", "service": "Canva", "why": "Leggere le grafiche del club per i post"}',
  theUser: 'l’utente',
  onlyForProject: (name) => `You ask for «${name}» only.`,
  monsterNotOfProject: (monster, project) => `${monster} is not of «${project}»`,
  notGranted: (summary) =>
    `Non concesso: ${summary} resta com’è. Vai avanti senza e non chiederlo di nuovo.`,
  grantedNotApplied: (message) =>
    `Concesso, ma Monsters non è riuscito ad applicarlo: ${message}. Dillo all’utente.`,
  granted: (summary) =>
    `Fatto: Monsters ha concesso ${summary}. Vale dal prossimo lavoro di chi lo usa: delega di nuovo (tu lo hai dal tuo prossimo turno).`,
  browserNotSetUp: (user) =>
    `Tell ${user} to turn it on in Impostazioni → Collegamenti → App e servizi → Browser (with "Mostra la finestra del browser" to sign in to sites). You cannot ask it here.`,
  browserIsOff: () =>
    'Tell the user to turn it on in Impostazioni → Collegamenti → App e servizi → Browser.',
  serviceReaches: (label) =>
    `${label} reaches the monsters of the personal squad already when it is given to the whole team: if its tools are missing, it is not signed in (Impostazioni → Collegamenti).`,
  serviceYours: (label, prefix, unlinked) =>
    unlinked
      ? `${label} is yours already, but it is not responding now (sign-in expired or an error): tell the user to reconnect it in Impostazioni → Collegamenti. No card was shown.`
      : `${label} is yours already: its tools are yours in this job (\`${prefix}…\`, call them by name or find them with \`tools_search\`). No card was shown to the user: go on with the work.`,
  serviceOnAlready: (label, project, viaClaude) =>
    `${label} is on for «${project}» already. If its tools are missing, the user signs in again in Impostazioni → Collegamenti${viaClaude ? ' (and only monsters working with Claude get it)' : ''}.`,
  onlyUserChanges: (where, user) => `Only the user changes who uses it, in ${where}: tell ${user}.`,
  viaClaudeLabel: 'tramite Claude',
  notConnectedHint: (name, user, viaClaude, connected) =>
    `Do not ask it: tell ${user} to connect ${name} in Impostazioni → Collegamenti` +
    `${viaClaude ? ' ("Collega tramite Claude", with the Claude subscription)' : ''}; then you can ask it for the project. ` +
    `Connected now: ${connected}.`,
  browserOwnAccess: 'Ask with {"access": "browser"}.',
};

export const accessPrompts = () => pick({ en, it });
