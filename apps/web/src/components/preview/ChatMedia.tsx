import { ArrowSquareOut, File as FileIcon, Image as ImageIcon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { openPreview } from '../../store/preview.ts';
import { useFileMeta, useFileUrl } from './files.ts';

/*
 * Images and files inside a message (D-075). An image the core keeps
 * (`/api/files/<id>/content`) shows in the bubble and opens in Anteprima. An
 * image on the internet is never loaded by itself (it would tell that site you
 * read the message, and from where): a small card says where it is, and only
 * "Mostra immagine" fetches it, without a referrer; the core's CSP allows
 * images from https only for this. The card shows the whole address: a monster
 * that read a hostile page could put the user's data in it (`?q=<note>`), so an
 * address with a query or a fragment asks once more before loading (D-085).
 * A link to a file opens it in Anteprima.
 */

export function ChatImage({ fileId, alt }: { fileId: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const picture = useFileUrl(fileId);
  const label = alt || 'Immagine';
  if (failed)
    return (
      <button
        type="button"
        className="md-note"
        onClick={() => openPreview({ kind: 'file', fileId })}
        data-testid="chat-image-missing"
      >
        <ImageIcon size={15} weight="bold" aria-hidden className="shrink-0" />
        <span>{label} (non si apre)</span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => openPreview({ kind: 'file', fileId })}
      className="md-image group"
      title={`Apri “${label}” nell’anteprima`}
      data-testid="chat-image"
    >
      <img
        src={picture.src}
        alt={label}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => picture.retry(() => setFailed(true))}
      />
    </button>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The address carries data besides the place of the image (`?…` or `#…`). */
export function carriesData(url: string): boolean {
  try {
    const u = new URL(url);
    return u.search.length > 1 || u.hash.length > 1;
  } catch {
    return true;
  }
}

/** Longest part of an address shown in the card (the whole one is in its title). */
const URL_SHOWN = 400;

export function RemoteImage({ url, alt }: { url: string; alt: string }) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const host = hostOf(url);
  const withData = carriesData(url);
  if (shown && !failed)
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="md-image"
        title={`Apri l’immagine su ${host}`}
        data-testid="remote-image"
      >
        <img
          src={url}
          alt={alt || `Immagine da ${host}`}
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </a>
    );
  return (
    <span className="md-remote" data-testid="remote-image-card">
      <ImageIcon size={16} weight="bold" aria-hidden className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate">{alt || 'Immagine'}</span>
        <span className="label block truncate opacity-80">
          {failed ? `Non si carica da ${host}` : `Da ${host}`}
        </span>
        <span
          className="block text-micro leading-4 break-all opacity-70"
          title={url}
          data-testid="remote-image-url"
        >
          {url.length > URL_SHOWN ? `${url.slice(0, URL_SHOWN)}…` : url}
        </span>
        {asking && (
          <span className="block text-micro leading-4" data-testid="remote-image-data">
            L’indirizzo contiene dati dopo «?» o «#»: arriverebbero a {host}. Mostrarla comunque?
          </span>
        )}
      </span>
      {!failed && (
        <button
          type="button"
          className="md-remote-key label"
          onClick={() => (withData && !asking ? setAsking(true) : setShown(true))}
          title={`Carica l’immagine da ${host}: quel sito saprà che l’hai aperta`}
          data-testid="remote-image-show"
        >
          {asking ? 'Sì, mostra' : 'Mostra immagine'}
        </button>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="md-remote-key"
        aria-label={`Apri l’immagine su ${host} (si apre in una nuova scheda)`}
      >
        <ArrowSquareOut size={14} weight="bold" aria-hidden />
      </a>
    </span>
  );
}

export function FileLink({ fileId, children }: { fileId: string; children?: ReactNode }) {
  const meta = useFileMeta(fileId);
  const name = meta.state === 'ready' ? meta.meta.name : null;
  return (
    <button
      type="button"
      className="md-note"
      onClick={() => openPreview({ kind: 'file', fileId })}
      title={`Apri ${name ? `“${name}”` : 'il file'} nell’anteprima`}
      data-testid="file-link"
    >
      <FileIcon size={15} weight="fill" aria-hidden className="shrink-0" />
      <span>{children ?? name ?? 'File'}</span>
    </button>
  );
}
