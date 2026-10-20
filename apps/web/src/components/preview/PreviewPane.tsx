import type { FileMeta, PreviewItem, VaultNote } from '@monsters/shared';
import {
  AppWindow,
  Copy,
  DownloadSimple,
  File,
  FilePdf,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  NotePencil,
  Table,
  X,
  type Icon,
} from '@phosphor-icons/react';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { desktop } from '../../lib/desktop.ts';
import { openPage, vaultPath } from '../../lib/router.ts';
import { linkIndex, withoutTitle } from '../../lib/vault-markdown.ts';
import { notify } from '../../store/app.ts';
import { useNameOf } from '../../store/hooks.ts';
import { openPreview, previewKey, usePreview } from '../../store/preview.ts';
import { vaultApi, vaultError } from '../vault/api.ts';
import { VaultMarkdown } from '../vault/VaultMarkdown.tsx';
import {
  downloadHref,
  downloadOnClick,
  fileUrlFor,
  useFileUrl,
  formatBytes,
  itemName,
  kindWord,
  noteTitle,
  rendererOf,
  useFileMeta,
} from './files.ts';
import { HtmlView, ImageView, OtherView, TextView } from './renderers.tsx';

/*
 * Anteprima (docs/design.md, "Pannello a destra"; D-075): the strip of what is
 * open (name and ✕), then the item shown: a header with its name, kind, size
 * and who made it, its keys (Apri con il sistema, Mostra nella cartella, Copia,
 * Scarica; a note: Apri nelle Note), and the item itself by kind.
 */

const PdfView = lazy(() => import('./PdfView.tsx'));

const ICONS: Record<FileMeta['kind'], Icon> = {
  image: ImageIcon,
  pdf: FilePdf,
  html: AppWindow,
  sheet: Table,
  text: FileText,
  document: FileText,
  other: File,
};

function StripChip({ item, index, active }: { item: PreviewItem; index: number; active: boolean }) {
  const meta = useFileMeta(item.kind === 'file' ? item.fileId : null);
  const ready = meta.state === 'ready' ? meta.meta : null;
  const name = item.kind === 'note' ? noteTitle(item.path) : (ready?.name ?? itemName(item));
  const Glyph = item.kind === 'note' ? FileText : ICONS[ready?.kind ?? 'other'];
  const self = useRef<HTMLLIElement>(null);
  // The item shown is always in sight in the strip.
  useEffect(() => {
    if (active) self.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <li
      ref={self}
      className="pv-chip shrink-0"
      data-active={active ? '' : undefined}
      data-testid="preview-chip"
    >
      <button
        type="button"
        onClick={() => usePreview.getState().select(index)}
        aria-current={active ? 'true' : undefined}
        title={name}
        className="min-w-0 gap-1.5 pr-1 pl-2.5"
      >
        <Glyph size={15} weight="bold" aria-hidden className="shrink-0" />
        <span className="truncate text-micro">{name}</span>
      </button>
      <button
        type="button"
        onClick={() => usePreview.getState().closeItem(index)}
        aria-label={`Chiudi ${name}`}
        title="Chiudi"
        className="w-7 shrink-0 justify-center"
        data-testid="preview-chip-close"
      >
        <X size={13} weight="bold" aria-hidden />
      </button>
    </li>
  );
}

function Key({
  icon: Glyph,
  label,
  onClick,
  href,
  download,
  testId,
}: {
  icon: Icon;
  label: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  href?: string;
  download?: string;
  testId?: string;
}) {
  const inside = (
    <>
      <Glyph size={16} weight="bold" aria-hidden />
      <span className="label">{label}</span>
    </>
  );
  const className = 'screen-key h-8 gap-1.5 px-2.5';
  return href ? (
    <a href={href} download={download} onClick={onClick} className={className} data-testid={testId}>
      {inside}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className} data-testid={testId}>
      {inside}
    </button>
  );
}

function Header({ title, line, keys }: { title: string; line: string; keys: ReactNode }) {
  return (
    <div className="pv-head grid shrink-0 gap-2 px-4 pt-3 pb-3">
      <div className="min-w-0">
        <h2
          className="truncate text-body leading-5 font-semibold text-screen-ink"
          data-testid="preview-title"
        >
          {title}
        </h2>
        <p className="label mt-1 truncate text-screen-muted" data-testid="preview-line">
          {line}
        </p>
      </div>
      <div className="-ml-1 flex flex-wrap gap-1">{keys}</div>
    </div>
  );
}

