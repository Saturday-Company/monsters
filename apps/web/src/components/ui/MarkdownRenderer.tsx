import { ArrowSquareOut, FileText } from '@phosphor-icons/react';
import { isUiFence, UI_FENCE_LANGS } from '@monsters/shared';
import {
  createContext,
  lazy,
  memo,
  Suspense,
  useContext,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BlockSkeleton } from '../chat/ui-block/Skeleton.tsx';
import {
  isAppLink,
  isExternalUrl,
  noteKey,
  noteName,
  noteTargetOf,
  prepareMarkdown,
  safeUrl,
} from '../../lib/markdown.ts';
import { notePath, vaultPath } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { noteIndex } from '../../store/derive.ts';
import { openPreview } from '../../store/preview.ts';
import { ChatImage, FileLink, RemoteImage } from '../preview/ChatMedia.tsx';
import { fileIdOf } from '../preview/files.ts';
import { CopyKey } from './CopyKey.tsx';
import { uiStrings } from './ui.strings.ts';

/* Minimal mdast shapes for the soft-break plugin (no extra type packages). */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/**
 * Chat-style line breaks: a single newline inside a paragraph is a visible
 * break (models write post drafts and hashtags on separate lines).
 */
function remarkSoftBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && child.value?.includes('\n')) {
        child.value.split('\n').forEach((part, i) => {
          if (i > 0) next.push({ type: 'break' });
          if (part) next.push({ type: 'text', value: part });
        });
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: MdNode) => walk(tree);
}

const PLUGINS = [remarkGfm, remarkSoftBreaks];

/**
 * A note named in a message: it opens the note. Where the log knows the note
 * (written, moved or trashed while the UI was open, or in the loaded history)
 * the chip goes to its current path, and a note in the trash says so.
 */
export function NoteChip({ target, children }: { target: string; children?: ReactNode }) {
  const name = noteName(target);
  const key = noteKey(target);
  const path = useApp((s) => noteIndex(s.events).pathOf.get(key) ?? null);
  const trashed = useApp((s) => noteIndex(s.events).trashed.has(key));
  // A note opens in Anteprima beside the chat (D-075); ⌘/Ctrl or the middle button still go to Notes.
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (trashed || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openPreview({ kind: 'note', path: path ?? target });
  };
  return (
    <a
      href={trashed ? vaultPath(null, 'cestino') : notePath(path ?? target)}
      onClick={onClick}
      className={cn('md-note', trashed && 'md-note-trashed')}
      title={trashed ? uiStrings().inTrash(name) : uiStrings().openNote(name)}
      data-testid="note-chip"
      data-trashed={trashed ? 'true' : undefined}
    >
      <FileText size={15} weight="fill" aria-hidden className="shrink-0" />
      <span>{children ?? name}</span>
      {trashed && <span className="md-note-tag">{uiStrings().inTrashTag}</span>}
    </a>
  );
}

/*
 * Drawn blocks (D-162): a fence of language `ui` (or `openui`, `openui-lang`) is a block of
 * OpenUI Lang, drawn by `UiBlock`. Its code (and the rest of the drawing: the components, the
 * parser and the OpenUI library, ~50 kB gzip) loads apart from the first bundle, when a reply
 * has a block; the skeleton stands in meanwhile. The flags it needs come by context, so
 * `COMPONENTS` stays one object and a block does not remount when the reply stops streaming.
 */
const LazyUiBlock = lazy(() => import('../chat/ui-block/UiBlock.tsx'));

interface MdFlags {
  streaming: boolean;
  onScreen: boolean;
  drawBlocks: boolean;
}
const MdFlagsContext = createContext<MdFlags>({
  streaming: false,
  onScreen: false,
  drawBlocks: true,
});

