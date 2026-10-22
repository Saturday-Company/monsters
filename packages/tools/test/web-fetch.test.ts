import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setAppLang, ToolError, type ToolContext } from '@monsters/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readLimited } from '../src/http.ts';
import {
  createWebFetchTool,
  htmlToMarkdown,
  isBlockedAddress,
  isPrivateHost,
  type Resolver,
} from '../src/index.ts';

function ctx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { agentId: 'rhea', runId: 'run-1', signal, emit: () => {} };
}

const ARTICLE = `<!doctype html><html><head><title>Titolo pagina</title>
<script>var x = "<p>non devo comparire</p>";</script><style>p{color:red}</style></head>
<body><header><nav><a href="/">Home</a> <a href="/chi">Chi siamo</a></nav></header>
<main><article><header><h1>Le lune di Saturno</h1></header>
<p>Rea è la seconda luna più grande di <a href="https://it.wikipedia.org/wiki/Saturno">Saturno</a>.</p>
<ul><li>Diametro: 1527 km</li><li>Scoperta: 1672</li></ul>
<p>Dione orbita più vicino al pianeta. ${'Testo di riempimento. '.repeat(20)}</p>
<img src="x.png" alt="foto"></article></main>
<aside>Pubblicità</aside><footer>© 2026 Sito</footer></body></html>`;