async function copyFile(meta: FileMeta): Promise<void> {
  // A page as the monster wrote it, not as the pane serves it (with the lockdown first).
  const url = await fileUrlFor(meta.id, rendererOf(meta) === 'html' ? 'download' : 'content', true);
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (rendererOf(meta) === 'image') {
    let blob = await res.blob();
    if (blob.type !== 'image/png') blob = await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  }
  await navigator.clipboard.writeText(await res.text());
}

/** The clipboard takes PNG only: other images are drawn once on a canvas. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
  );
}

const copied = (what: string) => notify(`${what} negli appunti`, 'success');
const notCopied = () => notify('Non sono riuscito a copiarlo', 'error');

function FileItem({ fileId }: { fileId: string }) {
  const state = useFileMeta(fileId);
  const nameOf = useNameOf();
  const file = useFileUrl(state.state === 'ready' ? fileId : null);
  if (state.state === 'loading') return <p className="sr-only">Carico…</p>;
  if (state.state !== 'ready')
    return (
      <p className="px-5 py-10 text-center text-screen-muted" data-testid="preview-missing">
        {state.state === 'missing'
          ? 'Questo file non c’è più.'
          : `Non riesco a leggere questo file: ${state.text}`}
      </p>
    );
  const meta = state.meta;
  const kind = rendererOf(meta);
  const who =
    meta.source === 'user' ? 'da te' : meta.agent ? `da ${nameOf(meta.agent)}` : 'da Monsters';
  const bridge = desktop();
  // With a ticket of the session in a browser (S-B13): the views wait for it.
  const url = file.src;
  const copyable = kind === 'image' || kind === 'text' || kind === 'html';
  const keys = (
    <>
      {/* A page of a monster opened by the system would leave its sandbox: here only. */}
      {bridge?.openFile && kind !== 'html' && (
        <Key
          icon={AppWindow}
          label="Apri nel sistema"
          testId="preview-open-system"
          onClick={() =>
            void bridge.openFile!(meta.path).then(
              (ok) => ok || notify('Questo file si apre solo dalla sua cartella', 'info'),
            )
          }
        />
      )}
      {bridge?.showFileInFolder && (
        <Key
          icon={FolderOpen}
          label="Mostra nella cartella"
          testId="preview-show-folder"
          onClick={() => void bridge.showFileInFolder!(meta.path)}
        />
      )}
      {copyable && (
        <Key
          icon={Copy}
          label="Copia"
          testId="preview-copy"
          onClick={() =>
            void copyFile(meta).then(
              () => copied(kind === 'image' ? 'Immagine' : 'Testo'),
              notCopied,
            )
          }
        />
      )}
      <Key
        icon={DownloadSimple}
        label="Scarica"
        href={downloadHref(meta.id, 'content')}
        download={meta.name}
        onClick={downloadOnClick(meta.id, meta.name)}
        testId="preview-download"
      />
    </>
  );
  return (
    <>
      <Header
        title={meta.name}
        line={`${kindWord(meta.kind)} · ${formatBytes(meta.size)} · ${who}`}
        keys={keys}
      />
      <div className="flex min-h-0 flex-1 flex-col" data-testid="preview-body" data-renderer={kind}>
        {url === undefined && kind !== 'other' && <p className="sr-only">Carico…</p>}
        {url !== undefined && kind === 'image' && <ImageView meta={meta} url={url} />}
        {url !== undefined && kind === 'pdf' && (
          <Suspense
            fallback={<p className="px-5 py-10 text-center text-screen-muted">Carico il PDF…</p>}
          >
            <PdfView meta={meta} url={url} />
          </Suspense>
        )}
        {url !== undefined && kind === 'text' && <TextView meta={meta} url={url} />}
        {url !== undefined && kind === 'html' && <HtmlView meta={meta} url={url} who={who} />}
        {kind === 'other' && <OtherView meta={meta} />}
      </div>
    </>
  );
}

let overview: Promise<(target: string) => string | null> | null = null;
/** The links of the notes, resolved like Notes does (read once per session). */
function noteLinks(): Promise<(target: string) => string | null> {
  overview ??= vaultApi
    .overview()
    .then((o) => linkIndex(o.notes.map((n) => n.path)))
    .catch((err: unknown) => {
      overview = null;
      throw err;
    });
  return overview;
}

