import { lazy, memo, Suspense } from 'react';
import { cn } from '../../lib/utils.ts';
import type { MarkdownProps } from './MarkdownRenderer.tsx';

export type { MarkdownProps } from './MarkdownRenderer.tsx';

/*
 * The Markdown renderer (react-markdown and remark-gfm, ~130 kB) is loaded
 * apart from the first bundle (M2.8). Until it arrives the text shows as it is.
 */
const loadRenderer = () => import('./MarkdownRenderer.tsx');
const LazyRenderer = lazy(loadRenderer);

/** Starts loading the renderer before the first message needs it. */
export function preloadMarkdown(): void {
  void loadRenderer();
}

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={cn('md whitespace-pre-wrap', props.className)} style={props.style}>
          {props.text}
        </div>
      }
    >
      <LazyRenderer {...props} />
    </Suspense>
  );
});
