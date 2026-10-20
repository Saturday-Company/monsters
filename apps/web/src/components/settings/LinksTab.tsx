import { useSettings } from './data.ts';
import { McpServersSection } from './McpServersSection.tsx';
import { TelegramSection } from './TelegramSection.tsx';
import { PaidSearchSection } from './PaidSearchSection.tsx';
import { WebSearchSection } from './WebSearchSection.tsx';

/*
 * Settings → Collegamenti (D-066): how the monsters reach the world and how
 * the world reaches them, each a way in: Telegram (you, from the phone), the
 * search on the web, other programs and services (MCP). The models and the
 * subscriptions stay in Modelli: they are what the monsters think with.
 */
export function LinksTab() {
  const [settings, reload] = useSettings();
  return (
    <>
      <div id="settings-telegram" className="scroll-mt-4">
        <TelegramSection />
      </div>
      <WebSearchSection settings={settings} onSaved={reload} />
      <PaidSearchSection settings={settings} onChanged={reload} />
      <McpServersSection />
    </>
  );
}
