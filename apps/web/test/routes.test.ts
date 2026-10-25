import { describe, expect, it } from 'vitest';
import { tellMorePath } from '../src/components/chat/FirstSteps.tsx';
import { noteActivityPath } from '../src/components/log/activity.ts';
import { isAppLink, safeUrl } from '../src/lib/markdown.ts';
import {
  automationPath,
  canonicalHash,
  chatPath,
  hashParam,
  PROJECT_ALIASES,
  PROJECT_TABS,
  projectPartOf,
  projectPath,
  projectTabOf,
  routeOf,
  SETTINGS_ALIASES,
  SETTINGS_TABS,
  settingsPartOf,
  settingsPath,
  settingsTabOf,
  tagPath,
  vaultPath,
} from '../src/lib/router.ts';

/* The hash routes are English; every Italian form of before leads to the same place. */

const ITALIAN_WORDS =
  /benvenuto|impostazioni|automazion|progetto|sezione|vista|nota=|giro|squadra|modelli|permessi|collegamenti|generale|cartella|spesa|archivio|cestino|grafo|nuov/;

describe('route paths', () => {
  it('reads the old paths and the new ones as the same route', () => {
    for (const [old, now, route] of [
      ['#/benvenuto', '#/welcome', 'welcome'],
      ['#/impostazioni', '#/settings', 'settings'],
      ['#/automazioni', '#/automations', 'automations'],
      ['#/progetto?id=a', '#/project?id=a', 'project'],
      ['#/note?nota=x', '#/notes?note=x', 'vault'],
      ['#/file', '#/files', 'files'],
      ['#/log', '#/log', 'log'],
      ['#/', '#/', 'home'],
      ['', '', 'home'],
    ] as const) {
      expect(routeOf(old)).toBe(route);
      expect(routeOf(now)).toBe(route);
    }
    expect(routeOf('#/boh')).toBe('home');
  });
});

describe('query keys and values', () => {
  it('reads every key by its new name and by its old one', () => {
    expect(hashParam('#/log?nota=Diario', 'note')).toBe('Diario');
    expect(hashParam('#/log?nota=Diario', 'nota')).toBe('Diario');
    expect(hashParam('#/log?note=Diario', 'nota')).toBe('Diario');
    expect(hashParam('#/automazioni?automazione=post&giro=r1&progetto=orto', 'automation')).toBe(
      'post',
    );
    expect(hashParam('#/automations?automation=post&run=r1&project=orto', 'giro')).toBe('r1');
    expect(hashParam('#/automations?automation=post&run=r1&project=orto', 'project')).toBe('orto');
    expect(hashParam('#/?chat=rhea&profilo=1', 'profile')).toBe('1');
    expect(hashParam('#/?chat=rhea&profile=1', 'profile')).toBe('1');
    expect(hashParam('#/?chat=rhea', 'profile')).toBeNull();
    expect(hashParam('#/project?id=orto', 'id')).toBe('orto');
  });

  it('prefers the new key when a link has both', () => {
    expect(hashParam('#/settings?sezione=modelli&section=permissions', 'section')).toBe('permessi');
    expect(canonicalHash('#/settings?sezione=modelli&section=permissions')).toBe(
      '#/settings?section=permissions',
    );
  });

  it('reads the views of the pages, old and new, as the same id', () => {
    for (const [old, now, id] of [
      ['#/automazioni?vista=nuova', '#/automations?view=new', 'nuova'],
      ['#/automazioni?vista=modifica', '#/automations?view=edit', 'modifica'],
      ['#/progetto?vista=nuovo', '#/project?view=new', 'nuovo'],
      ['#/note?vista=grafo', '#/notes?view=graph', 'grafo'],
      ['#/note?vista=cestino', '#/notes?view=trash', 'cestino'],
      ['#/note?vista=nuova', '#/notes?view=new', 'nuova'],
    ] as const) {
      expect(hashParam(old, 'view')).toBe(id);
      expect(hashParam(now, 'view')).toBe(id);
      expect(canonicalHash(old)).toBe(now);
    }
  });

  it('leaves values that are not names of places alone', () => {
    // A note called like a view, a project called like a tab.
    expect(hashParam('#/notes?note=grafo', 'note')).toBe('grafo');
    expect(hashParam('#/project?id=squadra', 'id')).toBe('squadra');
    expect(canonicalHash('#/log?nota=Risorse%2Fgrafo.md')).toBe('#/log?note=Risorse%2Fgrafo.md');
  });
});

