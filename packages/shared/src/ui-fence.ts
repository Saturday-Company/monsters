/*
 * The fence of a drawn block (D-162), apart from the library so that a surface that only has to
 * recognise a fence (the web app's Markdown renderer) does not load OpenUI to do it.
 */

/** The fence of a block, and the names a model may write for it. */
export const UI_FENCE = 'ui';
export const UI_FENCE_LANGS: readonly string[] = ['ui', 'openui', 'openui-lang'];

/** Is this the language of a fenced code block of ours? */
export const isUiFence = (lang: string | undefined | null): boolean =>
  !!lang && UI_FENCE_LANGS.includes(lang.trim().toLowerCase());
