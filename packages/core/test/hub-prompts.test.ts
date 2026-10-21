import { describe, expect, it } from 'vitest';
import { hubPrompts } from '../src/hub.prompts.ts';
import { mcpPrompts } from '../src/mcp/mcp.prompts.ts';
import { mcpStrings } from '../src/mcp/mcp.strings.ts';
import { accessStrings } from '../src/team/access.strings.ts';
import { inLang } from './prompt-lang.ts';

/* What the hub and the MCP hints tell a model (D-153): the Italian words, byte for byte, and their English twin. */

describe('hub prompts', () => {
  it('Italian family: the words the models have always read', () => {
    inLang('it');
    const p = hubPrompts();
    const card = accessStrings();
    expect(p.transcriptsClosed).toBe(
      'Le trascrizioni delle sessioni di Claude Code (~/.claude/projects) non sono accessibili: contengono le note lette dagli altri run.',
    );
    expect(p.desktopDataClosed).toBe(
      'La cartella dei dati dell’app Monsters (sessione e impostazioni) non è accessibile.',
    );
    expect(p.privateInChat('Privato')).toBe(
      'Le note private (Privato/) non sono accessibili mentre parli in una chat di Telegram.',
    );
    expect(p.yourLead).toBe('il tuo capo');
    expect(p.viaClaude('Gmail')).toBe('Gmail (tramite Claude)');
    expect(p.imageSaved('a.png', 'F1')).toBe(
      '[immagine salvata tra i File dell\'utente come "a.png" (fileId F1, /api/files/F1/content): l\'utente la vede in chat. Non è visibile come testo: non descriverla oltre quello che sai.]',
    );
    expect(p.reopened).toBe('[Il file che hai riaperto con file_read]');
    expect(p.accessOpen(p.theUser, card.grant, card.deny)).toBe(
      "La tua richiesta di accesso è ancora aperta: l'utente risponde dalla scheda (Sì, concedi o No), non a parole. Non chiederla di nuovo.",
    );
    expect(p.questionOpen('Giulio', 'Quale?')).toBe(
      'Hai una domanda ancora aperta per Giulio: «Quale?»',
    );
  });

  it('English family: the twin, with the English labels of the card', () => {
    inLang('en');
    const p = hubPrompts();
    const card = accessStrings();
    expect(p.transcriptsClosed).toMatch(/^The Claude Code session transcripts/);
    expect(p.yourLead).toBe('your squad lead');
    // The private folder of the vault, whatever its layout (D-154).
    expect(p.privateInChat('Private')).toBe(
      'The private notes (Private/) aren’t accessible while you talk in a Telegram chat.',
    );
    expect(p.viaClaude('Gmail')).toBe('Gmail (through Claude)');
    expect(p.imageSaved('a.png', 'F1')).toContain('(fileId F1, /api/files/F1/content)');
    expect(p.reopened).toBe('[The file you reopened with file_read]');
    expect(p.accessOpen(p.theUser, card.grant, card.deny)).toBe(
      'Your access request is still open: the user answers from the card (“Yes, grant” or “No”), not in words. Don’t ask for it again.',
    );
    expect(p.questionOpen('Giulio', 'Which one?')).toBe(
      'You have a question still open for Giulio: “Which one?”',
    );
  });

  it('the hints of the other apps quote the button of the card as the app names it', () => {
    inLang('it');
    expect(mcpPrompts().button(mcpStrings().connectButton)).toBe('«Collega»');
    expect(mcpPrompts().quoted('Saturday')).toBe('«Saturday»');
    inLang('en');
    expect(mcpPrompts().button(mcpStrings().connectButton)).toBe('“Connect”');
    expect(mcpPrompts().quoted('Saturday')).toBe('“Saturday”');
  });
});
