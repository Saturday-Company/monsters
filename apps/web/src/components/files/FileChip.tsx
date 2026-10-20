import type { FileKind, FileMeta } from '@monsters/shared';
import {
  Browser,
  FileCsv,
  FileDoc,
  FilePdf,
  FilePpt,
  FileText,
  FileXls,
  ImageSquare,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { createElement, useState } from 'react';
import { fileTag, formatSize, kindLabel } from '../../lib/files.ts';
import { cn } from '../../lib/utils.ts';
import { useFileMeta } from '../../store/files.ts';
import { openPreview } from '../../store/preview.ts';
import { useFileUrl } from '../preview/files.ts';

/*
 * A file as the instrument shows it (docs/design.md, "Allegati e File"): a
 * small tile with the picture, or a small black screen with the light of its
 * type, the name and in `.label` the type and the size. In the composer it
 * carries the dashes of the upload; everywhere else a press opens the preview.
 */

function iconOf(name: string, kind: FileKind): Icon {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (kind === 'image') return ImageSquare;
  if (kind === 'pdf') return FilePdf;
  if (kind === 'html') return Browser;
  if (ext === 'csv') return FileCsv;
  if (ext === 'xlsx') return FileXls;
  if (ext === 'pptx') return FilePpt;
  if (ext === 'docx') return FileDoc;
  return FileText;
}

/** Extensions whose icon already spells them ("PDF", "DOC"…): no tag under it. */
const TAGGED = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'csv']);

/** The small screen of a file that has no picture: its icon and its tag in light. */
export function FileGlyph({
  name,
  kind,
  size = 40,
  className,
}: {
  name: string;
  kind: FileKind;
  size?: number;
  className?: string;
}) {
  const big = size >= 72;
  const glyph = createElement(iconOf(name, kind), {
    size: big ? 34 : Math.round(size * 0.48),
    weight: 'regular',
    className: 'text-screen-ink',
  });
  return (
    <span
      aria-hidden
      className={cn('screen flex shrink-0 flex-col items-center justify-center gap-0.5', className)}
      style={{ width: size, height: size, borderRadius: big ? 10 : 8 }}
    >
      {glyph}
      {big &&
        !TAGGED.has(
          kind === 'pdf' ? 'pdf' : name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
        ) && (
          <span className="font-mono text-micro leading-none tracking-[0.06em] text-screen-muted">
            {fileTag(name, kind)}
          </span>
        )}
    </span>
  );
}

/** The picture of an image file (its thumbnail when there is one), or its glyph. */
export function FileThumb({
  meta,
  size = 40,
  fill = false,
  className,
}: {
  meta: Pick<FileMeta, 'id' | 'name' | 'kind' | 'hasThumb'>;
  size?: number;
  /** Fill the parent instead of a square of `size`. */
  fill?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const picture = useFileUrl(
    meta.kind === 'image' && !broken ? meta.id : null,
    meta.hasThumb ? 'thumb' : 'content',
  );
  if (meta.kind !== 'image' || broken) {
    return fill ? (
      <span className={cn('flex h-full w-full items-center justify-center', className)}>
        <FileGlyph name={meta.name} kind={meta.kind} size={88} />
      </span>
    ) : (
      <FileGlyph name={meta.name} kind={meta.kind} size={size} className={className} />
    );
  }
  return (
    <img
      src={picture.src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => picture.retry(() => setBroken(true))}
      className={cn(
        'shrink-0 bg-well object-cover',
        fill ? 'h-full w-full' : 'rounded-[8px]',
        className,
      )}
      style={fill ? undefined : { width: size, height: size }}
    />
  );
}

/** Dashes of a progress (the language of the meters: never a spinner). */
export function ProgressDashes({ value, label }: { value: number; label: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * 10);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="inline-flex items-end gap-[2px]"
      data-testid="upload-progress"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <i
          key={i}
          aria-hidden
          className={cn(
            'block h-[10px] w-[3px] rounded-[1px] bg-signal-ink',
            i < lit ? 'opacity-100' : 'opacity-20',
          )}
        />
      ))}
    </span>
  );
}

export interface ChipFile {
  id?: string | undefined;
  name: string;
  kind: FileKind;
  size: number;
  hasThumb?: boolean;
  /** A local picture while the file uploads (an object URL). */
  localUrl?: string | undefined;
}

