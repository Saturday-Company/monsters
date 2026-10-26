import { pick } from '@monsters/shared';

/*
 * What the hub tells a model (D-153): why a folder is closed, what a saved screenshot is, the
 * answers to a message that arrives while a question is open. The Italian family is the one
 * the models have always read; the English one is its twin. They follow the app's language at
 * the moment they are written. The user-facing texts of the hub are in `hub.strings.ts`.
 */

const it = {
  transcriptsClosed:
    'Le trascrizioni delle sessioni di Claude Code (~/.claude/projects) non sono accessibili: contengono le note lette dagli altri run.',
  /** The same, for Claude Code's own tools: what it saved for this session (D-195) opens. */
  transcriptsClosedSaved:
    'Le trascrizioni delle sessioni di Claude Code (~/.claude/projects) non sono accessibili: contengono le note lette dagli altri run. Si apre solo quello che Claude Code ha salvato per questa sessione (…/tool-results/), con Read o Grep.',
  desktopDataClosed:
    'La cartella dei dati dell’app Monsters (sessione e impostazioni) non è accessibile.',
  /** `folder`: the vault's private folder (`Privato`, `Private`: D-154). */
  privateInChat: (folder: string) =>
    `Le note private (${folder}/) non sono accessibili mentre parli in una chat di Telegram.`,
  yourLead: 'il tuo capo',
  viaClaude: (name: string) => `${name} (tramite Claude)`,
  imageSaved: (name: string, id: string) =>
    `[immagine salvata tra i File dell'utente come "${name}" (fileId ${id}, /api/files/${id}/content): l'utente la vede in chat. Non è visibile come testo: non descriverla oltre quello che sai.]`,
  reopened: '[Il file che hai riaperto con file_read]',
  theUser: "l'utente",
  accessOpen: (user: string, grant: string, deny: string) =>
    `La tua richiesta di accesso è ancora aperta: ${user} risponde dalla scheda (${grant} o ${deny}), non a parole. Non chiederla di nuovo.`,
  questionOpen: (user: string, asked: string) =>
    `Hai una domanda ancora aperta per ${user}: «${asked}»`,
};

const en: typeof it = {
  transcriptsClosed:
    'The Claude Code session transcripts (~/.claude/projects) aren’t accessible: they contain the notes read by the other runs.',
  transcriptsClosedSaved:
    'The Claude Code session transcripts (~/.claude/projects) aren’t accessible: they contain the notes read by the other runs. Only what Claude Code saved for this session (…/tool-results/) opens, with Read or Grep.',
  desktopDataClosed: 'The data folder of the Monsters app (session and settings) isn’t accessible.',
  privateInChat: (folder) =>
    `The private notes (${folder}/) aren’t accessible while you talk in a Telegram chat.`,
  yourLead: 'your lead',
  viaClaude: (name) => `${name} (through Claude)`,
  imageSaved: (name, id) =>
    `[image saved among the user’s Files as "${name}" (fileId ${id}, /api/files/${id}/content): the user sees it in the chat. It is not visible as text: don’t describe it beyond what you know.]`,
  reopened: '[The file you reopened with file_read]',
  theUser: 'the user',
  accessOpen: (user, grant, deny) =>
    `Your access request is still open: ${user} answers from the card (“${grant}” or “${deny}”), not in words. Don’t ask for it again.`,
  questionOpen: (user, asked) => `You have a question still open for ${user}: “${asked}”`,
};

export const hubPrompts = () => pick({ en, it });
