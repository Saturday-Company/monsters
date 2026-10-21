import { pick } from './i18n.ts';

/** The words of the drafts' cards shared by the core and the UI (D-153). */
const en = {
  /** The source of a text that came from third parties, when it has no name of its own. */
  thirdParty: 'third-party text',
};

const it: typeof en = {
  thirdParty: 'testo di terzi',
};

export const draftStrings = () => pick({ en, it });
