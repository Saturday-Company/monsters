import { ArrowSquareOut, FileText, Image, LinkBreak } from '@phosphor-icons/react';
import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isExternalUrl, noteName, noteTargetOf } from '../../lib/markdown.ts';
import { vaultPath } from '../../lib/router.ts';
import {
  embedTargetOf,
  isAttachment,
  linkNote,
  prepareNoteMarkdown,
  safeNoteUrl,
  tagOf,
} from '../../lib/vault-markdown.ts';
import { cn } from '../../lib/utils.ts';

const PLUGINS = [remarkGfm];

export interface VaultMarkdownProps {
  text: string;
  /** Resolves a link target to the path of an existing note (null = missing). */
  resolve: (target: string) => string | null;
  onTag: (tag: string) => void;
  className?: string;
}

/**
 * A vault note rendered for reading: no raw HTML (shown as text), links only to
 * http(s) and mailto (new tab), wikilinks to the notes of the vault (missing
 * ones marked), embeds as cards, tags as filters, no remote images.
 */
export const VaultMarkdown = memo(function VaultMarkdown({
  text,
  resolve,
  onTag,
  className,
}: VaultMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const url = href ?? '';
        if (isExternalUrl(url))
          return (
            <a href={url} target="_blank" rel="noopener noreferrer" className="md-link">
              {children}
              <ArrowSquareOut size={13} weight="bold" aria-hidden className="md-ext" />
              <span className="sr-only"> (si apre in una nuova scheda)</span>
            </a>
          );
        const tag = tagOf(url);
        if (tag)
          return (
            <button
              type="button"
              className="vault-tag"
              onClick={() => onTag(tag)}
              title={`Mostra le note con #${tag}`}
            >
              {children}
            </button>
          );
        const embed = embedTargetOf(url);
        if (embed) {
          const name = noteName(embed);
          if (isAttachment(embed))
            return (
              <span className="vault-embed" data-testid="vault-embed">
                <Image size={17} weight="bold" aria-hidden />
                <span>Allegato: {name}</span>
              </span>
            );
          const path = resolve(embed);
          return path ? (
            <a href={vaultPath(path)} className="vault-embed" data-testid="vault-embed">
              <FileText size={17} weight="fill" aria-hidden />
              <span>
                <span className="sr-only">Nota incorporata: </span>
                {name}
              </span>
            </a>
          ) : (
            <span className="vault-embed vault-missing" data-testid="vault-embed">
              <LinkBreak size={17} weight="bold" aria-hidden />
              <span>{name} (non esiste ancora)</span>
            </span>
          );
        }
        const target = url ? noteTargetOf(url) : null;
        if (target) {
          const path = resolve(target);
          if (!path)
            return (
              <span
                className="md-note vault-missing"
                title="Questa nota non esiste ancora"
                data-testid="vault-link-missing"
              >
                <span>{children}</span>
              </span>
            );
          return (
            <a
              href={vaultPath(path)}
              className="md-note"
              title={`Apri “${noteName(linkNote(path))}”`}
              data-testid="vault-link"
            >
              <span>{children}</span>
            </a>
          );
        }
        return <span>{children}</span>;
      },
      img({ src, alt }) {
        const url = typeof src === 'string' ? src : '';
        const label = alt?.trim() ? `Immagine: ${alt.trim()}` : 'Immagine';
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
    }),
    [resolve, onTag],
  );
  const prepared = useMemo(() => prepareNoteMarkdown(text), [text]);
  return (
    <div className={cn('md vault-md', className)} data-testid="vault-note-body">
      <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={safeNoteUrl} components={components}>
        {prepared}
      </ReactMarkdown>
    </div>
  );
});
