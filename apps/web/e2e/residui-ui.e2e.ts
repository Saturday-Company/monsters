import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Open points of the interface after the stability waves: the notice never over the
 * page's content (it sits in the flow), every squad in Squadra, the hierarchy in one
 * line, "costo stimato" on the project's card, who restarts after Ferma, and the changed
 * parts in the dark theme. `SCREENSHOTS=<folder>` writes the pictures.
 */

const OUT = process.env['SCREENSHOTS'] ? `${process.env['SCREENSHOTS']}/` : null;
const SIZES = [
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
] as const;

type AppModule = {
  notify(text: string, tone: 'error', extra: { ms: number; action: unknown }): void;
};

async function notify(page: Page, text: string) {
  await page.evaluate(async (t) => {
    // The dev server serves the module the app itself uses: the same store.
    const path = '/src/store/app.ts';
    const app = (await import(/* @vite-ignore */ path)) as AppModule;
    app.notify(t, 'error', { ms: 600_000, action: { label: 'Riprova', run: () => {} } });
  }, text);
}

const shot = async (page: Page, name: string) => {
  if (OUT) await page.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled' });
};

for (const size of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the notice covers neither the open question nor the writing field (${size.name}, ${scheme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto('/?mock=demo#/?chat=titan');
      const card = page.getByTestId('question-card').last();
      await expect(card).toBeVisible();
      await notify(page, 'Non sono riuscito a mandare il messaggio. Il testo è rimasto nel campo.');
      const notice = page.getByTestId('notice');
      await expect(notice).toBeVisible();
      await shot(page, `avviso-${scheme}-${size.name}`);
      const n = (await notice.boundingBox())!;
      for (const id of ['composer', 'question-card']) {
        const els = page.getByTestId(id);
        for (let i = 0; i < (await els.count()); i++) {
          const b = await els.nth(i).boundingBox();
          if (!b || b.height === 0) continue;
          // Not over it: the notice is under it, above it, or beside it.
          const apart =
            n.y >= b.y + b.height - 1 || n.y + n.height <= b.y + 1 || n.x >= b.x + b.width;
          expect(apart, `${id} #${i} is not covered by the notice`).toBe(true);
        }
      }
      // The notice is whole inside the window.
      expect(n.y + n.height).toBeLessThanOrEqual(size.height);
      // The last answer of the open question is not under the notice.
      const options = card.getByRole('button');
      if ((await options.count()) > 0) {
        await options.last().scrollIntoViewIfNeeded();
        const o = (await options.last().boundingBox())!;
        expect(o.y + o.height <= n.y + 1 || o.y >= n.y + n.height).toBe(true);
      }
    });
  }
}

test('Squadra lists every squad: the capo, the personal one, the projects', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni');
  await expect(page.getByTestId('team-squad-boss')).toContainText('Il tuo capo');
  await expect(page.getByTestId('team-squad-personal')).toContainText('Squadra personale');
  const project = page.getByTestId('team-squad-social-di-saturday');
  await expect(project).toContainText('Social di Saturday');
  await expect(project).toContainText('capo del progetto');
  await expect(
    project.getByRole('link', { name: /Apri la squadra di Social di Saturday/ }).first(),
  ).toHaveAttribute('href', /progetto\?id=social-di-saturday&sezione=squadra/);
  await shot(page, 'squadra-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'squadra-dark');
});

test('the hierarchy in one line: new project and empty squad', async ({ page }) => {
  await page.goto('/?mock=demo#/progetto?vista=nuovo');
  const chart = page.getByTestId('squad-chart');
  await expect(chart).toContainText('Il tuo capo');
  await expect(chart).toContainText('Capo del progetto');
  await expect(chart).toContainText('Mostri');
  await shot(page, 'gerarchia-nuovo-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'gerarchia-nuovo-dark');
});

test('the project card says "costo stimato" when a key has no cost from the provider', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  await page.evaluate(() =>
    (
      window as unknown as { __monstersMock: { estimateCost(a: string, l: string): void } }
    ).__monstersMock.estimateCost('iapetus', 'Anthropic'),
  );
  await page.evaluate(
    () => (window.location.hash = '#/progetto?id=social-di-saturday&sezione=spesa'),
  );
  const note = page.getByTestId('project-spend-estimated');
  await expect(note).toContainText('Con Anthropic il costo è stimato');
  await expect(note).toContainText('Il tetto del progetto lo conta');
  await shot(page, 'spesa-stimata-light');
});

test('the halt band names whose messages start again', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('halt-again')).toContainText('Con «Riprendi e continua» ripartono');
  await shot(page, 'ferma-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'ferma-dark');
});

test.describe('dark theme: the parts changed in the last waves', () => {
  test.use({ colorScheme: 'dark' });

  test('Da rivedere, the chain of caps, Non collegato', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/?mock=demo#/?chat=titan');
    await page.getByTestId('review-toggle').click();
    await expect(page.getByTestId('review-sheet')).toBeVisible();
    await shot(page, 'da-rivedere-sheet-dark');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=demo#/impostazioni?sezione=tetto');
    await page.getByTestId('spend-chain').scrollIntoViewIfNeeded();
    await shot(page, 'tetti-dark');

    await page.goto('/?mock=demo#/?chat=titan');
    await expect(page.getByTestId('status-display')).toBeVisible();
    await page.evaluate(() => {
      const m = (
        window as unknown as {
          __monstersMock: {
            attach: (s: { close(c: number, r: string): void }) => void;
            sockets: Set<{ close(c: number, r: string): void }>;
          };
        }
      ).__monstersMock;
      m.attach = (s) => setTimeout(() => s.close(1006, 'down'), 0);
      for (const s of [...m.sockets]) s.close(1006, 'down');
    });
    await expect(page.getByTestId('link-band')).toBeVisible({ timeout: 15_000 });
    await shot(page, 'non-collegato-dark');
  });
});
