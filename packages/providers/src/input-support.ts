import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

/*
 * What a model of a fallback chain can read besides text. A prompt is built for
 * the first link; the links after it get it through `withReadableInput`, so a
 * text-only fallback is not sent an image it would refuse with a 400.
 */

/** The kinds of file a model reads as such (everything else reaches it as text). */
export interface InputSupport {
  images: boolean;
  pdf: boolean;
}

export type UnreadableKind = 'image' | 'pdf';

function mediaKind(mediaType: string): UnreadableKind | undefined {
  const type = mediaType.toLowerCase();
  if (type === 'image' || type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  return undefined;
}

/** Whether the prompt carries a file the models do not all read (an image, a PDF). */
export function hasMediaParts(prompt: LanguageModelV4Prompt): boolean {
  return prompt.some((m) => {
    if (m.role === 'user') {
      return m.content.some((p) => p.type === 'file' && mediaKind(p.mediaType) !== undefined);
    }
    if (m.role === 'tool') {
      return m.content.some(
        (p) =>
          p.type === 'tool-result' &&
          p.output.type === 'content' &&
          p.output.value.some((v) => v.type === 'file' && mediaKind(v.mediaType) !== undefined),
      );
    }
    return false;
  });
}

/**
 * The prompt as a model with `support` can read it: the images and PDFs it
 * cannot take are replaced by the text `note` gives for them (the model says it
 * could not see the file instead of guessing). The same prompt object when there
 * is nothing to take out.
 */
export function withReadableInput(
  prompt: LanguageModelV4Prompt,
  support: InputSupport,
  note: (kind: UnreadableKind, filename: string | undefined) => string,
): LanguageModelV4Prompt {
  const unreadable = (mediaType: string): UnreadableKind | undefined => {
    const kind = mediaKind(mediaType);
    if (kind === 'image' && !support.images) return kind;
    if (kind === 'pdf' && !support.pdf) return kind;
    return undefined;
  };
  let changed = false;
  const out = prompt.map((m): LanguageModelV4Prompt[number] => {
    if (m.role === 'user') {
      if (!m.content.some((p) => p.type === 'file' && unreadable(p.mediaType))) return m;
      changed = true;
      return {
        ...m,
        content: m.content.map((p) => {
          const kind = p.type === 'file' ? unreadable(p.mediaType) : undefined;
          return p.type === 'file' && kind
            ? { type: 'text' as const, text: note(kind, p.filename) }
            : p;
        }),
      };
    }
    if (m.role === 'tool') {
      return {
        ...m,
        content: m.content.map((p) => {
          if (p.type !== 'tool-result' || p.output.type !== 'content') return p;
          const { value } = p.output;
          if (!value.some((v) => v.type === 'file' && unreadable(v.mediaType))) return p;
          changed = true;
          return {
            ...p,
            output: {
              ...p.output,
              value: value.map((v) => {
                const kind = v.type === 'file' ? unreadable(v.mediaType) : undefined;
                return v.type === 'file' && kind
                  ? { type: 'text' as const, text: note(kind, undefined) }
                  : v;
              }),
            },
          };
        }),
      };
    }
    return m;
  });
  return changed ? out : prompt;
}
