import type { FileMeta } from '@monsters/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describeError } from '../../lib/api.ts';
import {
  guessKind,
  makeThumb,
  MESSAGE_MAX_ATTACHMENTS,
  pastedName,
  precheck,
} from '../../lib/files.ts';
import { getApi, notify } from '../../store/app.ts';
import { useFiles } from '../../store/files.ts';
import type { ChipFile } from '../files/FileChip.tsx';
import { chatStrings } from './chat.strings.ts';

/*
 * The files of the message being written (D-075): each one starts to upload
 * as soon as it is picked, pasted or dropped, with its progress; the message
 * goes only when every upload is done. Errors stay on the chip, in a few words.
 */

export interface Attachment {
  key: string;
  file: ChipFile;
  /** 0..1 while uploading; undefined once done or failed. */
  progress?: number | undefined;
  error?: string | undefined;
  meta?: FileMeta | undefined;
  abort?: AbortController | undefined;
}

const FILES_EVENT = 'monsters:composer-files';

/** Gives files to the composer of the open chat (a drop on the chat). */
export function attachToComposer(files: readonly File[]): void {
  window.dispatchEvent(new CustomEvent<readonly File[]>(FILES_EVENT, { detail: files }));
}

let seq = 0;

export function useAttachments(agentId: string) {
  const [items, setItems] = useState<Attachment[]>([]);
  const live = useRef(items);
  useLayoutEffect(() => {
    live.current = items;
  }, [items]);

  const patch = (key: string, change: Partial<Attachment>) =>
    setItems((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));

  const add = useCallback(
    (files: readonly File[]) => {
      const room = MESSAGE_MAX_ATTACHMENTS - live.current.length;
      if (files.length > room) {
        notify(chatStrings().composer.tooMany(MESSAGE_MAX_ATTACHMENTS), 'error');
      }
      for (const raw of files.slice(0, Math.max(0, room))) {
        const name = pastedName(raw);
        const key = `att-${++seq}`;
        const error = precheck({ name, size: raw.size, type: raw.type });
        const isImage = /^image\/(png|jpeg|webp|gif)$/.test(raw.type);
        const file: ChipFile = {
          name,
          kind: guessKind({ name, type: raw.type }),
          size: raw.size,
          ...(isImage && !error ? { localUrl: URL.createObjectURL(raw) } : {}),
        };
        if (error) {
          setItems((list) => [...list, { key, file, error }]);
          continue;
        }
        const abort = new AbortController();
        setItems((list) => [...list, { key, file, progress: 0, abort }]);
        void (async () => {
          try {
            const thumb = isImage ? await makeThumb(raw) : null;
            const meta = await getApi().uploadFile(raw, name, {
              agent: agentId,
              thumb,
              signal: abort.signal,
              onProgress: (loaded, total) =>
                patch(key, { progress: total > 0 ? Math.min(0.99, loaded / total) : 0.5 }),
            });
            useFiles.getState().put([meta]);
            patch(key, {
              progress: undefined,
              abort: undefined,
              meta,
              file: {
                ...file,
                id: meta.id,
                name: meta.name,
                kind: meta.kind,
                size: meta.size,
                hasThumb: meta.hasThumb,
              },
            });
          } catch (err) {
            if (abort.signal.aborted) return;
            patch(key, { progress: undefined, abort: undefined, error: describeError(err) });
          }
        })();
      }
    },
    [agentId],
  );

  const remove = useCallback((key: string) => {
    const it = live.current.find((a) => a.key === key);
    it?.abort?.abort();
    if (it?.file.localUrl) URL.revokeObjectURL(it.file.localUrl);
    setItems((list) => list.filter((a) => a.key !== key));
  }, []);

  /** After sending: the chips go (the local pictures stay for the pending bubble a moment). */
  const clear = useCallback(() => {
    const old = live.current;
    setItems([]);
    setTimeout(() => {
      for (const a of old) if (a.file.localUrl) URL.revokeObjectURL(a.file.localUrl);
    }, 20_000);
  }, []);

  // Files dropped on the chat.
  useEffect(() => {
    const onFiles = (e: Event) => add((e as CustomEvent<readonly File[]>).detail);
    window.addEventListener(FILES_EVENT, onFiles);
    return () => window.removeEventListener(FILES_EVENT, onFiles);
  }, [add]);

  // Another chat: what was being attached here is dropped.
  useEffect(
    () => () => {
      for (const a of live.current) {
        a.abort?.abort();
        if (a.file.localUrl) URL.revokeObjectURL(a.file.localUrl);
      }
    },
    [],
  );

  const uploading = items.some((a) => a.progress !== undefined);
  const ready = items.flatMap((a) => (a.meta ? [a.meta] : []));
  return { items, add, remove, clear, uploading, ready };
}
