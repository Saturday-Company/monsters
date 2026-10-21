import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  BLUEPRINT_JSON,
  LEGACY_TEMPLATES,
  TeamService,
  createCoreServices,
  dioneBlueprint,
  fieldsOf,
  orchestratorBlueprint,
  renderAgentFiles,
  renderAgentsMd,
  rheaBlueprint,
  upgradeInstructions,
  type AgentBlueprint,
  type AgentConfig,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * D-065: teams created before the new templates get them when the team loads,
 * if their AGENTS.md is exactly what the old template rendered. Files edited by
 * hand are never touched.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

const user = { user: 'Giulio', context: 'Giulio guida Saturday Company.' };
/** The oldest template (before D-065). */
const legacy = (bp: AgentBlueprint) => renderAgentsMd(bp, LEGACY_TEMPLATES.at(-1));

/** An agent folder as an older Monsters wrote it: old template, maybe no blueprint.json. */
function oldFolder(
  agents: string,
  bp: AgentBlueprint,
  options: { blueprint?: boolean; text?: string } = {},
): string {
  const files = renderAgentFiles(bp);
  const dir = join(agents, bp.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yaml'), files['agent.yaml']);
  writeFileSync(join(dir, 'AGENTS.md'), options.text ?? legacy(bp));
  if (options.blueprint) {
    writeFileSync(join(dir, BLUEPRINT_JSON), `${JSON.stringify(fieldsOf(bp), null, 2)}\n`);
  }
  return dir;
}

function team(home: string): TeamService {
  const s = createCoreServices({ home });
  opened.push(s);
  return new TeamService({ dir: join(home, 'agents'), log: s.log });
}

describe('AGENTS.md of an older template', () => {
  it('the old template is really different (the upgrade has something to do)', () => {
    inLang('it');
    const bp = rheaBlueprint(user);
    expect(legacy(bp)).not.toBe(renderAgentsMd(bp));
    expect(legacy(bp)).toContain('intanto continui con il resto');
  });

  it('is rendered again with the current template when the team loads, with or without blueprint.json', async () => {
    inLang('it');
    const home = tempHome();
    const agents = join(home, 'agents');
    const titan = orchestratorBlueprint({ ...user, name: 'Titan' });
    const rhea = rheaBlueprint(user);
    const dione = dioneBlueprint(user);
    oldFolder(agents, titan);
    oldFolder(agents, rhea);
    oldFolder(agents, dione, { blueprint: true });

    const loaded = await team(home).load();
    for (const bp of [titan, rhea, dione]) {
      const md = readFileSync(join(agents, bp.id, 'AGENTS.md'), 'utf8');
      expect(md, bp.id).toBe(renderAgentsMd(bp));
      expect(loaded.find((d) => d.config.id === bp.id)?.instructions).toBe(md);
      // The fields are kept next to it from now on.
      expect(existsSync(join(agents, bp.id, BLUEPRINT_JSON))).toBe(true);
    }
    expect(readFileSync(join(agents, 'rhea', 'AGENTS.md'), 'utf8')).toContain('«Da ricordare:»');
  });

  it('Rhea of the template before D-071 gets the web method, Dione is left alone', async () => {
    inLang('it');
    const home = tempHome();
    const agents = join(home, 'agents');
    const rhea = rheaBlueprint(user);
    const dione = dioneBlueprint(user);
    const v2 = (bp: AgentBlueprint) => renderAgentsMd(bp, LEGACY_TEMPLATES[1]);
    expect(v2(rhea)).not.toContain('## Come cerchi sul web');
    expect(v2(dione)).toBe(renderAgentsMd(dione));
    oldFolder(agents, rhea, { text: v2(rhea), blueprint: true });
    oldFolder(agents, dione, { text: v2(dione), blueprint: true });
    await team(home).load();
    const md = readFileSync(join(agents, 'rhea', 'AGENTS.md'), 'utf8');
    expect(md).toBe(renderAgentsMd(rhea));
    expect(md).toContain('## Come cerchi sul web');
    expect(md.split('\n').length).toBeLessThan(40);
    expect(readFileSync(join(agents, 'dione', 'AGENTS.md'), 'utf8')).not.toContain('Come cerchi');
  });

  it('the capo squadra of the template before D-073 gets the language of the briefs and the writer rule', async () => {
    inLang('it');
    const home = tempHome();
    const agents = join(home, 'agents');
    const titan = orchestratorBlueprint({ ...user, name: 'Titan' });
    const before = renderAgentsMd(titan, LEGACY_TEMPLATES[1]);
    expect(before).not.toContain('Ogni delega, scritta in');
    oldFolder(agents, titan, { text: before, blueprint: true });
    await team(home).load();
    const md = readFileSync(join(agents, 'titan', 'AGENTS.md'), 'utf8');
    expect(md).toBe(renderAgentsMd(titan));
    expect(md).toContain('Ogni delega, scritta in italiano');
    expect(md).toContain('non li scrivi tu');
    expect(md.split('\n').length).toBeLessThan(40);
  });

  it('the capo squadra of the template before D-075 gets team_propose_monster and the notes_check wording', async () => {
    inLang('it');
    const home = tempHome();
    const agents = join(home, 'agents');
    const nova = orchestratorBlueprint({ ...user, name: 'Nova' });
    const before = renderAgentsMd(nova, LEGACY_TEMPLATES[0]);
    expect(before).not.toContain('team_propose_monster');
    expect(before).toContain('guardi `notes_check`');
    oldFolder(agents, nova, { text: before, blueprint: true });
    const rhea = rheaBlueprint({ ...user, orchestrator: 'Nova' });
    oldFolder(agents, rhea, { text: renderAgentsMd(rhea), blueprint: true });
    await team(home).load();
    const md = readFileSync(join(agents, 'nova', 'AGENTS.md'), 'utf8');
    expect(md).toBe(renderAgentsMd(nova));
    expect(md).toContain('con `team_propose_monster`: la conferma Giulio.');
    expect(md).toContain('nel risultato di `delegate` le note toccate (`notes_check`)');
    expect(md.split('\n').length).toBeLessThan(40);
    // The sub-agents' template did not change: Rhea is left as she is.
    expect(readFileSync(join(agents, 'rhea', 'AGENTS.md'), 'utf8')).toBe(renderAgentsMd(rhea));
  });

  it('a file edited by hand stays exactly as it is', async () => {
    inLang('it');
    const home = tempHome();
    const agents = join(home, 'agents');
    const rhea = rheaBlueprint(user);
    const edited = `${legacy(rhea)}\n- Una regola mia: niente fonti social.\n`;
    oldFolder(agents, rhea, { text: edited });
    const titan = orchestratorBlueprint({ ...user, name: 'Titan' });
    const titanEdited = legacy(titan).replace('come a un amico', 'con il lei');
    oldFolder(agents, titan, { text: titanEdited, blueprint: true });

    await team(home).load();
    expect(readFileSync(join(agents, 'rhea', 'AGENTS.md'), 'utf8')).toBe(edited);
    expect(existsSync(join(agents, 'rhea', BLUEPRINT_JSON))).toBe(false);
    expect(readFileSync(join(agents, 'titan', 'AGENTS.md'), 'utf8')).toBe(titanEdited);
  });

  it('a file of the current template is left alone', async () => {
    inLang('it');
    const dir = oldFolder(join(tempHome(), 'agents'), rheaBlueprint(user), {
      text: renderAgentsMd(rheaBlueprint(user)),
    });
    const config = parseYaml(readFileSync(join(dir, 'agent.yaml'), 'utf8')) as AgentConfig;
    expect(await upgradeInstructions(dir, config)).toBeNull();
  });
});
