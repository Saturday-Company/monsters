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
  return { title, markdown };
}
