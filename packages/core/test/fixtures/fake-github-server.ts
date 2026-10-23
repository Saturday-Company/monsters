/*
 * A fake GitHub MCP server (never the real service): ~90 tools named like the real GitHub MCP
 * server (snake_case, verb first) on 127.0.0.1, Streamable HTTP, POST only, every request needs
 * the personal token as a bearer (no OAuth). Hints as the real server sets them: reads
 * `readOnlyHint: true`, writes `readOnlyHint: false`, delete/merge/close-like tools
 * `destructiveHint: true`.
 *
 * Behind the main tools lives one repo, `acme/website`, with 40 issues (open and closed, labels
 * bug/enhancement/docs, long bodies) and a few comments each: `list_issues` without filters is
 * a long result (well over 10,000 characters), with `state`, `labels` or `query` a short one.
 * The tools that are not data-backed answer a plausible small JSON.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

// --- the data ----------------------------------------------------------------------------

export interface GithubComment {
  id: number;
  user: string;
  body: string;
  created_at: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  user: string;
  assignees: string[];
  body: string;
  created_at: string;
  comments: number;
}

const USERS = ['mrossi', 'lbianchi', 'sverdi', 'jcarter', 'priya-n', 'tkowalski'];

/** [title, labels, state] of the 40 issues, in order (number = index + 1). */
const ISSUE_SEEDS: [string, string[], 'open' | 'closed'][] = [
  ['Navbar overlaps the hero image on tablets', ['bug'], 'open'],
  ['Add dark mode toggle', ['enhancement'], 'open'],
  ['Document the local development setup', ['docs'], 'open'],
  ['Contact form sends the email twice', ['bug'], 'closed'],
  ['Lazy-load images below the fold', ['enhancement'], 'open'],
  ['Footer links are broken in the Italian locale', ['bug'], 'open'],
  ['Explain the release process in CONTRIBUTING', ['docs'], 'closed'],
  ['Support RSS feed for the blog', ['enhancement'], 'open'],
  ['Search box ignores accented characters', ['bug'], 'open'],
  ['Upgrade to the latest Node LTS in CI', ['enhancement'], 'closed'],
  ['Typo in the pricing page copy', ['docs', 'bug'], 'closed'],
  ['Cookie banner reappears after every page load', ['bug'], 'open'],
  ['Add a sitemap.xml generator', ['enhancement'], 'open'],
  ['Write an architecture overview for new contributors', ['docs'], 'open'],
  ['Login button is misaligned on mobile', ['bug'], 'closed'],
  ['Add SSO login option for enterprise customers', ['enhancement'], 'open'],
  ['Login page redirects to 404 after sign-in', ['bug'], 'open'],
  ['Blog pagination skips page 3', ['bug'], 'open'],
  ['Improve color contrast of secondary buttons', ['enhancement'], 'open'],
  ['Add alt text guidelines to the style guide', ['docs'], 'open'],
  ['Newsletter signup returns a 500 on empty email', ['bug'], 'closed'],
  ['Preload web fonts to avoid layout shift', ['enhancement'], 'open'],
  ['Dropdown menu cannot be closed with Escape', ['bug'], 'open'],
  ['Document the environment variables', ['docs'], 'closed'],
  ['Add a keyboard shortcut to open the search', ['enhancement'], 'open'],
  ['Open Graph image is cropped on LinkedIn', ['bug'], 'open'],
  ['Migrate the stylesheet build to Lightning CSS', ['enhancement'], 'closed'],
  ['Team page photos are not square', ['bug'], 'closed'],
  ['Add a changelog page', ['enhancement', 'docs'], 'open'],
  ['Mobile menu animation stutters on Android', ['bug'], 'open'],
  ['Explain how translations are managed', ['docs'], 'open'],
  ['Add print styles for case studies', ['enhancement'], 'open'],
  ['Case study video autoplays with sound', ['bug'], 'open'],
  ['Show reading time on blog posts', ['enhancement'], 'closed'],
  ['Broken anchor links in the FAQ', ['bug'], 'closed'],
  ['Add a troubleshooting section to the README', ['docs'], 'open'],
  ['Allow filtering case studies by industry', ['enhancement'], 'open'],
  ['Footer year is hardcoded', ['bug'], 'open'],
  ['Add structured data for articles', ['enhancement'], 'open'],
  ['Clarify the browser support policy', ['docs'], 'closed'],
];

const FILLER = [
  'I noticed this while testing the staging build on a clean profile.',
  'It happens every time, not only after a hard refresh, and it also happens in a private window.',
  'I checked the console and there is nothing unusual, no failed requests and no warnings.',
  'This was reported by two customers this week, so it is probably worth a look soon.',
  'I am not sure if this is a regression, it looks like it was already like this a few releases ago.',
  'Happy to help with a fix if someone can point me to the right part of the codebase.',
  'Related discussion happened in the team chat last month, but nothing was written down.',
  'The design team confirmed that the current behavior is not what was agreed in the mockups.',
];

