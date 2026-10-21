import { crc32, deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Files in the chat and the File section (D-075), on the mock core: the clip,
 * paste and drop give the composer its chips, which upload at once; the
 * message goes with them; the monsters' files show as chips; the File view
 * filters, searches and deletes. `MONSTERS_E2E_SHOTS=<folder>` saves the
 * screenshots of the design review.
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  // The demo's notice (a tool in pause) would cover the composer.
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.count()) {
    await close.first().click();
    await expect(close).toHaveCount(0);
  }
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** A 480×320 PNG with a sunset gradient: something to look at in the screenshots. */
function picture(): Buffer {
  const w = 480;
  const h = 320;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = y / h;
      const hill = y > h * 0.62 + Math.sin(x / 40) * 18;
      row[1 + x * 3] = hill ? 76 : Math.round(246 - 30 * t);
      row[2 + x * 3] = hill ? 42 : Math.round(178 - 90 * t);
      row[3 + x * 3] = hill ? 58 : Math.round(107 - 10 * t);
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A real 2×2 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGM4AQYMEAoAQa4JYQOnncMAAAAASUVORK5CYII=',
  'base64',
);

const composer = (page: Page) => page.getByTestId('composer');
const chips = (page: Page) => page.getByTestId('composer-attachments').getByTestId('file-chip');

/** Dispatches files on an element as the browser would (paste or drop). */
async function dispatchFiles(
  page: Page,
  selector: string,
  kind: 'paste' | 'drop',
  files: { name: string; type: string; text?: string; png?: boolean }[],
) {
  await page.evaluate(
    ({ selector, kind, files, png }) => {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      for (const f of files) {
        dt.items.add(new File([f.png ? bytes : (f.text ?? 'ciao')], f.name, { type: f.type }));
      }
      const el = document.querySelector(selector)!;
      if (kind === 'paste') {
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return;
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      }
    },
    { selector, kind, files, png: PNG.toString('base64') },
  );
}

test.use({ viewport: { width: 1440, height: 900 } });

test('the clip attaches files: chips with the upload, send when done, chips in the bubble', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'rhea');
  const send = composer(page).getByRole('button', { name: 'Send' });
  await page.getByTestId('composer-file-input').setInputFiles([
    { name: 'tramonto.png', mimeType: 'image/png', buffer: picture() },
    { name: 'note di viaggio.txt', mimeType: 'text/plain', buffer: Buffer.from('Tram 28 alle 8') },
  ]);
  await expect(chips(page)).toHaveCount(2);
  // While they upload, the dashes run and the message cannot go yet.
  await expect(chips(page).first()).toHaveAttribute('data-state', 'uploading');
  await expect(chips(page).first().getByTestId('upload-progress')).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(chips(page).nth(0)).toHaveAttribute('data-state', 'ready');
  await expect(chips(page).nth(1)).toHaveAttribute('data-state', 'ready');
  await expect(chips(page).nth(1)).toContainText('Text');
  await page.locator('#composer-input').fill('Look at these');
  await shot(page, 'composer-allegati');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
  const bubble = page.getByTestId('bubble-attachments').last();
  await expect(bubble.getByTestId('image-tile')).toHaveCount(1);
  await expect(bubble.getByTestId('file-chip')).toContainText('note di viaggio.txt');
  await expect(page.getByTestId('agent-bubble').last()).toContainText('Got 2 files');
  await shot(page, 'bolla-allegati');
  // A press on the picture opens it in Anteprima, on the right.
  await bubble.getByTestId('image-tile').click();
  await expect(page.getByTestId('preview-title')).toHaveText('tramonto.png');
  await expect(page.getByTestId('preview-body')).toHaveAttribute('data-renderer', 'image');
});

test('only files, no words: the message goes; a chip can be removed; wrong files say why', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=dione');
  await page.getByTestId('composer-file-input').setInputFiles([
    { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('x') },
    { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
    { name: 'foto.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(chips(page)).toHaveCount(3);
  await expect(chips(page).nth(0).getByTestId('upload-error')).toHaveText(/HEIC/);
  await expect(chips(page).nth(1).getByTestId('upload-error')).toHaveText(/can’t be attached/);
  await chips(page).nth(1).getByRole('button', { name: 'Remove setup.exe' }).click();
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1)).toHaveAttribute('data-state', 'ready');
  await composer(page).getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('bubble-attachments').last().getByTestId('image-tile')).toHaveCount(
    1,
  );
  await expect(page.getByTestId('agent-bubble').last()).toContainText('Got the file');
});

test('paste an image in the field and drop files on the chat', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'rhea');
  await dispatchFiles(page, '#composer-input', 'paste', [
    { name: 'image.png', type: 'image/png', png: true },
  ]);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toContainText(/pasted image \d\d\.\d\d\.png/);
  await dispatchFiles(page, '[data-testid="chat-scroller"]', 'drop', [
    { name: 'budget.csv', type: 'text/csv', text: 'voce,euro\nhotel,240' },
  ]);
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1)).toContainText('budget.csv');
  await expect(page.getByTestId('drop-zone')).toHaveCount(0);
});

