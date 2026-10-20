import type { LogEvent } from '@monsters/shared';

/*
 * Which messages are the user's own words (D-070): their sites become known
 * sites of the run, their text stays here. Never an agent's earlier reply
 * (it may quote a hostile page), a message a monster wrote (`project_send`,
 * D-098), the objective of an automation a monster proposed until the user
 * rewrites it (D-103), or what a person of a Telegram group wrote to a
 * dedicated bot (D-107): only the account paired with the main bot is the
 * user there.
 */
export function isUserWords(
  e: LogEvent | undefined,
  options: { objectiveFromMonster?: boolean } = {},
): boolean {
  return (
    e?.type === 'message' &&
    e.agent === 'user' &&
    !e.data.from &&
    !(options.objectiveFromMonster && e.data.channel === 'automation') &&
    (!e.data.telegram || e.data.telegram.owner)
  );
}
