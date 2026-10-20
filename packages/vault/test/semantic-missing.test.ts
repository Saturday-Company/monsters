import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SemanticUnavailableError,
  VaultService,
  WorkerEmbedder,
  asSemanticUnavailable,
  transformersInstalled,
  vaultSearchTool,
} from '../src/index.ts';
import { actor, tempDir, track } from './helpers.ts';

/*
 * transformers.js not installed (the packaged desktop app, D-046): semantic
 * search is off for good, the log gets one line, search is full-text and no
 * tool result or status carries the import error.
 */

/** What the embedding worker of the packaged app reported. */
function moduleNotFound(): Error {
  return Object.assign(
    new Error(
      "Cannot find package '@huggingface/transformers' imported from " +
        '/home/u/.local/opt/monsters-core/0.1.0-alpha.1/embed-worker.js',
    ),
    { code: 'ERR_MODULE_NOT_FOUND' },
  );
}

const LINE = 'semantic search off: @huggingface/transformers is not installed';

describe('transformers.js not installed', () => {
  it('turns semantic search off once, without retries, and searches full-text', async () => {
    let loads = 0;
    const logged: Error[] = [];
    const vault = track(
      await VaultService.create({
        root: join(tempDir(), 'Vault'),
        git: false,
        embedder: () => {
          loads++;
          return Promise.reject(moduleNotFound());
        },
        semanticOptions: { onError: (e) => logged.push(e), retryMinMs: 5, retryAfterMs: 5 },
      }),
    );
    const a = actor('user');
    await vault.write(a, { path: 'Risorse/Pane.md', content: '# Pane\n\nLa ricetta del pane.\n' });
    await vault.semanticIdle();
    await sleep(40);
    await vault.write(a, { path: 'Risorse/Riso.md', content: '# Riso\n\nIl risotto.\n' });
    await vault.semanticIdle();

    expect(loads).toBe(1);
    expect(logged.map((e) => e.message)).toEqual([LINE]);
    expect(logged[0]).toBeInstanceOf(SemanticUnavailableError);
    const status = vault.semanticStatus();
    expect(status.state).toBe('unavailable');
    expect(status.reason).toMatch(/non è disponibile in questa installazione/);
    expect(JSON.stringify(status)).not.toMatch(/Cannot find|imported from/);

    for (const mode of ['hybrid', 'semantic', 'text'] as const) {
      const hits = await vault.search(a, { query: 'ricetta pane', mode });
      expect(hits.map((h) => h.path)).toEqual(['Risorse/Pane.md']);
    }
    const tool = vaultSearchTool(vault);
    const out = await tool.execute(tool.inputSchema.parse({ query: 'risotto' }), {
      agentId: 'user',
      runId: 'r',
      callEventId: 'e',
      signal: new AbortController().signal,
      emit: () => undefined,
    });
    expect(out.map((h) => h.path)).toEqual(['Risorse/Riso.md']);
    expect(JSON.stringify(out)).not.toMatch(/Cannot find|transformers|imported from/);
  });

  it('starts no worker and downloads nothing when the package is not there', async () => {
    const cacheDir = join(tempDir(), 'models');
    const started = Date.now();
    await expect(WorkerEmbedder.create({ cacheDir, installed: () => false })).rejects.toThrow(
      SemanticUnavailableError,
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('finds the package where Node would look for it', () => {
    const dir = tempDir();
    const from = pathToFileURL(join(dir, 'core', 'embed-worker.js'));
    expect(transformersInstalled(from)).toBe(false);
    const pkg = join(dir, 'node_modules', '@huggingface', 'transformers');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{"name":"@huggingface/transformers"}');
    expect(transformersInstalled(from)).toBe(true);
  });

  it('tells a missing package from other failures', () => {
    expect(asSemanticUnavailable(moduleNotFound())?.message).toBe(LINE);
    expect(
      asSemanticUnavailable(
        new Error("Cannot find package 'onnxruntime-node' imported from /x/transformers.node.mjs"),
      )?.message,
    ).toBe('semantic search off: onnxruntime-node is not installed');
    expect(asSemanticUnavailable(new Error("Cannot find module 'sharp/lib'"))?.missing).toBe(
      'sharp',
    );
    // A file of the app (not a package), a download, a hash: the usual retries.
    expect(asSemanticUnavailable(new Error("Cannot find module '/x/embed-worker.js'"))).toBeNull();
    expect(asSemanticUnavailable(new Error("Cannot find module './embed-worker.js'"))).toBeNull();
    expect(asSemanticUnavailable(new Error('getaddrinfo ENOTFOUND huggingface.co'))).toBeNull();
    expect(asSemanticUnavailable(new Error('config.json: sha256 mismatch'))).toBeNull();
  });
});
