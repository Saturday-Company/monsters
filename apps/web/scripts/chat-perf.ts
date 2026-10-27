import { chromium, type Page } from '@playwright/test';

/*
 * How the chat's transcript performs on a long chat (stream J, docs/design.md Principle 6: at
 * 1440×900, ≥ 55 fps, target 60). Needs the Vite dev server of the web UI running (mock mode):
 *
 *   pnpm --filter @monsters/web exec vite --port 5195 --strictPort &
 *   node apps/web/scripts/chat-perf.ts --port 5195 --turns 1500 [--runs 3] [--step 160] [--json out.json]
 *
 * It seeds `?mockChat=<turns>` into Titan's chat, loads all of its history into the store (the
 * "Earlier messages" pages), then measures: (a) the time to open the chat, from the click to
 * the first painted frame; (b) the frames while scrolling the whole transcript; (c) the frames
 * and the cost of each chunk while a reply streams at the bottom (every 250 ms, as the core
 * sends them); (d) the DOM nodes. Headless Chromium, software raster: the numbers compare one
 * build with another on the same machine, they are not the frame rate of a real screen.
 */

interface Args {
  port: number;
  turns: number;
  runs: number;
  json: string | null;
  headed: boolean;
  step: number;
}

function args(argv: readonly string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    port: Number(get('port') ?? process.env['E2E_PORT'] ?? 5179),
    turns: Number(get('turns') ?? 1500),
    runs: Number(get('runs') ?? 3),
    json: get('json') ?? null,
    headed: argv.includes('--headed'),
    step: Number(get('step') ?? 160),
  };
}

const STORE = '/src/store/app.ts';

