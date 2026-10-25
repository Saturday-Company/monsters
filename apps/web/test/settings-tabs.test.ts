import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { panelId, tabId, tabKeyTarget, Tabs } from '../src/components/ui/tabs.tsx';
import {
  hashParam,
  PATHS,
  routeOf,
  SETTINGS_TABS,
  settingsPartOf,
  settingsPath,
  settingsTabOf,
} from '../src/lib/router.ts';

/* Settings in tabs: the keyboard of the tablist, its ARIA and the `?section=` links. */

describe('tablist keyboard', () => {
  it('moves with the arrows and wraps around', () => {
    expect(tabKeyTarget('ArrowRight', 0, 5)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 4, 5)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 2, 5)).toBe(1);
    expect(tabKeyTarget('ArrowLeft', 0, 5)).toBe(4);
  });

  it('goes to the ends with Home and End', () => {
    expect(tabKeyTarget('Home', 3, 5)).toBe(0);
    expect(tabKeyTarget('End', 1, 5)).toBe(4);
  });

  it('leaves every other key alone', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowDown', 'ArrowUp', 'a']) {
      expect(tabKeyTarget(key, 1, 5)).toBeNull();
    }
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('Tabs markup', () => {
  const html = renderToStaticMarkup(
    createElement(Tabs<'uno' | 'due' | 'tre'>, {
      base: 'prova',
      items: [
        { value: 'uno', label: 'Uno' },
        { value: 'due', label: 'Due' },
        { value: 'tre', label: 'Tre' },
      ],
      value: 'due',
      onChange: () => {},
      label: 'Sezioni di prova',
    }),
  );
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);

  it('is a labelled tablist of tabs', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sezioni di prova"');
    expect(tabs).toHaveLength(3);
  });

  it('selects one tab and keeps only that one in the Tab order', () => {
    const selected = tabs.filter((t) => t.includes('aria-selected="true"'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain(`id="${tabId('prova', 'due')}"`);
    expect(selected[0]).toContain('tabindex="0"');
    for (const t of tabs.filter((x) => !x.includes('aria-selected="true"'))) {
      expect(t).toContain('aria-selected="false"');
      expect(t).toContain('tabindex="-1"');
    }
  });

  it('ties each tab to its panel', () => {
    for (const v of ['uno', 'due', 'tre']) {
      expect(html).toContain(`id="${tabId('prova', v)}"`);
      expect(html).toContain(`aria-controls="${panelId('prova', v)}"`);
    }
  });
});

describe('settings links', () => {
  it('has five tabs, one idea each, Squadra first (D-066)', () => {
    expect(SETTINGS_TABS).toEqual(['squadra', 'modelli', 'permessi', 'collegamenti', 'generale']);
  });

  it('opens on the first tab without a parameter, or with an unknown one', () => {
    expect(settingsTabOf(null)).toBe('squadra');
    expect(settingsTabOf('boh')).toBe('squadra');
    expect(settingsTabOf('constructor')).toBe('squadra');
    expect(settingsTabOf('permessi')).toBe('permessi');
    expect(settingsPartOf('permessi')).toBeNull();
  });

  it('Collegamenti is a tab of its own again; old names and parts still lead somewhere', () => {
    expect(settingsTabOf('collegamenti')).toBe('collegamenti');
    expect(settingsPartOf('collegamenti')).toBeNull();
    expect(settingsTabOf('telegram')).toBe('collegamenti');
    expect(settingsPartOf('telegram')).toBe('telegram');
    expect(settingsTabOf('abbonamenti')).toBe('modelli');
    expect(settingsTabOf('aspetto')).toBe('generale');
    expect(settingsPartOf('aspetto')).toBe('aspetto');
    expect(settingsTabOf('account')).toBe('generale');
    expect(settingsPartOf('account')).toBe('account');
    expect(settingsTabOf('accesso')).toBe('generale');
    expect(settingsPartOf('toString')).toBeNull();
  });

  it('builds a link for every tab that leads back to it', () => {
    expect(settingsPath()).toBe(PATHS.settings);
    expect(settingsPath('squadra')).toBe('#/settings');
    expect(settingsPath('modelli')).toBe('#/settings?section=models');
    expect(settingsPath('collegamenti')).toBe('#/settings?section=apps');
    expect(settingsPath('generale')).toBe('#/settings?section=general');
    for (const tab of SETTINGS_TABS) {
      const path = settingsPath(tab);
      expect(routeOf(path)).toBe('settings');
      const param = hashParam(path, 'section');
      expect(settingsTabOf(param)).toBe(tab);
    }
  });
});
