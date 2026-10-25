import { useSettings } from './data.ts';
import { McpPausedCard } from './McpPaused.tsx';
import { McpServersSection, useMcpServers } from './McpServersSection.tsx';
import { TelegramSection } from './TelegramSection.tsx';
import { WebSearchSection } from './WebSearchSection.tsx';

/*
 * Settings → Apps and Telegram (route `collegamenti`, D-066; renamed in wave C, U2-17): how the
 * monsters reach the world and how the world reaches them, each a way in, in layers: what needs
 * you first (tools of an app that changed and wait for your OK), Telegram (you, from the phone:
 * your bot in three steps, the group bots behind "Advanced"), the apps (a search and the first six,
 * the browser, "Advanced: add an app by address") and the web search engine. The models and the
 * plans stay in Models; whether a monster may use the web is its permission, in Permissions.
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
