import { uiStreamParser, type UiNode } from '@monsters/shared';
import { useMemo } from 'react';
import { useResolvedTheme } from '../../../store/hooks.ts';
import { MarkdownRenderer } from '../../ui/MarkdownRenderer.tsx';
import { BarChart, Donut, LineChart } from './charts.tsx';
import { UiDrawingContext } from './context.ts';
import { resolveUiBlock, type BlockView } from './model.ts';
import { Callout, Card, Checklist, Compare, Stats, Steps, Table, Timeline } from './parts.tsx';
import { BlockSkeleton } from './Skeleton.tsx';
import { uiBlockViewStrings } from './ui-block.strings.ts';
import './ui-block.css';

/*
 * A drawn block (D-162): the OpenUI Lang a monster wrote in a ```ui fence, drawn with our own
 * components (no `@openuidev/react-lang`: the library is read-only and ours). It is this file
 * and its neighbours that stay out of the first bundle: the Markdown renderer loads them when a
 * reply has a block. A block that cannot be drawn is shown as text with a line that says so;
 * while it streams, the partial tree or a skeleton, never the source.
 */

/** One part of the block; a node the app does not know draws nothing. */
export function UiPart({ node }: { node: UiNode }) {
  switch (node.typeName) {
    case 'Stats':
      return <Stats node={node} />;
    case 'Table':
      return <Table node={node} />;
    case 'BarChart':
      return <BarChart node={node} />;
    case 'LineChart':
      return <LineChart node={node} />;
    case 'Donut':
      return <Donut node={node} />;
    case 'Compare':
      return <Compare node={node} />;
    case 'Steps':
      return <Steps node={node} />;
    case 'Checklist':
      return <Checklist node={node} />;
    case 'Timeline':
      return <Timeline node={node} />;
    case 'Card':
      return <Card node={node} />;
    case 'Callout':
      return <Callout node={node} />;
    default:
      return null;
  }
}

/** The drawn parts of a block, top to bottom. */
export function UiTree({ parts, streaming = false }: { parts: UiNode[]; streaming?: boolean }) {
  return (
    <div
      className="ui-block"
      data-testid="ui-block"
      data-streaming={streaming ? 'true' : undefined}
    >
      {parts.map((part, i) => (
        <UiPart key={i} node={part} />
      ))}
    </div>
  );
}

export function UiFallback({ text }: { text: string }) {
  return (
    <div className="ui-block ui-fallback" data-testid="ui-block-fallback">
      {text && <MarkdownRenderer text={text} drawBlocks={false} />}
      <p className="ui-more" role="note">
        {uiBlockViewStrings().cantDraw}
      </p>
    </div>
  );
}

export interface UiBlockProps {
  /** The OpenUI Lang between the fences. */
  source: string;
  /** The reply is still being written: show what is there, not the final state. */
  streaming?: boolean;
  /** The block sits on a black screen (the agent terminal). */
  onScreen?: boolean;
}

export function UiBlock({ source, streaming = false, onScreen = false }: UiBlockProps) {
  const theme = useResolvedTheme();
  const drawing = useMemo(() => ({ theme, onScreen }), [theme, onScreen]);
  // The streaming parser keeps its own buffer: one per block while it streams.
  const stream = useMemo(() => (streaming ? uiStreamParser() : undefined), [streaming]);
  const view: BlockView = useMemo(
    () => resolveUiBlock(source, streaming, stream),
    [source, streaming, stream],
  );
  return (
    <UiDrawingContext.Provider value={drawing}>
      <div className="ui-root" data-screen={onScreen ? 'true' : undefined}>
        {view.kind === 'tree' ? (
          <UiTree parts={view.parts} streaming={streaming} />
        ) : view.kind === 'skeleton' ? (
          <BlockSkeleton />
        ) : (
          <UiFallback text={view.text} />
        )}
      </div>
    </UiDrawingContext.Provider>
  );
}

export default UiBlock;
