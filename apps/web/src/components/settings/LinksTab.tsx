import { useSettings } from './data.ts';
import { McpPausedCard } from './McpPaused.tsx';
import { McpServersSection, useMcpServers } from './McpServersSection.tsx';
import { TelegramSection } from './TelegramSection.tsx';
import { WebSearchSection } from './WebSearchSection.tsx';

/*
 * Settings → Collegamenti (D-066): how the monsters reach the world and how
 * the world reaches them, each a way in: what needs you first (tools of an app
 * that changed and wait for your OK), Telegram (you, from the phone), apps and
 * services (MCP: the gallery, the browser, your own apps) and the search on the
 * web. The models and the subscriptions stay in Modelli: they are what the
 * monsters think with.
 */
export function LinksTab() {
  const [settings, reload] = useSettings();
  const mcp = useMcpServers();
  return (
    <>
      {mcp.data && <McpPausedCard data={mcp.data} onData={mcp.setData} />}
      <div id="settings-telegram" className="scroll-mt-4">
        <TelegramSection />
      </div>
      <McpServersSection mcp={mcp} />
      <WebSearchSection settings={settings} onSaved={reload} />
    </>
  );
}
