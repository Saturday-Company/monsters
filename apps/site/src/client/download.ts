/*
 * Picks the installer for this computer: the hero key and the big key of the download section
 * point straight at it, and its column is marked. Unknown systems (phones, ChromeOS) keep the
 * link to the release page.
 */
import { detectPlatform, type Platform } from '../lib/os.ts';
import type { ClientData } from './main.ts';

interface Pick {
  url: string;
  os: 'linux' | 'mac' | 'windows';
  label: string;
}

interface UaData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

function choose(platform: Platform, picks: Record<string, Pick>): Pick | null {
  switch (platform.os) {
    case 'linux':
      return picks['appimage'] ?? picks['deb'] ?? null;
    case 'mac':
      return platform.arch === 'x64'
        ? (picks['dmg-x64'] ?? null)
        : (picks['dmg-arm64'] ?? picks['dmg-x64'] ?? null);
    case 'windows':
      return picks['exe'] ?? null;
    default:
      return null;
  }
}

function apply(platform: Platform, data: ClientData | null): void {
  const main = document.querySelector<HTMLElement>('[data-dl-main]');
  if (!main) return;
  let picks: Record<string, Pick>;
  try {
    picks = JSON.parse(main.dataset['picks'] ?? '{}') as Record<string, Pick>;
  } catch {
    return;
  }
  const pick = choose(platform, picks);
  if (!pick) return;
  const template = data?.t.downloadFor ?? main.dataset['label'] ?? '{os}';
  const text = template.replace('{os}', pick.label);

  const key = main.querySelector<HTMLAnchorElement>('[data-dl-main-key]');
  const keyText = main.querySelector('[data-dl-main-text]');
  if (key && keyText) {
    key.href = pick.url;
    key.setAttribute('download', '');
    keyText.textContent = text;
  }
  const detected = main.querySelector<HTMLElement>('[data-dl-detected]');
  const osName = main.querySelector('[data-dl-os]');
  if (detected && osName) {
    osName.textContent = pick.label;
    detected.hidden = false;
  }
  document.querySelectorAll<HTMLElement>('.dl__os').forEach((col) => {
    col.dataset['mine'] = String(col.dataset['os'] === pick.os);
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-dl-id]').forEach((a) => {
    a.classList.toggle('key--signal', a.href === pick.url);
  });

  // The hero key keeps scrolling to the downloads (the signing notes sit next to the files);
  // it only learns the name of the system.
  const heroText = document.querySelector('[data-dl-hero-text]');
  if (heroText) heroText.textContent = text;
}

export function initDownloads(data: ClientData | null): void {
  const nav = navigator as Navigator & { userAgentData?: UaData };
  const ua = navigator.userAgent;
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  apply(detectPlatform(ua, platform), data);
  // Chromium on a Mac can tell Apple silicon from Intel.
  nav.userAgentData
    ?.getHighEntropyValues?.(['architecture'])
    .then((v) => apply(detectPlatform(ua, platform, v.architecture), data))
    .catch(() => undefined);
}
