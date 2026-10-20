import { describe, expect, it } from 'vitest';
import {
  claudeRejection,
  parseClaudeRateLimit,
  parseCodexRateLimits,
  resetPhrase,
} from '../src/harness/limits.ts';

const NOW = Date.parse('2026-10-17T15:00:00Z');
const SEC = (ms: number) => Math.floor(ms / 1000);

describe('parseClaudeRateLimit (rate_limit_event of Claude Code 2.1.302)', () => {
  it('reads the session and weekly windows of a complete event', () => {
    const reading = parseClaudeRateLimit({
      type: 'rate_limit_event',
      uuid: 'u',
      session_id: 's',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: SEC(NOW + 92 * 60_000),
        rateLimitType: 'five_hour',
        unifiedWindows: {
          five_hour: { utilization: 0.09, resetsAt: SEC(NOW + 92 * 60_000) },
          seven_day: { utilization: 0.63, resetsAt: SEC(NOW + 3 * 86_400_000) },
        },
        isUsingOverage: false,
      },
    });
    expect(reading).toEqual({
      plan: 'claude',
      partial: true,
      windows: [
        {
          id: 'five_hour',
          usedPercent: 9,
          resetsAt: SEC(NOW + 92 * 60_000) * 1000,
          windowMinutes: 300,
        },
        {
          id: 'seven_day',
          usedPercent: 63,
          resetsAt: SEC(NOW + 3 * 86_400_000) * 1000,
          windowMinutes: 10080,
        },
      ],
    });
  });

  it('takes the per-model weekly windows from the top level', () => {
    const reading = parseClaudeRateLimit({
      rate_limit_info: {
        status: 'allowed_warning',
        resetsAt: SEC(NOW + 86_400_000),
        rateLimitType: 'seven_day_opus',
        utilization: 0.87,
      },
    });
    expect(reading?.windows).toEqual([
      {
        id: 'seven_day_opus',
        usedPercent: 87,
        resetsAt: SEC(NOW + 86_400_000) * 1000,
        windowMinutes: null,
      },
    ]);
  });

  it('reads a bare rate_limit_info too, and a window past 100%', () => {
    const reading = parseClaudeRateLimit({
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 1.04,
      resetsAt: SEC(NOW + 60_000),
    });
    expect(reading?.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 104 });
  });

  it('counts a rejected window with no utilization as full', () => {
    const reading = parseClaudeRateLimit({
      rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1_800_000_000 },
    });
    expect(reading?.windows).toMatchObject([
      { id: 'seven_day', usedPercent: 100, resetsAt: 1_800_000_000_000 },
    ]);
  });

  it('tolerates partial events: a window with no reset, a missing utilization', () => {
    const reading = parseClaudeRateLimit({
      rate_limit_info: {
        status: 'allowed',
        unifiedWindows: { five_hour: { utilization: 0.5 }, seven_day: { resetsAt: 5 } },
      },
    });
    expect(reading?.windows).toEqual([
      { id: 'five_hour', usedPercent: 50, resetsAt: null, windowMinutes: 300 },
    ]);
  });

  it('does not read a window whose utilization arrives as a percentage already', () => {
    const reading = parseClaudeRateLimit({
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 83,
        resetsAt: 1_800_000_000,
      },
    });
    expect(reading?.windows[0]?.usedPercent).toBe(83);
  });

  it('ignores unknown types, overage windows, garbage and nothing', () => {
    expect(
      parseClaudeRateLimit({ rate_limit_info: { status: 'allowed', rateLimitType: 'new_kind' } }),
    ).toBeNull();
    expect(
      parseClaudeRateLimit({
        rate_limit_info: { status: 'allowed', rateLimitType: 'overage', utilization: 0.4 },
      }),
    ).toBeNull();
    expect(
      parseClaudeRateLimit({
        rate_limit_info: {
          status: 'allowed',
          unifiedWindows: { five_hour: { utilization: 'molto', resetsAt: 'presto' } },
        },
      }),
    ).toBeNull();
    for (const bad of [null, undefined, 3, 'x', [], {}, { rate_limit_info: 7 }]) {
      expect(parseClaudeRateLimit(bad)).toBeNull();
    }
  });
});

describe('claudeRejection', () => {
  it('gives the reset time of a refused request, only then', () => {
    expect(
      claudeRejection({ rate_limit_info: { status: 'rejected', resetsAt: 1_800_000_000 } }),
    ).toEqual({ resetsAt: 1_800_000_000_000 });
    expect(claudeRejection({ rate_limit_info: { status: 'rejected' } })).toEqual({
      resetsAt: null,
    });
    expect(claudeRejection({ rate_limit_info: { status: 'allowed' } })).toBeNull();
    expect(claudeRejection(null)).toBeNull();
  });
});

describe('parseCodexRateLimits', () => {
  it('reads account/rateLimits/updated (camelCase, unix seconds)', () => {
    const reading = parseCodexRateLimits(
      {
        rateLimits: {
          primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: 1_800_400_000 },
          credits: null,
          planType: 'plus',
        },
      },
      NOW,
    );
    expect(reading).toEqual({
      plan: 'chatgpt',
      partial: false,
      windows: [
        { id: 'primary', usedPercent: 24, resetsAt: 1_800_000_000_000, windowMinutes: 300 },
        { id: 'secondary', usedPercent: 81, resetsAt: 1_800_400_000_000, windowMinutes: 10080 },
      ],
    });
  });

  it('reads the token_count spelling (snake_case, resets_in_seconds)', () => {
    const reading = parseCodexRateLimits(
      {
        rate_limits: {
          primary: { used_percent: 12.5, window_minutes: 300, resets_in_seconds: 3600 },
          secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1_800_400_000 },
        },
      },
      NOW,
    );
    expect(reading?.windows).toEqual([
      { id: 'primary', usedPercent: 12.5, resetsAt: NOW + 3_600_000, windowMinutes: 300 },
      { id: 'secondary', usedPercent: 40, resetsAt: 1_800_400_000_000, windowMinutes: 10080 },
    ]);
  });

  it('reads one window alone, the snapshot itself and the by-limit-id form', () => {
    expect(
      parseCodexRateLimits({ primary: { usedPercent: 3, windowDurationMins: 300 } }, NOW)?.windows,
    ).toEqual([{ id: 'primary', usedPercent: 3, resetsAt: null, windowMinutes: 300 }]);
    expect(
      parseCodexRateLimits(
        {
          rateLimits: { primary: { usedPercent: 1 } },
          rateLimitsByLimitId: { codex: { secondary: { usedPercent: 9, windowDurationMins: 60 } } },
        },
        NOW,
      )?.windows,
    ).toEqual([{ id: 'secondary', usedPercent: 9, resetsAt: null, windowMinutes: 60 }]);
  });

  it('ignores what has no usable window', () => {
    for (const bad of [null, 5, [], {}, { rateLimits: {} }, { rateLimits: { primary: 'x' } }]) {
      expect(parseCodexRateLimits(bad, NOW)).toBeNull();
    }
    expect(
      parseCodexRateLimits({ rateLimits: { primary: { usedPercent: 'tanto' } } }, NOW),
    ).toBeNull();
  });
});

describe('resetPhrase', () => {
  it('says the hour within the day and the weekday later', () => {
    const soon = new Date(NOW + 2 * 3_600_000);
    expect(resetPhrase(soon.getTime(), NOW)).toMatch(/^alle \d\d:\d\d$/);
    expect(resetPhrase(NOW + 3 * 86_400_000, NOW)).toMatch(/^[a-zà-ù]{3} \d\d:\d\d$/);
  });
});
