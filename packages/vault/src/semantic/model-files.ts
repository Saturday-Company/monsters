import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/*
 * Files of the embedding model, pinned to a commit of the Hugging Face repo
 * and checked against their sha256 (D-030): a file that does not match, in the
 * cache or freshly downloaded, is deleted and never loaded. transformers.js
 * then loads the model from these local files only.
 */

export interface ModelFile {
  /** Path inside the repo, e.g. `onnx/model_quint8_avx2.onnx`. */
  path: string;
  sha256: string;
  size: number;
}

export interface ModelSpec {
  /** Repo on Hugging Face, e.g. `ibm-granite/granite-embedding-97m-multilingual-r2`. */
  id: string;
  /** Commit of the repo the files come from. */
  revision: string;
  /** ONNX file of the model, without `.onnx` (in `onnx/`). */
  file: string;
  /** Every file transformers.js needs, with its hash. */
  files: readonly ModelFile[];
}

export const HF_HOST = 'https://huggingface.co';

export interface EnsureModelOptions {
  /** Folder of the models: files go to `<cacheDir>/<id>/<path>`. */
  cacheDir: string;
  spec: ModelSpec;
  /** Only check the files already there (no download). */
  offline?: boolean;
  /** Default `https://huggingface.co` (tests use a local server). */
  remoteHost?: string;
  signal?: AbortSignal;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function intact(file: string, f: ModelFile): Promise<boolean | null> {
  const st = await stat(file).catch(() => null);
  if (!st) return null;
  return st.size === f.size && (await sha256Of(file)) === f.sha256;
}

async function download(url: string, target: string, f: ModelFile, signal?: AbortSignal) {
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  try {
    const res = await fetch(url, { redirect: 'follow', ...(signal ? { signal } : {}) });
    if (!res.ok || !res.body) throw new Error(`download of ${f.path} failed: HTTP ${res.status}`);
    const hash = createHash('sha256');
    let size = 0;
    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > f.size)
            throw new Error(
              `model file ${f.path}: larger than the pinned ${f.size} bytes (sha256 ${f.sha256})`,
            );
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(part),
      signal ? { signal } : {},
    );
    const got = hash.digest('hex');
    if (size !== f.size || got !== f.sha256) {
      throw new Error(
        `model file ${f.path}: sha256 ${got} (${size} bytes) does not match the pinned ${f.sha256} (${f.size} bytes)`,
      );
    }
    await rename(part, target);
  } finally {
    await rm(part, { force: true });
  }
}

/**
 * Makes sure every file of the model is in the cache and intact, downloading
 * the missing ones from the pinned revision. Throws (after deleting the bad
 * file) on a hash mismatch, and when offline with a file missing.
 */
export async function ensureModelFiles(opts: EnsureModelOptions): Promise<string> {
  const { spec } = opts;
  const dir = join(opts.cacheDir, ...spec.id.split('/'));
  const host = opts.remoteHost ?? HF_HOST;
  for (const f of spec.files) {
    opts.signal?.throwIfAborted();
    const target = join(dir, ...f.path.split('/'));
    const ok = await intact(target, f);
    if (ok) continue;
    if (ok === false) {
      // Truncated, corrupted or replaced: never loaded.
      await rm(target, { force: true });
      if (opts.offline) {
        throw new Error(`model file ${f.path} does not match its sha256: deleted`);
      }
    }
    if (opts.offline) throw new Error(`model file ${f.path} not downloaded (offline)`);
    const url = `${host}/${spec.id}/resolve/${encodeURIComponent(spec.revision)}/${f.path}`;
    await download(url, target, f, opts.signal);
  }
  return dir;
}
