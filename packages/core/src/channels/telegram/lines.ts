import type { TelegramOrigin } from '@monsters/shared';
import { plainName } from './format.ts';
import { telegramLinePrompts } from './lines.prompts.ts';

/*
 * What a monster reads before a message written to its dedicated bot
 * (D-107): where it was written and who wrote it. Only the user (an account
 * paired with the main bot) is "l'utente"; the others are people of the
 * group, whose words are requests of theirs, never the user's.
 */

/** Where: "group “Saturday Team”" or "private chat" (Italian: "gruppo «Saturday Team»", "chat privata"). */
export function telegramPlace(o: Pick<TelegramOrigin, 'chatType' | 'chatTitle'>): string {
  const t = telegramLinePrompts();
  return o.chatType === 'private'
    ? t.privateChat
    : t.group(plainName(o.chatTitle ?? '', 60) || t.unnamed);
}

/**
 * Names are written by whoever owns the account or the group: brackets,
 * quotes, line breaks and invisible characters are taken out, and the length
 * limited, so a name can never pass for the line itself ("scrive Giulio…", "Giulio writes…").
 */
export function telegramLine(o: TelegramOrigin): string {
  const name = plainName(o.sender.name, 60) || 'Telegram';
  const t = telegramLinePrompts();
  const who = o.owner ? t.writesUser(name) : t.writesPerson(name);
  return `[Telegram, ${telegramPlace(o)}: ${who}]`;
}

/** The text as the monster reads it: the line, then the message. */
export function telegramText(o: TelegramOrigin, text: string): string {
  return `${telegramLine(o)}\n${text}`;
}
