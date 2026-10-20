/*
 * Cloud CI status: the latest run of `main` per CI and platform (CircleCI: linux, windows,
 * macos; GitLab.com: linux, windows), read from their APIs. See docs/ci.md.
 *
 *   node scripts/ci-cloud-status.ts [--json]
 *
 * Settings, from the environment or else from `.env` (this checkout's, then the main one's):
 *   CIRCLECI_TOKEN          personal API token (User Settings > Personal API Tokens)
 *   CIRCLECI_PROJECT_SLUG   Project Settings > Overview, e.g. circleci/<org id>/<project id>
 *   GITLAB_TOKEN            token with read_api (project access token or personal)
 *   GITLAB_PROJECT          project path (e.g. owner/monsters) or numeric id
 *   GITLAB_URL              default https://gitlab.com
 * A CI without its settings is reported as not configured and skipped.
 *
 * Exit code: 0 every latest run passed (or is still running), 1 a latest run failed,
 * 2 an API or settings error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export type RunStatus = 'passed' | 'failed' | 'running' | 'canceled' | 'other';

/** The latest run of one platform on one CI. */
export interface CloudRun {
  ci: 'circleci' | 'gitlab';
  platform: string;
  status: RunStatus;
  /** Status as the CI says it (e.g. `success`, `failing`). */
  rawStatus: string;
  /** What started the pipeline: `schedule`, `api`, `web`, … */
  trigger: string;
  commit: string;
  createdAt: string;
  url: string;
}

// --- CircleCI (API v2) ------------------------------------------------------------------------

export interface CirclePipeline {
  id: string;
  number: number;
  created_at: string;
  trigger?: { type?: string };
  vcs?: { revision?: string };
}

export interface CircleWorkflow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export const CIRCLE_PLATFORMS = ['linux', 'windows', 'macos'];

export function circleStatus(status: string): RunStatus {
  if (status === 'success') return 'passed';
  if (['failed', 'error', 'failing', 'unauthorized'].includes(status)) return 'failed';
  if (['running', 'on_hold'].includes(status)) return 'running';
  if (status === 'canceled') return 'canceled';
  return 'other';
}

/**
 * Latest workflow per platform (the workflows are named after it), from pipelines newest
 * first and the workflows of each pipeline.
 */
export function circleRuns(
  slug: string,
  pipelines: CirclePipeline[],
  workflows: ReadonlyMap<string, CircleWorkflow[]>,
): CloudRun[] {
  const runs = new Map<string, CloudRun>();
  for (const pipeline of pipelines) {
    for (const wf of workflows.get(pipeline.id) ?? []) {
      if (!CIRCLE_PLATFORMS.includes(wf.name)) continue;
      const known = runs.get(wf.name);
      if (known && known.createdAt >= wf.created_at) continue;
      runs.set(wf.name, {
        ci: 'circleci',
        platform: wf.name,
        status: circleStatus(wf.status),
        rawStatus: wf.status,
        trigger: pipeline.trigger?.type ?? 'unknown',
        commit: pipeline.vcs?.revision ?? '',
        createdAt: wf.created_at,
        url: `https://app.circleci.com/pipelines/${slug}/${pipeline.number}/workflows/${wf.id}`,
      });
    }
  }
  return CIRCLE_PLATFORMS.flatMap((p) => runs.get(p) ?? []);
}

// --- GitLab (API v4) --------------------------------------------------------------------------

export interface GitlabPipeline {
  id: number;
  sha: string;
  source: string;
  created_at: string;
}

export interface GitlabJob {
  id: number;
  name: string;
  status: string;
  created_at: string;
  web_url: string;
}

export const GITLAB_PLATFORMS = ['linux', 'windows'];

export function gitlabStatus(status: string): RunStatus {
  if (status === 'success') return 'passed';
  if (status === 'failed') return 'failed';
  if (
    ['created', 'pending', 'running', 'preparing', 'waiting_for_resource', 'scheduled'].includes(
      status,
    )
  ) {
    return 'running';
  }
  if (status === 'canceled' || status === 'canceling') return 'canceled';
  return 'other';
}

/** Latest `checks-<platform>` job per platform, from pipelines and their jobs. */
export function gitlabRuns(
  pipelines: GitlabPipeline[],
  jobs: ReadonlyMap<number, GitlabJob[]>,
): CloudRun[] {
  const runs = new Map<string, CloudRun>();
  for (const pipeline of pipelines) {
    for (const job of jobs.get(pipeline.id) ?? []) {
      const platform = job.name.replace(/^checks-/, '');
      if (job.name === platform || !GITLAB_PLATFORMS.includes(platform)) continue;
      // A skipped or manual job never ran: an older run says more.
      if (job.status === 'skipped' || job.status === 'manual') continue;
      const known = runs.get(platform);
      if (known && known.createdAt >= job.created_at) continue;
      runs.set(platform, {
        ci: 'gitlab',
        platform,
        status: gitlabStatus(job.status),
        rawStatus: job.status,
        trigger: pipeline.source,
        commit: pipeline.sha,
        createdAt: job.created_at,
        url: job.web_url,
      });
    }
  }
  return GITLAB_PLATFORMS.flatMap((p) => runs.get(p) ?? []);
}

// --- report -----------------------------------------------------------------------------------

