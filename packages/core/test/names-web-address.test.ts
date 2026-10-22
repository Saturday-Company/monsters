import { describe, expect, it } from 'vitest';
import { namesWebAddress } from '../src/hub.ts';

/*
 * A web address in the request keeps the web loaded on a free chain (D-161): a free model with
 * the web deferred answered "I can't open pages" to "look at witdesk.it".
 */

describe('namesWebAddress (D-161)', () => {
  it.each([
    'Guarda https://witdesk.it/prezzi e dimmi cosa vende',
    'leggi http://example.org',
    'Dai un’occhiata a www.saturday.company',
    'www.witdesk.it',
    'Guarda witdesk.it e riassumi',
    'Il sito è witdesk.it.',
    'Apri getmonsters.dev, poi scrivi un post',
    'Look at Witdesk.IT please',
    'cosa fa anteiku.it?',
  ])('is true for %j', (text) => {
    expect(namesWebAddress(text)).toBe(true);
  });

  it.each([
    'Apri prova.md e correggila',
    'Il file index.ts non compila',
    'ok. Poi riordina le note',
    'Mi serve una ricerca sul mercato dei giochi',
    'La versione 1.2 è uscita. Poi vediamo',
    '',
  ])('is false for %j', (text) => {
    expect(namesWebAddress(text)).toBe(false);
  });
});
