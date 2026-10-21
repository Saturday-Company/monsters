import { pick } from '@monsters/shared';

/*
 * What a model reads from an MCP server's result and from the hints of the other apps (D-153).
 * The Italian family is the one the models have always read; the English one is its twin. They
 * follow the app's language at the moment they are written. The labels the hints quote (the
 * «Collega» button) are quoted the way each language quotes.
 */

const it = {
  truncated: (n: number) => `\n[… testo troncato: ${n} caratteri in più]`,
  image: (mime: string, size: string) => `[immagine ${mime}, ${size}: non visibile come testo]`,
  audio: (mime: string, size: string) => `[audio ${mime}, ${size}]`,
  resourceLink: (name: string, title: string | undefined, uri: string, mime: string | undefined) =>
    `[risorsa: ${name}${title ? ` (${title})` : ''} ${uri}${mime ? `, ${mime}` : ''}]`,
  resourceText: (uri: string, text: string) => `[risorsa ${uri}]\n${text}`,
  resourceBlob: (uri: string, mime: string | undefined, size: string) =>
    `[risorsa ${uri}${mime ? `, ${mime}` : ''}, ${size}]`,
  resource: (uri: string) => `[risorsa ${uri}]`,
  otherContent: (type: string) => `[contenuto di tipo ${type}]`,
  unreadable: '[dati strutturati non leggibili]',
  /** A label of the app quoted in a hint. */
  button: (label: string) => `«${label}»`,
  /** A project's name quoted in a hint. */
  quoted: (name: string) => `«${name}»`,
};

const en: typeof it = {
  truncated: (n) => `\n[… text truncated: ${n} more characters]`,
  image: (mime, size) => `[image ${mime}, ${size}: not visible as text]`,
  audio: (mime, size) => `[audio ${mime}, ${size}]`,
  resourceLink: (name, title, uri, mime) =>
    `[resource: ${name}${title ? ` (${title})` : ''} ${uri}${mime ? `, ${mime}` : ''}]`,
  resourceText: (uri, text) => `[resource ${uri}]\n${text}`,
  resourceBlob: (uri, mime, size) => `[resource ${uri}${mime ? `, ${mime}` : ''}, ${size}]`,
  resource: (uri) => `[resource ${uri}]`,
  otherContent: (type) => `[content of type ${type}]`,
  unreadable: '[structured data not readable]',
  button: (label) => `“${label}”`,
  quoted: (name) => `“${name}”`,
};

export const mcpPrompts = () => pick({ en, it });
