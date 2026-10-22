import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { monstersCard } from '../src/agents/monsters-card.ts';
import { buildSystemPrompt } from '../src/agents/run-agent.ts';
import {
  ALL_VAULT_TOOLS,
  TEAM_TOOLS,
  dioneBlueprint,
  orchestratorBlueprint,
  orchestratorTools,
  rheaBlueprint,
} from '../src/index.ts';

/*
 * The "## Monsters" card (D-075): what the monster can do, from its tools, and
 * what only the user does from the app. Stable for the cache, short.
 */

// The card is written in Italian for the model (wave 3) with the places of the app inside: in Italian.
beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));

const user = { user: 'Giulio' };
const orchestrator = orchestratorTools(orchestratorBlueprint(user).tools ?? [], true);
const rhea = rheaBlueprint(user).tools ?? [];
const dione = dioneBlueprint(user).tools ?? [];

/** ~3.6 characters per token in Italian: an upper bound for the budget of the card. */
const tokens = (s: string) => Math.ceil(s.length / 3.6);

describe('the Monsters card', () => {
  it('orchestrator: notes, team, questions, proposals; no web of its own', () => {
    expect(monstersCard({ toolNames: orchestrator })).toMatchInlineSnapshot(`
      "## Monsters
      Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.
      Puoi:
      - note: cerchi, leggi e scrivi (\`vault_*\`)
      - squadra: deleghi agli altri mostri (\`delegate\`)
      - domande all’utente (\`ask_user\`)
      - nuovi mostri: proponi una bozza (\`team_propose_monster\`), l’utente la crea
      Non hai: web; servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → Altri programmi).
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('a monster without the web knows who has it, never that it is denied (D-127)', () => {
    const capo = monstersCard({ toolNames: orchestrator, webElsewhere: ['Pixel'] });
    expect(capo).toContain('Non hai: web (ce l’ha Pixel: delega la ricerca); servizi collegati');
    const two = monstersCard({ toolNames: dione, webElsewhere: ['Pixel', 'Rhea', 'Pixel'] });
    // No `delegate`: no "delega" (D-132).
    expect(two).toContain('Non hai: web (ce l’ha Pixel e Rhea); servizi collegati');
    // Nobody in the squad has it: no "delega" towards nobody.
    const none = monstersCard({ toolNames: orchestrator, webElsewhere: [] });
    expect(none).toContain('Non hai: web (nessuno nella squadra ce l’ha)');
    expect(none).not.toContain('delega)');
    expect(
      buildSystemPrompt({
        agent: {
          config: parseAgentConfig({
            id: 'nova',
            name: 'Nova',
            role: 'regole',
            color: '#336699',
            models: [{ provider: 'fake', model: 'x' }],
          }),
          instructions: '# Nova',
        },
        toolNames: dione,
        webElsewhere: ['Pixel'],
      }),
    ).toContain('web (ce l’ha Pixel)');
  });

  it('research monster: notes and web', () => {
    expect(monstersCard({ toolNames: rhea })).toMatchInlineSnapshot(`
      "## Monsters
      Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.
      Puoi:
      - note: cerchi, leggi e scrivi (\`vault_*\`)
      - web: \`web_search\`, pagine con \`web_fetch\`
      Non hai: servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → Altri programmi).
      Senza uno strumento apposta non pubblichi, non invii mail o messaggi, non paghi: prepari bozze.
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('writer: notes only', () => {
    expect(monstersCard({ toolNames: dione })).toMatchInlineSnapshot(`
      "## Monsters
      Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.
      Puoi:
      - note: cerchi, leggi e scrivi (\`vault_*\`)
      Non hai: web; servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → Altri programmi).
      Senza uno strumento apposta non pubblichi, non invii mail o messaggi, non paghi: prepari bozze.
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('harness: its own web search, terminal, connectors and connected programs', () => {
    expect(
      monstersCard({
        toolNames: [
          ...ALL_VAULT_TOOLS,
          'web_fetch',
          ...TEAM_TOOLS,
          'mcp__notion__search',
          'mcp__browser__browser_navigate',
        ],
        harness: {
          ownWebSearch: true,
          terminal: true,
          connectors: ['claude.ai Gmail', 'claude.ai Google Calendar'],
        },
      }),
    ).toMatchInlineSnapshot(`
      "## Monsters
      Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.
      Puoi:
      - note: cerchi, leggi e scrivi (\`vault_*\`)
      - web: la tua ricerca web, pagine con \`web_fetch\`
      - browser: usi siti veri nel browser di Monsters, con gli accessi che l’utente ci ha fatto (es. Instagram): leggi e prepari; prima di Pubblica, Condividi, Invia o Paga Monsters chiede all’utente
      - terminale e file: nella cartella di questo lavoro
      - squadra: deleghi agli altri mostri (\`delegate\`)
      - domande all’utente (\`ask_user\`)
      - nuovi mostri: proponi una bozza (\`team_propose_monster\`), l’utente la crea
      - servizi collegati: notion, Gmail, Google Calendar
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('names servers with upper case and underscores (D-079)', () => {
    const card = monstersCard({
      toolNames: [...ALL_VAULT_TOOLS, 'mcp__Anteiku_Prod__list_tasks', 'mcp__my-db__query'],
    });
    expect(card).toContain('- servizi collegati: Anteiku_Prod, my-db');
    expect(card).not.toContain('servizi collegati.');
  });

  it('names the services given to the monster that are not connected now (connettori 6)', () => {
    expect(monstersCard({ toolNames: dione })).not.toContain('non risponde');
    const one = monstersCard({ toolNames: dione, unlinked: ['Notion'] });
    expect(one).toContain(
      'Notion non risponde ora (accesso scaduto o un errore): i suoi strumenti mancano. Se ti serve, chiedi all’utente di ricollegarlo in Impostazioni → Collegamenti → Altri programmi.',
    );
    // Never "non è collegato": the service is connected, its access is not working (D-129).
    expect(one).not.toContain('non è collegato');
    const two = monstersCard({ toolNames: dione, unlinked: ['Blender', 'Linear', 'Notion'] });
    expect(two).toContain('Blender, Linear e Notion non rispondono ora');
  });

  it('every «Non hai» says the cause and who changes it (D-132)', () => {
    const off = monstersCard({ toolNames: dione, webOff: 'permission', webElsewhere: [] });
    expect(off).toContain(
      'web (spento per te: lo accende l’utente in Impostazioni → Permessi → Il web)',
    );
    const asks = monstersCard({
      toolNames: [...orchestrator, 'access_request'],
      webOff: 'permission',
      webElsewhere: ['Pixel'],
    });
    expect(asks).toContain('o lo chiedi tu con `access_request`, e intanto ce l’ha Pixel');
    const project = monstersCard({
      toolNames: dione,
      webOff: 'project',
      project: 'Progetto Social',
      webElsewhere: [],
    });
    expect(project).toContain(
      'web (la ricerca sul web è spenta per il progetto «Progetto Social»: la accende l’utente nella pagina del progetto «Progetto Social», scheda Collegamenti)',
    );
    expect(project).toContain(
      'servizi collegati (nessuno è acceso per questo progetto: li accende l’utente nella pagina del progetto «Progetto Social», scheda Collegamenti)',
    );
    // A project's monster: its squad, services and cap are on the project's page (§2.1).
    expect(project).toContain(
      'Per il progetto «Progetto Social» la pagina del progetto: schede Squadra, Collegamenti (servizi e ricerca sul web) e Spesa (tetto di spesa).',
    );
    for (const card of [off, asks, project]) {
      const line = card.split('\n').find((l) => l.startsWith('Non hai: '))!;
      for (const item of line.slice('Non hai: '.length, -1).split('; ')) {
        expect(item, item).toMatch(/\(.+\)$/);
      }
    }
  });

  it('MCP tools past the cap are said, never cut in silence (M1, D-134)', () => {
    const card = monstersCard({
      toolNames: [...dione, 'mcp__anteiku__x'],
      cut: [{ server: 'Anteiku', shown: 40, total: 124 }],
    });
    expect(card).toContain(
      'Di Anteiku vedi 40 strumenti su 124 (limite di strumenti di questo lavoro): gli altri non sono tra i tuoi, non è un no dell’utente.',
    );
  });

  it('own tools that wait for this turn are named with tools_search (D-134)', () => {
    const card = monstersCard({
      toolNames: [...rhea, 'tools_search', 'vault_delete', 'artifact_create'],
      searched: ['web_search', 'web_fetch', 'vault_delete', 'artifact_create'],
    });
    expect(card).toContain(
      'web: `web_search`, pagine con `web_fetch` (prima caricali con `tools_search`)',
    );
    expect(card).toContain(
      'anche, da caricare con `tools_search` quando servono: vault_delete, artifact_create',
    );
    expect(card).not.toContain('Non hai: web');
  });

  it('Codex: a command that needs the network asks Monsters, and the card says how (D-158)', () => {
    const card = monstersCard({
      toolNames: dione,
      harness: { id: 'codex', ownWebSearch: false, terminal: true, connectors: [] },
    });
    expect(card).toContain('un comando che ha bisogno della rete chiede prima a Monsters');
    expect(card).not.toContain('non hanno rete');
  });

  it('stays small: ~150-300 tokens', () => {
    for (const toolNames of [orchestrator, rhea, dione]) {
      const n = tokens(monstersCard({ toolNames }));
      expect(n).toBeGreaterThan(120);
      expect(n).toBeLessThan(260);
    }
  });

  it('is the same for every run of the same monster, whatever the order of its tools', () => {
    const tools = ['mcp__github__issues', ...rhea, 'mcp__anteiku__tasks'];
    expect(monstersCard({ toolNames: tools })).toBe(
      monstersCard({ toolNames: [...tools].reverse() }),
    );
    expect(monstersCard({ toolNames: tools })).toContain('servizi collegati: anteiku, github');
    expect(monstersCard({ toolNames: tools })).not.toMatch(/\d{1,2}:\d\d|\d{4}-\d\d/);
  });

  it('names the sections of the app as the app does (Impostazioni → Squadra, not "Mostri")', () => {
    const card = monstersCard({ toolNames: dione });
    for (const name of [
      'Squadra',
      'Modelli',
      'Permessi',
      'Collegamenti',
      'Note',
      'File',
      'Attività',
    ]) {
      expect(card).toContain(name);
    }
    expect(card).not.toMatch(/sezione Mostri/i);
  });

  it('a monster with the terminal knows it works only in the folders it was given', () => {
    expect(monstersCard({ toolNames: [...dione, 'shell', 'fs_read'] })).toContain(
      'terminale e file: solo nelle cartelle concesse',
    );
  });

  it('sits after AGENTS.md and the rules, before the profile and the memory', () => {
    const agent = {
      config: parseAgentConfig({
        id: 'titan',
        name: 'Titan',
        kind: 'orchestrator',
        role: 'capo',
        color: '#9b6dff',
        models: [{ provider: 'fake', model: 'x' }],
        tools: orchestrator,
      }),
      instructions: '# Titan\n\nSei Titan.',
    };
    const prompt = buildSystemPrompt({
      agent,
      toolNames: orchestrator,
      profile: 'Giulio ama la zucca.',
      memory: '- una cosa',
    });
    const at = (s: string) => prompt.indexOf(s);
    expect(at('## Regole del sistema')).toBeGreaterThan(at('# Titan'));
    expect(at('## Monsters')).toBeGreaterThan(at('## Regole del sistema'));
    expect(at("## Profilo dell'utente")).toBeGreaterThan(at('## Monsters'));
    expect(at('## La tua memoria')).toBeGreaterThan(at("## Profilo dell'utente"));
    expect(prompt).toContain('`team_propose_monster`');
  });
});
