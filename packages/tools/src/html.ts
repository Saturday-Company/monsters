import { NodeHtmlMarkdown } from 'node-html-markdown';
import { parse, type HTMLElement } from 'node-html-parser';

/*
 * HTML → readable Markdown. Not a full Readability: drops the obvious chrome
 * (scripts, navigation, footers, forms…) and keeps the main content when the
 * page marks it (`<article>`, `<main>`), which covers most modern sites.
 */

const NOISE = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'nav',
  'aside',
  'form',
  'button',
  'select',
  'dialog',
  '[role=navigation]',
  '[role=banner]',
  '[role=contentinfo]',
  '[role=complementary]',
  '[aria-hidden=true]',
  '[hidden]',
].join(',');

const converter = new NodeHtmlMarkdown({
  ignore: ['img', 'picture', 'video', 'audio', 'source'],
  maxConsecutiveNewlines: 2,
  useLinkReferenceDefinitions: false,
  keepDataImages: false,
});

export interface HtmlPage {
  title: string | undefined;
  markdown: string;
  /**
   * What the page says about itself without its body: meta description, Open Graph, the
   * text of its structured data (JSON-LD) and of `<noscript>`. A page built by JavaScript
   * has little else to give without a browser.
   */
  about: string;
}

/** Text fields of JSON-LD that describe a page, a product or an organization. */
const LD_FIELDS = ['name', 'headline', 'description', 'slogan', 'text', 'articleBody'];

function ldText(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 40) return;
  if (Array.isArray(value)) {
    for (const v of value) ldText(v, out, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const o = value as Record<string, unknown>;
  for (const f of LD_FIELDS) {
    const v = o[f];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  for (const [k, v] of Object.entries(o)) if (!LD_FIELDS.includes(k)) ldText(v, out, depth + 1);
}

function aboutPage(root: HTMLElement): string {
  const meta = (selector: string) => root.querySelector(selector)?.getAttribute('content')?.trim();
  const parts = [
    meta('meta[name="description"]'),
    meta('meta[property="og:description"]'),
    meta('meta[name="twitter:description"]'),
  ];
  const ld: string[] = [];
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      ldText(JSON.parse(el.textContent), ld);
    } catch {
      // Broken structured data: the rest of the page still counts.
    }
  }
  parts.push(...ld);
  for (const el of root.querySelectorAll('noscript')) {
    const text = parse(el.textContent).textContent.replace(/\s+/g, ' ').trim();
    if (text.length > 40) parts.push(text);
  }
  const seen = new Set<string>();
  return parts
    .filter((p): p is string => !!p && !seen.has(p) && !!seen.add(p))
    .join('\n\n')
    .slice(0, 4000);
}

function textLength(el: HTMLElement): number {
  return el.textContent.replace(/\s+/g, ' ').trim().length;
}

function mainContent(root: HTMLElement): HTMLElement {
  const body = root.querySelector('body') ?? root;
  const bodyLen = textLength(body);
  const candidates = [
    ...root.querySelectorAll('article'),
    ...root.querySelectorAll('main'),
    ...root.querySelectorAll('[role=main]'),
  ];
  let best: HTMLElement | undefined;
  let bestLen = 0;
  for (const c of candidates) {
    const len = textLength(c);
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  // Use the marked region only if it holds a meaningful part of the page.
  return best && bestLen >= Math.min(200, bodyLen * 0.3) ? best : body;
}

export function htmlToMarkdown(html: string): HtmlPage {
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });
  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    root.querySelector('title')?.textContent.trim() ||
    undefined;
  const about = aboutPage(root);
  for (const el of root.querySelectorAll(NOISE)) el.remove();
  // Page headers and footers are chrome; the ones inside an article are content.
  for (const el of root.querySelectorAll('header, footer')) {
    if (!el.closest('article, main')) el.remove();
  }
  const content = mainContent(root);
  const markdown = converter
    .translate(content.innerHTML)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, markdown, about };
}
