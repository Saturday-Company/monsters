import {
  DecisionsUpdateSchema,
  TypeSafeKeyRequestSchema,
  type DecisionsView,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';

/*
 * `/api/settings/decisions` and the TypeSafe key of the mock core (M2.9). A
 * key containing `000000` is refused like TypeSafe would.
 */

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});
const ok = (body: unknown): RawResponse => ({ status: 200, body });

const noKeyMessage = () =>
  tr(
    'To use the expert model you first need the TypeSafe key.',
    'Per usare il modello esperto serve prima la chiave di TypeSafe.',
  );

export class MockDecisions {
  private view: DecisionsView = {
    engine: 'rules',
    threshold: 0.8,
    jev: { keySet: false, model: 'jev-1.13.0' },
  };

  /** Engine and key, shared with the instinct of the mock (D-067). */
  state(): { engine: DecisionsView['engine']; keySet: boolean } {
    return { engine: this.view.engine, keySet: this.view.jev.keySet };
  }

  /** Changes the engine; an error response when Jev has no key. */
  setEngine(engine: DecisionsView['engine']): RawResponse | null {
    if (engine === 'jev' && !this.view.jev.keySet) {
      return fail(409, 'no_key', noKeyMessage());
    }
    this.view = { ...this.view, engine };
    return null;
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/settings/decisions':
        return ok(this.view);
      case 'PUT /api/settings/decisions': {
        const p = DecisionsUpdateSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (p.data.engine === 'jev' && !this.view.jev.keySet) {
          return fail(409, 'no_key', noKeyMessage());
        }
        this.view = { ...this.view, engine: p.data.engine };
        return ok(this.view);
      }
      case 'PUT /api/settings/typesafe-key': {
        const p = TypeSafeKeyRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (p.data.key.includes('000000')) {
          return fail(
            400,
            'invalid_key',
            tr('TypeSafe doesn’t recognize this key.', 'TypeSafe non riconosce questa chiave.'),
          );
        }
        this.view = { ...this.view, jev: { ...this.view.jev, keySet: true, keySource: 'file' } };
        return ok(this.view);
      }
      case 'DELETE /api/settings/typesafe-key':
        this.view = {
          ...this.view,
          engine: this.view.engine === 'jev' ? 'rules' : this.view.engine,
          jev: { keySet: false, model: this.view.jev.model },
        };
        return ok(this.view);
      default:
        return null;
    }
  }
}
