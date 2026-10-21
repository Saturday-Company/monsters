import { pick } from '@monsters/shared';

/*
 * The words of the spending cap that the meter writes (D-153): the reason a monster may not
 * spend now (what the hub tells the user and the monster, what Telegram quotes) and the name of
 * a project inside the `spend` event's sentence. The sentence of the event itself, the money and
 * the periods are in `@monsters/shared` (`spend.strings.ts`).
 */

const en = {
  /** "reached the squad’s spending cap for today (€10)" */
  capReached: (whose: string, period: string, cap: string) =>
    `reached ${whose} spending cap ${period} (${cap})`,
  squadCap: 'the squad’s',
  projectCap: (project: string) => `the “${project}” project’s`,
  agentCap: (name: string) => `${name}’s`,
  /** A project as the scope of a `spend` event ("the “X” project", then “’s cap”). */
  projectScope: (project: string) => `the “${project}” project`,
};

const it: typeof en = {
  capReached: (whose, period, cap) => `raggiunto il tetto di spesa${whose} ${period} (${cap})`,
  squadCap: ' della squadra',
  projectCap: (project) => ` del progetto ${project}`,
  agentCap: (name) => ` di ${name}`,
  projectScope: (project) => `progetto ${project}`,
};

export const teamSpendStrings = () => pick({ en, it });