test('the monsters’ files show as chips: a screenshot of Rhea, a page of Dione', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const shotRow = page.getByTestId('file-row').filter({ hasText: 'Rhea saved a screenshot' });
  await expect(shotRow).toHaveCount(1);
  await expect(shotRow.getByTestId('image-tile')).toBeVisible();
  await page.goto('/?mock=demo#/?chat=dione');
  const page_ = page.getByTestId('file-row').filter({ hasText: 'Dione created a page' });
  await expect(page_).toContainText('Weekly menu');
  await expect(page_.getByTestId('file-chip')).toContainText('Weekly menu.html');
  // The user's photo rides on the bubble.
  await expect(
    page.getByTestId('bubble-attachments').first().getByTestId('image-tile'),
  ).toBeVisible();
});

test('File: Ctrl 4, filters, search, delete with "Di nuovo"', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+4');
  const toolbar = page.locator('[data-titlebar]');
  await expect(toolbar.getByRole('heading', { name: 'File', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/file$/);
  const tiles = page.getByTestId('file-tile');
  await expect(tiles).toHaveCount(9);
  await expect(page.getByTestId('files-count')).toHaveText('9 files');
  const filter = page.getByRole('radiogroup', { name: 'Which files' });
  await filter.getByRole('radio', { name: 'Images' }).click();
  await expect(tiles).toHaveCount(3);
  await filter.getByRole('radio', { name: 'Documents' }).click();
  await expect(tiles).toHaveCount(4);
  await expect(tiles.filter({ hasText: 'Lisbon quote.pdf' })).toHaveAttribute('data-kind', 'pdf');
  await filter.getByRole('radio', { name: 'From the monsters' }).click();
  await expect(tiles).toHaveCount(5);
  await expect(tiles.filter({ hasText: 'Screenshot by Rhea' })).toHaveCount(1);
  await expect(tiles.filter({ hasText: 'Page by Titan' })).toHaveCount(1);
  await filter.getByRole('radio', { name: 'All' }).click();
  await page.getByTestId('files-search').fill('ALFAMA');
  // The name of the photo, and the text of the quote ("Two nights in Alfama").
  await expect(tiles).toHaveCount(2);
  await expect(tiles.filter({ hasText: 'tramonto-alfama.jpg' })).toHaveCount(1);
  await expect(
    tiles.filter({ hasText: 'tramonto-alfama.jpg' }).getByTestId('file-snippet'),
  ).toHaveCount(0);
  // The words in the text of a file, not in its name: the piece of text around them (D-086).
  await page.getByTestId('files-search').fill('funiculars');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toContainText('Lisbon quote.pdf');
  await expect(tiles.first().getByTestId('file-snippet')).toContainText('Tram 28 and funiculars');
  await page.getByTestId('files-search').fill('');
  await expect(tiles).toHaveCount(9);

  await tiles.filter({ hasText: 'Weekly menu.html' }).getByRole('button', { name: /open/ }).click();
  await expect(page.getByTestId('preview-title')).toContainText('Weekly menu');
  await expect(page.getByTestId('preview-body')).toHaveAttribute('data-renderer', 'html');

  const pdf = tiles.filter({ hasText: 'Lisbon quote.pdf' });
  const del = pdf.getByTestId('file-delete');
  await del.click();
  await expect(del).toHaveAttribute('data-armed', 'true');
  await expect(del).toContainText('Again');
  await del.click();
  await expect(tiles).toHaveCount(8);
  await expect(page.getByText('I deleted Lisbon quote.pdf.')).toBeVisible();
});

test('File: the empty state when nothing matches', async ({ page }) => {
  await page.goto('/?mock=demo#/file');
  await page.getByTestId('files-search').fill('nobody is called that');
  await expect(page.getByTestId('files-empty')).toContainText('No files like that');
});

for (const scheme of ['dark', 'light'] as const) {
  test(`File: the grid in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?mock=demo#/file');
    await expect(page.getByTestId('file-tile')).toHaveCount(9);
    await expect(page.getByTestId('file-tile').first().locator('img')).toBeVisible();
    await shot(page, `file-${scheme}`);
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('File and the composer fit a phone', async ({ page }) => {
    await page.goto('/?mock=demo#/file');
    await expect(page.getByTestId('file-tile')).toHaveCount(9);
    await expectNoSideScroll(page, 390);
    await shot(page, 'file-telefono');
    await page.goto('/?mock=demo#/?chat=dione');
    await page.getByTestId('composer-file-input').setInputFiles([
      {
        name: 'una foto con un nome molto lungo da tagliare.png',
        mimeType: 'image/png',
        buffer: PNG,
      },
    ]);
    await expect(chips(page).first()).toHaveAttribute('data-state', 'ready');
    await expectNoSideScroll(page, 390);
    await shot(page, 'composer-telefono');
  });
});
