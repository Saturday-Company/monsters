import { formatList } from '@monsters/shared';
import { defineStrings } from '../lib/i18n.ts';
import { toNameIt } from '../lib/utils.strings.ts';

/* The sentences of the event log and the chat (store/derive.ts), D-153. */

const en = {
  /* ------------------------------------------------------------- live mood */
  live: {
    thinking: 'Thinking…',
    asked: 'I asked you a question',
    confused: 'is changing course',
    wentWrong: 'Something went wrong',
    waitingFor: (name: string) => `Waiting for ${name}`,
    pickingUp: 'Picking the thread back up',
    couldNot: 'I couldn’t do it',
  },

  /* ----------------------------------------------------------------- tools */
  /** What a monster says it does, one line per tool call. */
  tool: {
    previewNote: (name: string) => `Showing you the note “${name}”`,
    previewFile: 'Showing you a file',
    searchWeb: (query: string) => `Searching “${query}”`,
    searchWebAny: 'Searching the web',
    fetchHost: (host: string) => `Reading ${host}`,
    fetchAny: 'Reading a web page',
    searchNotes: (query: string) => `Searching the notes for “${query}”`,
    searchNotesAny: 'Searching the notes',
    readNote: (name: string) => `Reading ${name}`,
    readNoteAny: 'Reading a note',
    writeNote: (name: string) => `Writing ${name}`,
    writeNoteAny: 'Writing a note',
    editNote: (name: string) => `Editing ${name}`,
    editNoteAny: 'Editing a note',
    trashNote: 'Moving a note to the trash',
    moveNote: (name: string) => `Moving ${name}`,
    moveNoteAny: 'Moving a note',
    listNotes: 'Listing the notes',
    links: 'Checking the links between notes',
    tags: 'Checking the notes’ tags',
    history: 'Checking a note’s history',
    restore: 'Putting a note back',
    propose: 'Proposing a change to you',
    applyProposal: 'Applying a proposed change',
    delegate: (to: string) => `Handing the work to ${to}`,
    delegateAny: 'Handing the work to a colleague',
    askTeammate: (to: string) => `Asking ${to}`,
    askTeammateAny: 'Asking a teammate',
    ask: 'Asking you a question',
    shell: (command: string) => `Running ${command}`,
    shellAny: 'Running a command',
    fsList: 'Listing the files in a folder',
    fsRead: (name: string) => `Reading ${name}`,
    fsReadAny: 'Reading a file',
    fsWrite: (name: string) => `Writing ${name}`,
    fsWriteAny: 'Writing a file',
    fsMove: (name: string) => `Moving ${name}`,
    fsMoveAny: 'Moving a file',
    fsTrash: 'Moving a file to the trash',
    other: 'Using a tool',
    browserOpen: (host: string) => `Opening ${host} in the browser`,
    browserOpenAny: 'Opening a page in the browser',
    browser: 'Using the browser',
    mcp: (server: string, name: string) => `Using ${server}: ${name}`,
  },

  /** What a tool does, as a phrase after "finished …": "searching the web". */
  toolAction: {
    web_search: 'searching the web',
    web_fetch: 'reading a page',
    ui_guide: 'reading the manual of the drawn blocks',
    vault_search: 'searching the notes',
    vault_read: 'reading a note',
    vault_list: 'listing the notes',
    vault_write: 'writing a note',
    vault_create: 'writing a note',
    vault_edit: 'editing a note',
    vault_move: 'moving a note',
    vault_delete: 'moving a note to the trash',
    vault_links: 'checking the links',
    vault_tags: 'checking the tags',
    vault_history: 'checking a note’s history',
    vault_restore: 'restoring a note',
    vault_undo: 'undoing a change',
    vault_propose: 'proposing a change',
    vault_apply_proposal: 'applying the proposed change',
    delegate: 'delegating',
    ask_user: 'asking a question',
    team_propose_monster: 'proposing a new monster',
    project_send: 'sending work to a project',
    project_status: 'checking the projects',
    project_propose: 'proposing a project',
    automation_propose: 'proposing an automation',
    shell: 'running the command',
    fs_list: 'listing the files',
    fs_read: 'reading a file',
    fs_write: 'writing a file',
    fs_move: 'moving a file',
    fs_delete: 'moving a file to the trash',
  } as Record<string, string>,
  browserAction: 'using the browser',
  mcpAction: 'using another app',
  otherAction: 'the operation',

  /** Short name of a tool for the terminal. */
  toolLabel: {
    web_search: 'Web search',
    web_fetch: 'Page read',
    ui_guide: 'Drawing manual',
    vault_search: 'Notes search',
    vault_read: 'Note read',
    vault_list: 'Notes list',
    vault_write: 'Note written',
    vault_create: 'Note written',
    vault_edit: 'Note edited',
    vault_move: 'Note moved',
    vault_delete: 'Note moved to the trash',
    vault_links: 'Link check',
    vault_tags: 'Tag check',
    vault_history: 'Note history check',
    vault_restore: 'Note restored',
    vault_undo: 'Change undone',
    vault_propose: 'Change proposed',
    vault_apply_proposal: 'Proposed change applied',
    delegate: 'Delegation',
    ask_user: 'Question',
    team_propose_monster: 'New monster proposal',
    project_send: 'Work sent to a project',
    project_status: 'Project check',
    project_propose: 'Project proposal',
    automation_propose: 'Automation proposal',
    shell: 'Command',
    fs_list: 'File list',
    fs_read: 'File read',
    fs_write: 'File written',
    fs_move: 'File moved',
    fs_delete: 'File moved to the trash',
  } as Record<string, string>,
  browserLabel: 'Browser use',
  mcpLabel: 'Other app use',
  otherLabel: 'Operation',

  /** Short names of the tools for the instrumentation line ("Web search ×3"). */
  toolShort: {
    web_search: 'Web search',
    web_fetch: 'Web page',
    vault_search: 'Notes search',
    vault_read: 'Note read',
    vault_list: 'Notes list',
    vault_write: 'Note written',
    vault_create: 'Note written',
    vault_edit: 'Note edited',
    vault_move: 'Note moved',
    vault_delete: 'Note in the trash',
    vault_links: 'Links',
    vault_tags: 'Tags',
    vault_history: 'Note history',
    vault_restore: 'Note restored',
    vault_undo: 'Undo',
    vault_propose: 'Proposal',
    vault_apply_proposal: 'Proposal applied',
    delegate: 'Delegation',
    ask_user: 'Question',
    team_propose_monster: 'New monster',
    project_send: 'To the project',
    project_status: 'Project status',
    project_propose: 'New project',
    automation_propose: 'New automation',
    preview_show: 'Preview',
    ui_guide: 'Drawing manual',
    shell: 'Command',
    fs_list: 'File list',
    fs_read: 'File read',
    fs_write: 'File written',
    fs_move: 'File moved',
    fs_delete: 'File in the trash',
  } as Record<string, string>,
  browserShort: 'Browser',

  model: {
    freeRouter: 'free one picked by OpenRouter',
    free: (name: string) => `${name} (free)`,
  },

  /* ------------------------------------------------------------------ chat */
  chat: {
    you: 'You',
    resumed: (request: string) => `Picked the stopped work back up: “${request}”`,
    stoppedAll: 'You stopped all the monsters',
    resumedAll: 'Back to work: the monsters are free again',
    telegramWhere: (title: string | undefined) =>
      title ? `from Telegram · ${title}` : 'from Telegram · in private',
    telegramVia: (title: string | undefined) =>
      title ? `on Telegram · ${title}` : 'on Telegram · in private',
    previewYou: (text: string) => `You: ${text}`,
    delegationDone: (to: string, task: string) => `${to} finished “${task}”`,
    delegationStarted: (to: string, task: string) => `Task for ${to}: ${task}`,
    delegationStopped: (to: string) => `${to}’s task stopped`,
    askedYou: (name: string) => `${name} asked you a question`,
    newConversation: 'New conversation',
    receipt: (summary: string) => `Receipt: ${summary}`,
    proposes: (name: string, monster: string) => `${name} proposes a new monster: ${monster}`,
    showsYou: (name: string, what: string) => `${name} shows you “${what}”`,
  },

  report: {
    restart: 'was interrupted: Monsters closed while it was working',
    stopped: 'was stopped before starting',
    completed: 'finished',
    waiting: 'is waiting for your answer',
    failed: 'couldn’t do it',
    aborted: 'stopped',
    sentence: (project: string, lead: string, outcome: string) => `${project}: ${lead} ${outcome}`,
  },

  group: {
    events: (n: number) => `${n} ${n === 1 ? 'event' : 'events'} among the monsters`,
    done: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} completed`,
    open: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} handed to the squad`,
    partDone: (n: number) => `${n} completed`,
    partOpen: (n: number) => `${n} in progress`,
    partOther: (n: number) => `${n} stopped`,
    mixed: (total: number, parts: string) => `${total} ${total === 1 ? 'task' : 'tasks'}: ${parts}`,
  },

  /** A list: "A, B and C". */
  list: (items: readonly string[]) => formatList(items),

  /* ------------------------------------------------------------ categories */
  category: {
    messages: 'Messages',
    runs: 'Jobs',
    delegations: 'Delegations',
    tools: 'Tools',
    questions: 'Questions',
    vault: 'Notes',
    errors: 'Errors',
    instinct: 'Monsters’ decisions',
    system: 'System',
  },

  /* ----------------------------------------------------------------- notes */
  vault: {
    /** "Rhea created the note Ideas" / "You created the note Ideas" (`who` null: the user). */
    change: (action: string, who: string | null, note: string) => {
      const verb: Record<string, string> = {
        create: 'created the note',
        edit: 'edited the note',
        move: 'moved the note',
        delete: 'trashed the note',
        restore: 'restored the note',
        undo: 'undid a change to',
        propose: 'proposed a change to',
      };
      return `${who ?? 'You'} ${verb[action] ?? 'touched the note'} ${note}`;
    },
    /** Past participles after "note": "Work note of Rhea (x) created". */
    noteParticiple: (action: string) =>
      ({
        create: 'created',
        edit: 'updated',
        move: 'moved',
        delete: 'moved to the trash',
        restore: 'restored',
        undo: 'rolled back',
        propose: 'with a proposed change',
      })[action] ?? 'touched',
    notesParticiple: (action: string) =>
      ({
        create: 'created',
        edit: 'updated',
        move: 'moved',
        delete: 'in the trash',
        restore: 'restored',
        undo: 'rolled back',
        propose: 'with a proposed change',
      })[action] ?? 'touched',
  },

  agentFile: {
    memoryUpdated: (owner: string) => `${owner} updated their notes`,
    memoryOther: (owner: string, participle: string) => `${owner}’s notes ${participle}`,
    stateUpdated: (owner: string) => `${owner} updated the state of their jobs`,
    stateOther: (owner: string, participle: string) =>
      `State of ${owner}’s jobs: note ${participle}`,
    workUpdated: (owner: string, name: string) => `${owner} updated a work note (${name})`,
    workOther: (owner: string, name: string, participle: string) =>
      `Work note of ${owner} (${name}) ${participle}`,
  },

  /* ---------------------------------------------------------------- errors */
  error: {
    stopped: (who: string) => `${who}’s work stopped`,
    searchFallback: (who: string, engine: 'wikipedia' | 'duckduckgo' | 'brave' | null) =>
      `The web search wasn’t responding: ${who} is using ${
        engine === 'wikipedia'
          ? 'Wikipedia'
          : engine === 'duckduckgo'
            ? 'DuckDuckGo'
            : engine === 'brave'
              ? 'Brave'
              : 'another engine'
      } instead`,
    noAlternative: (who: string, message: string) =>
      `${who}’s model isn’t responding and there are no alternatives: ${message}`,
    switchModel: (who: string) => `The model wasn’t responding: ${who} is switching to another one`,
    orphans: 'Closed processes left over from the previous start',
    killHook: 'The stop couldn’t close everything right away',
    internal: 'Monsters internal error',
    runLimit: (who: string) => `${who} stops here: this job reached its limit`,
    // Which cap stopped a job, from the data of the error (`limit`): see `limitStopSentence`.
    limit: {
      stopsHere: (who: string, why: string, raiseIn: string | null) =>
        `${who} stops here: ${why}.${raiseIn ? ` You can raise the limit in ${raiseIn}.` : ''}`,
      partial: 'It wrote a partial report.',
      noReport: 'It wrote no report.',
      why: {
        steps: (n: string, plan: boolean) =>
          `the job used all its ${n} ${plan ? 'steps on the plan' : 'model steps'}`,
        tokens: (n: string, plan: boolean) =>
          `the job used all its ${n} tokens${plan ? ' on the plan' : ''}`,
        cost: (eur: string) => `the job spent its ${eur} limit`,
        treeCost: (eur: string) =>
          `the job, with the work sent to projects, spent its ${eur} limit`,
        agentTokens: (n: string, plan: boolean) =>
          `it used all its ${n} tokens for this job${plan ? ' on the plan' : ''}`,
        agentSteps: (n: string) => `it used all its ${n} steps without finishing`,
        // Older events and kinds without a figure.
        runLimit: 'this job reached its limit',
        tokenLimit: 'it reached its token limit',
        maxSteps: 'it used all its steps without finishing',
      },
    },
    contextGuard: (who: string) => `${who}’s context was almost full: it made room`,
    truncated: (who: string) => `${who}’s reply was cut off: the model reached its maximum length`,
    contextRescue: (who: string) =>
      `The model found ${who}’s request too long: making room and trying again`,
    compactionFailed: (who: string) =>
      `Summarizing ${who}’s older messages failed: it only sees the latest ones`,
    problem: (who: string, message: string) => `${who} ran into a problem: ${message}`,
    undoConflict: (names: readonly string[]) => {
      if (names.length === 0)
        return 'The note changed after this edit: undoing it also loses those changes.';
      if (names.length === 1)
        return `${names[0]} changed after this edit: undoing it also loses those changes.`;
      const list =
        names.length > 3 ? `${names.slice(0, 3).join(', ')} and others` : formatList(names);
      return `${list} changed after this edit: undoing it also loses those changes.`;
    },
  },

  /* -------------------------------------------------------------- channels */
  channel: {
    someone: 'someone',
    account: (id: string) => `account ${id}`,
    telegramConnected: (name: string | undefined) =>
      `Telegram connected${name ? ` (${name})` : ''}`,
    bot: (dedicated: boolean, name: string | undefined) =>
      dedicated ? (name ? `The bot ${name}` : 'The dedicated bot') : 'Telegram',
    conflict: (bot: string) =>
      `${bot} is in use by another app (or has a webhook): Monsters will retry`,
    stoppedBot: (bot: string) => `${bot} stopped: it needs your attention`,
    noAnswer: (bot: string) => `${bot} isn’t responding: Monsters will retry`,
    ignored: (who: string, reason: string) => `Telegram message ignored: ${who} (${reason})`,
    notAllowed: 'not allowed',
    ignoredReason: {
      not_whitelisted: 'not one of the connected accounts',
      not_private: 'sent in a group',
      forwarded: 'forwarded message',
      not_text: 'not text',
      bot_or_anonymous: 'unknown sender',
      chat_not_approved: 'group not approved yet',
      not_allowed: 'not one of the allowed people',
      rate_limited: 'too many messages in an hour',
      forged_button: 'invalid button',
    } as Record<string, string>,
    paired: (who: string) => `${who} can now control the monsters from Telegram`,
    pairingFailed: (who: string) => `Pairing code rejected for ${who}`,
    pairingStarted: 'You asked for a code to connect a Telegram account',
    userRemoved: (who: string) => `${who} can no longer control the monsters from Telegram`,
    tokenSet: (name: string | undefined) => `Telegram bot connected${name ? `: ${name}` : ''}`,
    tokenRemoved: 'Telegram bot disconnected',
    tokenRefused: 'Telegram didn’t recognize the bot code you pasted',
    tokenUnchecked: 'I couldn’t verify the Telegram bot code',
    botAdded: (name: string | undefined) => `Dedicated bot connected${name ? `: ${name}` : ''}`,
    botRemoved: (name: string | undefined) => `Dedicated bot removed${name ? `: ${name}` : ''}`,
    botChanged: 'Dedicated bot changed',
    chatPending: (name: string | undefined) =>
      `A dedicated bot was added to the group ${name ?? 'with no name'}: it’s waiting for your approval`,
    chatApproved: (name: string | undefined) =>
      `Group approved for a dedicated bot${name ? `: ${name}` : ''}`,
    chatRemoved: (name: string | undefined) =>
      `Group removed from a dedicated bot${name ? `: ${name}` : ''}`,
    personPending: (who: string) =>
      `${who} asks to talk to a dedicated bot: it’s waiting for your approval`,
    personApproved: (who: string) => `${who} can talk to a dedicated bot`,
    personRemoved: (who: string) => `${who} can no longer talk to a dedicated bot`,
    limitReached: 'A dedicated bot reached today’s message limit',
    chatMigrated: (name: string | undefined) =>
      `The group${name ? ` ${name}` : ''} became a supergroup: it stays approved`,
    chatLeft: (name: string | undefined) =>
      `A dedicated bot is no longer in the group${name ? ` ${name}` : ''}: replies there won’t go out`,
    blocked: (who: string) => `${who} blocked the bot: replies to that account won’t go out`,
  },

  /* ------------------------------------------------------------- decisions */
  decision: {
    quick: 'a quick decision',
    forWho: (who: string) => ` for ${who}`,
    instinct: (forWho: string, what: string, shadow: boolean) =>
      `Decision${forWho}: ${what}${shadow ? ' (noted only)' : ''}`,
    userChoice: (choice: string) => `You chose: “${choice}”`,
    teamProposal: (choice: string) => `Squad proposed: ${choice}`,
    notifyNow: 'Telegram notification sent right away',
    notifySilent: 'Telegram notification sent without sound',
    notifyLater: 'Telegram notification postponed until after quiet hours',
    notifyNone: 'Telegram notification not sent',
    askUser: (who: string) => `${who} decided to ask you`,
    proceed: (who: string, choice: string) => `${who} decided without asking you: “${choice}”`,
    chose: (who: string, choice: string) => `${who} chose: “${choice}”`,
  },

  /* ---------------------------------------------------------------- events */
  event: {
    wroteTo: (name: string) => `You wrote to ${name}`,
    wroteMessage: 'You wrote a message',
    writing: (who: string) => `${who} is writing`,
    stoppedWriting: (who: string) => `${who} stopped while writing`,
    didNotFinishWriting: (who: string) => `${who} didn’t finish writing`,
    replied: (who: string) => `${who} replied`,
    handedTask: (from: string, to: string, task: string) =>
      `${from} handed ${to} a task: “${task}”`,
    taskDone: (to: string, from: string) => `${to} finished the task for ${from}`,
    taskFailed: (to: string, from: string) => `${to}’s task for ${from} didn’t succeed`,
    taskStopped: (to: string, from: string) => `${to}’s task for ${from} stopped`,
    toolCall: (who: string, what: string) => `${who}: ${what}`,
    toolDone: (who: string, action: string) => `${who} finished ${action}`,
    toolHalf: (who: string, action: string) => `${who} stopped halfway through ${action}`,
    toolFailed: (who: string, action: string) => `${who} couldn’t finish ${action}`,
    question: (who: string) => `${who} asked you a question`,
    answer: 'You answered a question',
    questionExpired: (who: string) => `${who}’s question expired`,
    questionParked: (who: string) => `${who} is waiting for your answer`,
    newConversationWith: (name: string) => `You started a new conversation with ${name}`,
    newConversation: 'You started a new conversation',
    summary: (who: string, turns: number) =>
      `Summarized the oldest messages of the conversation with ${who} (${turns})`,
    typesafe: (who: string) => `Decision for ${who}: a question to the expert model (TypeSafe)`,
    compaction: (who: string, model: string) => `Summary of ${who}’s conversation with ${model}`,
    webSearch: (who: string) => `${who} searched the web with OpenRouter`,
    usedModel: (who: string, model: string) => `${who} used the model ${model}`,
    killAll: 'All the monsters were stopped',
    killAgent: (name: string) => `${name}’s work was stopped`,
    killRun: 'A job was stopped',
    killTool: 'A tool was stopped',
    resumed: 'The monsters are back at work',
    runStarted: (who: string) => `${who} started a job`,
    runCompleted: (who: string) => `${who} finished the job`,
    runWaiting: (who: string) => `${who} finished its turn: waiting for your answer`,
    runFailed: (who: string) => `${who}’s job didn’t succeed`,
    runRestart: (who: string) => `${who}’s job stopped when Monsters restarted`,
    runStopped: (who: string) => `${who}’s job stopped`,
    auth: {
      setup: 'Account created',
      login: 'Signed in',
      login_failed: 'Sign-in attempt failed',
      logout: 'Signed out',
      login_token_issued: 'Automatic sign-in prepared for the app',
      login_token: 'Automatic sign-in from the desktop app',
      login_token_failed: 'Automatic sign-in failed',
      password_changed: 'You changed your password',
      password_change_failed: 'Password change failed',
      password_reset: 'Password reset from the computer',
      confirmed: 'You confirmed it’s you',
      confirm_failed: 'Password confirmation failed',
      other: 'New token for the command line',
    } as Record<string, string>,
    aMonster: 'a monster',
    teamAdd: (name: string) => `You added ${name} to the squad`,
    teamRename: (from: string | undefined, name: string) =>
      `You renamed ${from ?? 'a monster'}: now ${name}`,
    teamEdit: (name: string) => `You changed ${name}’s role and what it does`,
    teamLook: (name: string) => `You changed ${name}’s look`,
    teamArchive: (name: string) => `You removed ${name} from the squad`,
    teamRestore: (name: string) => `You brought ${name} back to the squad`,
    teamOther: 'You changed your preferences',
    permissionsDefaults: 'You changed the squad’s permissions',
    permissionsOf: (name: string) => `You changed ${name}’s permissions`,
    memoryOverLimit: (who: string) => `${who}’s memory is long: it only sees the latest lines`,
    memoryThings: (n: number) => (n === 1 ? 'one new thing' : `${n} new things`),
    memoryProposed: (who: string, things: string) =>
      `${who} wants to remember ${things}: waiting for you`,
    memoryDiscarded: (who: string) => `${who}’s memory stays as it was`,
    memoryRemembers: (who: string, things: string) => `${who} remembers ${things}`,
    mcpBrowser: 'the browser',
    mcpApp: (server: string) => `the app “${server}”`,
    mcpBrowserOn: 'You turned on the browser',
    mcpAdded: (name: string) => `You added ${name}`,
    mcpChanged: (name: string) => `You changed ${name}`,
    mcpRemoved: (name: string) => `You removed ${name}`,
    mcpConnected: (name: string) => `Connected ${name}`,
    mcpDisconnected: (name: string) => `Disconnected ${name}`,
    mcpSignedIn: (name: string) => `You signed in for ${name}`,
    mcpSignedOut: (name: string) => `You disconnected the sign-in for ${name}`,
    mcpToolsUpdated: (name: string) => `${name} updated its tools`,
    mcpNeedsSignin: (name: string) => `Sign-in needed again for ${name}`,
    mcpFailed: (name: string) => `I can’t start ${name}`,
    receipt: (name: string, summary: string) => `Receipt for ${name}’s work: ${summary}`,
    monsterProposed: (from: string, name: string) => `${from} proposes a new monster: ${name}`,
    monsterCreated: (name: string, from: string) => `You created ${name} from ${from}’s proposal`,
    monsterDropped: (from: string, name: string) => `You dropped ${from}’s proposal (${name})`,
    docsWhat: (name: string, file: string) => `the instructions of “${name}” (${file})`,
    docsProposed: (from: string, what: string) => `${from} proposes changing ${what}`,
    docsApplied: (from: string, what: string) => `You applied ${from}’s proposal for ${what}`,
    docsSuperseded: (from: string, what: string) => `${from} replaced their proposal for ${what}`,
    docsDropped: (from: string, what: string) => `You dropped ${from}’s proposal for ${what}`,
    previewNote: (name: string, what: string) => `${name} shows you the note “${what}”`,
    previewFile: (name: string, what: string) => `${name} shows you the file “${what}”`,
    automationStarted: (name: string, who: string) => `Automation “${name}”: ${who} started a run`,
    automationDone: (name: string) => `Automation “${name}”: run finished`,
    automationWaiting: (name: string) => `Automation “${name}”: waiting for your answer`,
    automationFailed: (name: string) => `Automation “${name}”: the run didn’t succeed`,
    automationSkipped: (name: string, message: string) =>
      `Automation “${name}”: run skipped. ${message}`,
    automationChange: (name: string, action: string) => {
      const what: Record<string, string> = {
        created: 'created',
        updated: 'updated',
        deleted: 'deleted',
        paused: 'paused',
        resumed: 'resumed',
        confirmed: 'confirmed',
        discarded: 'draft dropped',
      };
      return `Automation “${name}”: ${what[action] ?? action}`;
    },
    projectChange: (name: string, action: string, member: string) => {
      const what: Record<string, string> = {
        created: 'created',
        updated: 'updated',
        confirmed: 'confirmed',
        archived: 'archived',
        member_added: `${member} joined the project`,
        member_removed: `${member} left the project`,
        discarded: 'draft dropped',
        restored: 'back from the archive',
        stopped: 'stopped',
        docs_approved: 'folder instructions approved',
      };
      return `Project “${name}”: ${what[action] ?? action}`;
    },
    projectReport: (lead: string, to: string) => `${lead} sent the project report to ${to}`,
    logArchive: (n: number, dir: string) =>
      `Monsters archived ${n} old ${n === 1 ? 'event' : 'events'} (usage, tool results, streamed text) in ${dir}`,
    accessGranted: (summary: string, from: string) =>
      `You granted ${summary} (${from} asked for it)`,
    accessDenied: (summary: string, from: string) =>
      `You didn’t grant ${summary} (${from} had asked for it)`,
    accessFailed: (summary: string, message: string | undefined) =>
      `I couldn’t grant ${summary}: ${message ?? 'something changed'}`,
    fileDeleted: (name: string) => `You deleted the file ${name}`,
    fileHtml: (who: string, title: string | undefined) =>
      `${who} created a page${title ? `: ${title}` : ''}`,
    fileScreenshot: (who: string) => `${who} saved a screenshot`,
    fileSaved: (who: string, name: string) => `${who} saved the file ${name}`,
  },

  /* ------------------------------------------------------ instrumentation */
  instrumentation: {
    free: 'free',
    tools: (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`,
  },

  /* ---------------------------------------------------------------- halted */
  halted: {
    question: (name: string) => `${name}’s question`,
    questions: (n: number, names: string) => `${n} questions (${names})`,
    work: (names: string) => `the work of ${names}`,
    messages: (n: number, names: string) =>
      `${n === 1 ? 'the message' : 'the messages'} for ${names}`,
  },

  /* ----------------------------------------------------------- automations */
  automation: {
    busy: (name: string) =>
      `Running the automation “${name}”: your message goes out as soon as it’s done`,
  },

  /* ------------------------------------------------------- retry and again */
  retry: (request: string) => `Try again: “${request}”`,
};

const it: typeof en = {
  live: {
    thinking: 'Ci penso…',
    asked: 'Ti ho fatto una domanda',
    confused: 'sta cambiando strada',
    wentWrong: 'Qualcosa è andato storto',
    waitingFor: (name) => `Aspetto ${name}`,
    pickingUp: 'Riprendo il filo',
    couldNot: 'Non ce l’ho fatta',
  },

  tool: {
    previewNote: (name) => `Ti mostro la nota “${name}”`,
    previewFile: 'Ti mostro un file',
    searchWeb: (query) => `Cerco “${query}”`,
    searchWebAny: 'Cerco sul web',
    fetchHost: (host) => `Leggo ${host}`,
    fetchAny: 'Leggo una pagina web',
    searchNotes: (query) => `Cerco nelle note “${query}”`,
    searchNotesAny: 'Cerco nelle note',
    readNote: (name) => `Leggo ${name}`,
    readNoteAny: 'Leggo una nota',
    writeNote: (name) => `Scrivo ${name}`,
    writeNoteAny: 'Scrivo una nota',
    editNote: (name) => `Sistemo ${name}`,
    editNoteAny: 'Sistemo una nota',
    trashNote: 'Butto una nota nel cestino',
    moveNote: (name) => `Sposto ${name}`,
    moveNoteAny: 'Sposto una nota',
    listNotes: 'Guardo quali note ci sono',
    links: 'Guardo i collegamenti tra le note',
    tags: 'Guardo i tag delle note',
    history: 'Guardo la storia di una nota',
    restore: 'Rimetto a posto una nota',
    propose: 'Ti propongo una modifica',
    applyProposal: 'Applico una modifica proposta',
    delegate: (to) => `Passo il lavoro ${toNameIt(to)}`,
    delegateAny: 'Passo il lavoro a un collega',
    askTeammate: (to) => `Chiedo ${toNameIt(to)}`,
    askTeammateAny: 'Chiedo a un compagno di squadra',
    ask: 'Ti faccio una domanda',
    shell: (command) => `Eseguo ${command}`,
    shellAny: 'Eseguo un comando',
    fsList: 'Guardo i file in una cartella',
    fsRead: (name) => `Leggo ${name}`,
    fsReadAny: 'Leggo un file',
    fsWrite: (name) => `Scrivo ${name}`,
    fsWriteAny: 'Scrivo un file',
    fsMove: (name) => `Sposto ${name}`,
    fsMoveAny: 'Sposto un file',
    fsTrash: 'Butto un file nel cestino',
    other: 'Uso uno strumento',
    browserOpen: (host) => `Apro ${host} nel browser`,
    browserOpenAny: 'Apro una pagina nel browser',
    browser: 'Uso il browser',
    mcp: (server, name) => `Uso ${server}: ${name}`,
  },

  toolAction: {
    web_search: 'la ricerca sul web',
    web_fetch: 'la lettura di una pagina',
    ui_guide: 'la lettura del manuale dei blocchi disegnati',
    vault_search: 'la ricerca nelle note',
    vault_read: 'la lettura di una nota',
    vault_list: 'l’elenco delle note',
    vault_write: 'la scrittura di una nota',
    vault_create: 'la scrittura di una nota',
    vault_edit: 'la modifica di una nota',
    vault_move: 'lo spostamento di una nota',
    vault_delete: 'lo spostamento nel cestino',
    vault_links: 'il controllo dei collegamenti',
    vault_tags: 'il controllo dei tag',
    vault_history: 'il controllo della storia di una nota',
    vault_restore: 'il ripristino di una nota',
    vault_undo: 'l’annullamento di una modifica',
    vault_propose: 'la proposta di modifica',
    vault_apply_proposal: 'la modifica proposta',
    delegate: 'la delega',
    ask_user: 'la domanda',
    team_propose_monster: 'la proposta di un nuovo mostro',
    project_send: 'il lavoro passato a un progetto',
    project_status: 'il controllo dei progetti',
    project_propose: 'la proposta di un progetto',
    automation_propose: 'la proposta di un’automazione',
    shell: 'il comando',
    fs_list: 'l’elenco dei file',
    fs_read: 'la lettura di un file',
    fs_write: 'la scrittura di un file',
    fs_move: 'lo spostamento di un file',
    fs_delete: 'lo spostamento di un file nel cestino',
  },
  browserAction: 'l’uso del browser',
  mcpAction: 'l’uso di un’altra app',
  otherAction: 'un’operazione',

  toolLabel: {
    web_search: 'Ricerca sul web',
    web_fetch: 'Lettura di una pagina',
    ui_guide: 'Manuale dei disegni',
    vault_search: 'Ricerca nelle note',
    vault_read: 'Lettura di una nota',
    vault_list: 'Elenco delle note',
    vault_write: 'Scrittura di una nota',
    vault_create: 'Scrittura di una nota',
    vault_edit: 'Modifica di una nota',
    vault_move: 'Spostamento di una nota',
    vault_delete: 'Spostamento nel cestino',
    vault_links: 'Controllo dei collegamenti',
    vault_tags: 'Controllo dei tag',
    vault_history: 'Controllo della storia di una nota',
    vault_restore: 'Ripristino di una nota',
    vault_undo: 'Annullamento di una modifica',
    vault_propose: 'Proposta di modifica',
    vault_apply_proposal: 'Modifica proposta',
    delegate: 'Delega',
    ask_user: 'Domanda',
    team_propose_monster: 'Proposta di un nuovo mostro',
    project_send: 'Lavoro passato a un progetto',
    project_status: 'Controllo dei progetti',
    project_propose: 'Proposta di un progetto',
    automation_propose: 'Proposta di un’automazione',
    shell: 'Comando',
    fs_list: 'Elenco dei file',
    fs_read: 'Lettura di un file',
    fs_write: 'Scrittura di un file',
    fs_move: 'Spostamento di un file',
    fs_delete: 'Spostamento di un file nel cestino',
  },
  browserLabel: 'Uso del browser',
  mcpLabel: 'Uso di un’altra app',
  otherLabel: 'Operazione',

  toolShort: {
    web_search: 'Ricerca web',
    web_fetch: 'Pagina web',
    vault_search: 'Ricerca note',
    vault_read: 'Lettura nota',
    vault_list: 'Elenco note',
    vault_write: 'Nota scritta',
    vault_create: 'Nota scritta',
    vault_edit: 'Nota modificata',
    vault_move: 'Nota spostata',
    vault_delete: 'Nota nel cestino',
    vault_links: 'Collegamenti',
    vault_tags: 'Tag',
    vault_history: 'Storia nota',
    vault_restore: 'Nota ripristinata',
    vault_undo: 'Annullamento',
    vault_propose: 'Proposta',
    vault_apply_proposal: 'Proposta applicata',
    delegate: 'Delega',
    ask_user: 'Domanda',
    team_propose_monster: 'Nuovo mostro',
    project_send: 'Al progetto',
    project_status: 'Stato progetti',
    project_propose: 'Nuovo progetto',
    automation_propose: 'Nuova automazione',
    preview_show: 'Anteprima',
    ui_guide: 'Manuale dei disegni',
    shell: 'Comando',
    fs_list: 'Elenco file',
    fs_read: 'Lettura file',
    fs_write: 'File scritto',
    fs_move: 'File spostato',
    fs_delete: 'File nel cestino',
  },
  browserShort: 'Browser',

  model: {
    freeRouter: 'gratuito scelto da OpenRouter',
    free: (name) => `${name} (gratis)`,
  },

  chat: {
    you: 'Tu',
    resumed: (request) => `Ripreso il lavoro fermato: «${request}»`,
    stoppedAll: 'Hai fermato tutti i mostri',
    resumedAll: 'Si riparte: i mostri sono di nuovo liberi',
    telegramWhere: (title) => (title ? `da Telegram · ${title}` : 'da Telegram · in privato'),
    telegramVia: (title) => (title ? `su Telegram · ${title}` : 'su Telegram · in privato'),
    previewYou: (text) => `Tu: ${text}`,
    delegationDone: (to, task) => `${to} ha finito «${task}»`,
    delegationStarted: (to, task) => `Incarico per ${to}: ${task}`,
    delegationStopped: (to) => `L’incarico di ${to} si è fermato`,
    askedYou: (name) => `${name} ti ha fatto una domanda`,
    newConversation: 'Nuova conversazione',
    receipt: (summary) => `Ricevuta: ${summary}`,
    proposes: (name, monster) => `${name} propone un nuovo mostro: ${monster}`,
    showsYou: (name, what) => `${name} ti mostra «${what}»`,
  },

  report: {
    restart: 'si è interrotto: Monsters si è chiuso mentre ci lavorava',
    stopped: 'fermato prima di cominciare',
    completed: 'ha finito',
    waiting: 'aspetta una tua risposta',
    failed: 'non ce l’ha fatta',
    aborted: 'si è fermato',
    sentence: (project, lead, outcome) => `${project}: ${lead} ${outcome}`,
  },

  group: {
    events: (n) => `${n} ${n === 1 ? 'evento' : 'eventi'} tra i mostri`,
    done: (n) => (n === 1 ? '1 incarico completato' : `${n} incarichi completati`),
    open: (n) =>
      n === 1 ? '1 incarico passato alla squadra' : `${n} incarichi passati alla squadra`,
    partDone: (n) => `${n} ${n === 1 ? 'completato' : 'completati'}`,
    partOpen: (n) => `${n} in corso`,
    partOther: (n) => `${n} ${n === 1 ? 'fermato' : 'fermati'}`,
    mixed: (total, parts) => `${total} ${total === 1 ? 'incarico' : 'incarichi'}: ${parts}`,
  },

  list: (items) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`,

  category: {
    messages: 'Messaggi',
    runs: 'Lavori',
    delegations: 'Deleghe',
    tools: 'Strumenti',
    questions: 'Domande',
    vault: 'Note',
    errors: 'Errori',
    instinct: 'Decisioni dei mostri',
    system: 'Sistema',
  },

  vault: {
    change: (action, who, note) => {
      const verb: Record<string, [string, string]> = {
        create: ['ha creato la nota', 'Hai creato la nota'],
        edit: ['ha modificato la nota', 'Hai modificato la nota'],
        move: ['ha spostato la nota', 'Hai spostato la nota'],
        delete: ['ha cestinato la nota', 'Hai cestinato la nota'],
        restore: ['ha ripristinato la nota', 'Hai ripristinato la nota'],
        undo: ['ha annullato una modifica a', 'Hai annullato una modifica a'],
        propose: ['ha proposto una modifica a', 'Hai proposto una modifica a'],
      };
      const v = verb[action] ?? ['ha toccato la nota', 'Hai toccato la nota'];
      return who === null ? `${v[1]} ${note}` : `${who} ${v[0]} ${note}`;
    },
    noteParticiple: (action) =>
      ({
        create: 'creata',
        edit: 'aggiornata',
        move: 'spostata',
        delete: 'cestinata',
        restore: 'ripristinata',
        undo: 'riportata indietro',
        propose: 'con una modifica proposta',
      })[action] ?? 'toccata',
    notesParticiple: (action) =>
      ({
        create: 'creati',
        edit: 'aggiornati',
        move: 'spostati',
        delete: 'nel cestino',
        restore: 'ripristinati',
        undo: 'riportati indietro',
        propose: 'con una modifica proposta',
      })[action] ?? 'toccati',
  },

  agentFile: {
    memoryUpdated: (owner) => `${owner} ha aggiornato i suoi appunti`,
    memoryOther: (owner, participle) => `Appunti di ${owner} ${participle}`,
    stateUpdated: (owner) => `${owner} ha aggiornato lo stato dei suoi lavori`,
    stateOther: (owner, participle) => `Stato dei lavori di ${owner}: nota ${participle}`,
    workUpdated: (owner, name) => `${owner} ha aggiornato una nota di lavoro (${name})`,
    workOther: (owner, name, participle) => `Nota di lavoro di ${owner} (${name}) ${participle}`,
  },

  error: {
    stopped: (who) => `Il lavoro di ${who} si è fermato`,
    searchFallback: (who, engine) =>
      `La ricerca sul web non rispondeva: ${who} cerca su ${
        engine === 'wikipedia'
          ? 'Wikipedia'
          : engine === 'duckduckgo'
            ? 'DuckDuckGo'
            : engine === 'brave'
              ? 'Brave'
              : 'un altro motore'
      }`,
    noAlternative: (who, message) =>
      `Il modello di ${who} non risponde e non ci sono alternative: ${message}`,
    switchModel: (who) => `Il modello non rispondeva: ${who} passa a un altro`,
    orphans: 'Chiusi dei programmi rimasti aperti dall’avvio precedente',
    killHook: 'Lo stop non è riuscito a chiudere tutto subito',
    internal: 'Errore interno di Monsters',
    runLimit: (who) => `${who} si ferma qui: questo lavoro ha raggiunto il suo limite`,
    limit: {
      stopsHere: (who, why, raiseIn) =>
        `${who} si ferma qui: ${why}.${raiseIn ? ` Puoi alzare il limite in ${raiseIn}.` : ''}`,
      partial: 'Ha scritto un rapporto parziale.',
      noReport: 'Non ha scritto nessun rapporto.',
      why: {
        steps: (n, plan) =>
          `il lavoro ha usato tutti i suoi ${n} ${plan ? 'passi sul piano' : 'passi del modello'}`,
        tokens: (n, plan) =>
          `il lavoro ha usato tutti i suoi ${n} token${plan ? ' sul piano' : ''}`,
        cost: (eur) => `il lavoro ha speso il suo limite di ${eur}`,
        treeCost: (eur) =>
          `il lavoro, con quello mandato ai progetti, ha speso il suo limite di ${eur}`,
        agentTokens: (n, plan) =>
          `ha usato tutti i suoi ${n} token per questo lavoro${plan ? ' sul piano' : ''}`,
        agentSteps: (n) => `ha usato tutti i suoi ${n} passi senza finire`,
        runLimit: 'questo lavoro ha raggiunto il suo limite',
        tokenLimit: 'ha raggiunto il suo limite di token',
        maxSteps: 'ha usato tutti i suoi passi senza finire',
      },
    },
    contextGuard: (who) => `Il contesto di ${who} era quasi pieno: ha fatto spazio`,
    truncated: (who) =>
      `La risposta di ${who} è stata tagliata: il modello è arrivato alla lunghezza massima`,
    contextRescue: (who) =>
      `Il modello ha trovato troppo lunga la richiesta di ${who}: fa spazio e riprova`,
    compactionFailed: (who) =>
      `Il riassunto dei messaggi più vecchi di ${who} non è riuscito: vede solo gli ultimi`,
    problem: (who, message) => `${who} ha avuto un problema: ${message}`,
    undoConflict: (names) => {
      if (names.length === 0)
        return 'La nota è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.';
      if (names.length === 1)
        return `${names[0]} è cambiata dopo questa modifica: annullandola perdi anche quei cambiamenti.`;
      const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} e altre` : names.join(', ');
      return `${list} sono cambiate dopo questa modifica: annullandola perdi anche quei cambiamenti.`;
    },
  },

  channel: {
    someone: 'qualcuno',
    account: (id) => `l’account ${id}`,
    telegramConnected: (name) => `Telegram collegato${name ? ` (${name})` : ''}`,
    bot: (dedicated, name) => (dedicated ? `Il bot ${name ?? 'dedicato'}` : 'Telegram'),
    conflict: (bot) => `${bot} è usato da un’altra app (o ha un webhook): Monsters riprova`,
    stoppedBot: (bot) => `${bot} si è fermato: serve il tuo intervento`,
    noAnswer: (bot) => `${bot} non risponde: Monsters riprova`,
    ignored: (who, reason) => `Messaggio su Telegram ignorato: ${who} (${reason})`,
    notAllowed: 'non ammesso',
    ignoredReason: {
      not_whitelisted: 'non è tra gli account collegati',
      not_private: 'scritto in un gruppo',
      forwarded: 'messaggio inoltrato',
      not_text: 'non è testo',
      bot_or_anonymous: 'mittente sconosciuto',
      chat_not_approved: 'gruppo non ancora approvato',
      not_allowed: 'non è tra le persone ammesse',
      rate_limited: 'troppi messaggi in un’ora',
      forged_button: 'pulsante non valido',
    },
    paired: (who) => `${who} ora può comandare i mostri da Telegram`,
    pairingFailed: (who) => `Codice di collegamento rifiutato per ${who}`,
    pairingStarted: 'Hai chiesto un codice per collegare un account Telegram',
    userRemoved: (who) => `${who} non può più comandare i mostri da Telegram`,
    tokenSet: (name) => `Bot Telegram collegato${name ? `: ${name}` : ''}`,
    tokenRemoved: 'Bot Telegram scollegato',
    tokenRefused: 'Telegram non ha riconosciuto il codice del bot incollato',
    tokenUnchecked: 'Non sono riuscito a verificare il codice del bot di Telegram',
    botAdded: (name) => `Bot dedicato collegato${name ? `: ${name}` : ''}`,
    botRemoved: (name) => `Bot dedicato tolto${name ? `: ${name}` : ''}`,
    botChanged: 'Bot dedicato cambiato',
    chatPending: (name) =>
      `Un bot dedicato è stato aggiunto al gruppo ${name ?? 'senza nome'}: aspetta la tua approvazione`,
    chatApproved: (name) => `Gruppo approvato per un bot dedicato${name ? `: ${name}` : ''}`,
    chatRemoved: (name) => `Gruppo tolto da un bot dedicato${name ? `: ${name}` : ''}`,
    personPending: (who) =>
      `${who} chiede di parlare con un bot dedicato: aspetta la tua approvazione`,
    personApproved: (who) => `${who} può parlare con un bot dedicato`,
    personRemoved: (who) => `${who} non può più parlare con un bot dedicato`,
    limitReached: 'Un bot dedicato ha raggiunto i messaggi di oggi',
    chatMigrated: (name) =>
      `Il gruppo${name ? ` ${name}` : ''} è diventato un supergruppo: resta approvato`,
    chatLeft: (name) =>
      `Un bot dedicato non è più nel gruppo${name ? ` ${name}` : ''}: le risposte lì non partono`,
    blocked: (who) => `${who} ha bloccato il bot: le risposte a quell’account non partono`,
  },

  decision: {
    quick: 'una decisione al volo',
    forWho: (who) => ` per ${who}`,
    instinct: (forWho, what, shadow) =>
      `Decisione${forWho}: ${what}${shadow ? ' (solo annotato)' : ''}`,
    userChoice: (choice) => `Hai scelto: “${choice}”`,
    teamProposal: (choice) => `Squadra proposta: ${choice}`,
    notifyNow: 'Notifica su Telegram mandata subito',
    notifySilent: 'Notifica su Telegram mandata senza suono',
    notifyLater: 'Notifica su Telegram rimandata a dopo le ore di silenzio',
    notifyNone: 'Notifica su Telegram non mandata',
    askUser: (who) => `${who} ha deciso di chiedere a te`,
    proceed: (who, choice) => `${who} ha deciso senza chiederti: “${choice}”`,
    chose: (who, choice) => `${who} ha scelto: “${choice}”`,
  },

  event: {
    wroteTo: (name) => `Hai scritto ${toNameIt(name)}`,
    wroteMessage: 'Hai scritto un messaggio',
    writing: (who) => `${who} sta scrivendo`,
    stoppedWriting: (who) => `${who} si è fermato mentre scriveva`,
    didNotFinishWriting: (who) => `${who} non ha finito di scrivere`,
    replied: (who) => `${who} ha risposto`,
    handedTask: (from, to, task) => `${from} ha passato un incarico ${toNameIt(to)}: “${task}”`,
    taskDone: (to, from) => `${to} ha finito l’incarico per ${from}`,
    taskFailed: (to, from) => `L’incarico di ${to} per ${from} non è andato a buon fine`,
    taskStopped: (to, from) => `L’incarico di ${to} per ${from} si è fermato`,
    toolCall: (who, what) => `${who}: ${what}`,
    toolDone: (who, action) => `${who} ha finito ${action}`,
    toolHalf: (who, action) => `${who} ha lasciato a metà ${action}`,
    toolFailed: (who, action) => `${who} non ha completato ${action}`,
    question: (who) => `${who} ti ha fatto una domanda`,
    answer: 'Hai risposto a una domanda',
    questionExpired: (who) => `La domanda di ${who} è scaduta`,
    questionParked: (who) => `${who} aspetta la tua risposta`,
    newConversationWith: (name) => `Hai iniziato una nuova conversazione con ${name}`,
    newConversation: 'Hai iniziato una nuova conversazione',
    summary: (who, turns) =>
      `Riassunti i messaggi più vecchi della conversazione con ${who} (${turns})`,
    typesafe: (who) => `Decisione per ${who}: una domanda al modello esperto (TypeSafe)`,
    compaction: (who, model) => `Riassunto della conversazione di ${who} con ${model}`,
    webSearch: (who) => `${who} ha cercato sul web con OpenRouter`,
    usedModel: (who, model) => `${who} ha usato il modello ${model}`,
    killAll: 'Tutti i mostri sono stati fermati',
    killAgent: (name) => `Il lavoro di ${name} è stato fermato`,
    killRun: 'Un lavoro è stato fermato',
    killTool: 'Uno strumento è stato fermato',
    resumed: 'I mostri sono ripartiti',
    runStarted: (who) => `${who} ha iniziato un lavoro`,
    runCompleted: (who) => `${who} ha finito il lavoro`,
    runWaiting: (who) => `${who} ha finito il turno: aspetta la tua risposta`,
    runFailed: (who) => `Il lavoro di ${who} non è andato a buon fine`,
    runRestart: (who) => `Il lavoro di ${who} si è fermato al riavvio di Monsters`,
    runStopped: (who) => `Il lavoro di ${who} si è fermato`,
    auth: {
      setup: 'Account creato',
      login: 'Accesso eseguito',
      login_failed: 'Tentativo di accesso non riuscito',
      logout: 'Uscita dall’account',
      login_token_issued: 'Accesso automatico preparato per l’app',
      login_token: 'Accesso automatico dall’app desktop',
      login_token_failed: 'Accesso automatico non riuscito',
      password_changed: 'Hai cambiato la password',
      password_change_failed: 'Cambio della password non riuscito',
      password_reset: 'Password reimpostata dal computer',
      confirmed: 'Hai confermato che sei tu',
      confirm_failed: 'Conferma della password non riuscita',
      other: 'Nuovo token per la riga di comando',
    },
    aMonster: 'un mostro',
    teamAdd: (name) => `Hai aggiunto ${name} alla squadra`,
    teamRename: (from, name) =>
      `Hai cambiato nome ${from ? toNameIt(from) : 'a un mostro'}: ora è ${name}`,
    teamEdit: (name) => `Hai cambiato ruolo e cosa fa ${name}`,
    teamLook: (name) => `Hai cambiato l’aspetto di ${name}`,
    teamArchive: (name) => `Hai tolto ${name} dalla squadra`,
    teamRestore: (name) => `Hai riportato ${name} nella squadra`,
    teamOther: 'Hai cambiato le tue preferenze',
    permissionsDefaults: 'Hai cambiato i permessi della squadra',
    permissionsOf: (name) => `Hai cambiato i permessi di ${name}`,
    memoryOverLimit: (who) => `La memoria di ${who} è lunga: vede solo le righe più recenti`,
    memoryThings: (n) => (n === 1 ? 'una cosa nuova' : `${n} cose nuove`),
    memoryProposed: (who, things) => `${who} vuole ricordare ${things}: aspetta te`,
    memoryDiscarded: (who) => `La memoria di ${who} resta com’era`,
    memoryRemembers: (who, things) => `${who} si ricorda ${things}`,
    mcpBrowser: 'il browser',
    mcpApp: (server) => `l’app “${server}”`,
    mcpBrowserOn: 'Hai attivato il browser',
    mcpAdded: (name) => `Hai aggiunto ${name}`,
    mcpChanged: (name) => `Hai cambiato ${name}`,
    mcpRemoved: (name) => `Hai tolto ${name}`,
    mcpConnected: (name) => `Collegato ${name}`,
    mcpDisconnected: (name) => `Chiuso ${name}`,
    mcpSignedIn: (name) => `Hai fatto l’accesso per ${name}`,
    mcpSignedOut: (name) => `Hai scollegato l’accesso di ${name}`,
    mcpToolsUpdated: (name) => `${name} ha aggiornato i suoi strumenti`,
    mcpNeedsSignin: (name) => `Serve di nuovo l’accesso per ${name}`,
    mcpFailed: (name) => `Non riesco ad avviare ${name}`,
    receipt: (name, summary) => `Ricevuta del lavoro di ${name}: ${summary}`,
    monsterProposed: (from, name) => `${from} propone un nuovo mostro: ${name}`,
    monsterCreated: (name, from) => `Hai creato ${name} dalla proposta di ${from}`,
    monsterDropped: (from, name) => `Hai lasciato stare la proposta di ${from} (${name})`,
    docsWhat: (name, file) => `le istruzioni di «${name}» (${file})`,
    docsProposed: (from, what) => `${from} propone di cambiare ${what}`,
    docsApplied: (from, what) => `Hai applicato la proposta di ${from} per ${what}`,
    docsSuperseded: (from, what) => `${from} ha sostituito la sua proposta per ${what}`,
    docsDropped: (from, what) => `Hai lasciato stare la proposta di ${from} per ${what}`,
    previewNote: (name, what) => `${name} ti mostra la nota “${what}”`,
    previewFile: (name, what) => `${name} ti mostra il file “${what}”`,
    automationStarted: (name, who) => `Automazione «${name}»: ${who} ha iniziato un giro`,
    automationDone: (name) => `Automazione «${name}»: giro finito`,
    automationWaiting: (name) => `Automazione «${name}»: aspetta una tua risposta`,
    automationFailed: (name) => `Automazione «${name}»: il giro non è andato a buon fine`,
    automationSkipped: (name, message) => `Automazione «${name}»: giro saltato. ${message}`,
    automationChange: (name, action) => {
      const what: Record<string, string> = {
        created: 'creata',
        updated: 'modificata',
        deleted: 'eliminata',
        paused: 'in pausa',
        resumed: 'ripresa',
        confirmed: 'confermata',
        discarded: 'bozza lasciata stare',
      };
      return `Automazione «${name}»: ${what[action] ?? action}`;
    },
    projectChange: (name, action, member) => {
      const what: Record<string, string> = {
        created: 'creato',
        updated: 'modificato',
        confirmed: 'confermato',
        archived: 'archiviato',
        member_added: `${member} è entrato nel progetto`,
        member_removed: `${member} è uscito dal progetto`,
        discarded: 'bozza lasciata stare',
        restored: 'tornato dall’archivio',
        stopped: 'fermato',
        docs_approved: 'istruzioni della cartella approvate',
      };
      return `Progetto «${name}»: ${what[action] ?? action}`;
    },
    projectReport: (lead, to) => `${lead} ha mandato il rapporto del progetto a ${to}`,
    logArchive: (n, dir) =>
      `Monsters ha archiviato ${n} ${n === 1 ? 'evento vecchio' : 'eventi vecchi'} (consumi, risultati degli strumenti, testo in arrivo) in ${dir}`,
    accessGranted: (summary, from) => `Hai concesso ${summary} (l’ha chiesto ${from})`,
    accessDenied: (summary, from) => `Non hai concesso ${summary} (l’aveva chiesto ${from})`,
    accessFailed: (summary, message) =>
      `Non ho potuto concedere ${summary}: ${message ?? 'è cambiato qualcosa'}`,
    fileDeleted: (name) => `Hai eliminato il file ${name}`,
    fileHtml: (who, title) => `${who} ha creato una pagina${title ? `: ${title}` : ''}`,
    fileScreenshot: (who) => `${who} ha salvato uno screenshot`,
    fileSaved: (who, name) => `${who} ha salvato il file ${name}`,
  },

  instrumentation: {
    free: 'gratis',
    tools: (n) => `${n} ${n === 1 ? 'strumento' : 'strumenti'}`,
  },

  halted: {
    question: (name) => `la domanda di ${name}`,
    questions: (n, names) => `${n} domande (${names})`,
    work: (names) => `il lavoro di ${names}`,
    messages: (n, names) => `${n === 1 ? 'il messaggio' : 'i messaggi'} per ${names}`,
  },

  automation: {
    busy: (name) => `Sta facendo l’automazione «${name}»: il tuo messaggio parte appena finisce`,
  },

  retry: (request) => `Riprova: «${request}»`,
};

export const deriveStrings = defineStrings({ en, it });
