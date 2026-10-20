import type { TelegramOrigin } from '@monsters/shared';
import { plainName } from './format.ts';

/*
 * What a monster reads before a message written to its dedicated bot
 * (D-107): where it was written and who wrote it. Only the user (an account
 * paired with the main bot) is "l'utente"; the others are people of the
 * group, whose words are requests of theirs, never the user's.
 */

/** Where: "gruppo «Saturday Team»" or "chat privata". */
export function telegramPlace(o: Pick<TelegramOrigin, 'chatType' | 'chatTitle'>): string {
  return o.chatType === 'private'
    ? 'chat privata'
    : `gruppo «${plainName(o.chatTitle ?? '', 60) || 'senza nome'}»`;
}

/**
 * Names are written by whoever owns the account or the group: brackets,
 * quotes, line breaks and invisible characters are taken out, and the length
 * limited, so a name can never pass for the line itself ("scrive Giulio…").
 */
export function telegramLine(o: TelegramOrigin): string {
  const name = plainName(o.sender.name, 60) || 'Telegram';
  const who = o.owner
    ? `scrive ${name} (l’utente)`
    : `scrive ${name}, una persona del gruppo, non l’utente`;
  return `[Telegram, ${telegramPlace(o)}: ${who}]`;
}

/** The text as the monster reads it: the line, then the message. */
export function telegramText(o: TelegramOrigin, text: string): string {
  return `${telegramLine(o)}\n${text}`;
}
