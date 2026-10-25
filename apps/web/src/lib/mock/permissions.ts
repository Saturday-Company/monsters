import {
  DEFAULT_AGENT_PERMISSIONS,
  PermissionsUpdateRequestSchema,
  type AgentPermissions,
  type AgentSummary,
  type EventInput,
  type PermissionsResponse,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';
import { mockVaultDir } from './paths.ts';

/*
 * `/api/permissions` of the mock core (M2.1): the team's defaults plus the
 * permissions of each agent, kept in memory. A folder is "missing" when its
 * path contains `non-esiste`; the vault cannot be granted, like in the core.
 */

const HOME = '/home/demo';

type Full = Required<AgentPermissions>;

const full = (p: AgentPermissions): Full => ({
  vault: p.vault,
  web: p.web,
  shell: p.shell ?? false,
  folders: (p.folders ?? []).map((f) => ({ path: f.path, write: f.write })),
});

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});

export class MockPermissions {
  private defaults: Full = full(DEFAULT_AGENT_PERMISSIONS);
  private readonly own = new Map<string, Full>();
  private readonly agents: () => AgentSummary[];
  private readonly log: (event: EventInput) => void;

  constructor(options: { agents: () => AgentSummary[]; log: (event: EventInput) => void }) {
    this.agents = options.agents;
    this.log = options.log;
    // The demo team: Rhea and Dione research and write, Mimas does the numbers in a folder.
    this.own.set('mimas', {
      vault: true,
      web: false,
      shell: true,
      folders: [{ path: `${HOME}/${tr('Documents/Accounts', 'Documenti/Conti')}`, write: true }],
    });
  }

  private view(): PermissionsResponse {
    return {
      defaults: this.defaults,
      agents: this.agents().map((a) => ({
        id: a.id,
        name: a.name,
        color: a.color,
        isOrchestrator: a.isOrchestrator,
        permissions: this.own.get(a.id) ?? this.defaults,
        custom: this.own.has(a.id),
      })),
      home: HOME,
      workspaces: `${HOME}/.monsters/workspaces`,
      platform: 'linux',
    };
  }

  private check(p: AgentPermissions): Full | RawResponse {
    const out = full(p);
    for (const f of out.folders) {
      const path = f.path.replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, '');
      if (!path.startsWith('/')) {
        return fail(
          400,
          'invalid_folder',
          tr('Write the full path of the folder.', 'Scrivi il percorso completo della cartella.'),
        );
      }
      if (path.includes('non-esiste') || path.includes('does-not-exist')) {
        return fail(
          400,
          'invalid_folder',
          tr(`The folder ${path} doesn’t exist.`, `La cartella ${path} non esiste.`),
        );
      }
      const vault = mockVaultDir();
      if (path === vault || path.startsWith(`${vault}/`)) {
        return fail(
          400,
          'invalid_folder',
          tr(
            'This is the notes folder: the monsters already use it, with history and undo. Pick another folder.',
            'È la cartella delle note: i mostri la usano già, con la cronologia e l’annulla. Scegli un’altra cartella.',
          ),
        );
      }
      f.path = path;
    }
    return out;
  }

  /** Whether a monster may use the web (the browser and the search follow it). */
  webOf(id: string): boolean {
    return (this.own.get(id) ?? this.defaults).web;
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (path !== '/api/permissions') return null;
    if (method === 'GET') return { status: 200, body: this.view() };
    if (method !== 'PUT') return fail(405, 'method_not_allowed');
    const p = PermissionsUpdateRequestSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
    const ids = new Set(this.agents().map((a) => a.id));
    for (const id of Object.keys(p.data.agents ?? {})) {
      if (!ids.has(id)) return fail(404, 'unknown_agent');
    }
    if (p.data.defaults) {
      const checked = this.check(p.data.defaults);
      if ('status' in checked) return checked;
      this.defaults = checked;
      this.log({
        agent: 'user',
        type: 'permissions',
        data: { target: 'defaults', permissions: checked, by: 'ui' },
      });
    }
    for (const [id, perm] of Object.entries(p.data.agents ?? {})) {
      if (perm === null) {
        this.own.delete(id);
        this.log({
          agent: 'user',
          type: 'permissions',
          data: { target: id, permissions: null, by: 'ui' },
        });
        continue;
      }
      const checked = this.check(perm);
      if ('status' in checked) return checked;
      this.own.set(id, checked);
      this.log({
        agent: 'user',
        type: 'permissions',
        data: { target: id, permissions: checked, by: 'ui' },
      });
    }
    return { status: 200, body: this.view() };
  }
}
