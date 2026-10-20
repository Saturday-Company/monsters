import { SETTINGS_TABS } from '@monsters/shared';
import { Brain, Gear, Plugs, ShieldCheck, UsersThree } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  replaceHash,
  settingsPartOf,
  settingsPath,
  settingsTabOf,
  useHashParam,
  type SettingsTab,
} from '../../lib/router.ts';
import { panelId, tabId, Tabs, type TabItem } from '../ui/tabs.tsx';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { GeneralTab } from './GeneralTab.tsx';
import { LinksTab } from './LinksTab.tsx';
import { ModelsTab } from './ModelsTab.tsx';
import { PermissionsTab } from './PermissionsTab.tsx';
import { TeamTab } from './TeamTab.tsx';

/**
 * The settings tabs (D-052, D-066): one idea each, a label, an icon and the
 * line that says what is inside (the panel's accessible description).
 * Squadra = who they are; Modelli = what they think with (keys and
 * subscriptions); Permessi = what they may do and what they always ask;
 * Collegamenti = the ways in from outside (Telegram, the web, other
 * programs); Generale = how the app looks, your access, where things are.
 */
const TABS: readonly (TabItem<SettingsTab> & { hint: string })[] = [
  {
    value: 'squadra',
    label: SETTINGS_TABS.squadra,
    icon: <UsersThree size={18} aria-hidden />,
    hint: 'Chi c’è nella tua squadra, e chi sei tu per i mostri.',
  },
  {
    value: 'modelli',
    label: SETTINGS_TABS.modelli,
    icon: <Brain size={18} aria-hidden />,
    hint: 'Con cosa pensano i mostri: chiavi e abbonamenti, e il modello di ognuno.',
  },
  {
    value: 'permessi',
    label: SETTINGS_TABS.permessi,
    icon: <ShieldCheck size={18} aria-hidden />,
    hint: 'Cosa possono fare i mostri da soli, e cosa ti chiedono sempre prima.',
  },
  {
    value: 'collegamenti',
    label: SETTINGS_TABS.collegamenti,
    icon: <Plugs size={18} aria-hidden />,
    hint: 'Come raggiungi i mostri da fuori e cosa possono usare oltre alle note: Telegram, la ricerca sul web, altri programmi.',
  },
  {
    value: 'generale',
    label: SETTINGS_TABS.generale,
    icon: <Gear size={18} aria-hidden />,
    hint: 'Aspetto, il tuo accesso e dove stanno le note e le chiavi.',
  },
];

function panel(t: SettingsTab): ReactNode {
  switch (t) {
    case 'squadra':
      return <TeamTab />;
    case 'modelli':
      return <ModelsTab />;
    case 'permessi':
      return <PermissionsTab />;
    case 'collegamenti':
      return <LinksTab />;
    case 'generale':
      return <GeneralTab />;
  }
}

/**
 * Settings page (`#/impostazioni?sezione=…`), in tabs. A tab is mounted the
 * first time it is opened and then kept (hidden), so a half-typed key or an
 * open form survives a look at another tab; each tab scrolls on its own. An
 * old tab name in the link (`?sezione=collegamenti`) opens the tab that holds
 * it now, at that part.
 */
export function SettingsView() {
  const param = useHashParam('sezione');
  const tab = settingsTabOf(param);
  const part = settingsPartOf(param);
  const [visited, setVisited] = useState<ReadonlySet<SettingsTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

  // An old name or a part: the link becomes the tab's own, the part scrolls into view once it
  // is there (the tab may still be loading). The target outlives the hash it came from.
  const [target, setTarget] = useState<string | null>(null);
  const [seenPart, setSeenPart] = useState<string | null>(null);
  if (part !== seenPart) {
    setSeenPart(part);
    if (part) setTarget(part);
  }
  useEffect(() => {
    if (part) replaceHash(settingsPath(tab));
  }, [part, tab]);
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`settings-${target}`);
      if (el || ++tries > 30) {
        clearInterval(timer);
        setTarget(null);
        // Only its own panel scrolls: scrollIntoView would also move the window's frame.
        const box = el?.closest<HTMLElement>('[role="tabpanel"]');
        if (el && box)
          box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
      }
    }, 100);
    return () => clearInterval(timer);
  }, [target]);

  return (
    <section
      aria-labelledby="settings-title"
      // Full height whatever the tab holds: the page does not jump when switching.
      className="flex w-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ToolbarContent>
        <ToolbarTitle id="settings-title">Impostazioni</ToolbarTitle>
      </ToolbarContent>
      <header className="seam-b flex shrink-0 justify-center px-4 pt-3 pb-3.5 sm:px-8">
        <Tabs
          base="settings"
          items={TABS}
          value={tab}
          onChange={(t) => replaceHash(settingsPath(t))}
          label="Sezioni delle impostazioni"
          fit
        />
      </header>
      {TABS.filter((t) => visited.has(t.value)).map((t) => (
        <div
          key={t.value}
          role="tabpanel"
          id={panelId('settings', t.value)}
          aria-labelledby={tabId('settings', t.value)}
          aria-describedby={`settings-hint-${t.value}`}
          hidden={t.value !== tab}
          // The panel opens with text, not a control: it takes focus itself (WAI-ARIA tabs).
          tabIndex={0}
          data-testid={`settings-panel-${t.value}`}
          className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink sm:px-8"
        >
          <div className="mx-auto grid w-full max-w-[700px] gap-7">
            <p
              id={`settings-hint-${t.value}`}
              className="px-1 text-body leading-snug text-ink-muted"
              data-testid={`settings-hint-${t.value}`}
            >
              {t.hint}
            </p>
            {panel(t.value)}
          </div>
        </div>
      ))}
    </section>
  );
}