describe('Settings', () => {
  it('opens the same tab and part from the old link as from the new one', () => {
    const ids = [...SETTINGS_TABS, ...Object.keys(SETTINGS_ALIASES)];
    for (const id of ids) {
      const old = `#/impostazioni?sezione=${id}`;
      const now = settingsPath(id);
      expect(now).not.toMatch(/sezione|impostazioni/);
      for (const link of [old, now]) {
        const param = hashParam(link, 'section');
        expect([id, settingsTabOf(param), settingsPartOf(param)]).toEqual([
          id,
          settingsTabOf(id),
          settingsPartOf(id),
        ]);
      }
      // The old link is rewritten as the new one (the first tab is the page without a section).
      expect(canonicalHash(old)).toBe(id === 'squadra' ? `${now}?section=squad` : now);
    }
  });

  it('names the tabs the way the app does', () => {
    expect(settingsPath()).toBe('#/settings');
    expect(settingsPath('squadra')).toBe('#/settings');
    expect(settingsPath('squad')).toBe('#/settings');
    expect(settingsPath('modelli')).toBe('#/settings?section=models');
    expect(settingsPath('permessi')).toBe('#/settings?section=permissions');
    expect(settingsPath('collegamenti')).toBe('#/settings?section=apps');
    expect(settingsPath('generale')).toBe('#/settings?section=general');
    expect(settingsPath('tetto')).toBe('#/settings?section=spend-cap');
    expect(settingsPath('istinto')).toBe('#/settings?section=instinct');
    expect(settingsPath('pausa')).toBe('#/settings?section=paused');
  });

  it('lands on the same place from every spelling the owner may have saved', () => {
    for (const [link, tab, part] of [
      ['#/impostazioni?sezione=generale', 'generale', null],
      ['#/settings?section=general', 'generale', null],
      ['#/impostazioni?sezione=aspetto', 'generale', 'aspetto'],
      ['#/settings?section=appearance', 'generale', 'aspetto'],
      ['#/impostazioni?sezione=accesso', 'generale', 'account'],
      ['#/settings?section=account', 'generale', 'account'],
      ['#/impostazioni?sezione=abbonamenti', 'modelli', null],
      ['#/settings?section=plans', 'modelli', null],
      ['#/impostazioni?sezione=limiti', 'modelli', 'limiti'],
      ['#/settings?section=limits', 'modelli', 'limiti'],
      ['#/impostazioni?sezione=pagella', 'squadra', 'pagella'],
      ['#/settings?section=scorecard', 'squadra', 'pagella'],
      ['#/impostazioni?sezione=avanzate', 'squadra', 'avanzate'],
      ['#/settings?section=advanced', 'squadra', 'avanzate'],
      ['#/impostazioni?sezione=telegram', 'collegamenti', 'telegram'],
      ['#/settings?section=telegram', 'collegamenti', 'telegram'],
    ] as const) {
      const param = hashParam(link, 'section');
      expect([link, settingsTabOf(param), settingsPartOf(param)]).toEqual([link, tab, part]);
    }
  });
});

describe('a project page', () => {
  it('opens the same tab and part from the old link as from the new one', () => {
    for (const id of [...PROJECT_TABS, ...Object.keys(PROJECT_ALIASES)] as const) {
      const old = `#/progetto?id=orto&sezione=${id}`;
      const now = projectPath('orto', id as never);
      expect(now).not.toMatch(/sezione|progetto/);
      for (const link of [old, now]) {
        const param = hashParam(link, 'section');
        expect([id, projectTabOf(param), projectPartOf(param)]).toEqual([
          id,
          projectTabOf(id),
          projectPartOf(id),
        ]);
      }
      // The old link is rewritten as the new one (the chat is the page without a tab).
      expect(canonicalHash(old)).toBe(id === 'chat' ? `${now}&section=chat` : now);
    }
  });

  it('names the tabs in English', () => {
    expect(projectPath('orto')).toBe('#/project?id=orto');
    expect(projectPath('orto', 'chat')).toBe('#/project?id=orto');
    expect(projectPath('orto', 'squadra')).toBe('#/project?id=orto&section=squad');
    expect(projectPath('orto', 'note')).toBe('#/project?id=orto&section=notes');
    expect(projectPath('orto', 'automazioni')).toBe('#/project?id=orto&section=automations');
    expect(projectPath('orto', 'impostazioni')).toBe('#/project?id=orto&section=settings');
    expect(projectPath('orto', 'cartella')).toBe('#/project?id=orto&section=folder');
    expect(projectPath('orto', 'collegamenti')).toBe('#/project?id=orto&section=apps');
    expect(projectPath('orto', 'spesa')).toBe('#/project?id=orto&section=spending');
    expect(projectPath('orto', 'archivio')).toBe('#/project?id=orto&section=archive');
    expect(projectPath(null)).toBe('#/project?view=new');
  });
});