/**
 * The chip of a file: picture or glyph, name, type and size. `progress` while
 * it uploads, `error` when it could not go, `onRemove` in the composer.
 */
export function FileChip({
  file,
  progress,
  error,
  onRemove,
  open = true,
  tone = 'raised',
  className,
}: {
  file: ChipFile;
  progress?: number | undefined;
  error?: string | undefined;
  onRemove?: () => void;
  /** A press opens the preview (once the file is in the core). */
  open?: boolean;
  /** `ink`: on the user's dark bubble side. */
  tone?: 'raised' | 'ink';
  className?: string;
}) {
  const id = file.id;
  const canOpen = open && id !== undefined && progress === undefined && !error;
  const meta = `${kindLabel(file.kind)} · ${formatSize(file.size)}`;
  const picture = file.localUrl ? (
    <img
      src={file.localUrl}
      alt=""
      className="size-10 shrink-0 rounded-[8px] bg-well object-cover"
    />
  ) : id && file.kind === 'image' ? (
    <FileThumb meta={{ id, name: file.name, kind: file.kind, hasThumb: file.hasThumb ?? false }} />
  ) : (
    <FileGlyph name={file.name} kind={file.kind} />
  );
  const body = (
    <>
      {picture}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="truncate text-footnote font-medium text-ink">{file.name}</span>
        {error ? (
          <span className="text-caption leading-tight text-stop-ink" data-testid="upload-error">
            {error}
          </span>
        ) : progress !== undefined ? (
          <span className="flex items-center gap-2">
            <ProgressDashes value={progress} label={`Carico ${file.name}`} />
            <span className="label text-ink-muted">{Math.round(progress * 100)}%</span>
          </span>
        ) : (
          // In the composer the type and size light on when the upload is done.
          <span className={cn('label truncate text-ink-muted', onRemove && 'light-on')}>
            {meta}
          </span>
        )}
      </span>
    </>
  );
  return (
    <div
      data-testid="file-chip"
      data-state={error ? 'error' : progress !== undefined ? 'uploading' : 'ready'}
      className={cn(
        'card relative flex h-[56px] max-w-[280px] min-w-[180px] items-center rounded-[12px]',
        tone === 'ink' && 'on-panel bg-panel',
        className,
      )}
    >
      {canOpen ? (
        <button
          type="button"
          onClick={() => openPreview({ kind: 'file', fileId: id })}
          title={`Apri ${file.name} nell’anteprima`}
          aria-label={`${file.name}, ${meta}: apri nell’anteprima`}
          className="row-key flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-[12px] py-2 pr-3 pl-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
        >
          {body}
        </button>
      ) : (
        <span className="flex h-full min-w-0 flex-1 items-center gap-2.5 py-2 pr-2 pl-2">
          {body}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Togli ${file.name}`}
          title="Togli"
          className="key-ghost mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink"
        >
          <X size={14} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A big tile for an image in a bubble: the picture itself, a press opens the preview. */
export function ImageTile({ meta }: { meta: FileMeta }) {
  const ratio = meta.width && meta.height ? meta.width / meta.height : 4 / 3;
  const width = Math.round(Math.min(260, Math.max(140, 200 * Math.min(ratio, 1.6))));
  return (
    <button
      type="button"
      onClick={() => openPreview({ kind: 'file', fileId: meta.id })}
      aria-label={`${meta.name}, immagine: apri nell’anteprima`}
      title={meta.name}
      data-testid="image-tile"
      className="card tile-key block overflow-hidden rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
      style={{ width, aspectRatio: String(Math.min(Math.max(ratio, 0.6), 1.9)) }}
    >
      <FileThumb meta={meta} fill />
    </button>
  );
}

/** A file named by id: its chip once the metadata is here, a line when it is gone. */
export function FileById({ id, image = false }: { id: string; image?: boolean }) {
  const meta = useFileMeta(id);
  if (meta === 'missing') {
    return (
      <span className="label rounded-[10px] px-2 py-1 text-ink-muted" data-testid="file-missing">
        File eliminato
      </span>
    );
  }
  if (!meta) return <span aria-hidden className="block h-[56px] w-[180px]" />;
  if (image && meta.kind === 'image') return <ImageTile meta={meta} />;
  return <FileChip file={meta} />;
}
