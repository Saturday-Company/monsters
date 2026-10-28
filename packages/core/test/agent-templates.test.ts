import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentDefinitionError,
  checkAgentsMd,
  dioneBlueprint,
  loadAgentDefinition,
  orchestratorBlueprint,
  renderAgentFiles,
  renderAgentsMd,
  rheaBlueprint,
  sourcesRule,
  writeAgentFolder,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

const ctx = {
  user: 'Giulio',
  context: 'Giulio guida Saturday Company, uno studio digitale a Milano.',
};

const make = () => ({
  orchestrator: orchestratorBlueprint({ ...ctx, name: 'Titan' }),
  rhea: rheaBlueprint(ctx),
  dione: dioneBlueprint(ctx),
});

// The Italian family (D-153): these assertions are the proof that its texts did not move.
describe('AGENTS.md templates', () => {
  for (const name of ['orchestrator', 'rhea', 'dione'] as const) {
    it(`${name}: under 40 lines, no placeholders left, in Italian`, () => {
      inLang('it');
      const md = renderAgentsMd(make()[name]);
      expect(checkAgentsMd(md)).toEqual([]);
      expect(md.split('\n').length).toBeLessThan(40);
      expect(md).not.toMatch(/\{\{|\}\}/);
      expect(md).toMatch(/^# /);
      expect(md).toContain('Giulio');
    });
  }

  it('fills the subagent template with role, context, duties and area', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.rhea);
    expect(md).toContain(
      'Sei Rhea, la ricercatrice della squadra di Giulio: trovi informazioni affidabili e aggiornate e le trasformi in note utili. Giulio guida Saturday Company',
    );
    expect(md).toContain('Ricevi incarichi da Titan');
    expect(md).toContain('`Risorse/Ricerche/`');
  });

  it('sub-agents: one note per task, decisions in the report, memory through «Da ricordare:» (D-065)', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.dione);
    expect(md).toContain('una nota per lavoro');
    expect(md).toContain('le varianti stanno nella stessa nota');
    // No tool sends options while working: the choice goes in the report.
    expect(md).toContain('la scrivi nel rapporto sotto «Da decidere»');
    expect(md).not.toContain('intanto continui');
    expect(md).toContain('Il tuo ultimo messaggio è il rapporto per Titan:');
    // The runtime saves the memory from the report: no two steps to edit MEMORY.md.
    expect(md).toContain('chiudi il rapporto con «Da ricordare:»');
    expect(md).not.toContain('MEMORY.md');
  });

  it('orchestrator: vault before delegating, how much to delegate, no dead stato.md (D-065)', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.orchestrator);
    expect(md).toContain('Prima di far cercare qualcosa guardi nel vault');
    expect(md).toContain('Mai due deleghe con lo stesso obiettivo');
    expect(md).toContain('nel risultato di `delegate` le note toccate (`notes_check`)');
    expect(md).toContain('`team_propose_monster`');
    expect(md).toContain('«Da ricordare:»');
    expect(md).not.toContain('stato.md');
  });

  it('lists the team in the orchestrator file', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.orchestrator);
    expect(md).toContain('- **Rhea**: ricerche online e sintesi con fonti');
    expect(md).toContain('- **Dione**:');
    expect(md).toContain('in italiano.');
  });

  it('tells the orchestrator who writes and how to ask (eval of 14/10/2026)', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.orchestrator);
    expect(md).toMatch(
      /I testi da consegnare .* li scrive l'agente della squadra che scrive testi/,
    );
    expect(md).toContain('con `ask_user`, mai con una domanda nel testo');
    expect(md).toContain('Le richieste semplici le fai tu');
  });

  it('gives every sub-agent the note rules: language, links, file names', () => {
    inLang('it');
    const blueprints = make();
    const md = renderAgentsMd(blueprints.rhea);
    expect(md).toContain('Sempre in italiano, anche quando le fonti sono in altre lingue');
    expect(md).toContain('`[testo](https://…)`');
    expect(md).toContain('Nomi dei file leggibili, con spazi');
  });

  it('tells only the agents with web tools to cite the links they saw (D-026)', () => {
    inLang('it');
    const blueprints = make();
    expect(renderAgentsMd(blueprints.rhea)).toContain(sourcesRule('it'));
    expect(renderAgentsMd(blueprints.dione)).not.toContain(sourcesRule('it'));
    // The orchestrator's file holds whether or not it gets the web at runtime.
    expect(renderAgentsMd(blueprints.orchestrator)).toContain(
      "li cerca chi fa ricerche, se c'è; se non c'è, cerchi tu.",
    );
  });

  it('rejects blueprints that would break the template', () => {
    inLang('it');
    const blueprints = make();
    expect(() =>
      renderAgentsMd({ ...blueprints.rhea, mission: 'riga uno\n## Nuova sezione' }),
    ).toThrow(/single line/);
    expect(() => renderAgentsMd({ ...blueprints.rhea, context: 'ciao {{UTENTE}}' })).toThrow(
      /placeholders/,
    );
    expect(() => renderAgentsMd({ ...blueprints.rhea, outputArea: '../fuori' })).toThrow();
    expect(() => renderAgentsMd({ ...blueprints.rhea, duties: [] })).toThrow();
    expect(() => renderAgentsMd({ ...blueprints.rhea, id: 'Rhea!' })).toThrow();
  });

  it('flags long files and leftover placeholders', () => {
    const long = ['# X', ...Array.from({ length: 45 }, (_, i) => `riga ${i}`)].join('\n');
    expect(checkAgentsMd(long)[0]).toMatch(/46 lines/);
    expect(checkAgentsMd('# X\n{{NOME}}')).toEqual(['placeholders left: {{NOME}}']);
  });

  it('writes an agent folder that loads back as a valid definition', async () => {
    inLang('it');
    const blueprints = make();
    const dir = join(tempHome(), 'agents', 'rhea');
    await writeAgentFolder(dir, { ...blueprints.rhea, genome: { hue: 220, eyes: 2 } });
    const def = await loadAgentDefinition(dir);
    expect(def.instructions).toBe(renderAgentsMd(blueprints.rhea));
    expect(def.config).toMatchObject({
      id: 'rhea',
      name: 'Rhea',
      kind: 'subagent',
      role: 'ricerche online e sintesi con fonti',
      tools: expect.arrayContaining(['web_search', 'web_fetch', 'vault_read']) as unknown,
      vault: { read: ['**'], write: ['Agenti/Rhea/**', 'Inbox/**', 'Risorse/Ricerche/**'] },
      limits: { maxOutputTokens: 4000 },
    });
    // No step cap of its own (D-200): the job's limits bound the run.
    expect(def.config.limits.maxSteps).toBeUndefined();
    expect(def.config.models.at(-1)).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    expect(def.genome).toEqual({ hue: 220, eyes: 2 });
    expect(readFileSync(join(dir, 'agent.yaml'), 'utf8')).toContain('id: rhea');
  });

  it('renders every file of the archetypes', () => {
    inLang('it');
    const blueprints = make();
    const files = renderAgentFiles(blueprints.dione);
    expect(Object.keys(files)).toEqual(['AGENTS.md', 'agent.yaml']);
  });
});

