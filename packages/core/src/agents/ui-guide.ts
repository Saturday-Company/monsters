import { defineTool, uiSignatures } from '@monsters/shared';
import { z } from 'zod';
import { uiGuidePrompts } from './ui-guide.prompts.ts';

/*
 * Drawn blocks in a reply (D-162): the manual a monster reads to write a ```ui block. It reaches
 * the model two ways: the `ui_guide` tool (every monster has it, API and harness alike: a card
 * line names it) and, when the request reads better drawn (the instinct's `ui` use), attached
 * to that turn's message by the hub so the monster does not spend a step calling the tool.
 * Never in the system prompt (the cache) and never saved as a message of the chat.
 */

export const UI_GUIDE_TOOL = 'ui_guide';

/** Components whose signature says it all: no description (the manual stays small). */
const SELF_EVIDENT = new Set(['Block', 'Stat', 'Step']);

/** The components the manual lists: the whole library, the same the app draws. */
const signatures = (): string =>
  uiSignatures()
    .map((line) => (SELF_EVIDENT.has(line.split('(')[0]!) ? line.split(' — ')[0]! : line))
    .join('\n');

/** The manual, in the language in use. */
export const uiGuideText = (): string => uiGuidePrompts().guide(signatures());

/** The line a turn gets when the request reads better drawn: a header and the manual. */
export const uiGuideHint = (): string => `${uiGuidePrompts().attached}\n${uiGuideText()}`;

/**
 * `ui_guide` (made per run, so its description follows the app's language): no arguments, only reads (a text of ours), costs nothing: no permission, no
 * brake, nothing to approve. It is still a tool call, so the log shows it like any other.
 */
export function uiGuideTool() {
  return defineTool({
    name: UI_GUIDE_TOOL,
    description: uiGuidePrompts().toolDescription,
    inputSchema: z.object({}),
    readOnly: true,
    destructive: false,
    execute: () => Promise.resolve(uiGuideText()),
  });
}
