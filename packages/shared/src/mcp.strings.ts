import { pick } from './i18n.ts';

/* The words of the checks of `mcp.ts` (D-153), picked when the check fails, never at module load. */

const en = {
  serverName: 'lowercase letters, digits and hyphens, at most 24',
};

const it: typeof en = {
  serverName: 'lettere minuscole, cifre e trattini, al massimo 24',
};

export const mcpSchemaStrings = () => pick({ en, it });
