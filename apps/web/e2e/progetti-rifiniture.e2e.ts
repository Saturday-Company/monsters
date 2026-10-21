import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The finishing touches of the projects (D-102) on the mock core: the god's
 * bar is its chat in the sidebar (no row of its own), a message Titan wrote
 * with `project_send` is Titan's in the lead's chat, the lead's report has a
 * line in Titan's chat, and the lead of a draft has a look before it is
 * born. `RIFINITURE_SHOTS=<folder>` saves the screenshots (desktop light,
 * phone dark).
 */

const SHOTS = process.env['RIFINITURE_SHOTS'];
const STORE = '/src/store/app.ts';

const god = (page: Page) => page.getByTestId('god-bar');

async function closeNotice(page: Page) {
  // The demo's notice (a tool in pause) would cover the page.
  const close = page.getByRole('button', { name: 'Chiudi', exact: true });
  if (await close.count()) {
    await close.first().click();
    await expect(close).toHaveCount(0);
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await closeNotice(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function noSideScroll(page: Page, width: number) {
  await expectNoSideScroll(page, width);
}

/** Feeds events to the store as the stream would, after everything in the log. */
let fed = 0;
const feed = (page: Page, events: { agent: string; type: string; data: unknown }[]) =>
  page.evaluate(
    async ({ src, events, from }) => {
      const { ingest } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
      ingest(
        events.map((e, i) => ({
          id: `7ZZZZZZZZZ${String(from + i).padStart(16, '0')}`,
          ts: Date.now(),
          runId: 'r-rifiniture',
          parentId: null,
          ...e,
        })) as Parameters<(typeof AppStore)['ingest']>[0],
      );
    },
    { src: STORE, events, from: (fed += events.length) - events.length },
  );

/** The open questions of Titan, closed: its bar can show what else waits in its chat. */
async function closeTitanQuestions(page: Page) {
  const ids = await page.evaluate(async (src) => {
    const { useApp } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
    return Object.values(useApp.getState().questions)
      .filter((q) => q.status === 'open' && q.from === 'titan')
      .map((q) => q.id);
  }, STORE);
  await feed(
    page,
    ids.map((questionId) => ({ agent: 'system', type: 'question_expired', data: { questionId } })),
  );
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the god’s bar is its chat: chosen, its question, its unread messages, no row', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo');
    // The home shows the god's chat: its bar is the chosen strip, and Titan has no row.
    await expect(god(page)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="chat-row"][data-agent="titan"]')).toHaveCount(0);
    await expect(god(page)).toHaveAttribute('data-waiting', 'true');
    await expect(god(page).getByTestId('god-question')).toHaveText('1');
    await expect(god(page)).toHaveAccessibleName(/^Titan, .*ti chiede: /);
    await shot(page, 'barra-del-dio-scelta-chiaro');

    // Another chat open: the bar is not chosen; a message of Titan's is unread on it.
    await page.getByTestId('chat-row').filter({ hasText: 'Dione' }).click();
    await expect(god(page)).not.toHaveAttribute('aria-current', 'page');
    await closeTitanQuestions(page);
    await expect(god(page).getByTestId('god-question')).toHaveCount(0);
    await feed(page, [
      { agent: 'titan', type: 'message', data: { role: 'agent', text: 'Ho finito il giro.' } },
    ]);
    await expect(god(page).getByTestId('god-unread')).toHaveText('1');
    await expect(god(page)).toHaveAccessibleName(/^Titan, .*1 da leggere/);
    await shot(page, 'barra-del-dio-da-leggere-chiaro');
    await god(page).click();
    await expect(page).toHaveURL(/#\/\?chat=titan$/);
    await expect(god(page).getByTestId('god-unread')).toHaveCount(0);
    await expect(god(page)).toHaveAttribute('aria-current', 'page');
  });

  test('a message Titan wrote with project_send is Titan’s in the lead’s chat', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo#/progetto?id=social-di-saturday');
    await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'iapetus');
    const relayed = page.getByTestId('relayed');
    await expect(relayed).toHaveCount(1);
    await expect(relayed).toHaveAttribute('data-from', 'titan');
    await expect(relayed).toContainText('Da Titan');
    await expect(relayed.getByTestId('relayed-bubble')).toContainText(
      'Prepara il post per la serata di sabato',
    );
    // Not a message of the user's, and the lead's answer under it.
    await expect(page.getByTestId('user-bubble')).toHaveCount(0);
    await expect(page.getByTestId('agent-bubble').last()).toContainText('Calypso ha scritto');
    // Its preview in the sidebar says who wrote it.
    await expect(page.locator('[data-testid="chat-row"][data-agent="iapetus"]')).not.toContainText(
      'Tu:',
    );
    await shot(page, 'chat-del-capo-messaggio-del-dio-chiaro');
  });

  test('the lead’s report has a line in Titan’s chat, with a way to the project', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo#/?chat=titan');
    const report = page.getByTestId('report-row');
    await expect(report).toHaveCount(1);
    await expect(report).toHaveAttribute('data-status', 'completed');
    await expect(report).toContainText('Rapporto di Iapetus · Social di Saturday');
    await expect(report.getByTestId('report-text')).toContainText('Iapetus ha finito');
    await expect(report.getByTestId('report-text')).toContainText('Pandora ha preparato');
    await report.scrollIntoViewIfNeeded();
    await shot(page, 'chat-del-dio-rapporto-chiaro');
    await report.getByTestId('report-open').click();
    await expect(page).toHaveURL(/#\/progetto\?id=social-di-saturday$/);
    await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'iapetus');
  });

  test('the new lead of a draft has a look before it is born', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo#/progetto?id=sito-di-saturday');
    await expect(page.getByTestId('project-draft-page')).toBeVisible();
    // Atlas (new), Telesto (new) and the copy of Rhea: three monsters on the squad's screen.
    const screen = page.getByTestId('draft-squad').getByTestId('crew-screen');
    await expect(screen.locator('svg')).toHaveCount(3);
    await shot(page, 'bozza-capo-con-aspetto-chiaro');
    // The card in Da rivedere has the lead too.
    await page.goto('/?mock=demo');
    await page.getByTestId('review-toggle').click();
    const card = page.getByTestId('draft-card').filter({ hasText: 'Sito di Saturday' });
    await expect(card.getByTestId('crew-screen').locator('svg')).toHaveCount(3);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the same in dark on a phone, with no sideways scroll', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/?mock=demo');
    // The home is the sidebar: the bar heads it, and Titan has no row.
    await expect(god(page)).toBeVisible();
    await expect(page.locator('[data-testid="chat-row"][data-agent="titan"]')).toHaveCount(0);
    await expect(god(page).getByTestId('god-question')).toHaveText('1');
    await noSideScroll(page, 390);
    await shot(page, 'barra-del-dio-telefono-scuro');

    await page.goto('/?mock=demo#/progetto?id=social-di-saturday');
    await expect(page.getByTestId('relayed')).toContainText('Da Titan');
    await noSideScroll(page, 390);
    await shot(page, 'chat-del-capo-messaggio-del-dio-telefono-scuro');

    await page.goto('/?mock=demo#/?chat=titan');
    const report = page.getByTestId('report-row');
    await report.scrollIntoViewIfNeeded();
    await expect(report).toBeInViewport();
    await noSideScroll(page, 390);
    await shot(page, 'chat-del-dio-rapporto-telefono-scuro');

    await page.goto('/?mock=demo#/progetto?id=sito-di-saturday');
    await expect(page.getByTestId('draft-squad').locator('svg')).toHaveCount(3);
    await noSideScroll(page, 390);
    await shot(page, 'bozza-capo-con-aspetto-telefono-scuro');
  });
});
