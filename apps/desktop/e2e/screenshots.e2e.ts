import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  dioneBlueprint,
  orchestratorBlueprint,
  rheaBlueprint,
  writeAgentFolder,
} from '@monsters/core';
import { expect, test } from '@playwright/test';
import { APP_DIR, EMAIL, launch, onCore, PASSWORD, quit, tempRoot } from './helpers.ts';

/*
 * Screenshots of the running app, light and dark (`pnpm --filter @monsters/desktop
 * screenshots`), with a team already in the data directory. Files in MONSTERS_DESKTOP_SHOTS
 * (default node_modules/.playwright/shots). Skipped in the normal run.
 */

test.skip(process.env['MONSTERS_DESKTOP_SCREENSHOTS'] !== '1', 'screenshots only on request');

test('screenshots: the chats in the app, light and dark', async () => {
  const dirs = tempRoot();
  const out =
    process.env['MONSTERS_DESKTOP_SHOTS'] ?? join(APP_DIR, 'node_modules', '.playwright', 'shots');
  mkdirSync(out, { recursive: true });
  const models = [{ provider: 'lmstudio', model: 'qwen3-8b' }];
  const agents = join(dirs.home, 'agents');
  await writeAgentFolder(join(agents, 'titan'), orchestratorBlueprint({ user: 'Giulio', models }));
  await writeAgentFolder(join(agents, 'rhea'), rheaBlueprint({ user: 'Giulio', models }));
  await writeAgentFolder(join(agents, 'dione'), dioneBlueprint({ user: 'Giulio', models }));

  const { app, page } = await launch(dirs.home, dirs.userData(1));
  try {
    await onCore(page);
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Crea account' }).click();
    await expect(page.getByTestId('kill-switch')).toBeVisible();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, 'desktop-chiaro.png') });
    // Playwright emulates `prefers-color-scheme` on its pages (light by default), above the
    // system theme: switch the emulation, as the system's dark mode would.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
      .toBe('dark');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, 'desktop-scuro.png') });
  } finally {
    await quit(app);
    dirs.cleanup();
  }
});
