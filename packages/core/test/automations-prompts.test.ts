import { describe, expect, it } from 'vitest';
import { automationPrompts } from '../src/automations/automations.prompts.ts';
import { inLang } from './prompt-lang.ts';

/* What the lead of an automation reads (D-153): the Italian words, byte for byte, and their English twin. */

describe('automation prompts', () => {
  it('Italian family: the words the models have always read', () => {
    inLang('it');
    const p = automationPrompts();
    expect(p.recover).toBe(
      'Monsters si è chiuso (un riavvio o un aggiornamento) mentre lavoravi a questo giro. Riprendi da dove eri rimasto: quello che avevi già fatto è qui sopra, non rifarlo.',
    );
    expect(p.headSlot('Post', p.slot('domenica 18 ottobre, 23:00'))).toBe(
      '[Automazione «Post» (giro di domenica 18 ottobre, 23:00)]',
    );
    expect(p.headNow('Post')).toBe('[Automazione «Post», eseguita ora]');
    expect(p.participants('Rhea (ricerche), Dione (testi)')).toBe(
      'Mostri che partecipano: Rhea (ricerche), Dione (testi).',
    );
    expect(p.resultsFolder('Post')).toBe('Salva i risultati nella cartella «Post» delle note.');
    expect(p.manual).toBe("È un giro dell'automazione, avviato dall'utente.");
    expect(p.scheduled).toBe("È un giro automatico: l'utente non sta guardando la chat.");
    expect(p.closing).toBe(
      'Se ti serve una sua scelta, chiedigliela invece di tirare a indovinare; alla fine scrivi in breve cosa hai fatto e dove sono i risultati.',
    );
  });

  it('English family: the twin', () => {
    inLang('en');
    const p = automationPrompts();
    expect(p.recover).toMatch(
      /^Monsters was closed \(a restart or an update\) while you were working on this run\./,
    );
    expect(p.headSlot('Posts', p.slot('Sunday, October 18, 11:00 PM'))).toBe(
      '[Automation “Posts” (run of Sunday, October 18, 11:00 PM)]',
    );
    expect(p.headNow('Posts')).toBe('[Automation “Posts”, run now]');
    expect(p.participants('Rhea (research), Dione (texts)')).toBe(
      'Monsters taking part: Rhea (research), Dione (texts).',
    );
    expect(p.resultsFolder('Posts')).toBe('Save the results in the “Posts” folder of the notes.');
    expect(p.manual).toBe('This is a run of the automation, started by the user.');
    expect(p.scheduled).toBe('This is an automatic run: the user is not watching the chat.');
    expect(p.closing).toMatch(/^If you need a choice from the user, ask instead of guessing/);
  });
});