function NoteItem({ path }: { path: string }) {
  const nameOf = useNameOf();
  const [state, setState] = useState<
    | { path: string; note: VaultNote; resolve: (t: string) => string | null }
    | { path: string; error: string }
    | null
  >(null);
  useEffect(() => {
    let alive = true;
    // A wikilink names a note by its title: resolved like Notes does, then read.
    noteLinks()
      .catch((): ((t: string) => string | null) => () => null)
      .then(async (resolve) => ({ resolve, note: await vaultApi.note(resolve(path) ?? path) }))
      .then(({ note, resolve }) => alive && setState({ path, note, resolve }))
      .catch((err: unknown) => alive && setState({ path, error: vaultError(err) }));
    return () => {
      alive = false;
    };
  }, [path]);
  const shown = state?.path === path ? state : null;
  const resolve = useMemo(() => (shown && 'note' in shown ? shown.resolve : () => null), [shown]);
  if (!shown) return <p className="sr-only">Carico la nota…</p>;
  if ('error' in shown)
    return (
      <p className="px-5 py-10 text-center text-screen-muted" data-testid="preview-missing">
        {shown.error}
      </p>
    );
  const note = shown.note;
  // A link inside the note opens that note here too; the ⌘/Ctrl click still goes to Notes.
  const onLinkClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[data-testid="vault-link"], a.vault-embed');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const href = a.getAttribute('href') ?? '';
    const target = new URLSearchParams(href.split('?')[1] ?? '').get('nota');
    if (!target) return;
    e.preventDefault();
    openPreview({ kind: 'note', path: target });
  };
  const who =
    note.author === 'user'
      ? 'scritta da te'
      : note.author
        ? `scritta da ${nameOf(note.author)}`
        : null;
  const folder = note.path.includes('/') ? note.path.split('/').slice(0, -1).join(' › ') : 'Note';
  return (
    <>
      <Header
        title={note.title}
        line={['Nota', folder, who].filter(Boolean).join(' · ')}
        keys={
          <>
            <Key
              icon={NotePencil}
              label="Apri nelle Note"
              testId="preview-open-notes"
              onClick={() => openPage(vaultPath(note.path))}
            />
            {note.content !== null && (
              <Key
                icon={Copy}
                label="Copia"
                testId="preview-copy"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(note.content ?? '')
                    .then(() => copied('Nota'), notCopied)
                }
              />
            )}
          </>
        }
      />
      <div
        className="scroll-screen min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        data-testid="preview-body"
        data-renderer="note"
        onClickCapture={onLinkClick}
      >
        <article className="pv-note px-5 py-5">
          {note.content === null ? (
            <p className="text-body text-ink-muted">Questo file non è una nota di testo.</p>
          ) : note.content.trim() === '' ? (
            <p className="text-body text-ink-muted">La nota è vuota.</p>
          ) : (
            <VaultMarkdown
              text={withoutTitle(note.content, note.title)}
              resolve={resolve}
              onTag={(tag) => openPage(`#/note?tag=${encodeURIComponent(tag)}`)}
            />
          )}
          {note.truncated && (
            <p className="mt-4 text-footnote text-ink-muted">
              La nota è molto lunga: qui ne vedi solo l’inizio.
            </p>
          )}
        </article>
      </div>
    </>
  );
}

export default function PreviewPane() {
  const items = usePreview((s) => s.items);
  const active = usePreview((s) => s.active);
  const item = items[active];
  if (!item) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
        data-testid="preview-empty"
      >
        <p className="text-body text-screen-ink">Niente in anteprima</p>
        <p className="max-w-[320px] text-caption leading-5 text-screen-muted">
          Tocca un allegato, un’immagine o una nota in chat: si apre qui, accanto alla
          conversazione.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="preview-pane">
      <ul
        aria-label="Aperti in anteprima"
        className="pv-strip scroll-screen flex shrink-0 gap-1 overflow-x-auto px-3 py-2"
        data-testid="preview-strip"
      >
        {items.map((it, i) => (
          <StripChip key={previewKey(it)} item={it} index={i} active={i === active} />
        ))}
      </ul>
      <div key={previewKey(item)} className="flex min-h-0 flex-1 flex-col">
        {item.kind === 'file' ? <FileItem fileId={item.fileId} /> : <NoteItem path={item.path} />}
      </div>
    </div>
  );
}
