import { messageFor, type HostKeyInfo, type TunnelErrorKind } from '@monsters/remote';
import { appLang } from '@monsters/shared';
import { SYSTEM_FONT } from './page-theme.ts';
import { remoteCopyStrings } from './remote-copy.strings.ts';
import type { LinkState } from './remote-core.ts';

/*
 * The words of the client mode (M3.3, D-047), in the app's language (D-153; the texts are in
 * remote-copy.strings.ts): the host key dialogs, the tray tooltip, the banner over the window
 * while reconnecting, the status line of the connections page. Pure functions (tested), used
 * by index.ts.
 */

/** The fields of Electron's MessageBoxOptions used here. */
export interface DialogCopy {
  type: 'warning' | 'error';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

/** Index of the "trust" button in `hostKeyDialog`. */
export const TRUST_BUTTON = 1;

/**
 * First connection to a computer: the user compares the fingerprint with the one the
 * remote computer prints. "Cancel" is the default (Enter, Esc, closing the dialog). The
 * first line says it is normal; the check, for whoever wants it, comes after (audit UX 1.8).
 */
export function hostKeyDialog(info: HostKeyInfo, name: string): DialogCopy {
  const t = remoteCopyStrings().hostKey;
  const key = info.keys[0];
  const where = info.port === 22 ? info.hostname : t.port(info.hostname, info.port);
  return {
    type: 'warning',
    title: t.title,
    message: t.message(name),
    detail: [
      t.remember(where),
      '',
      t.fingerprint(key?.type ?? '?', key?.fingerprint ?? '?'),
      '',
      ...t.verify,
    ].join('\n'),
    buttons: [t.cancel, t.trust],
    defaultId: 0,
    cancelId: 0,
  };
}

export function hostKeyChangedDialog(name: string): DialogCopy {
  const t = remoteCopyStrings().hostKeyChanged;
  return {
    type: 'error',
    title: t.title,
    message: t.message(name),
    detail: t.detail,
    buttons: [t.ok],
    defaultId: 0,
    cancelId: 0,
  };
}

/** "Forget the old key": a strong warning first. Button 0 forgets, 1 is the default. */
export function forgetKeyDialog(name: string): DialogCopy {
  const t = remoteCopyStrings().forgetKey;
  return {
    type: 'warning',
    title: t.title,
    message: t.message(name),
    detail: t.detail,
    buttons: [t.forget, t.cancel],
    defaultId: 1,
    cancelId: 1,
  };
}

/** The old key is in the user's own known_hosts: Monsters never writes it. */
export function keyElsewhereDialog(name: string, address: string): DialogCopy {
  const t = remoteCopyStrings().keyElsewhere;
  return {
    type: 'warning',
    title: t.title,
    message: t.message(name),
    detail: t.detail(address),
    buttons: [t.ok],
    defaultId: 0,
    cancelId: 0,
  };
}

/** Field of the connections form that fixes a failure ("Fix the connection"). */
export type FixField = 'host' | 'user' | 'identityFile' | 'sshPort';

export interface FailureCopy {
  message: string;
  tip?: string;
  /** Field to open the form on; null when the profile is not what needs fixing. */
  fix: FixField | null;
  /** Host key changed: offer to forget the old one. */
  forgetKey?: boolean;
}

/**
 * Why a connection failed, in plain words, naming the address that was tried and saying what
 * to do (audit UX 1.4, 1.7). The technical lines of ssh stay under "Details".
 */
export function remoteFailureCopy(
  kind: TunnelErrorKind,
  name: string,
  address: string,
  fallback = '',
  platform: string = process.platform,
): FailureCopy {
  const t = remoteCopyStrings().failure;
  switch (kind) {
    case 'host-not-found':
      return { message: t.hostNotFound(address), tip: t.hostNotFoundTip, fix: 'host' };
    case 'unreachable':
      return { message: t.unreachable(address), tip: t.unreachableTip, fix: 'host' };
    case 'auth-failed':
      return {
        message: t.authFailed(address),
        tip: platform === 'win32' ? t.authFailedTipWindows : t.authFailedTip,
        fix: 'user',
      };
    case 'host-key-unknown':
      return { message: t.hostKeyUnknown(name), tip: t.hostKeyUnknownTip, fix: null };
    case 'host-key-changed':
      return {
        message: t.hostKeyChanged(name),
        tip: t.hostKeyChangedTip,
        fix: null,
        forgetKey: true,
      };
    case 'core-unreachable':
      return { message: t.coreUnreachable(name), tip: t.coreUnreachableTip, fix: null };
    case 'core-unverified':
      return { message: t.coreUnverified(name), tip: t.coreUnverifiedTip, fix: null };
    case 'core-outdated':
      return { message: t.coreOutdated(name), tip: t.coreOutdatedTip, fix: null };
    case 'connection-lost':
    case 'ssh-error':
      return { message: t.connectionLost(name), tip: t.connectionLostTip, fix: null };
    default:
      return { message: messageFor(kind) || fallback, fix: null };
  }
}

/** Tooltip of the tray icon: which core the app is using, and how the link is doing. */
export function trayTooltip(link: LinkState | null): string {
  const t = remoteCopyStrings().tray;
  if (!link) return t.local;
  switch (link.status) {
    case 'connecting':
      return t.connecting(link.name);
    case 'connected':
      return t.connected(link.name);
    case 'reconnecting':
      return t.reconnecting(link.name);
    case 'failed':
    case 'closed':
      return t.disconnected(link.name);
  }
}

/** The status line of the current row in the connections page. */
export function linkStatusText(link: LinkState | null, localReady: boolean): string {
  const t = remoteCopyStrings().status;
  if (!link) return localReady ? t.inUse : t.inUseStarting;
  switch (link.status) {
    case 'connecting':
      return t.inUseConnecting;
    case 'connected':
      return t.inUseConnected;
    case 'reconnecting':
      return t.inUseReconnecting(link.attempt);
    case 'failed':
      return t.inUseFailed;
    case 'closed':
      return t.closed;
  }
}

/** The banner over the remote page, or null when there is nothing to say. */
export function bannerText(link: LinkState | null): string | null {
  if (!link) return null;
  const t = remoteCopyStrings().banner;
  if (link.status === 'reconnecting') return t.reconnecting(link.name, link.attempt);
  if (link.status === 'connected') return t.connected(link.name);
  return null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The banner page: text only, no script (CSP `default-src 'none'`). */
export function bannerHtml(text: string, tone: 'busy' | 'ok'): string {
  return `<!doctype html>
<html lang="${appLang()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;font:500 13px/1.3 ${SYSTEM_FONT};-webkit-font-smoothing:antialiased}
p{margin:0;padding:.5rem .95rem;border-radius:10px;background:#0d0d0c;color:#efe9dc;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 0 0 1px rgba(0,0,0,.4);max-width:calc(100% - 1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:.5rem}
i{width:8px;height:8px;border-radius:50%;background:${tone === 'ok' ? '#4fd98a' : '#ff5e14'};box-shadow:0 0 6px ${tone === 'ok' ? 'rgba(79,217,138,.6)' : 'rgba(255,94,20,.6)'};flex:none}
@media (prefers-color-scheme:dark){p{background:#050505}}
</style></head>
<body><p role="status" data-tone="${tone}"><i></i>${escape(text)}</p></body></html>
`;
}
