import { RunLimitsUpdateSchema, type RunLimitsValues, type RunLimitsView } from '@monsters/shared';
import type { RawResponse } from '../transport.ts';

/*
 * `/api/settings/limits` of the mock core (D-064): the limits of each job, with the defaults the
 * core has (`DEFAULT_RUN_LIMITS`). Kept in memory, like the rest of the mock.
 */

const DEFAULTS: RunLimitsValues = {
  maxRunSteps: 150,
  maxRunTokens: 1_500_000,
  maxRunCostUsd: 0.5,
  maxSubagentTokens: 400_000,
  maxDelegationsPerRun: 12,
  plan: { maxRunSteps: 400, maxRunTokens: 5_000_000, maxSubagentTokens: 1_500_000 },
};

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});

export class MockRunLimits {
  private limits: RunLimitsValues = structuredClone(DEFAULTS);

  view(): RunLimitsView {
    return { limits: structuredClone(this.limits), defaults: structuredClone(DEFAULTS) };
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (path !== '/api/settings/limits') return null;
    if (method === 'GET') return { status: 200, body: this.view() };
    if (method === 'DELETE') {
      this.limits = structuredClone(DEFAULTS);
      return { status: 200, body: this.view() };
    }
    if (method !== 'PUT') return fail(405, 'method_not_allowed');
    const p = RunLimitsUpdateSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
    const { plan, ...rest } = p.data;
    this.limits = { ...this.limits, ...rest, plan: { ...this.limits.plan, ...plan } };
    return { status: 200, body: this.view() };
  }
}
