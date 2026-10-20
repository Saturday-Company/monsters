import { StringDecoder } from 'node:string_decoder';

/*
 * Bounded capture of a process output: keeps the beginning and the end (errors
 * are usually at the end, the shape of the data at the beginning), counts what
 * is dropped in between. Memory stays bounded whatever the process prints.
 */

/** ANSI escape sequences (colours, cursor moves, OSC titles). */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Removes ANSI codes and keeps only the last state of `\r`-rewritten lines (progress bars). */
export function cleanTerminalText(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r');
      return i < 0 ? line : line.slice(i + 1);
    })
    .join('\n');
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export class OutputCapture {
  readonly #headMax: number;
  readonly #tailMax: number;
  readonly #decoder = new StringDecoder('utf8');
  #head = '';
  #headFull = false;
  #tail = '';
  #total = 0;

  /** Keeps up to `maxChars`: a quarter from the beginning, the rest from the end. */
  constructor(maxChars: number) {
    this.#headMax = Math.floor(maxChars / 4);
    this.#tailMax = maxChars - this.#headMax;
  }

  push(chunk: Buffer | string): void {
    this.#add(typeof chunk === 'string' ? chunk : this.#decoder.write(chunk));
  }

  #add(text: string): void {
    if (!text) return;
    this.#total += text.length;
    let rest = text;
    if (!this.#headFull) {
      let take = this.#headMax - this.#head.length;
      // Never split a surrogate pair (emoji…): the whole character goes to the tail.
      if (take < rest.length) {
        if (take > 0 && isHighSurrogate(rest.charCodeAt(take - 1))) take--;
        else if (take === 0 && isHighSurrogate(this.#head.charCodeAt(this.#head.length - 1))) {
          rest = this.#head.slice(-1) + rest;
          this.#head = this.#head.slice(0, -1);
        }
      }
      this.#head += rest.slice(0, take);
      rest = rest.slice(take);
      if (rest) this.#headFull = true;
    }
    if (!rest) return;
    let tail = this.#tail + rest;
    if (tail.length > this.#tailMax) {
      let start = tail.length - this.#tailMax;
      if (isLowSurrogate(tail.charCodeAt(start))) start++;
      tail = tail.slice(start);
    }
    this.#tail = tail;
  }

  /** Characters dropped between head and tail. */
  get omitted(): number {
    return this.#total - this.#head.length - this.#tail.length;
  }

  get total(): number {
    return this.#total;
  }

  /** The captured text, cleaned, with a marker where characters were dropped. */
  text(): string {
    this.#add(this.#decoder.end());
    const omitted = this.omitted;
    const raw =
      omitted > 0
        ? `${this.#head}\n…[${omitted} characters omitted]…\n${this.#tail}`
        : this.#head + this.#tail;
    return cleanTerminalText(raw);
  }
}