function bodyOf(i: number, title: string, labels: string[]): string {
  const filler = Array.from({ length: 3 }, (_, k) => FILLER[(i * 3 + k * 5) % FILLER.length]);
  const kind = labels.includes('bug')
    ? [
        '### Steps to reproduce',
        '1. Open the site on the staging environment.',
        '2. Follow the flow described in the title.',
        '3. Watch what happens next.',
        '',
        '### Expected behavior',
        'The page behaves as in the design and the user can continue without errors.',
        '',
        '### Actual behavior',
        'The behavior described in the title: the user gets stuck and has to reload.',
      ]
    : labels.includes('docs')
      ? [
          '### What is missing',
          'New contributors keep asking about this in the chat; a short section would save everyone time.',
          '',
          '### Proposal',
          'Add a page under docs/ with the essentials and link it from the README.',
        ]
      : [
          '### Motivation',
          'This would make the site easier to use and is a common request from visitors.',
          '',
          '### Proposal',
          'Implement it behind a small component and cover it with a test; no new dependency needed.',
        ];
  return [
    `${title}.`,
    '',
    ...kind,
    '',
    '### Notes',
    ...filler,
    `Environment: staging, build ${1000 + i}.`,
  ].join('\n');
}

const LOGIN_NUMBER = ISSUE_SEEDS.findIndex(([t]) => t.startsWith('Login page redirects')) + 1;

const LOGIN_COMMENTS = [
  'Reproduced on Chrome and Firefox. After signing in, the URL becomes /dashboard/ with a trailing slash and the router has no route for it.',
  'The redirect target comes from the `next` query parameter. When it is empty we fall back to `/home`, which was removed in the last release. That is the 404.',
  'Confirmed: changing the fallback to `/dashboard` fixes it locally. I will open a PR, but we should also add a test for the empty `next` case.',
];

const issueDate = (i: number) =>
  `2026-0${1 + (i % 9)}-${String((i % 27) + 1).padStart(2, '0')}T10:00:00Z`;

/** The fake company: one repo, its issues and their comments, by issue number. */
export const GITHUB_DATA = (() => {
  const owner = 'acme';
  const repo = 'website';
  const issues: GithubIssue[] = ISSUE_SEEDS.map(([title, labels, state], idx) => {
    const number = idx + 1;
    return {
      number,
      title,
      state,
      labels,
      user: USERS[idx % USERS.length]!,
      assignees: idx % 4 === 0 ? [USERS[(idx + 2) % USERS.length]!] : [],
      body: bodyOf(idx, title, labels),
      created_at: issueDate(idx),
      comments: number === LOGIN_NUMBER ? 3 : 1 + (idx % 3),
    };
  });
  const comments: Record<number, GithubComment[]> = {};
  for (const issue of issues) {
    comments[issue.number] = Array.from({ length: issue.comments }, (_, k) => ({
      id: issue.number * 100 + k,
      user: USERS[(issue.number + k + 1) % USERS.length]!,
      body:
        issue.number === LOGIN_NUMBER
          ? LOGIN_COMMENTS[k]!
          : `${FILLER[(issue.number + k * 2) % FILLER.length]} ${FILLER[(issue.number + k * 3 + 1) % FILLER.length]}`,
      created_at: issueDate(issue.number + k + 1),
    }));
  }
  return { owner, repo, fullName: `${owner}/${repo}`, issues, comments, loginIssue: LOGIN_NUMBER };
})();

export interface GithubCall {
  tool: string;
  args: Record<string, unknown>;
}

// --- the tools ---------------------------------------------------------------------------

type Kind = 'read' | 'write' | 'destructive';
type Shape = Record<string, z.ZodType>;

interface ToolSpec {
  name: string;
  description: string;
  kind: Kind;
  shape: Shape;
}

const owner = z.string().describe('Repository owner (user or organization)');
const repo = z.string().describe('Repository name');
const page = z.number().int().min(1).optional().describe('Page number for pagination (min 1)');
const perPage = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Results per page for pagination (min 1, max 100)');
const REPO = { owner, repo };
const PAGING = { page, perPage };
const issueNumber = z.number().int().min(1).describe('The number of the issue');
const pullNumber = z.number().int().min(1).describe('The number of the pull request');
const labelsFilter = z.array(z.string()).optional().describe('Filter by label names');
const state3 = z.enum(['open', 'closed', 'all']).optional().describe('Filter by state');
const sort = (...values: [string, ...string[]]) =>
  z.enum(values).optional().describe('Field to sort by');
const direction = z.enum(['asc', 'desc']).optional().describe('Sort direction');
const ref = z
  .string()
  .optional()
  .describe('Branch, tag or commit SHA (default: the default branch)');
const text = (d: string) => z.string().describe(d);
const opt = (d: string) => z.string().optional().describe(d);
const num = (d: string) => z.number().int().min(1).describe(d);

/** [name, description, kind, shape]; the descriptions are written like the real server's. */
const T = (name: string, kind: Kind, description: string, shape: Shape): ToolSpec => ({
  name,
  kind,
  description,
  shape,
});

