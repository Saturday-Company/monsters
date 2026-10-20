import {
  AppWindow,
  ArrowRight,
  File as FileIcon,
  FilePdf,
  FileText,
  Image as ImageIcon,
  Table,
  type Icon,
} from '@phosphor-icons/react';
import type { FileKind } from '@monsters/shared';
import type { ChatItem } from '../../store/derive.ts';
import { useNameOf } from '../../store/hooks.ts';
import { openPreview, samePreview, usePreview } from '../../store/preview.ts';
import { kindWord, useFileUrl } from './files.ts';

/*
 * What a monster showed with `preview_show` (D-075), in its chat: a chip with
 * the name, the monster's line, and the key that opens it in Anteprima (it
 * opened by itself if the chat was on screen). An image shows a small copy.
 */

const ICONS: Record<FileKind, Icon> = {
  image: ImageIcon,
  pdf: FilePdf,
  document: FileText,
  sheet: Table,
  text: FileText,
  html: AppWindow,
  other: FileIcon,
};

export function PreviewRow({ item }: { item: Extract<ChatItem, { kind: 'preview' }> }) {
  const nameOf = useNameOf();
  const shown = usePreview(
    (s) =>
      s.visible &&
      s.tab === 'preview' &&
      !!s.items[s.active] &&
      samePreview(s.items[s.active]!, item.data.item),
  );
  const target = item.data.item;
  const picture = useFileUrl(
    target.kind === 'file' && item.data.fileKind === 'image' ? target.fileId : null,
  );
  const Glyph = target.kind === 'note' ? FileText : ICONS[item.data.fileKind ?? 'other'];
  const what = target.kind === 'note' ? 'Nota' : kindWord(item.data.fileKind ?? 'other');
  const who = nameOf(item.from);
  return (
    <button
      type="button"
      onClick={() => openPreview(target)}
      className="preview-row raised flex w-full max-w-[460px] items-center gap-3 rounded-[12px] p-2 pr-3 text-left"
      data-testid="preview-row"
      data-shown={shown ? '' : undefined}
      aria-label={`${who} ti mostra ${what.toLowerCase()} “${item.data.name}”: apri nell’anteprima`}
    >
      <span className="screen flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px]">
        {target.kind === 'file' && item.data.fileKind === 'image' ? (
          <img
            src={picture.src}
            alt=""
            loading="lazy"
            onError={() => picture.retry(() => {})}
            className="size-full object-cover"
          />
        ) : (
          <Glyph size={22} weight="bold" aria-hidden className="text-screen-ink" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="label block truncate text-ink-muted">
          {who} ti mostra · {what}
        </span>
        <span className="block truncate text-body font-semibold text-ink">{item.data.name}</span>
        {item.data.caption && (
          <span className="block truncate text-footnote text-ink-muted">{item.data.caption}</span>
        )}
      </span>
      <span className="label flex shrink-0 items-center gap-1 text-signal-ink">
        {shown ? 'In anteprima' : 'Apri'}
        {!shown && <ArrowRight size={13} weight="bold" aria-hidden />}
      </span>
    </button>
  );
}
