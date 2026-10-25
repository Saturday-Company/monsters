import { setAppLang } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer as Markdown } from '../src/components/ui/MarkdownRenderer.tsx';
import {
  clipText,
  noteTargetOf,
  plainText,
  prepareMarkdown,
  safeUrl,
} from '../src/lib/markdown.ts';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('prepareMarkdown', () => {
  it('turns wikilinks into note links', () => {
    expect(prepareMarkdown('Vedi [[Idee]].')).toBe('Vedi [Idee](<nota:Idee>).');
    expect(prepareMarkdown('[[Risorse/Lisbona.md|la nota]]')).toBe(
      '[la nota](<nota:Risorse/Lisbona.md>)',
    );
  });

  it('turns the [[Titolo|https://…]] mistake into an external link', () => {
    expect(prepareMarkdown('[[Wild boar|https://en.wikipedia.org/wiki/Wild_boar]]')).toBe(
      '[Wild boar](<https://en.wikipedia.org/wiki/Wild_boar>)',
    );
  });

  it('leaves code alone', () => {
    const md = 'Usa `[[Nota]]` così:\n\n```\n[[Nota]]\n```\n\n[[Vera]]';
    expect(prepareMarkdown(md)).toBe(
      'Usa `[[Nota]]` così:\n\n```\n[[Nota]]\n```\n\n[Vera](<nota:Vera>)',
    );
  });
});

describe('safeUrl', () => {
  it('keeps http(s), mailto and note links', () => {
    expect(safeUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeUrl('mailto:ciao@example.org')).toBe('mailto:ciao@example.org');
    expect(safeUrl('nota:Idee')).toBe('nota:Idee');
    expect(safeUrl('Risorse/Idee.md')).toBe('Risorse/Idee.md');
  });

  it('drops every other scheme', () => {
    for (const u of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html;base64,xx',
      'file:///etc/passwd',
      'vbscript:x',
      '//evil.example/x',
    ])
      expect(safeUrl(u)).toBe('');
  });

  it('reads note targets from wikilinks and relative paths', () => {
    expect(noteTargetOf('nota:Progetti/Social/Post 1')).toBe('Progetti/Social/Post 1');
    expect(noteTargetOf('./Risorse/Idee%20belle.md')).toBe('Risorse/Idee belle.md');
    expect(noteTargetOf('https://example.org')).toBeNull();
    expect(noteTargetOf('#titolo')).toBeNull();
  });
});

describe('Markdown', () => {
  it('renders headings, emphasis, lists and tables', () => {
    const html = render('### Note\n- **Tag:** sì\n\n| A | B |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<h3>Note</h3>');
    expect(html).toContain('<strong>Tag:</strong>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('###');
    expect(html).not.toContain('**');
  });

  it('never renders raw HTML', () => {
    const html = render('Ciao <img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('opens external links in a new tab, without opener', () => {
    const html = render('[fonte](https://example.org)');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows unsafe links as plain text', () => {
    const html = render('[clicca](javascript:alert(1))');
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('<a');
    expect(html).toContain('clicca');
  });

  it('shows wikilinks as note chips that open the note', () => {
    const html = render('Vedi [[Risorse/Lisbona, spunti]]');
    expect(html).toContain('data-testid="note-chip"');
    expect(html).toContain('href="#/notes?note=Risorse%2FLisbona%2C%20spunti"');
    expect(html).toContain('Lisbona, spunti');
    expect(html).not.toContain('[[');
  });

  it('opens the pages of the app in place', () => {
    const html = render('Collegalo in [Impostazioni → Modelli](#/impostazioni?sezione=modelli).');
    expect(html).toContain('href="#/impostazioni?sezione=modelli"');
    expect(html).not.toContain('target="_blank"');
    expect(safeUrl('#/altro')).toBe('');
  });

  it('never loads remote images by itself: a card with "Show image" (D-075)', () => {
    const html = render('![foto](https://example.org/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('remote-image-card');
    expect(html).toContain('From example.org');
    expect(html).toContain('Show image');
    // Plain http is a link only.
    const plain = render('![foto](http://example.org/a.png)');
    expect(plain).not.toContain('<img');
    expect(plain).toContain('Image: foto');
    expect(render('![](http://example.org/a.png)')).toContain('>Image<');
    setAppLang('it');
    try {
      expect(render('![foto](http://example.org/a.png)')).toContain('Immagine: foto');
    } finally {
      setAppLang('en');
    }
  });

  it('shows the core’s images and opens files in Anteprima (D-075)', () => {
    const html = render(
      '![menu](/api/files/f-menu/content) e [preventivo](/api/files/f-pdf/content)',
    );
    expect(html).toContain('data-testid="chat-image"');
    expect(html).toMatch(/<img[^>]+src="\/api\/files\/f-menu\/content"/);
    expect(html).toContain('data-testid="file-link"');
    expect(html).not.toContain('note-chip');
  });

  it('keeps single line breaks, as in a chat', () => {
    expect(render('riga uno\nriga due')).toMatch(/riga uno<br\/>\s*riga due/);
  });
});

describe('plainText', () => {
  it('strips Markdown for one-line places', () => {
    expect(
      plainText('### Titolo\n- **Ricerca** su [[Note/Idee|idee]] e [sito](https://x.org)'),
    ).toBe('Titolo Ricerca su idee e sito');
    expect(plainText('usa `vault_search` e _poi_ scrivi')).toBe('usa vault_search e poi scrivi');
  });

  it('keeps snake_case words', () => {
    expect(plainText('il file note_di_oggi.md')).toBe('il file note_di_oggi.md');
  });

  it('clips on a word boundary', () => {
    expect(clipText('una frase abbastanza lunga da tagliare', 24)).toBe('una frase abbastanza…');
    expect(clipText('breve', 24)).toBe('breve');
  });
});
