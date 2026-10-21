import { fake, type FakeScript } from '@monsters/providers/testing';

/*
 * What the fake models answer in the end-to-end test, request after request.
 * One conversation, in this order (see real-core.core.ts):
 *   1. "Find me three facts about Enceladus": Titan delegates to Rhea (who searches the
 *      web), asks whether to save a note, writes it, then streams the reply.
 *   2. "Write me a long poem": Titan never finishes; the test stops it with
 *      the kill switch.
 *   3. "Resume and continue" starts the poem again: a short answer (D-072).
 */

/** Never settles: the fake stream waits on it until the kill switch aborts the run. */
const never = new Promise<never>(() => {});

export const FINAL_REPLY =
  'Done! Rhea found three facts about Enceladus and I saved them in the note [[Enceladus]]: ' +
  'the ice geysers, the ocean under the crust and the E ring that its jets feed.';

export const NOTE_PATH = 'Resources/Research/Enceladus';

/** After "Resume and continue", with a file of the core to open in the preview (D-075). */
export const RESUMED_REPLY =
  'Here I am again: let’s pick up whenever you like. Meanwhile, here’s [the proof](/api/files/e2e-pdf/content).';

export const scenario: Record<string, FakeScript> = {
  titan: [
    fake.toolCall(
      'delegate',
      {
        agent: 'Rhea',
        goal: 'Find three facts about Enceladus with a source',
        why: 'Giulio wants a short note',
        done_when: 'three facts with the source',
      },
      { text: 'I’ll ask Rhea to search.' },
    ),
    fake.toolCall('ask_user', {
      question: 'Shall I save the three facts in a note?',
      options: [
        { label: 'Yes, in a note', description: 'you’ll find it in Resources/Research' },
        'No, the chat is enough',
      ],
      recommended: 'Yes, in a note',
      kind: 'taste',
    }),
    fake.toolCall('vault_write', {
      path: NOTE_PATH,
      content:
        '# Enceladus\n\nThree facts found by Rhea.\n\n- Ice geysers at the south pole.\n' +
        '- A salty ocean under the crust.\n- The jets feed Saturn’s E ring.\n\n' +
        'Source: https://science.nasa.gov/saturn/moons/enceladus/\n',
    }),
    fake.text(FINAL_REPLY, { chunkSize: 6, delayMs: 45 }),
    fake.text('I’m starting the poem…', { gate: never }),
    fake.text(RESUMED_REPLY, { chunkSize: 8, delayMs: 20 }),
  ],
  rhea: [
    fake.toolCall('web_search', { query: 'Enceladus main facts' }),
    fake.text(
      'Three facts about Enceladus: ice geysers, an ocean under the crust, the E ring. Source: NASA Science.',
    ),
  ],
  dione: [],
};
