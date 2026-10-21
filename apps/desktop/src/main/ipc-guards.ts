import { connectionsStrings } from './connections-page.strings.ts';
import { isCoreUrl } from './navigation.ts';
import type { LinkState } from './remote-core.ts';

/*
 * Who may call the IPC of the preload, without Electron (tested in test/connections-ux.test.ts).
 * Every handler checks the sender: the webContents of the right window, its main frame (never
 * a subframe), and the page it shows now:
 * - the core's page (web UI of the core the window shows, local or remote): setup code, links
 *   to the browser, title bar colours, "Connections…" and where the window is connected;
 * - a page of the app (data: URL built by the main process: status page, first start, the
 *   connections window): "Try again" and the status actions; the connections API.
 * A page of a core never reaches the API of the app's pages, and the other way round.
 */

/** The parts of an Electron IPC event used by the checks. */
export interface IpcEventLike {
  sender: unknown;
  /** `origin` is the frame's own (`WebFrameMain.origin`): `null` for a sandboxed document. */
  senderFrame: { url: string; origin?: string } | null;
}

interface WebContentsLike {
  mainFrame: unknown;
}

function mainFrameOf(event: IpcEventLike, wc: WebContentsLike | null | undefined): boolean {
  const frame = event.senderFrame;
  return !!wc && event.sender === wc && frame !== null && frame === wc.mainFrame;
}

/**
 * The main frame of `wc`, showing the core at `coreOrigin`. The frame's origin decides, not
 * only its URL: a document of the core served with a CSP `sandbox` has the core's URL and an
 * opaque origin (review of 18/10, B12). A frame that reports no origin is refused.
 */
export function fromCorePage(
  event: IpcEventLike,
  wc: WebContentsLike | null | undefined,
  coreOrigin: string | null,
): boolean {
  return (
    mainFrameOf(event, wc) &&
    coreOrigin !== null &&
    event.senderFrame!.origin === coreOrigin &&
    isCoreUrl(event.senderFrame!.url, coreOrigin)
  );
}

/** The main frame of `wc`, showing a page built by the app (a data: HTML document). */
export function fromAppPage(event: IpcEventLike, wc: WebContentsLike | null | undefined): boolean {
  return mainFrameOf(event, wc) && event.senderFrame!.url.startsWith('data:text/html');
}

/**
 * Where the window is connected, for the web UI (the computer switcher of the sidebar,
 * audit UX 1.3). `state`: `ready` the core answers, `starting` the local core is starting,
 * `connecting` / `reconnecting` the SSH link, `offline` nothing answers. No address, port or
 * path: the page only needs a name and a colour.
 */
export interface TargetInfo {
  kind: 'local' | 'remote';
  name: string;
  state: 'ready' | 'starting' | 'connecting' | 'reconnecting' | 'offline';
}

/** The name of this computer for the web UI's switcher, in the app's language. */
export function localName(): string {
  return connectionsStrings().localName;
}

export function targetInfo(link: LinkState | null, localReady: boolean): TargetInfo {
  if (!link) return { kind: 'local', name: localName(), state: localReady ? 'ready' : 'starting' };
  const state: TargetInfo['state'] =
    link.status === 'connected'
      ? 'ready'
      : link.status === 'connecting'
        ? 'connecting'
        : link.status === 'reconnecting'
          ? 'reconnecting'
          : 'offline';
  return { kind: 'remote', name: link.name, state };
}
