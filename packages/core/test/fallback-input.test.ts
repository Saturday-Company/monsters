import type { FileMeta } from '@monsters/shared';
import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreServices,
  parseAgentConfig,
  runAgent,
  type AgentDefinition,
  type CoreServices,
} from '../src/index.ts';
import {
  attachmentParts,
  type AttachmentSource,
  type ModelSight,
} from '../src/files/model-input.ts';
import { tempHome } from './helpers.ts';

/*
 * Review of 28/10: the files of a message are chosen for the first model of the chain, and a
 * fallback that cannot read them used to be sent them all the same; its 400 disabled the provider.
 * Each link gets a prompt it can read (D-218).
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

const photo: FileMeta = {
  id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
  name: 'foto.png',
  mime: 'image/png',
  size: 2048,
  kind: 'image',
  source: 'user',
  path: 'File/2026-10/foto.png',
  hasThumb: false,
  hasText: false,
  createdAt: 0,
};

const SEES: ModelSight = { images: true, pdf: false };
const BLIND: ModelSight = { images: false, pdf: false };

function agent(models: { provider: string; model: string }[]): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche online',
      color: '#4f8df7',
      models,
      tools: [],
      limits: { maxSteps: 4 },
    }),
    instructions: '# Rhea',
  };
}

async function ask(
  scripts: { sees: FakeScript; blind: FakeScript; other?: FakeScript },
  chain: { provider: string; model: string }[],
  files: { meta: FileMeta; sight: ModelSight; text: AttachmentSource['text'] } = {
    meta: photo,
    sight: SEES,
    text: () => null,
  },
) {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const provider = new FakeProvider({ models: { sees: scripts.sees, blind: scripts.blind } });
  const providers = new ProviderRegistry().register(provider);
  const def = agent(chain);
  const r = services.runs.startRun({ agent: 'rhea' });
  const result = await runAgent({
    agent: def,
    task: 'Cosa vedi nella foto?',
    tools: [],
    signal: r.signal,
    log: services.log,
    runId: r.id,
    session: providers.session(def.config.models),
    // Built for the first model, which sees: the image goes in as an image.
    attachments: attachmentParts(
      [{ meta: files.meta, bytes: () => Buffer.from([1, 2, 3]), text: files.text }],
      files.sight,
    ),
    sight: (ref) => (ref.model === 'sees' ? files.sight : BLIND),
  });
  r.finish();
  return { result, provider };
}

const CHAIN = [
  { provider: 'fake', model: 'sees' },
  { provider: 'fake', model: 'blind' },
];

describe('files in a fallback chain', () => {
  it('a text-only fallback gets a note instead of the image', async () => {
    const { result, provider } = await ask(
      {
        sees: [{ kind: 'http-error', status: 503, message: 'overloaded' }],
        blind: [fake.text('Non vedo la foto.')],
      },
      CHAIN,
    );
    expect(result).toMatchObject({ status: 'completed', text: 'Non vedo la foto.' });
    const sent = (model: string) => JSON.stringify(provider.callsTo(model)[0]!.options.prompt);
    expect(sent('sees')).toContain('image/png');
    expect(sent('blind')).not.toContain('image/png');
    expect(sent('blind')).toContain('foto.png');
    expect(sent('blind')).toMatch(/can.t see images/);
  });

  it('a 400 on the image does not skip the provider’s other models', async () => {
    const { result, provider } = await ask(
      {
        sees: [{ kind: 'http-error', status: 400, message: 'Bad Request' }],
        blind: [fake.text('Non vedo la foto.')],
      },
      CHAIN,
    );
    expect(result).toMatchObject({ status: 'completed', text: 'Non vedo la foto.' });
    expect(provider.calls.map((c) => c.model)).toEqual(['sees', 'blind']);
  });

  it('a fallback that cannot read PDFs gets the extracted text, within the limits', async () => {
    const scheda: FileMeta = { ...photo, name: 'scheda.pdf', mime: 'application/pdf', kind: 'pdf' };
    const long = 'Capitolo uno. '.repeat(5_000);
    const { result, provider } = await ask(
      {
        sees: [{ kind: 'http-error', status: 503, message: 'overloaded' }],
        blind: [fake.text('Letto.')],
      },
      CHAIN,
      {
        meta: scheda,
        sight: { images: true, pdf: true },
        text: () => ({ text: long, truncated: false }),
      },
    );
    expect(result).toMatchObject({ status: 'completed', text: 'Letto.' });
    const sent = (model: string) => JSON.stringify(provider.callsTo(model)[0]!.options.prompt);
    expect(sent('sees')).toContain('application/pdf');
    const fallback = sent('blind');
    expect(fallback).not.toContain('application/pdf');
    expect(fallback).toContain('Capitolo uno.');
    expect(fallback).not.toMatch(/can.t read PDFs/);
    // The clipped text of the file, not all of it.
    expect(fallback.length).toBeLessThan(long.length);
    expect(fallback).toContain('text cut');
  });

  it('a PDF without extracted text still gives the note', async () => {
    const scheda: FileMeta = { ...photo, name: 'scheda.pdf', mime: 'application/pdf', kind: 'pdf' };
    const { provider } = await ask(
      {
        sees: [{ kind: 'http-error', status: 503, message: 'overloaded' }],
        blind: [fake.text('Non lo leggo.')],
      },
      CHAIN,
      { meta: scheda, sight: { images: true, pdf: true }, text: () => null },
    );
    expect(JSON.stringify(provider.callsTo('blind')[0]!.options.prompt)).toMatch(/can.t read PDFs/);
  });
});
