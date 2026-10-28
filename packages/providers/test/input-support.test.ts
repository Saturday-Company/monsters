import { APICallError, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  hasMediaParts,
  isProviderError,
  ProviderRegistry,
  withReadableInput,
  type SessionEvent,
} from '../src/index.ts';
import { fake, FakeProvider, type FakeScript } from '../src/testing/index.ts';

const note = (kind: 'image' | 'pdf', name: string | undefined) =>
  `[${kind} ${name ?? '?'} left out]`;

const withImage = [
  { role: 'system' as const, content: 'Sei Rhea.' },
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'Cosa vedi?' },
      {
        type: 'file' as const,
        data: { type: 'data' as const, data: new Uint8Array([1, 2, 3]) },
        mediaType: 'image/png',
        filename: 'foto.png',
      },
      {
        type: 'file' as const,
        data: { type: 'data' as const, data: new Uint8Array([4]) },
        mediaType: 'application/pdf',
        filename: 'scheda.pdf',
      },
    ],
  },
];

describe('withReadableInput', () => {
  it('replaces what the model cannot read with a note, and nothing else', () => {
    const blind = withReadableInput(withImage, { images: false, pdf: true }, note);
    expect(blind[1]).toMatchObject({
      content: [
        { type: 'text', text: 'Cosa vedi?' },
        { type: 'text', text: '[image foto.png left out]' },
        { type: 'file', mediaType: 'application/pdf' },
      ],
    });
    const textOnly = withReadableInput(withImage, { images: false, pdf: false }, note);
    expect(hasMediaParts(textOnly)).toBe(false);
    expect(JSON.stringify(textOnly)).toContain('[pdf scheda.pdf left out]');
    // Nothing to take out: the very same prompt.
    expect(withReadableInput(withImage, { images: true, pdf: true }, note)).toBe(withImage);
    // The original is untouched.
    expect(hasMediaParts(withImage)).toBe(true);
  });
});

describe('a chain with a model that cannot read the images', () => {
  function chain(models: Record<string, FakeScript>) {
    const provider = new FakeProvider({ models });
    const events: SessionEvent[] = [];
    const session = new ProviderRegistry().register(provider).session(
      [
        { provider: 'fake', model: 'sees' },
        { provider: 'fake', model: 'blind' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    session.setPromptAdapter((ref, prompt) =>
      withReadableInput(prompt, { images: ref.model === 'sees', pdf: false }, note),
    );
    return { provider, session, events };
  }
  const ask = (session: ReturnType<typeof chain>['session']) =>
    streamText({
      model: session,
      maxRetries: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Cosa vedi?' },
            { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
          ],
        },
      ],
    }).text;

  it('each link gets a prompt it can read', async () => {
    const { provider, session } = chain({
      sees: [{ kind: 'http-error', status: 503, message: 'overloaded' }],
      blind: [fake.text('Non vedo immagini.')],
    });
    expect(await ask(session)).toBe('Non vedo immagini.');
    const seen = (model: string) => JSON.stringify(provider.callsTo(model)[0]!.options.prompt);
    expect(seen('sees')).toContain('image/png');
    expect(seen('blind')).not.toContain('image/png');
    expect(seen('blind')).toContain('left out');
  });

  it('a 400 for an image does not disable the provider: the next model answers', async () => {
    const { provider, session, events } = chain({
      // The first model refuses its image with a bare 400.
      sees: [{ kind: 'http-error', status: 400, message: 'Bad Request' }],
      blind: [fake.text('Fatto senza immagine.')],
    });
    expect(await ask(session)).toBe('Fatto senza immagine.');
    expect(provider.calls.map((c) => c.model)).toEqual(['sees', 'blind']);
    expect(events.find((e) => e.type === 'fallback')).toMatchObject({
      kind: 'bad_request',
      to: { model: 'blind' },
    });
  });

  it('a 400 without media is still the provider’s: its other models are skipped', async () => {
    const provider = new FakeProvider({
      models: {
        a: [{ kind: 'http-error', status: 400, message: 'Bad Request' }],
        b: [fake.text('non deve arrivare')],
      },
    });
    const session = new ProviderRegistry().register(provider).session([
      { provider: 'fake', model: 'a' },
      { provider: 'fake', model: 'b' },
    ]);
    await expect(
      streamText({ model: session, prompt: 'ciao', maxRetries: 0 }).text,
    ).rejects.toThrow();
    expect(provider.calls.map((c) => c.model)).toEqual(['a']);
  });
});

describe('a 400 that says the input is unsupported', () => {
  const bad = (message: string, responseBody = '') =>
    new APICallError({
      message,
      url: 'https://api.example/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400,
      responseBody,
    });

  it.each([
    'Invalid content type. image_url is only supported by certain models.',
    "'messages.1.content' : value must be a string",
    'Image input is not supported by this model',
    'failed to process inputs: this model is missing data required for image input',
    'Unsupported content type: image_url',
    'PDF input is not supported',
  ])('is the model’s, not the provider’s: %s', (message) => {
    const err = bad(message);
    expect(classifyProviderError(err)).toBe('model_gone');
    expect(isProviderError(err)).toBe(false);
  });

  it('a plain bad request stays the provider’s', () => {
    expect(classifyProviderError(bad('Invalid parameter: temperature'))).toBe('bad_request');
  });
});
