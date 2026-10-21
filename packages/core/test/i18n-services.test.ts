import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { automationStrings } from '../src/automations/automations.strings.ts';
import { coreStrings } from '../src/core.strings.ts';
import { fileStrings } from '../src/files/files.strings.ts';
import { hubStrings } from '../src/hub.strings.ts';
import { mcpStrings } from '../src/mcp/mcp.strings.ts';
import { onboardingStrings } from '../src/onboarding/onboarding.strings.ts';
import { welcomeText } from '../src/onboarding/service.ts';
import { projectStrings } from '../src/projects/projects.strings.ts';
import { providerStrings } from '../src/providers/providers.strings.ts';
import { secretStrings } from '../src/secrets/secrets.strings.ts';
import { serverStrings } from '../src/server/server.strings.ts';

/*
 * The dictionaries of the core's services (D-153): English by default in the tests, Italian
 * when the app's language is Italian. The texts are picked where they are written.
 */

afterEach(() => setAppLang('en'));

describe('the core services speak the app’s language', () => {
  it('English by default, Italian when the app is Italian', () => {
    expect(projectStrings().archived('Saturday')).toBe('The project Saturday is archived.');
    expect(automationStrings().halted).toBe('Monsters is stopped: the run didn’t start.');
    expect(mcpStrings().unknownServer('notes')).toBe('There is no server “notes”.');
    expect(providerStrings().noKey('Anthropic')).toBe('Anthropic doesn’t use a key');
    expect(fileStrings().empty).toBe('The file is empty.');
    expect(secretStrings().keyInvalid).toBe('the key in the keychain isn’t valid');
    expect(serverStrings().wrongPassword).toBe('The password isn’t right.');
    expect(hubStrings().replyPrivate).toBe('repeats a private note');
    expect(onboardingStrings().teamQuestion).toBe('Which squad is needed?');
    expect(coreStrings().archiveFailed('x')).toBe('log archive failed, no event lost: x');

    setAppLang('it');
    expect(projectStrings().archived('Saturday')).toBe('Il progetto Saturday è archiviato.');
    expect(automationStrings().halted).toBe('Monsters è fermo: il giro non è partito.');
    expect(mcpStrings().unknownServer('notes')).toBe('Non c’è nessun server “notes”.');
    expect(providerStrings().noKey('Anthropic')).toBe('Anthropic non usa una chiave');
    expect(fileStrings().empty).toBe('Il file è vuoto.');
    expect(secretStrings().keyInvalid).toBe('la chiave nel portachiavi non è valida');
    expect(serverStrings().wrongPassword).toBe('La password non è giusta.');
    expect(hubStrings().replyPrivate).toBe('ripete una nota privata');
    expect(onboardingStrings().teamQuestion).toBe('Quale squadra serve?');
    expect(coreStrings().archiveFailed('x')).toBe(
      'archivio del registro non riuscito, nessun evento perso: x',
    );
  });

  it('plurals and agreements are whole sentences', () => {
    const draft = (automations: number) =>
      projectStrings().projectDraftSummary({
        who: 'Titan',
        name: 'Social',
        lead: 'Tethys',
        members: ['Sofia'],
        automations,
        folder: undefined,
      });
    expect(draft(1)).toBe(
      'Titan proposes the project “Social”: lead Tethys, with Sofia; one automation.',
    );
    expect(draft(2)).toContain('2 automations');
    expect(mcpStrings().toolsPaused('Notes', 1, 'new', 'add')).toContain('a new tool “add”');
    expect(mcpStrings().toolsPaused('Notes', 3, 'new', 'add')).toContain('3 new or changed tools');
    expect(serverStrings().archiveTooSoon(1)).toContain('1 minute.');
    expect(hubStrings().movedToPlan(['Dione'], false, 'Claude')).toBe(
      'Now Dione works with your Claude subscription. You can change it in Settings → Models.',
    );
    setAppLang('it');
    expect(draft(1)).toContain('un’automazione');
    expect(hubStrings().movedToPlan(['Dione', 'Rhea'], false, 'Claude')).toContain(
      'Dione, Rhea lavorano',
    );
    expect(serverStrings().archiveTooSoon(1)).toContain('1 minuto.');
  });

  it('the welcome follows the language the monsters write in', () => {
    const members = [
      { name: 'Dione', role: 'Writes posts' },
      { name: 'Rhea', role: 'Finds things' },
    ] as never;
    const en = welcomeText(
      { userName: 'Giulio', orchestratorName: 'Atlas', languageId: 'en' } as never,
      members,
      true,
    );
    expect(en).toContain('Hi Giulio! I’m Atlas, I coordinate your squad.');
    expect(en).toContain('Dione (writes posts) and Rhea (finds things)');
    // The app in Italian, the monsters in English: they greet in English.
    setAppLang('it');
    expect(
      welcomeText(
        { userName: 'Giulio', orchestratorName: 'Atlas', languageId: 'en' } as never,
        members,
        true,
      ),
    ).toContain('Hi Giulio!');
    const it = welcomeText(
      { userName: 'Giulio', orchestratorName: 'Atlas', languageId: 'it' } as never,
      members,
      false,
    );
    expect(it).toContain('Ciao Giulio! Sono Atlas e coordino la tua squadra');
    expect(it).toContain('Dione (writes posts) e Rhea (finds things)');
    // A language the app does not have: the app's own.
    expect(
      welcomeText(
        { userName: 'Ana', orchestratorName: 'Atlas', languageId: 'es' } as never,
        members,
        true,
      ),
    ).toContain('Ciao Ana!');
    setAppLang('en');
    expect(
      welcomeText(
        { userName: 'Ana', orchestratorName: 'Atlas', languageId: 'es' } as never,
        members,
        true,
      ),
    ).toContain('Hi Ana!');
  });
});
