import { fake, type FakeScript } from '@monsters/providers/testing';

/*
 * What the fake models answer in the end-to-end test, request after request.
 * One conversation, in this order (see real-core.core.ts):
 *   1. "Trovami tre fatti su Encelado": Titan delegates to Rhea (who searches the
 *      web), asks whether to save a note, writes it, then streams the reply.
 *   2. "Scrivimi una poesia lunga": Titan never finishes; the test stops it with
 *      the kill switch.
 *   3. "Riprendi e continua" starts the poem again: a short answer (D-072).
 */

/** Never settles: the fake stream waits on it until the kill switch aborts the run. */
const never = new Promise<never>(() => {});

export const FINAL_REPLY =
  'Fatto! Rhea ha trovato tre fatti su Encelado e li ho salvati nella nota [[Encelado]]: ' +
  'i geyser di ghiaccio, l’oceano sotto la crosta e l’anello E che nasce dai suoi getti.';

export const NOTE_PATH = 'Risorse/Ricerche/Encelado';

/** After "Riprendi e continua", with a file of the core to open in Anteprima (D-075). */
export const RESUMED_REPLY =
  'Eccomi di nuovo: ripartiamo quando vuoi. Intanto ecco [la prova](/api/files/e2e-pdf/content).';

export const scenario: Record<string, FakeScript> = {
  titan: [
    fake.toolCall(
      'delegate',
      {
        agent: 'Rhea',
        goal: 'Trova tre fatti su Encelado con una fonte',
        why: 'Giulio vuole una nota breve',
        done_when: 'tre fatti con la fonte',
      },
      { text: 'Chiedo a Rhea di cercare.' },
    ),
    fake.toolCall('ask_user', {
      question: 'Salvo i tre fatti in una nota?',
      options: [
        { label: 'Sì, in una nota', description: 'la trovi in Risorse/Ricerche' },
        'No, bastano in chat',
      ],
      recommended: 'Sì, in una nota',
      kind: 'taste',
    }),
    fake.toolCall('vault_write', {
      path: NOTE_PATH,
      content:
        '# Encelado\n\nTre fatti trovati da Rhea.\n\n- Geyser di ghiaccio al polo sud.\n' +
        '- Un oceano salato sotto la crosta.\n- I getti alimentano l’anello E di Saturno.\n\n' +
        'Fonte: https://science.nasa.gov/saturn/moons/enceladus/\n',
    }),
    fake.text(FINAL_REPLY, { chunkSize: 6, delayMs: 45 }),
    fake.text('Comincio la poesia…', { gate: never }),
    fake.text(RESUMED_REPLY, { chunkSize: 8, delayMs: 20 }),
  ],
  rhea: [
    fake.toolCall('web_search', { query: 'Encelado fatti principali' }),
    fake.text(
      'Tre fatti su Encelado: geyser di ghiaccio, oceano sotto la crosta, anello E. Fonte: NASA Science.',
    ),
  ],
  dione: [],
};