const LABEL: Record<RunStatus, string> = {
  passed: 'verde',
  failed: 'ROSSO',
  running: 'in corso',
  canceled: 'annullato',
  other: 'altro',
};

/** One line per run: `circleci  linux    verde     schedule  1a2b3c4  15/10 02:07  <url>`. */
export function formatRuns(runs: CloudRun[]): string {
  return runs
    .map((r) => {
      const d = new Date(r.createdAt);
      const when = Number.isNaN(d.getTime())
        ? r.createdAt
        : d.toLocaleString('it-IT', {
            timeZone: 'Europe/Rome',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
      const status = r.status === 'other' ? r.rawStatus : LABEL[r.status];
      return [
        r.ci.padEnd(9),
        r.platform.padEnd(8),
        status.padEnd(10),
        r.trigger.padEnd(9),
        (r.commit.slice(0, 7) || '-').padEnd(8),
        when.padEnd(13),
        r.url,
      ].join(' ');
    })
    .join('\n');
}

export function exitCode(runs: CloudRun[]): number {
  return runs.some((r) => r.status === 'failed') ? 1 : 0;
}

// --- settings and HTTP ------------------------------------------------------------------------

/** Settings: the environment wins over `.env` files, the first file over the next. */
export function loadSettings(
  env: NodeJS.ProcessEnv,
  envFiles: string[],
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  for (const file of [...envFiles].reverse()) {
    if (existsSync(file)) Object.assign(merged, parseEnv(readFileSync(file, 'utf8')));
  }
  for (const [key, value] of Object.entries(env)) if (value) merged[key] = value;
  return merged;
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} on ${url}`);
  return (await response.json()) as T;
}

/** Pipelines of `main` until every platform has a workflow (at most 3 pages). */
async function fetchCircle(token: string, slug: string): Promise<CloudRun[]> {
  const api = 'https://circleci.com/api/v2';
  const headers = { 'Circle-Token': token };
  const pipelines: CirclePipeline[] = [];
  const workflows = new Map<string, CircleWorkflow[]>();
  let pageToken: string | null = null;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ branch: 'main' });
    if (pageToken) query.set('page-token', pageToken);
    const body: { items: CirclePipeline[]; next_page_token: string | null } = await getJson(
      `${api}/project/${slug}/pipeline?${query.toString()}`,
      headers,
    );
    for (const pipeline of body.items) {
      const wf = await getJson<{ items: CircleWorkflow[] }>(
        `${api}/pipeline/${pipeline.id}/workflow`,
        headers,
      );
      pipelines.push(pipeline);
      workflows.set(pipeline.id, wf.items);
    }
    if (circleRuns(slug, pipelines, workflows).length === CIRCLE_PLATFORMS.length) break;
    pageToken = body.next_page_token;
    if (!pageToken) break;
  }
  return circleRuns(slug, pipelines, workflows);
}

async function fetchGitlab(token: string, project: string, base: string): Promise<CloudRun[]> {
  const api = `${base.replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(project)}`;
  const headers = { 'PRIVATE-TOKEN': token };
  const pipelines = await getJson<GitlabPipeline[]>(
    `${api}/pipelines?ref=main&per_page=20&order_by=id&sort=desc`,
    headers,
  );
  const jobs = new Map<number, GitlabJob[]>();
  for (const pipeline of pipelines) {
    jobs.set(
      pipeline.id,
      await getJson<GitlabJob[]>(`${api}/pipelines/${pipeline.id}/jobs?per_page=50`, headers),
    );
    if (gitlabRuns(pipelines, jobs).length === GITLAB_PLATFORMS.length) break;
  }
  return gitlabRuns(pipelines, jobs);
}

function envFiles(): string[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = [join(root, '.env')];
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    files.push(join(dirname(common), '.env'));
  } catch {
    // Not a git checkout: this folder's .env only.
  }
  return [...new Set(files)];
}

async function main(): Promise<number> {
  const json = process.argv.includes('--json');
  const s = loadSettings(process.env, envFiles());
  const runs: CloudRun[] = [];
  let failed = false;
  const jobs: [string, (() => Promise<CloudRun[]>) | null][] = [
    [
      'circleci',
      s['CIRCLECI_TOKEN'] && s['CIRCLECI_PROJECT_SLUG']
        ? () => fetchCircle(s['CIRCLECI_TOKEN'] ?? '', s['CIRCLECI_PROJECT_SLUG'] ?? '')
        : null,
    ],
    [
      'gitlab',
      s['GITLAB_TOKEN'] && s['GITLAB_PROJECT']
        ? () =>
            fetchGitlab(
              s['GITLAB_TOKEN'] ?? '',
              s['GITLAB_PROJECT'] ?? '',
              s['GITLAB_URL'] ?? 'https://gitlab.com',
            )
        : null,
    ],
  ];
  for (const [ci, fetchRuns] of jobs) {
    if (!fetchRuns) {
      if (!json) console.warn(`${ci}: non configurato (vedi docs/ci.md)`);
      continue;
    }
    try {
      const found = await fetchRuns();
      if (found.length === 0 && !json) console.warn(`${ci}: nessuna run di main`);
      runs.push(...found);
    } catch (error) {
      failed = true;
      console.error(`${ci}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (json) process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
  else if (runs.length > 0) process.stdout.write(`${formatRuns(runs)}\n`);
  return failed ? 2 : exitCode(runs);
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(String(error));
      process.exit(2);
    },
  );
}