export const GITHUB_TOOL_SPECS: ToolSpec[] = [
  // issues
  T(
    'list_issues',
    'read',
    'List issues in a GitHub repository. Returns the issues with number, title, state, labels, author, assignees, body and comment count, newest first, paginated.',
    {
      ...REPO,
      state: state3,
      labels: labelsFilter,
      assignee: opt('Filter by assignee login'),
      since: opt('Only issues updated after this ISO 8601 timestamp'),
      sort: sort('created', 'updated', 'comments'),
      direction,
      ...PAGING,
    },
  ),
  T(
    'get_issue',
    'read',
    'Get the details of a specific issue in a GitHub repository, including its body, labels and assignees (comments are fetched with list_issue_comments).',
    { ...REPO, issue_number: issueNumber },
  ),
  T(
    'create_issue',
    'write',
    'Create a new issue in a GitHub repository with a title, an optional body, labels, assignees and milestone.',
    {
      ...REPO,
      title: text('Issue title'),
      body: opt('Issue body content (Markdown)'),
      labels: z.array(z.string()).optional().describe('Labels to apply to the issue'),
      assignees: z.array(z.string()).optional().describe('Logins to assign to the issue'),
      milestone: z.number().int().optional().describe('Milestone number'),
    },
  ),
  T(
    'update_issue',
    'write',
    'Update an existing issue: change its title, body, state, labels, assignees or milestone.',
    {
      ...REPO,
      issue_number: issueNumber,
      title: opt('New title'),
      body: opt('New body'),
      state: z.enum(['open', 'closed']).optional().describe('New state'),
      labels: z.array(z.string()).optional().describe('Replace the labels'),
      assignees: z.array(z.string()).optional().describe('Replace the assignees'),
    },
  ),
  T(
    'add_issue_comment',
    'write',
    'Add a comment to a specific issue or pull request in a GitHub repository.',
    { ...REPO, issue_number: issueNumber, body: text('Comment content (Markdown)') },
  ),
  T(
    'list_issue_comments',
    'read',
    'List the comments of a specific issue in a GitHub repository, oldest first, paginated.',
    {
      ...REPO,
      issue_number: issueNumber,
      since: opt('Only comments after this ISO 8601 timestamp'),
      ...PAGING,
    },
  ),
  T(
    'search_issues',
    'read',
    'Search for issues and pull requests across GitHub repositories using the GitHub search syntax (for example "repo:acme/website is:open label:bug login").',
    {
      query: text('Search query using the GitHub issues search syntax'),
      sort: sort('comments', 'reactions', 'created', 'updated'),
      order: direction,
      ...PAGING,
    },
  ),
  T(
    'close_issue',
    'destructive',
    'Close an issue, optionally with a reason (completed or not planned).',
    {
      ...REPO,
      issue_number: issueNumber,
      reason: z.enum(['completed', 'not_planned']).optional().describe('Why the issue is closed'),
    },
  ),
  T('reopen_issue', 'write', 'Reopen a closed issue.', { ...REPO, issue_number: issueNumber }),
  T('lock_issue', 'write', 'Lock the conversation of an issue so only collaborators can comment.', {
    ...REPO,
    issue_number: issueNumber,
    lock_reason: z
      .enum(['off-topic', 'too heated', 'resolved', 'spam'])
      .optional()
      .describe('Reason for locking'),
  }),
  T('unlock_issue', 'write', 'Unlock the conversation of an issue.', {
    ...REPO,
    issue_number: issueNumber,
  }),
  T('assign_issue', 'write', 'Assign one or more users to an issue.', {
    ...REPO,
    issue_number: issueNumber,
    assignees: z.array(z.string()).min(1).describe('Logins to assign'),
  }),
  T('add_labels_to_issue', 'write', 'Add labels to an issue without removing the existing ones.', {
    ...REPO,
    issue_number: issueNumber,
    labels: z.array(z.string()).min(1).describe('Label names to add'),
  }),
  T('remove_label_from_issue', 'destructive', 'Remove a label from an issue.', {
    ...REPO,
    issue_number: issueNumber,
    label: text('Label name to remove'),
  }),
  T(
    'list_issue_events',
    'read',
    'List the timeline events of an issue (labeled, assigned, closed, referenced...).',
    { ...REPO, issue_number: issueNumber, ...PAGING },
  ),
  // pull requests
  T(
    'list_pull_requests',
    'read',
    'List pull requests in a GitHub repository, with filters by state, head and base branch.',
    {
      ...REPO,
      state: state3,
      head: opt('Filter by head user/org and branch (user:branch)'),
      base: opt('Filter by base branch'),
      sort: sort('created', 'updated', 'popularity', 'long-running'),
      direction,
      ...PAGING,
    },
  ),
  T(
    'get_pull_request',
    'read',
    'Get the details of a specific pull request: title, body, state, branches, mergeability and counts of commits and changed files.',
    { ...REPO, pullNumber },
  ),
  T(
    'create_pull_request',
    'write',
    'Create a new pull request from a head branch to a base branch.',
    {
      ...REPO,
      title: text('Pull request title'),
      head: text('The branch that contains the changes'),
      base: text('The branch to merge into'),
      body: opt('Pull request description (Markdown)'),
      draft: z.boolean().optional().describe('Open as a draft'),
      maintainer_can_modify: z
        .boolean()
        .optional()
        .describe('Allow maintainers to push to the branch'),
    },
  ),
  T(
    'update_pull_request',
    'write',
    'Update the title, body, base branch or state of an existing pull request.',
    {
      ...REPO,
      pullNumber,
      title: opt('New title'),
      body: opt('New description'),
      base: opt('New base branch'),
      state: z.enum(['open', 'closed']).optional().describe('New state'),
    },
  ),
  T(
    'merge_pull_request',
    'destructive',
    'Merge a pull request into its base branch with a merge commit, squash or rebase.',
    {
      ...REPO,
      pullNumber,
      merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method'),
      commit_title: opt('Title of the merge commit'),
      commit_message: opt('Extra detail for the merge commit'),
    },
  ),
  T('close_pull_request', 'destructive', 'Close a pull request without merging it.', {
    ...REPO,
    pullNumber,
  }),
  T('get_pull_request_diff', 'read', 'Get the unified diff of a pull request.', {
    ...REPO,
    pullNumber,
  }),
  T(
    'get_pull_request_files',
    'read',
    'List the files changed by a pull request, with additions and deletions per file.',
    { ...REPO, pullNumber, ...PAGING },
  ),
  T('list_pull_request_reviews', 'read', 'List the reviews submitted on a pull request.', {
    ...REPO,
    pullNumber,
    ...PAGING,
  }),
  T(
    'create_pull_request_review',
    'write',
    'Submit a review on a pull request: approve, request changes or comment.',
    {
      ...REPO,
      pullNumber,
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('The review action'),
      body: opt('Review summary'),
    },
  ),
  T(
    'list_pull_request_comments',
    'read',
    'List the review comments on the diff of a pull request.',
    { ...REPO, pullNumber, ...PAGING },
  ),
  T(
    'add_pull_request_review_comment',
    'write',
    'Add an inline review comment on a line of a pull request diff.',
    {
      ...REPO,
      pullNumber,
      body: text('Comment text'),
      path: text('File path relative to the repo root'),
      line: num('Line number in the diff'),
    },
  ),
  T('request_reviewers', 'write', 'Request reviews on a pull request from users or teams.', {
    ...REPO,
    pullNumber,
    reviewers: z.array(z.string()).optional().describe('User logins'),
    team_reviewers: z.array(z.string()).optional().describe('Team slugs'),
  }),
  T(
    'get_pull_request_status',
    'read',
    'Get the combined status of the checks of a pull request head commit.',
    { ...REPO, pullNumber },
  ),
  // branches
  T('list_branches', 'read', 'List the branches of a GitHub repository.', {
    ...REPO,
    protected: z.boolean().optional().describe('Only protected branches'),
    ...PAGING,
  }),
  T(
    'get_branch',
    'read',
    'Get the details of a branch, including its head commit and protection status.',
    { ...REPO, branch: text('Branch name') },
  ),
  T('create_branch', 'write', 'Create a new branch in a GitHub repository from an existing ref.', {
    ...REPO,
    branch: text('Name for the new branch'),
    from_branch: opt('Source branch (default: the default branch)'),
  }),
  T('delete_branch', 'destructive', 'Delete a branch from a GitHub repository.', {
    ...REPO,
    branch: text('Branch name to delete'),
  }),
  // files and code
  T(
    'get_file_contents',
    'read',
    'Get the contents of a file or the listing of a directory in a GitHub repository.',
    { ...REPO, path: text('Path to the file or directory (default: the repo root)'), ref },
  ),
  T(
    'create_or_update_file',
    'write',
    'Create or update a single file in a GitHub repository with a commit. Updating needs the blob SHA of the current file.',
    {
      ...REPO,
      path: text('Path where to create or update the file'),
      content: text('Content of the file'),
      message: text('Commit message'),
      branch: text('Branch to commit to'),
      sha: opt('Blob SHA of the file being replaced (required to update)'),
    },
  ),
  T('delete_file', 'destructive', 'Delete a file from a GitHub repository with a commit.', {
    ...REPO,
    path: text('Path of the file to delete'),
    message: text('Commit message'),
    branch: text('Branch to commit to'),
    sha: text('Blob SHA of the file being deleted'),
  }),
  T('push_files', 'write', 'Push several files to a GitHub repository in a single commit.', {
    ...REPO,
    branch: text('Branch to push to'),
    message: text('Commit message'),
    files: z
      .array(z.object({ path: z.string(), content: z.string() }))
      .min(1)
      .describe('Files to push'),
  }),
  T(
    'search_code',
    'read',
    'Search for code across GitHub repositories (for example "addClass repo:acme/website language:js").',
    {
      query: text('Search query using the GitHub code search syntax'),
      sort: sort('indexed'),
      order: direction,
      ...PAGING,
    },
  ),
  T(
    'get_repository_tree',
    'read',
    'Get the file tree of a repository at a ref, optionally recursive.',
    {
      ...REPO,
      tree_sha: opt('Tree SHA or branch name'),
      recursive: z.boolean().optional().describe('Walk subdirectories'),
      path_filter: opt('Only paths starting with this prefix'),
    },
  ),
  // commits and tags
  T('list_commits', 'read', 'List the commits of a branch in a GitHub repository, newest first.', {
    ...REPO,
    sha: opt('Branch name or commit SHA to start from'),
    author: opt('Filter by author login or email'),
    path: opt('Only commits touching this path'),
    since: opt('Only commits after this ISO 8601 timestamp'),
    ...PAGING,
  }),
  T(
    'get_commit',
    'read',
    'Get the details of a commit: message, author, stats and changed files.',
    {
      ...REPO,
      sha: text('Commit SHA, branch or tag name'),
      include_diff: z.boolean().optional().describe('Include the file diffs'),
    },
  ),
  T(
    'compare_commits',
    'read',
    'Compare two commits, branches or tags and list the commits and files between them.',
    { ...REPO, base: text('Base ref'), head: text('Head ref') },
  ),
  T('list_tags', 'read', 'List the git tags of a GitHub repository.', { ...REPO, ...PAGING }),
  T('create_tag', 'write', 'Create a lightweight git tag on a commit.', {
    ...REPO,
    tag: text('Tag name'),
    sha: text('Commit SHA to tag'),
  }),
  T('delete_tag', 'destructive', 'Delete a git tag from a GitHub repository.', {
    ...REPO,
    tag: text('Tag name to delete'),
  }),
  // releases
  T('list_releases', 'read', 'List the releases of a GitHub repository.', { ...REPO, ...PAGING }),
  T('get_release', 'read', 'Get a release by its tag name, with notes and assets.', {
    ...REPO,
    tag: text('Tag of the release'),
  }),
  T(
    'get_latest_release',
    'read',
    'Get the latest published, non-prerelease release of a repository.',
    { ...REPO },
  ),
  T(
    'create_release',
    'write',
    'Create a release for a tag, with notes, optionally as a draft or prerelease.',
    {
      ...REPO,
      tag_name: text('Tag name'),
      name: opt('Release title'),
      body: opt('Release notes (Markdown)'),
      draft: z.boolean().optional().describe('Create as a draft'),
      prerelease: z.boolean().optional().describe('Mark as a prerelease'),
      target_commitish: opt('Branch or commit the tag is created from'),
      generate_release_notes: z.boolean().optional().describe('Generate the notes automatically'),
    },
  ),
  T('update_release', 'write', 'Update the title, notes or flags of a release.', {
    ...REPO,
    release_id: num('Release id'),
    name: opt('New title'),
    body: opt('New notes'),
    draft: z.boolean().optional().describe('Draft flag'),
    prerelease: z.boolean().optional().describe('Prerelease flag'),
  }),
  T('delete_release', 'destructive', 'Delete a release (the git tag stays).', {
    ...REPO,
    release_id: num('Release id'),
  }),
  // labels
  T('list_labels', 'read', 'List the labels of a GitHub repository.', { ...REPO, ...PAGING }),
  T('get_label', 'read', 'Get a label of a repository by name.', {
    ...REPO,
    name: text('Label name'),
  }),
  T('create_label', 'write', 'Create a label in a GitHub repository.', {
    ...REPO,
    name: text('Label name'),
    color: opt('Hex color without #'),
    description: opt('Short description'),
  }),
  T('update_label', 'write', 'Update the name, color or description of a label.', {
    ...REPO,
    name: text('Current label name'),
    new_name: opt('New name'),
    color: opt('Hex color without #'),
    description: opt('Short description'),
  }),
  T(
    'delete_label',
    'destructive',
    'Delete a label from a GitHub repository; it is removed from every issue.',
    { ...REPO, name: text('Label name') },
  ),
  // milestones
  T('list_milestones', 'read', 'List the milestones of a GitHub repository.', {
    ...REPO,
    state: state3,
    sort: sort('due_on', 'completeness'),
    direction,
    ...PAGING,
  }),
  T(
    'get_milestone',
    'read',
    'Get a milestone by its number, with the counts of open and closed issues.',
    { ...REPO, milestone_number: num('Milestone number') },
  ),
  T('create_milestone', 'write', 'Create a milestone in a GitHub repository.', {
    ...REPO,
    title: text('Milestone title'),
    description: opt('Description'),
    due_on: opt('Due date, ISO 8601'),
  }),
  T(
    'update_milestone',
    'write',
    'Update the title, description, due date or state of a milestone.',
    {
      ...REPO,
      milestone_number: num('Milestone number'),
      title: opt('New title'),
      description: opt('New description'),
      due_on: opt('New due date'),
      state: z.enum(['open', 'closed']).optional().describe('New state'),
    },
  ),
  T('delete_milestone', 'destructive', 'Delete a milestone from a GitHub repository.', {
    ...REPO,
    milestone_number: num('Milestone number'),
  }),
  // actions
  T('list_workflows', 'read', 'List the GitHub Actions workflows of a repository.', {
    ...REPO,
    ...PAGING,
  }),
  T(
    'list_workflow_runs',
    'read',
    'List the runs of a workflow, with filters by branch, event and status.',
    {
      ...REPO,
      workflow_id: text('Workflow id or file name'),
      branch: opt('Filter by branch'),
      event: opt('Filter by event (push, pull_request...)'),
      status: z
        .enum(['queued', 'in_progress', 'completed', 'success', 'failure'])
        .optional()
        .describe('Filter by status'),
      ...PAGING,
    },
  ),
  T('get_workflow_run', 'read', 'Get the details of a workflow run.', {
    ...REPO,
    run_id: num('Run id'),
  }),
  T(
    'list_workflow_jobs',
    'read',
    'List the jobs of a workflow run, with their steps and conclusions.',
    { ...REPO, run_id: num('Run id'), ...PAGING },
  ),
  T('get_workflow_run_logs', 'read', 'Get the download URL of the logs of a workflow run.', {
    ...REPO,
    run_id: num('Run id'),
  }),
  T(
    'run_workflow',
    'write',
    'Trigger a workflow with a workflow_dispatch event on a ref, with optional inputs.',
    {
      ...REPO,
      workflow_id: text('Workflow id or file name'),
      ref: text('Branch or tag to run on'),
      inputs: z.record(z.string(), z.string()).optional().describe('Workflow inputs'),
    },
  ),
  T('rerun_workflow_run', 'write', 'Re-run a workflow run, or only its failed jobs.', {
    ...REPO,
    run_id: num('Run id'),
    failed_only: z.boolean().optional().describe('Only re-run the failed jobs'),
  }),
  T('cancel_workflow_run', 'destructive', 'Cancel a workflow run that is in progress.', {
    ...REPO,
    run_id: num('Run id'),
  }),
  // notifications
  T(
    'list_notifications',
    'read',
    'List the notifications of the authenticated user, with filters by repository and read state.',
    {
      all: z.boolean().optional().describe('Include read notifications'),
      participating: z.boolean().optional().describe('Only where you are directly involved'),
      since: opt('Only notifications updated after this ISO 8601 timestamp'),
      owner: opt('Only of this repository owner'),
      repo: opt('Only of this repository'),
      ...PAGING,
    },
  ),
  T('mark_notification_read', 'write', 'Mark a notification thread as read.', {
    thread_id: text('Notification thread id'),
  }),
  T(
    'mark_all_notifications_read',
    'write',
    'Mark all notifications as read, optionally only those of a repository.',
    {
      owner: opt('Repository owner'),
      repo: opt('Repository name'),
      last_read_at: opt('Timestamp up to which they are marked, ISO 8601'),
    },
  ),
  // users and repositories
  T(
    'get_me',
    'read',
    'Get the profile of the authenticated user: login, name, email, plan and counts.',
    {},
  ),
  T('get_user', 'read', 'Get the public profile of a GitHub user.', {
    username: text('User login'),
  }),
  T('search_users', 'read', 'Search for GitHub users by login, name or email.', {
    query: text('Search query'),
    sort: sort('followers', 'repositories', 'joined'),
    order: direction,
    ...PAGING,
  }),
  T(
    'list_repositories',
    'read',
    'List the repositories of a user or organization, or of the authenticated user.',
    {
      owner: opt('User or organization (default: you)'),
      type: z
        .enum(['all', 'owner', 'member', 'public', 'private'])
        .optional()
        .describe('Kind of repositories'),
      sort: sort('created', 'updated', 'pushed', 'full_name'),
      direction,
      ...PAGING,
    },
  ),
  T(
    'get_repository',
    'read',
    'Get the details of a repository: description, default branch, topics, counts and visibility.',
    { ...REPO },
  ),
  T(
    'search_repositories',
    'read',
    'Search for GitHub repositories by name, topic, language or stars.',
    {
      query: text('Search query using the GitHub repository search syntax'),
      sort: sort('stars', 'forks', 'help-wanted-issues', 'updated'),
      order: direction,
      ...PAGING,
    },
  ),
  T(
    'create_repository',
    'write',
    'Create a new GitHub repository in your account or an organization.',
    {
      name: text('Repository name'),
      description: opt('Short description'),
      private: z.boolean().optional().describe('Make it private'),
      auto_init: z.boolean().optional().describe('Initialize with a README'),
      organization: opt('Organization to create it in'),
    },
  ),
  T('fork_repository', 'write', 'Fork a repository to your account or an organization.', {
    ...REPO,
    organization: opt('Organization to fork into (default: your account)'),
  }),
  T('star_repository', 'write', 'Star a repository for the authenticated user.', { ...REPO }),
  T('unstar_repository', 'write', 'Remove the star of a repository for the authenticated user.', {
    ...REPO,
  }),
  T(
    'list_starred_repositories',
    'read',
    'List the repositories starred by a user (default: you).',
    { username: opt('User login'), sort: sort('created', 'updated'), direction, ...PAGING },
  ),
  T('delete_repository', 'destructive', 'Permanently delete a repository. This cannot be undone.', {
    ...REPO,
  }),
  // collaborators, gists, security
  T(
    'list_collaborators',
    'read',
    'List the collaborators of a repository with their permissions.',
    { ...REPO, ...PAGING },
  ),
  T('add_collaborator', 'write', 'Invite a user to collaborate on a repository.', {
    ...REPO,
    username: text('User login'),
    permission: z
      .enum(['pull', 'triage', 'push', 'maintain', 'admin'])
      .optional()
      .describe('Permission level'),
  }),
  T('remove_collaborator', 'destructive', 'Remove a collaborator from a repository.', {
    ...REPO,
    username: text('User login'),
  }),
  T('list_gists', 'read', 'List the gists of a user (default: you).', {
    username: opt('User login'),
    since: opt('Only gists updated after this ISO 8601 timestamp'),
    ...PAGING,
  }),
  T('create_gist', 'write', 'Create a gist with one or more files.', {
    description: opt('Gist description'),
    public: z.boolean().optional().describe('Make it public'),
    files: z.record(z.string(), z.string()).describe('File names and contents'),
  }),
  T('list_dependabot_alerts', 'read', 'List the Dependabot security alerts of a repository.', {
    ...REPO,
    state: z.enum(['open', 'fixed', 'dismissed']).optional().describe('Filter by state'),
    severity: z
      .enum(['low', 'medium', 'high', 'critical'])
      .optional()
      .describe('Filter by severity'),
    ...PAGING,
  }),
  T('list_code_scanning_alerts', 'read', 'List the code scanning alerts of a repository.', {
    ...REPO,
    state: z.enum(['open', 'fixed', 'dismissed']).optional().describe('Filter by state'),
    ref,
    ...PAGING,
  }),
  T('list_secret_scanning_alerts', 'read', 'List the secret scanning alerts of a repository.', {
    ...REPO,
    state: z.enum(['open', 'resolved']).optional().describe('Filter by state'),
    ...PAGING,
  }),
  T('list_discussions', 'read', 'List the discussions of a repository.', {
    ...REPO,
    category: opt('Discussion category'),
    ...PAGING,
  }),
];