/** The language and text of a fenced code block, from react-markdown's tree (`pre > code`). */
function fenceOf(node: unknown): { lang: string; text: string } | null {
  const pre = node as { children?: HastNode[] } | undefined;
  const code = pre?.children?.[0];
  if (code?.type !== 'element' || code.tagName !== 'code') return null;
  const classes = code.properties?.className;
  const list = Array.isArray(classes) ? classes : typeof classes === 'string' ? [classes] : [];
  const lang = list
    .map(String)
    .find((c) => c.startsWith('language-'))
    ?.slice('language-'.length);
  const text = (code.children ?? [])
    .map((c) => (c.type === 'text' ? (c.value ?? '') : ''))
    .join('');
  return { lang: lang ?? '', text };
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** A fence still being typed ("```u", "```openui-"): it will be a block, so no raw code meanwhile. */
const startsUiFence = (lang: string) =>
  lang !== '' && UI_FENCE_LANGS.some((l) => l.startsWith(lang.toLowerCase()));

function Pre({ node, children }: { node: unknown; children?: ReactNode }) {
  const flags = useContext(MdFlagsContext);
  const code = fenceOf(node);
  const fence = flags.drawBlocks ? code : null;
  if (fence && isUiFence(fence.lang)) {
    return (
      <Suspense fallback={<BlockSkeleton />}>
        <LazyUiBlock
          source={fence.text.replace(/\n$/, '')}
          streaming={flags.streaming}
          onScreen={flags.onScreen}
        />
      </Suspense>
    );
  }
  if (fence && flags.streaming && !fence.text.trim() && startsUiFence(fence.lang)) {
    return <BlockSkeleton />;
  }
  // Code: its language on top and a key to copy it (the whole block, without the last newline).
  return (
    <div className="md-code" data-testid="code-block">
      <div className="md-code-head">
        <span className="md-code-lang" data-testid="code-lang">
          {code?.lang || uiStrings().codeBlock}
        </span>
        <CopyKey
          text={() => (code?.text ?? '').replace(/\n$/, '')}
          label={uiStrings().copyCode}
          testId="copy-code"
          className="md-code-copy"
        />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const COMPONENTS: Components = {
  pre: ({ node, children }) => <Pre node={node}>{children}</Pre>,
  a({ href, children }) {
    const url = href ?? '';
    if (isExternalUrl(url))
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="md-link">
          {children}
          <ArrowSquareOut size={13} weight="bold" aria-hidden className="md-ext" />
          <span className="sr-only">{uiStrings().newTab}</span>
        </a>
      );
    if (isAppLink(url))
      return (
        <a href={url} className="md-link">
          {children}
        </a>
      );
    const file = url ? fileIdOf(url) : null;
    if (file) return <FileLink fileId={file}>{children}</FileLink>;
    const note = url ? noteTargetOf(url) : null;
    if (note) return <NoteChip target={note}>{children}</NoteChip>;
    return <span>{children}</span>;
  },
  // The core's images show, and open in Anteprima; remote ones load only when asked (privacy).
  img({ src, alt }) {
    const url = typeof src === 'string' ? src : '';
    const file = fileIdOf(url);
    if (file) return <ChatImage fileId={file} alt={alt?.trim() ?? ''} />;
    if (/^https:\/\//i.test(url)) return <RemoteImage url={url} alt={alt?.trim() ?? ''} />;
    const label = uiStrings().image(alt?.trim() ?? '');
    return isExternalUrl(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="md-link">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
  table({ children }) {
    return (
      <div className="md-table scroll-soft">
        <table>{children}</table>
      </div>
    );
  },
  input({ checked, type }) {
    if (type !== 'checkbox') return null;
    return <input type="checkbox" checked={!!checked} disabled readOnly className="md-check" />;
  },
};

/** How many finished texts keep their parsed tree (a long chat mounts its rows again, stream J). */
const TREES_MAX = 300;
const trees = new Map<string, ReactNode>();

/**
 * The elements of a finished text, parsed once: a row of a long chat that scrolls away and back
 * mounts again (the transcript renders only the rows near the screen), and parsing is most of
 * the cost of a bubble. `ReactMarkdown` is a plain function of its options (no hooks), and its
 * options here are constants, so its elements depend on the text alone; the flags of the
 * renderer reach the components by context, at render.
 */
function markdownTree(text: string): ReactNode {
  const hit = trees.get(text);
  if (hit !== undefined) {
    trees.delete(text);
    trees.set(text, hit);
    return hit;
  }
  const tree = ReactMarkdown({
    remarkPlugins: PLUGINS,
    urlTransform: safeUrl,
    components: COMPONENTS,
    children: text,
  });
  trees.set(text, tree);
  if (trees.size > TREES_MAX) trees.delete(trees.keys().next().value!);
  return tree;
}

export interface MarkdownProps {
  text: string;
  className?: string;
  /** Colours inside a coloured bubble: code background and rules derive from it. */
  codeBg?: string;
  style?: CSSProperties;
  /** Shows a blinking caret after the last block while the text streams in. */
  streaming?: boolean;
  /** On a black screen (the agent terminal): drawn blocks use the colours made for it. */
  onScreen?: boolean;
  /** `false` shows a block's fence as code (the text form of a block that could not be drawn). */
  drawBlocks?: boolean;
}

/**
 * Markdown written by the models, rendered safely: no raw HTML (it shows as
 * text), links only to http(s) and mailto (in a new tab), wikilinks and vault
 * paths as note chips (opened in Anteprima), the core's files as images or
 * chips, remote images only after "Show image".
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
  className,
  codeBg,
  style,
  streaming = false,
  onScreen = false,
  drawBlocks = true,
}: MarkdownProps) {
  const flags = useMemo(
    () => ({ streaming, onScreen, drawBlocks }),
    [streaming, onScreen, drawBlocks],
  );
  return (
    <MdFlagsContext.Provider value={flags}>
      <div
        className={cn('md', streaming && 'md-streaming', className)}
        style={codeBg ? { ...style, ['--md-code-bg' as string]: codeBg } : style}
      >
        {streaming ? (
          <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={safeUrl} components={COMPONENTS}>
            {prepareMarkdown(text)}
          </ReactMarkdown>
        ) : (
          markdownTree(prepareMarkdown(text))
        )}
      </div>
    </MdFlagsContext.Provider>
  );
});

export default MarkdownRenderer;
