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
/** The capo of a squad without pages: no web at all, only the squad's (D-127). */
const capoNoWeb = orchestrator.filter((t) => !t.startsWith('web_'));
const rhea = rheaBlueprint(user).tools ?? [];
const dione = dioneBlueprint(user).tools ?? [];

/** ~3.6 characters per token in Italian: an upper bound for the budget of the card. */
const tokens = (s: string) => Math.ceil(s.length / 3.6);

describe('the Monsters card', () => {
  it('orchestrator: notes, team, questions, proposals; the pages but not the search (D-161)', () => {
    expect(monstersCard({ toolNames: orchestrator })).toMatchInlineSnapshot(`
      "## Monsters
      Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.
      Puoi:
      - note: cerchi, leggi e scrivi (\`vault_*\`)
      - web: pagine con \`web_fetch\`; un sito o un indirizzo che l’utente o il brief nominano lo leggi tu con \`web_fetch\`: mai chiedergli di incollarlo
      - squadra: deleghi agli altri mostri (\`delegate\`)
      - domande all’utente (\`ask_user\`)
      - nuovi mostri: proponi una bozza (\`team_propose_monster\`), l’utente la crea
      Non hai: servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → App e servizi).
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('a capo with the pages but not the search says who searches and reads what the user names (D-161)', () => {
    const capo = monstersCard({ toolNames: orchestrator, webElsewhere: ['Pixel'] });
    expect(capo).toContain(
      '- web: pagine con `web_fetch`; un sito o un indirizzo che l’utente o il brief nominano lo leggi tu con `web_fetch`: mai chiedergli di incollarlo\n',
    );
    expect(capo).toContain(
      'Non hai: ricerca sul web (ce l’ha Pixel: delega le ricerche); servizi collegati',
    );
    // Nobody searches: no search to name, the pages stay.
    const alone = monstersCard({ toolNames: orchestrator, webElsewhere: [] });
    expect(alone).not.toContain('ricerca sul web');
    expect(alone).toContain('pagine con `web_fetch`');
    // With the search of its own, nothing is missing and the pages end with the same rule.
    const both = monstersCard({ toolNames: rhea, webElsewhere: ['Pixel'] });
    expect(both).toContain('`web_search`, pagine con `web_fetch`; un sito o un indirizzo');
    expect(both).not.toContain('Non hai: ricerca');
    // Without the pages there is no rule to read them.
    expect(monstersCard({ toolNames: capoNoWeb })).not.toContain('mai chiedergli di incollarlo');
  });

  it('a monster without the web knows who has it, never that it is denied (D-127)', () => {
    const capo = monstersCard({ toolNames: capoNoWeb, webElsewhere: ['Pixel'] });
    expect(capo).toContain('Non hai: web (ce l’ha Pixel: delega la ricerca); servizi collegati');
    const two = monstersCard({ toolNames: dione, webElsewhere: ['Pixel', 'Rhea', 'Pixel'] });
    // No `delegate`: no "delega" (D-132).
    expect(two).toContain('Non hai: web (ce l’ha Pixel e Rhea); servizi collegati');
    // Nobody in the squad has it: no "delega" towards nobody.
    const none = monstersCard({ toolNames: capoNoWeb, webElsewhere: [] });
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
      - web: \`web_search\`, pagine con \`web_fetch\`; un sito o un indirizzo che l’utente o il brief nominano lo leggi tu con \`web_fetch\`: mai chiedergli di incollarlo
      Non hai: servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → App e servizi).
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
      Non hai: web; servizi collegati (nessuno è dato a te: li collega e li dà l’utente in Impostazioni → Collegamenti → App e servizi).
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
      - web: la tua ricerca web, pagine con \`web_fetch\`; un sito o un indirizzo che l’utente o il brief nominano lo leggi tu con \`web_fetch\`: mai chiedergli di incollarlo
      - browser: usi siti veri nel browser di Monsters, con gli accessi che l’utente ci ha fatto (es. Instagram): leggi e prepari; prima di Pubblica, Condividi, Invia o Paga Monsters chiede all’utente
      - terminale e file: nella cartella di questo lavoro
      - squadra: deleghi agli altri mostri (\`delegate\`)
      - domande all’utente (\`ask_user\`)
      - nuovi mostri: proponi una bozza (\`team_propose_monster\`), l’utente la crea
      - servizi collegati, già tuoi (mai chiedere all’utente accessi, chiavi o indirizzi per questi): notion, Gmail, Google Calendar
      Solo l’utente, in Impostazioni: Squadra (creare, cambiare e archiviare mostri; chi è lui per voi), Modelli (modelli e spesa; tu non la vedi), Permessi, Collegamenti (servizi, Telegram). Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file."
    `);
  });

  it('names servers with upper case and underscores (D-079)', () => {
    const card = monstersCard({
      toolNames: [...ALL_VAULT_TOOLS, 'mcp__Anteiku_Prod__list_tasks', 'mcp__my-db__query'],
    });
    expect(card).toContain(
      '- servizi collegati, già tuoi (mai chiedere all’utente accessi, chiavi o indirizzi per questi): Anteiku_Prod, my-db',
    );
    expect(card).not.toContain('servizi collegati.');
  });

  it('names the services given to the monster that are not connected now (connettori 6)', () => {
    expect(monstersCard({ toolNames: dione })).not.toContain('non risponde');
    const one = monstersCard({ toolNames: dione, unlinked: ['Notion'] });
    expect(one).toContain(
      'Notion non risponde ora (accesso scaduto o un errore): i suoi strumenti mancano. Se ti serve, chiedi all’utente di ricollegarlo in Impostazioni → Collegamenti → App e servizi.',
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
      toolNames: [...capoNoWeb, 'access_request'],
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
      'web (la ricerca sul web è spenta per il progetto «Progetto Social»: la accende l’utente nella pagina del progetto «Progetto Social», scheda Impostazioni)',
    );
    expect(project).toContain(
      'servizi collegati (nessuno è acceso per questo progetto: li accende l’utente nella pagina del progetto «Progetto Social», scheda Impostazioni)',
    );
    // A project's monster: its squad, apps and cap are on the project's page (§2.1).
    expect(project).toContain(
      'Per il progetto «Progetto Social» la pagina del progetto: schede Squadra e Impostazioni (cartella, app e ricerca sul web, tetto di spesa).',
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
    expect(monstersCard({ toolNames: tools })).toContain('già tuoi');
    expect(monstersCard({ toolNames: tools })).toContain('): anteiku, github');
    expect(monstersCard({ toolNames: tools })).not.toMatch(/\d{1,2}:\d\d|\d{4}-\d\d/);
  });

  it('services by the name the user knows, already yours; the catalog only when the tools wait (D-163)', () => {
    const names = [
      'mcp__anteiku__search',
      'mcp__anteiku__anteiku_task_crea',
      'mcp__anteiku__anteiku_task_elenca',
      'mcp__anteiku__anteiku_clienti_elenca',
      'mcp__notion__notion_search',
    ];
    const labels = { anteiku: 'Anteiku' };
    const shown = monstersCard({
      toolNames: [...dione, ...names],
      mcpSearch: true,
      labels,
    });
    // The label, not the server name; the services are the monster's own.
    expect(shown).toContain('servizi collegati, già tuoi (mai chiedere all’utente accessi');
    expect(shown).toContain('): Anteiku, notion');
    expect(shown).not.toContain('per questi): anteiku');
    // One example full name of a tool that opens a service, then one sub-bullet per server.
    expect(shown).toContain('es. `mcp__anteiku__anteiku_clienti_elenca`');
    expect(shown).toContain(
      '\n  - Anteiku (`mcp__anteiku__…`): anteiku_{clienti_elenca,task_crea,task_elenca} · search\n',
    );
    expect(shown).toContain('\n  - notion (`mcp__notion__…`): notion_search\n');
    // The sub-bullets sit inside the list of what the monster can do.
    const lines = shown.split('\n');
    const at = lines.findIndex((l) => l.startsWith('  - Anteiku'));
    expect(lines[at - 1]).toContain('servizi collegati');
    // Without the search the tools are all sent: no catalog (the old text is gone too).
    const plain = monstersCard({ toolNames: [...dione, ...names], mcpSearch: false, labels });
    expect(plain).toContain('): Anteiku, notion');
    expect(plain).not.toContain('\n  - ');
    expect(plain).not.toContain('tools_search');
    expect(plain).not.toContain('molti strumenti');
    // No label known: the server name, as before.
    expect(monstersCard({ toolNames: names, mcpSearch: true })).toContain('): anteiku, notion');
  });

  it('is the same whatever the order of the tool names, catalog and labels included (D-163)', () => {
    const tools = [
      ...rhea,
      'mcp__anteiku__anteiku_task_crea',
      'mcp__anteiku__anteiku_task_elenca',
      'mcp__anteiku__anteiku_clienti_crea',
      'mcp__anteiku__search',
      'mcp__github__list_issues',
      'mcp__github__create_issue',
    ];
    const options = { mcpSearch: true, labels: { anteiku: 'Anteiku', github: 'GitHub' } };
    const card = monstersCard({ toolNames: tools, ...options });
    expect(card).toContain('\n  - GitHub (`mcp__github__…`): ');
    expect(monstersCard({ toolNames: [...tools].reverse(), ...options })).toBe(card);
    expect(
      monstersCard({
        toolNames: [...tools].sort(() => 0.5 - Math.sin(tools.length)),
        ...options,
      }),
    ).toBe(card);
    expect(card).not.toMatch(/\d{1,2}:\d\d|\d{4}-\d\d/);
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
