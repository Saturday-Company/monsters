import type { EventInput, LogEvent } from '@monsters/shared';
import { tr } from './lang.ts';
import { noteTitle } from './paths.ts';

/*
 * A turn of Titan with things to open in Anteprima (`?mock=demo&anteprima=1`,
 * D-075): an image and a PDF in its answer, a note link, a page it showed with
 * `preview_show`, and a browser screenshot in "Dietro le quinte". Added after
 * the demo history, so the demo itself (and its tests) stays as it is.
 */

export function seedPreviewScene(append: (event: EventInput, ts: number) => LogEvent): void {
  let t = Date.now() - 3 * 60_000;
  const at = (seconds: number) => (t += seconds * 1000);
  const run = 'run_seed_preview';
  append(
    {
      agent: 'user',
      runId: run,
      type: 'message',
      data: {
        role: 'user',
        text: tr(
          'Titan, can you show me the new menu and the Lisbon quote?',
          'Titan, mi fai vedere il menu nuovo e il preventivo di Lisbona?',
        ),
        channel: 'ui',
      },
    },
    at(0),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'run',
      data: { status: 'started', goal: tr('Menu and quote', 'Menu e preventivo') },
    },
    at(1),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'tool_call',
      data: {
        callId: 'pv1',
        tool: 'mcp__browser__browser_take_screenshot',
        input: { url: 'https://www.carris.pt/' },
      },
    },
    at(2),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'tool_result',
      data: {
        callId: 'pv1',
        tool: 'mcp__browser__browser_take_screenshot',
        ok: true,
        durationMs: 1840,
        output: {
          fileId: 'f-screenshot-tram',
          saved: tr(
            'File/2026-10/Screenshot carris.pt.png',
            'File/2026-10/Schermata carris.pt.png',
          ),
        },
      },
    },
    at(2),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'tool_call',
      data: { callId: 'pv2', tool: 'preview_show', input: { file: 'f-pagina-menu' } },
    },
    at(1),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'preview',
      data: {
        item: { kind: 'file', fileId: 'f-pagina-menu' },
        name: tr('Weekly menu.html', 'Menu della settimana.html'),
        fileKind: 'html',
        caption: tr(
          'The menu page, to send to the customers',
          'La pagina del menu, da mandare ai clienti',
        ),
      },
    },
    at(0.1),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'tool_result',
      data: { callId: 'pv2', tool: 'preview_show', ok: true, durationMs: 12 },
    },
    at(0.1),
  );
  append(
    {
      agent: 'titan',
      runId: run,
      type: 'message',
      data: {
        role: 'agent',
        text: tr(
          'Here’s the menu Dione designed:\n\n![Autumn menu](/api/files/f-menu-autunno/content)\n\n' +
            'The quote is here: [Lisbon quote](/api/files/f-preventivo/content). ' +
            `For the tram times see the note [[${noteTitle('tram28')}]]; the photo of the Carris site is among the steps.\n\n` +
            '![The view from Graça](https://upload.wikimedia.org/wikipedia/commons/a/a3/Lisboa_-_Miradouro_da_Gra%C3%A7a.jpg)',
          'Ecco il menu che ha disegnato Dione:\n\n![Menu autunno](/api/files/f-menu-autunno/content)\n\n' +
            'Il preventivo è qui: [Preventivo Lisbona](/api/files/f-preventivo/content). ' +
            `Per gli orari del tram guarda la nota [[${noteTitle('tram28')}]]; la foto del sito di Carris è tra i passi.\n\n` +
            '![La vista da Graça](https://upload.wikimedia.org/wikipedia/commons/a/a3/Lisboa_-_Miradouro_da_Gra%C3%A7a.jpg)',
        ),
      },
    },
    at(2),
  );
  append({ agent: 'titan', runId: run, type: 'run', data: { status: 'completed' } }, at(0.5));
}