describe('loadAgentDefinition', () => {
  function folder(files: Record<string, string>): string {
    const dir = join(tempHome(), 'agent');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }
  const yaml =
    'id: rhea\nname: Rhea\nrole: ricerche\ncolor: "#112233"\nmodels:\n  - provider: openrouter\n    model: openrouter/free\n';

  it('applies defaults', async () => {
    const def = await loadAgentDefinition(folder({ 'AGENTS.md': '# Rhea\n', 'agent.yaml': yaml }));
    expect(def.config).toMatchObject({ kind: 'subagent', tools: [], limits: {} });
    expect(def.config.limits.maxSteps).toBeUndefined();
    expect(def.genome).toBeUndefined();
  });

  it('drops the blank links of a chain stored by an older version, and trims the rest', async () => {
    const stored =
      yaml +
      '  - provider: openrouter\n    model: "   "\n  - provider: anthropic\n    model: " claude-test "\n';
    const def = await loadAgentDefinition(
      folder({ 'AGENTS.md': '# Rhea\n', 'agent.yaml': stored }),
    );
    expect(def.config.models).toEqual([
      { provider: 'openrouter', model: 'openrouter/free' },
      { provider: 'anthropic', model: 'claude-test' },
    ]);
    // Nothing left: the agent cannot run, and the file says so.
    await expect(
      loadAgentDefinition(
        folder({
          'AGENTS.md': '# R',
          'agent.yaml': yaml.replace('openrouter/free', '"  "'),
        }),
      ),
    ).rejects.toThrow(/models/);
  });

  it('explains what is wrong', async () => {
    await expect(loadAgentDefinition(folder({ 'agent.yaml': yaml }))).rejects.toThrow(
      /AGENTS\.md: missing/,
    );
    await expect(
      loadAgentDefinition(
        folder({ 'AGENTS.md': '# R', 'agent.yaml': yaml.replace('"#112233"', 'blu') }),
      ),
    ).rejects.toThrow(/color/);
    await expect(
      loadAgentDefinition(
        folder({ 'AGENTS.md': '# R', 'agent.yaml': `${yaml}vault:\n  write: ["../fuori/**"]\n` }),
      ),
    ).rejects.toThrow(AgentDefinitionError);
    await expect(
      loadAgentDefinition(
        folder({ 'AGENTS.md': '# R', 'agent.yaml': yaml, 'genome.json': '[1,2]' }),
      ),
    ).rejects.toThrow(/genome\.json/);
    await expect(
      loadAgentDefinition(folder({ 'AGENTS.md': '# R', 'agent.yaml': 'id: [unclosed' })),
    ).rejects.toThrow(/invalid YAML/);
  });
});