/** The names of the fake's tools and their hints, for the eval (`readOnly` is `readOnlyHint`). */
export const GITHUB_TOOLS: { name: string; readOnly: boolean; destructive: boolean }[] =
  GITHUB_TOOL_SPECS.map((s) => ({
    name: s.name,
    readOnly: s.kind === 'read',
    destructive: s.kind === 'destructive',
  }));

// --- the behavior ------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function issueView(i: GithubIssue) {
  return { ...i, url: `https://github.com/${GITHUB_DATA.fullName}/issues/${i.number}` };
}

/** `repo:`/`is:`/`label:` qualifiers and free words of a search query, over title and body. */
function searchIssues(issues: GithubIssue[], query: string): GithubIssue[] {
  let out = issues;
  const words: string[] = [];
  for (const token of query.toLowerCase().match(/"[^"]+"|\S+/g) ?? []) {
    const [key, ...rest] = token.split(':');
    const value = rest.join(':').replace(/"/g, '');
    if (key === 'is' && (value === 'open' || value === 'closed')) {
      out = out.filter((i) => i.state === value);
    } else if (key === 'label') {
      out = out.filter((i) => i.labels.includes(value));
    } else if (key === 'repo' || key === 'is' || key === 'type' || key === 'in') {
      // the only repo is acme/website; issue/pr kinds do not matter here
    } else words.push(token.replace(/"/g, ''));
  }
  return out.filter((i) => {
    const hay = `${i.title} ${i.body}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function pageOf<T>(items: T[], args: Record<string, unknown>, defaultPerPage = 30): T[] {
  const per = typeof args['perPage'] === 'number' ? args['perPage'] : defaultPerPage;
  const p = typeof args['page'] === 'number' ? args['page'] : 1;
  return items.slice((p - 1) * per, p * per);
}

function knownRepo(args: Record<string, unknown>): void {
  if (args['owner'] !== GITHUB_DATA.owner || args['repo'] !== GITHUB_DATA.repo) {
    throw new Error(`Not Found: repository ${String(args['owner'])}/${String(args['repo'])}`);
  }
}

function runTool(
  name: string,
  args: Record<string, unknown>,
  created: GithubIssue[],
  createdComments: Map<number, GithubComment[]>,
): unknown {
  const all = [...GITHUB_DATA.issues, ...created];
  const find = () => {
    const issue = all.find((i) => i.number === args['issue_number']);
    if (!issue) throw new Error(`Not Found: issue #${String(args['issue_number'])}`);
    return issue;
  };
  switch (name) {
    case 'list_issues': {
      knownRepo(args);
      const state = typeof args['state'] === 'string' ? args['state'] : 'open';
      const labels = asArray(args['labels']).map((l) => l.toLowerCase());
      const assignee = typeof args['assignee'] === 'string' ? args['assignee'] : '';
      let items = all.filter(
        (i) =>
          (state === 'all' || i.state === state) &&
          labels.every((l) => i.labels.includes(l)) &&
          (!assignee || i.assignees.includes(assignee)),
      );
      items = [...items].sort((a, b) => b.number - a.number);
      if (args['direction'] === 'asc') items.reverse();
      return { total_count: items.length, issues: pageOf(items, args).map(issueView) };
    }
    case 'get_issue':
      knownRepo(args);
      return issueView(find());
    case 'list_issue_comments': {
      knownRepo(args);
      const issue = find();
      const comments =
        GITHUB_DATA.comments[issue.number] ?? createdComments.get(issue.number) ?? [];
      return { total_count: comments.length, comments: pageOf(comments, args) };
    }
    case 'search_issues': {
      const found = searchIssues(all, str(args['query']));
      return { total_count: found.length, items: pageOf(found, args).map(issueView) };
    }
    case 'create_issue': {
      knownRepo(args);
      const number = all.length + 1;
      const issue: GithubIssue = {
        number,
        title: str(args['title']),
        state: 'open',
        labels: asArray(args['labels']),
        user: 'giulio-bot',
        assignees: asArray(args['assignees']),
        body: typeof args['body'] === 'string' ? args['body'] : '',
        created_at: '2026-10-23T12:00:00Z',
        comments: 0,
      };
      created.push(issue);
      return issueView(issue);
    }
    case 'add_issue_comment': {
      knownRepo(args);
      const issue = find();
      const list = createdComments.get(issue.number) ?? [];
      const comment = {
        id: issue.number * 100 + 50 + list.length,
        user: 'giulio-bot',
        body: str(args['body']),
        created_at: '2026-10-23T12:00:00Z',
      };
      createdComments.set(issue.number, [...list, comment]);
      return comment;
    }
    case 'update_issue':
    case 'close_issue':
    case 'reopen_issue':
      knownRepo(args);
      return issueView(find());
    case 'list_labels':
      return {
        total_count: 3,
        labels: [
          { name: 'bug', color: 'd73a4a', description: 'Something is not working' },
          { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
          {
            name: 'docs',
            color: '0075ca',
            description: 'Improvements or additions to documentation',
          },
        ],
      };
    case 'get_me':
      return { login: 'giulio-bot', name: 'Giulio Bot', plan: 'free', public_repos: 3 };
    case 'list_repositories':
      return { total_count: 1, repositories: [{ full_name: GITHUB_DATA.fullName, private: true }] };
    default: {
      const spec = GITHUB_TOOL_SPECS.find((s) => s.name === name);
      if (spec?.kind === 'read') return { total_count: 0, items: [] };
      return { ok: true, ...args };
    }
  }
}

function githubServer(calls: GithubCall[]): McpServer {
  const created: GithubIssue[] = [];
  const createdComments = new Map<number, GithubComment[]>();
  const server = new McpServer(
    { name: 'github', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'GitHub: repositories, issues, pull requests, code, releases and Actions. Always pass owner and repo. Prefer filters (state, labels, query) over reading whole lists.',
    },
  );
  for (const spec of GITHUB_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.name.replace(/_/g, ' '),
        description: spec.description,
        inputSchema: z.object(spec.shape),
        annotations:
          spec.kind === 'read'
            ? { readOnlyHint: true, openWorldHint: true }
            : {
                readOnlyHint: false,
                destructiveHint: spec.kind === 'destructive',
                openWorldHint: true,
              },
      },
      (args: Record<string, unknown>) => {
        calls.push({ tool: spec.name, args });
        try {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(runTool(spec.name, args, created, createdComments), null, 1),
              },
            ],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: (err as Error).message }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}

export interface FakeGithub {
  base: string;
  mcpUrl: string;
  /** The personal access token the server accepts (`Authorization: Bearer ghp_…`). */
  personalToken: string;
  /** Tool calls, in order. */
  calls: GithubCall[];
  close(): Promise<void>;
}

export async function startFakeGithub(): Promise<FakeGithub> {
  const calls: GithubCall[] = [];
  const handler = createMcpHandler(() => githubServer(calls));
  const personalToken = `ghp_${randomBytes(18).toString('base64url')}`;
  const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const server = serve({
    fetch: async (req: Request): Promise<Response> => {
      if (new URL(req.url).pathname !== '/mcp') return json({ error: 'not found' }, 404);
      if (req.method !== 'POST') {
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      }
      const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
      if (token !== personalToken) return json({ error: 'Bad credentials' }, 401);
      return handler.fetch(req);
    },
    port: 0,
    hostname: '127.0.0.1',
    overrideGlobalObjects: false,
  });
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    mcpUrl: `${base}/mcp`,
    personalToken,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