interface Frames {
  frames: number;
  ms: number;
  fps: number;
  p95: number;
  worst: number;
  /** Frames longer than 1.5 × 16.7 ms: a frame missed at 60 Hz. */
  long: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Loads every page of Titan's history into the store, as scrolling to the top would. */
async function loadAll(page: Page): Promise<number> {
  return page.evaluate(async (src) => {
    const app = (await import(/* @vite-ignore */ src)) as {
      loadChatOlder: (id: string) => Promise<number>;
      chatHistoryOf: (s: unknown, id: string) => { hasOlder: boolean };
      useApp: { getState: () => { events: unknown[] } };
    };
    for (let i = 0; i < 500; i++) {
      if (!app.chatHistoryOf(app.useApp.getState(), 'titan').hasOlder) break;
      await app.loadChatOlder('titan');
    }
    return app.useApp.getState().events.length;
  }, STORE);
}

/** From a click on Titan's row to the first frame painted with its chat. */
async function openTime(page: Page): Promise<number> {
  await page.evaluate(() => {
    window.location.hash = '#/?chat=dione';
  });
  await page.locator('[data-testid="chat-panel"][data-agent="dione"]').waitFor();
  await page.waitForTimeout(300);
  return page.evaluate(
    () =>
      new Promise<number>((done) => {
        const t0 = performance.now();
        window.location.hash = '#/?chat=titan';
        const check = () => {
          const panel = document.querySelector('[data-testid="chat-panel"][data-agent="titan"]');
          if (panel && panel.querySelector('[data-testid="turn"]')) {
            // The frame after the one that rendered it: painted.
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - t0)));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
  );
}

/** Frame times while `drive` runs each frame (it returns false when done). */
async function frames(page: Page, script: string): Promise<Frames> {
  return page.evaluate(
    (body) =>
      new Promise<Frames>((done) => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the measuring loop, in the page
        const drive = new Function('frame', body) as (frame: number) => boolean;
        const times: number[] = [];
        let last = performance.now();
        const start = last;
        let n = 0;
        const tick = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          if (drive(n++) === false) {
            const sorted = [...times].sort((a, b) => a - b);
            const ms = now - start;
            done({
              frames: times.length,
              ms: Math.round(ms),
              fps: Math.round((times.length / ms) * 1000 * 10) / 10,
              p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
              worst: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
              long: times.filter((t) => t > 25).length,
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    script,
  );
}

/**
 * Scrolls the whole transcript from the bottom to the top, a fixed step a frame (160 px: a quick
 * wheel or a flick, about 9,600 px a second), as the user reading back would.
 */
function scrollScript(step: number): string {
  return `
    const el = document.querySelector('[data-testid="chat-scroller"]');
    if (!el) return false;
    if (frame === 0) el.scrollTop = el.scrollHeight;
    el.scrollTop -= ${step};
    return el.scrollTop > 0 && frame < 20000;
  `;
}

/** A reply streamed at the bottom: one chunk every 250 ms, as the core sends them, for 6 s. */
async function streaming(
  page: Page,
): Promise<{ frames: Frames; chunkMs: number; chunkP95: number }> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-scroller"]');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
  const costs = page.evaluate(async (src) => {
    const app = (await import(/* @vite-ignore */ src)) as {
      ingest: (events: unknown[]) => void;
    };
    const run = 'r-perf-stream';
    let n = 0;
    const id = () => `7ZZZZZZZZZ${String(++n).padStart(16, '0')}`;
    const base = { runId: run, parentId: null, agent: 'titan' };
    app.ingest([
      {
        ...base,
        id: id(),
        ts: Date.now(),
        agent: 'user',
        type: 'message',
        data: {
          role: 'user',
          text: 'One more thing: summarise the week.',
          to: 'titan',
          channel: 'ui',
        },
      },
      { ...base, id: id(), ts: Date.now(), type: 'run', data: { status: 'started', goal: 'Week' } },
    ]);
    const words =
      'The week was calm: two meetings, the newsletter went out on **Tuesday** and the printer confirmed the 14th. '.split(
        ' ',
      );
    const out: number[] = [];
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const text = `${words.slice((i * 4) % words.length, ((i * 4) % words.length) + 4).join(' ')} `;
      const t0 = performance.now();
      app.ingest([
        {
          ...base,
          id: id(),
          ts: Date.now(),
          type: 'message',
          data: { role: 'agent', text, partial: true },
        },
      ]);
      out.push(performance.now() - t0);
    }
    return out;
  }, STORE);
  const f = await frames(page, `return frame < 340;`);
  const c = await costs;
  const sorted = [...c].sort((a, b) => a - b);
  return {
    frames: f,
    chunkMs: Math.round(median(c) * 10) / 10,
    chunkP95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
  };
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  const browser = await chromium.launch({ headless: !a.headed });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  page.on('pageerror', (err) => process.stderr.write(`page error: ${err.message}\n`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') process.stderr.write(`console error: ${msg.text()}\n`);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const base = `http://127.0.0.1:${a.port}`;
  await page.goto(`${base}/?mock=demo&mockChat=${a.turns}#/?chat=dione`);
  await page.locator('[data-testid="chat-panel"]').waitFor({ timeout: 60_000 });
  const events = await loadAll(page);
  // After a hot update the page's store is `app.ts?t=…`: a plain import gets an empty twin.
  if (events === 0) throw new Error('The page’s store was not reached: restart the Vite server.');

  const opens: number[] = [];
  for (let i = 0; i < a.runs; i++) opens.push(await openTime(page));
  await page.waitForTimeout(500);
  const dom = await page.evaluate(() => ({
    page: document.getElementsByTagName('*').length,
    chat:
      document.querySelector('[data-testid="chat-scroller"]')?.getElementsByTagName('*').length ??
      0,
    rows: document.querySelectorAll('[data-testid="chat-list"] > li').length,
    turns: document.querySelectorAll('[data-testid="turn"]').length,
    height: document.querySelector('[data-testid="chat-scroller"]')?.scrollHeight ?? 0,
  }));
  const scroll = await frames(page, scrollScript(a.step));
  const metric = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  const before = await metric();
  const stream = await streaming(page);
  const after = await metric();
  const cpu = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000);
  const result = {
    turns: a.turns,
    events,
    openMs: { median: Math.round(median(opens)), all: opens.map(Math.round) },
    dom,
    scroll,
    streaming: {
      ...stream,
      cpuMs: {
        script: cpu('ScriptDuration'),
        layout: cpu('LayoutDuration'),
        style: cpu('RecalcStyleDuration'),
      },
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (a.json) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(a.json, JSON.stringify(result, null, 2));
  }
  await browser.close();
}

await main();
