import { pick } from '@monsters/shared';

/*
 * What a monster reads before a message written to its dedicated bot (D-153, wave 3): where
 * it was written and who wrote it. Two families: the one of the app's language at the moment
 * the message is read. The Italian one is byte for byte what it was. Only the user (an account
 * paired with the main bot) is "the user"; the others are people of the group.
 */

const en = {
  privateChat: 'private chat',
  group: (title: string) => `group “${title}”`,
  unnamed: 'unnamed',
  writesUser: (name: string) => `${name} (the user) writes`,
  writesPerson: (name: string) => `${name} writes, a person in the group, not the user`,
};

const it: typeof en = {
  privateChat: 'chat privata',
  group: (title) => `gruppo «${title}»`,
  unnamed: 'senza nome',
  writesUser: (name) => `scrive ${name} (l’utente)`,
  writesPerson: (name) => `scrive ${name}, una persona del gruppo, non l’utente`,
};

export const telegramLinePrompts = () => pick({ en, it });