describe('the writers', () => {
  it('write the new form only', () => {
    const options = { giro: 'r1', mode: 'modifica', project: 'orto' } as const;
    const written = [
      settingsPath('modelli'),
      projectPath('orto', 'squadra'),
      projectPath(null),
      automationPath('post', options),
      automationPath(null, { mode: 'nuova' }),
      vaultPath('Diario/oggi.md', 'grafo'),
      vaultPath(null, 'cestino'),
      tagPath('idee'),
      noteActivityPath('Diario/oggi.md'),
      chatPath('rhea'),
      tellMorePath('rhea'),
    ];
    for (const hash of written) expect(hash).not.toMatch(ITALIAN_WORDS);
    expect(automationPath('post', options)).toBe(
      '#/automations?automation=post&run=r1&view=edit&project=orto',
    );
    expect(vaultPath('Diario/oggi.md', 'grafo')).toBe('#/notes?note=Diario%2Foggi.md&view=graph');
    expect(tagPath('idee')).toBe('#/notes?tag=idee');
    expect(noteActivityPath('Diario/oggi.md')).toBe('#/log?note=Diario%2Foggi.md');
    expect(tellMorePath('rhea')).toBe('#/?chat=rhea&profile=1');
  });

  it('write what the readers read back', () => {
    expect(hashParam(automationPath('post', { giro: 'r1', mode: 'nuova' }), 'giro')).toBe('r1');
    expect(hashParam(automationPath('post', { mode: 'nuova' }), 'view')).toBe('nuova');
    expect(hashParam(vaultPath('Diario/oggi.md', 'cestino'), 'note')).toBe('Diario/oggi.md');
    expect(hashParam(vaultPath(null, 'cestino'), 'view')).toBe('cestino');
    expect(hashParam(projectPath(null), 'view')).toBe('nuovo');
    expect(hashParam(tellMorePath('rhea'), 'profile')).toBe('1');
  });
});

describe('canonicalHash', () => {
  it('rewrites an old address as the new one and leaves the new one alone', () => {
    for (const [old, now] of [
      ['#/benvenuto', '#/welcome'],
      ['#/impostazioni?sezione=permessi', '#/settings?section=permissions'],
      ['#/automazioni?automazione=post&giro=r1', '#/automations?automation=post&run=r1'],
      ['#/automazioni?vista=nuova&progetto=orto', '#/automations?view=new&project=orto'],
      [
        '#/note?nota=Risorse%2FLisbona%2C%20spunti.md',
        '#/notes?note=Risorse%2FLisbona%2C%20spunti.md',
      ],
      ['#/note?vista=cestino', '#/notes?view=trash'],
      ['#/progetto?id=orto&sezione=impostazioni', '#/project?id=orto&section=settings'],
      ['#/?chat=rhea&profilo=1', '#/?chat=rhea&profile=1'],
      ['#/log?nota=Diario', '#/log?note=Diario'],
      ['#/file', '#/files'],
    ] as const) {
      expect(canonicalHash(old)).toBe(now);
      expect(canonicalHash(now)).toBe(now);
    }
  });

  it('does not touch what it does not know', () => {
    for (const hash of ['', '#', '#heading', '#/boh?x=1', '#/log?foo=bar', '#/?chat=a%20b'])
      expect(canonicalHash(hash)).toBe(hash);
  });
});

describe('links in notes and messages', () => {
  it('opens the pages of the app in place, written either way', () => {
    for (const href of [
      '#/settings?section=models',
      '#/impostazioni?sezione=modelli',
      '#/notes?note=Diario',
      '#/note?nota=Diario',
      '#/log?note=Diario',
      '#/log',
    ]) {
      expect(isAppLink(href)).toBe(true);
      expect(safeUrl(href)).toBe(href);
    }
    for (const href of ['#/altro', '#/settings x', '#/welcome', 'settings', '#/projectx']) {
      expect(isAppLink(href)).toBe(false);
    }
  });
});