const SPA = `<!doctype html><html><head><title>WitDesk</title>
<meta name="description" content="L'helpdesk con l'AI che risponde dai vostri manuali.">
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"WitDesk","offers":{"description":"Da 99 euro al mese"}}</script>
</head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

let server: Server;
let forbidden = 0;
let base: string;

// A test that pins the Italian family restores the English one.
afterEach(() => setAppLang('en'));

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/page/')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`pagina ${req.url}`);
      return;
    }
    if (req.url?.startsWith('/forbidden')) {
      forbidden++;
      res.writeHead(403);
      res.end('no bots');
      return;
    }
    switch (req.url) {
      case '/article':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(ARTICLE);
        return;
      case '/plain':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('solo testo');
        return;
      case '/big':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('a'.repeat(50_000));
        return;
      case '/long':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(LONG);
        return;
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF');
        return;
      case '/redirect':
        res.writeHead(302, { location: '/article' });
        res.end();
        return;
      case '/slow':
        // Never answers: used for timeout and abort.
        return;
      case '/spa':
        // A site built in the browser: an empty root, what it says about itself in the head.
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(SPA);
        return;
      case '/waf':
        res.writeHead(202, { 'content-type': 'text/html', 'x-amzn-waf-action': 'challenge' });
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('charset of the body', () => {
  const latin1 = (html: string) => new Uint8Array(Buffer.from(html, 'latin1'));
  const respond = (body: Uint8Array, type: string) =>
    new Response(body, { headers: { 'content-type': type } });

  it('accepts a quoted charset in the header', async () => {
    const res = respond(latin1('perché'), 'text/html; charset="iso-8859-1"');
    expect((await readLimited(res, 1000)).text).toBe('perché');
  });

  it('reads <meta charset> when the header has none', async () => {
    const res = respond(
      latin1('<html><head><meta charset="windows-1252"></head>città'),
      'text/html',
    );
    expect((await readLimited(res, 1000)).text).toContain('città');
  });

  it('reads the http-equiv form and leaves non-HTML alone', async () => {
    const html = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">perché';
    expect((await readLimited(respond(latin1(html), 'text/html'), 1000)).text).toContain('perché');
    const json = respond(new Uint8Array(Buffer.from('{"a":"é"}')), 'application/json');
    expect((await readLimited(json, 1000)).text).toBe('{"a":"é"}');
  });
});

describe('htmlToMarkdown', () => {
  it('keeps the article and drops scripts, navigation, asides and footers', () => {
    const page = htmlToMarkdown(ARTICLE);
    expect(page.title).toBe('Titolo pagina');
    expect(page.markdown).toContain('# Le lune di Saturno');
    expect(page.markdown).toContain('[Saturno](https://it.wikipedia.org/wiki/Saturno)');
    expect(page.markdown).toMatch(/\* Diametro: 1527 km/);
    for (const noise of [
      'non devo comparire',
      'Chi siamo',
      'Pubblicità',
      '© 2026',
      'color:red',
      'x.png',
    ]) {
      expect(page.markdown).not.toContain(noise);
    }
  });
});

/** A long page with headings and one passage about prices far from the start. */
const LONG = [
  '# Trattoria da Bruno',
  'filler '.repeat(1500),
  '## Orari',
  'Aperti dal martedì alla domenica. ' + 'filler '.repeat(1500),
  '## Prezzi',
  'Il menu degustazione costa 45 euro, vini esclusi.',
  'filler '.repeat(1500),
].join('\n');

describe('web_fetch', () => {
  // A limit far above any local answer: only `/slow`, which never answers, may reach it, and
  // the test that wants the timeout uses a tool of its own (D-149).
  const tool = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 10_000 });

  it('returns 8000 characters by default, and says how much is left (D-064)', async () => {
    const out = await tool.execute({ url: `${base}/long` }, ctx());
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThan(8200);
    expect(out.content).toMatch(
      /\[… truncated: \d+ more characters; call again with max_chars or find\]$/,
    );
    expect(out.content).not.toContain('45 euro');
  });

  it('reads several pages at once with `urls`, 4000 characters each, and says which failed (D-071)', async () => {
    const out = await tool.execute(
      { url: `${base}/long`, urls: [`${base}/article`, `${base}/missing`, `${base}/long`] },
      ctx(),
    );
    expect(out.pages?.map((p) => p.url)).toEqual([
      `${base}/long`,
      `${base}/article`,
      `${base}/missing`,
    ]);
    const [long, article, missing] = out.pages!;
    expect('content' in long! && long.content.length).toBeLessThan(4200);
    expect(article).toMatchObject({ title: 'Titolo pagina' });
    expect(missing && 'error' in missing ? missing.error : '').toMatch(/404/);
    expect(out.url).toBe(`${base}/long`);
    // `urls` alone is enough; nothing at all is invalid.
    const only = await tool.execute({ urls: [`${base}/plain`, `${base}/article`] }, ctx());
    expect(only.pages?.map((p) => p.url)).toEqual([`${base}/plain`, `${base}/article`]);
    expect(tool.inputSchema.safeParse({ find: 'x' }).success).toBe(false);
    // A longer list: the first three, the rest said.
    const five = await tool.execute(
      { urls: [1, 2, 3, 4, 5].map((n) => `${base}/page/${n}`) },
      ctx(),
    );
    expect(five.pages).toHaveLength(3);
    expect(five.notice).toMatch(/the others are in `not_read`/);
    expect(five.not_read).toEqual([`${base}/page/4`, `${base}/page/5`]);
    // All failing: the error of the first page.
    await expect(
      tool.execute({ url: `${base}/missing`, urls: [`${base}/pdf`] }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('suggests `urls` after two single pages, and to stop after 8 pages (D-071)', async () => {
    const own = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 10_000 });
    const run: ToolContext = { ...ctx(), runId: 'r-tips' };
    expect((await own.execute({ url: `${base}/plain` }, run)).notice).toBeUndefined();
    expect((await own.execute({ url: `${base}/article` }, run)).notice).toMatch(
      /together in `urls`/,
    );
    // The same page again: said, whatever the keywords.
    expect((await own.execute({ url: `${base}/plain`, find: 'testo' }, run)).notice).toMatch(
      /already read this page/,
    );
    const three = { url: `${base}/long`, urls: [`${base}/big`, `${base}/redirect`] };
    expect((await own.execute(three, run)).notice).toBeUndefined();
    const more = { url: `${base}/page/1`, urls: [`${base}/page/2`, `${base}/page/3`] };
    expect((await own.execute(more, run)).notice).toMatch(/You have read 9 pages/);
  });

  it('a site that refused is not asked again in the same task (D-071)', async () => {
    setAppLang('it');
    const own = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 10_000 });
    const run = (id: string): ToolContext => ({ ...ctx(), runId: id });
    forbidden = 0;
    const first = await own
      .execute({ url: `${base}/forbidden/a` }, run('r-403'))
      .catch((e: unknown) => e);
    expect(first).toMatchObject({ code: 'SITE_REFUSED' });
    expect((first as ToolError).hint).toMatch(/Non aprire le sue altre pagine/);
    const second = await own
      .execute({ url: `${base}/forbidden/b` }, run('r-403'))
      .catch((e: unknown) => e);
    expect((second as ToolError).message).toMatch(/ha già rifiutato/);
    expect(forbidden).toBe(1);
    // Another task asks again.
    await own.execute({ url: `${base}/forbidden/c` }, run('r-other')).catch(() => undefined);
    expect(forbidden).toBe(2);
  });

  it('with find returns the headings and the passages around the keywords', async () => {
    const out = await tool.execute({ url: `${base}/long`, find: 'prezzi euro' }, ctx());
    expect(out.matches).toBe(1);
    expect(out.content).toMatch(/^Headings:\n# Trattoria da Bruno\n## Orari\n## Prezzi/);
    // The Italian family keeps its word, byte for byte.
    setAppLang('it');
    const it = await tool.execute({ url: `${base}/long`, find: 'prezzi euro' }, ctx());
    expect(it.content).toMatch(/^Intestazioni:\n# Trattoria da Bruno\n## Orari\n## Prezzi/);
    setAppLang('en');
    expect(out.content).toContain('Il menu degustazione costa 45 euro');
    expect(out.content.length).toBeLessThan(2000);
    // Nothing found: the start of the page, as without find.
    const none = await tool.execute({ url: `${base}/long`, find: 'parcheggio' }, ctx());
    expect(none.matches).toBe(0);
    expect(none.content.startsWith('# Trattoria da Bruno')).toBe(true);
  });

  it('returns the page as Markdown, following redirects', async () => {
    const out = await tool.execute({ url: `${base}/redirect` }, ctx());
    expect(out.url).toBe(`${base}/article`);
    expect(out.title).toBe('Titolo pagina');
    expect(out.content).toContain('Rea è la seconda luna');
    expect(out.truncated).toBe(false);
  });

  it('returns plain text as is and truncates long content', async () => {
    expect((await tool.execute({ url: `${base}/plain` }, ctx())).content).toBe('solo testo');
    // Without `find` a page gives at least 4000 characters (D-071).
    const big = await tool.execute({ url: `${base}/big`, max_chars: 1000 }, ctx());
    expect(big.truncated).toBe(true);
    expect(big.chars).toBe(50_000);
    expect(big.content.length).toBeGreaterThan(4000);
    expect(big.content.length).toBeLessThan(4200);
  });

  it('stops downloading at maxBytes', async () => {
    const small = createWebFetchTool({ allowPrivateHosts: true, maxBytes: 1000 });
    const out = await small.execute({ url: `${base}/big` }, ctx());
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(1000);
  });

  it('maps failures to tool errors the model can act on', async () => {
    const code = (url: string, c = ctx()) =>
      tool.execute({ url }, c).then(
        () => 'ok',
        (e: unknown) => (e instanceof ToolError ? e.code : `not a ToolError: ${String(e)}`),
      );
    expect(await code(`${base}/missing`)).toBe('NOT_FOUND');
    expect(await code(`${base}/pdf`)).toBe('INVALID_INPUT');
    expect(await code('ftp://example.com/x')).toBe('INVALID_INPUT');
    expect(await code('non è un url')).toBe('INVALID_INPUT');
    const quick = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 50 });
    const timedOut = await quick.execute({ url: `${base}/slow` }, ctx()).catch((e: unknown) => e);
    expect(timedOut).toMatchObject({ code: 'UNAVAILABLE' });
    const ac = new AbortController();
    const pending = code(`${base}/slow`, ctx(ac.signal));
    setTimeout(() => ac.abort(new Error('kill')), 20);
    expect(await pending).toBe('ABORTED');
  });

  it('the refusals of a site are worded in English, in the English family (D-153)', async () => {
    const own = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 10_000 });
    const first = (await own
      .execute({ url: `${base}/forbidden/e` }, { ...ctx(), runId: 'r-403-en' })
      .catch((e: unknown) => e)) as ToolError;
    expect(first.code).toBe('SITE_REFUSED');
    expect(first.message).toContain('refused the reading');
    expect(first.hint).toMatch(/Don’t open its other pages/);
    const second = (await own
      .execute({ url: `${base}/forbidden/f` }, { ...ctx(), runId: 'r-403-en' })
      .catch((e: unknown) => e)) as ToolError;
    expect(second.message).toMatch(/already refused the reading/);
    for (const text of [first.message, first.hint ?? '', second.message]) {
      expect(text).not.toMatch(/permission|denied|rifiutato/i);
    }
  });

  it('a 403 is a refusal of the site, never worded as a permission', async () => {
    setAppLang('it');
    const own = createWebFetchTool({ allowPrivateHosts: true, timeoutMs: 10_000 });
    const err = (await own
      .execute({ url: `${base}/forbidden/x` }, { ...ctx(), runId: 'r-403-words' })
      .catch((e: unknown) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe('SITE_REFUSED');
    expect(err.message).toContain(new URL(base).hostname);
    expect(err.message).toContain('ha rifiutato');
    expect(err.message).toContain('403');
    for (const text of [err.message, err.hint ?? '']) {
      expect(text).not.toMatch(/permission|denied/i);
    }
  });

  it('refuses local and private hosts by default, also after a redirect', async () => {
    const strict = createWebFetchTool({
      resolver: () => Promise.resolve([{ address: '93.184.215.14', family: 4 }]),
      fetch: () =>
        Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { location: 'http://169.254.169.254/latest' },
          }),
        ),
    });
    await expect(strict.execute({ url: `${base}/article` }, ctx())).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
    await expect(strict.execute({ url: 'https://example.com/' }, ctx())).rejects.toMatchObject({
      code: 'BLOCKED_BY_POLICY',
    });
  });

  it('recognises private addresses', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.20.0.1',
      '169.254.169.254',
      '[::1]',
      'fd00::1',
      'nas.local',
    ])
      expect(isPrivateHost(h), h).toBe(true);
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888'])
      expect(isPrivateHost(h), h).toBe(false);
  });

  it('recognises private addresses in every form', () => {
    for (const ip of [
      '0.0.0.0',
      '127.0.0.1',
      '100.64.0.1',
      '192.0.0.8',
      '198.18.0.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:0:7f00:1',
      '0:0:0:0:0:ffff:a00:1',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::1',
      '2002:7f00:1::1',
      '2002:c0a8:101::1',
      '2001:db8::1',
      '2001::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%eth0',
      'ff02::1',
      'not an ip',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of [
      '8.8.8.8',
      '93.184.215.14',
      '2001:4860:4860::8888',
      '2606:4700::1111',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2002:808:808::1',
    ])
      expect(isBlockedAddress(ip), ip).toBe(false);
    for (const h of ['localhost.', 'LOCALHOST.', 'foo.localhost.', 'router', 'printer.home.arpa'])
      expect(isPrivateHost(h), h).toBe(true);
  });
});

describe('web_fetch DNS checks (SSRF)', () => {
  const hits: string[] = [];
  let secret: Server;
  let port = 0;

  beforeAll(async () => {
    secret = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`SECRET ${req.headers.host}`);
    });
    await new Promise<void>((r) => secret.listen(0, '127.0.0.1', r));
    port = (secret.address() as AddressInfo).port;
  });

  afterAll(async () => {
    secret.closeAllConnections();
    await new Promise((r) => secret.close(r));
  });

  const table =
    (map: Record<string, string[]>): Resolver =>
    (host) => {
      const ips = map[host];
      if (!ips) return Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      return Promise.resolve(
        ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );
    };

  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: unknown) => (e instanceof ToolError ? e.code : `not a ToolError: ${String(e)}`),
    );

  it('refuses a public name that resolves to a private address, before connecting', async () => {
    const tool = createWebFetchTool({
      timeoutMs: 2000,
      resolver: table({
        'attacker.example': ['127.0.0.1'],
        'mixed.example': ['93.184.215.14', '10.0.0.5'],
        'v6.example': ['::ffff:127.0.0.1'],
        'nat64.example': ['64:ff9b::7f00:1'],
      }),
    });
    for (const host of ['attacker.example', 'mixed.example', 'v6.example', 'nat64.example']) {
      expect(await codeOf(tool.execute({ url: `http://${host}:${port}/` }, ctx())), host).toBe(
        'BLOCKED_BY_POLICY',
      );
    }
    for (const url of [`http://localhost.:${port}/`, `http://LOCALHOST.:${port}/x`]) {
      expect(await codeOf(tool.execute({ url }, ctx())), url).toBe('BLOCKED_BY_POLICY');
    }
    expect(hits).toEqual([]);
  });

  it('checks the target of every redirect the same way', async () => {
    const tool = createWebFetchTool({
      resolver: table({ 'public.example': ['93.184.215.14'], 'inside.example': ['192.168.1.1'] }),
      fetch: () =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'http://inside.example/admin' } }),
        ),
    });
    const err = await tool
      .execute({ url: 'http://public.example/' }, ctx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('BLOCKED_BY_POLICY');
    expect((err as ToolError).message).toContain('inside.example');
  });

  it('connects to the checked address, not to a second DNS answer (rebinding)', async () => {
    // `.test` never resolves in the real DNS: the page can only be reached
    // through the address the tool resolved and checked.
    const tool = createWebFetchTool({
      allowPrivateHosts: true,
      timeoutMs: 2000,
      resolver: table({ 'pinned.test': ['127.0.0.1'] }),
    });
    const out = await tool.execute({ url: `http://pinned.test:${port}/pin` }, ctx());
    expect(out.content).toBe(`SECRET pinned.test:${port}`);
    expect(hits).toEqual(['/pin']);
  });
});

describe('pages built by JavaScript (D-1xx-tools)', () => {
  const tool = () => createWebFetchTool({ allowPrivateHosts: true });

  it('gives what the page says about itself and says why there is little', async () => {
    const out = await tool().execute({ url: `${base}/spa` }, ctx());
    expect(out.content).toContain("L'helpdesk con l'AI");
    expect(out.content).toContain('Da 99 euro al mese');
    expect(out.note).toMatch(/JavaScript/);
    expect(out.note).toMatch(/permission of the user/);
  });

  it('a normal page has no note', async () => {
    const out = await tool().execute({ url: `${base}/article` }, ctx());
    expect(out.note).toBeUndefined();
  });

  it('a check against bots is a refusal of the site, not an empty page', async () => {
    const err = await tool()
      .execute({ url: `${base}/waf` }, ctx())
      .catch((e: unknown) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('SITE_REFUSED');
    expect((err as ToolError).message).toMatch(/check against bots/);
  });
});
