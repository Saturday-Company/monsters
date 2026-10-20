/*
 * Which download to offer first. Pure: the browser passes its user agent, `navigator.platform`
 * and, when Chromium exposes it, the architecture from User-Agent Client Hints.
 */

export type Os = 'linux' | 'mac' | 'windows' | 'unknown';
export type Arch = 'arm64' | 'x64' | 'unknown';

export interface Platform {
  os: Os;
  arch: Arch;
}

/** Phones and tablets get no installer: the app is for desktops. */
const MOBILE = /android|iphone|ipad|ipod|mobile/i;

export function detectOs(userAgent: string, platform = ''): Os {
  const ua = `${userAgent} ${platform}`;
  if (MOBILE.test(userAgent)) return 'unknown';
  if (/windows|win32|win64/i.test(ua)) return 'windows';
  if (/macintosh|mac os x|macintel|macos/i.test(ua)) return 'mac';
  // ChromeOS runs Linux apps in a container, but an AppImage is not the right first offer.
  if (/cros/i.test(ua)) return 'unknown';
  if (/linux|x11|ubuntu|fedora|debian/i.test(ua)) return 'linux';
  return 'unknown';
}

/**
 * The architecture, when the browser tells it. Safari never does: every Mac sold since 2021 is
 * Apple silicon, so an unknown Mac counts as arm64 (the Intel build is one key away).
 */
export function detectArch(os: Os, userAgent: string, hintArchitecture?: string): Arch {
  const hint = (hintArchitecture ?? '').toLowerCase();
  if (hint === 'arm') return 'arm64';
  if (hint === 'x86') return 'x64';
  if (/aarch64|arm64/i.test(userAgent)) return 'arm64';
  if (os === 'mac') return 'arm64';
  if (/x86_64|x64|win64|amd64|wow64/i.test(userAgent)) return 'x64';
  return 'unknown';
}

export function detectPlatform(
  userAgent: string,
  platform = '',
  hintArchitecture?: string,
): Platform {
  const os = detectOs(userAgent, platform);
  return { os, arch: detectArch(os, userAgent, hintArchitecture) };
}
