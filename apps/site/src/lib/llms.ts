/*
 * The site for language models: `/llms.txt` (a short, linked summary) and `/llms-full.txt` (the
 * same plus the English guides of the repository, read from `docs/` at build time). Both are
 * plain English Markdown, written for assistants and crawlers, not shown on the pages.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPARE, COMPETITORS, VERIFIED } from '../i18n/compare.ts';
import { STRINGS } from '../i18n/strings.ts';
import type { SiteData } from './build-data.ts';
import { GUIDES, absolutizeLinks, blob, docsDir } from './docs.ts';
import { REPO_URL, RELEASES_URL } from './feed.ts';
import { COMPANY_NAME, COMPANY_URL, LICENSE_URL, SITE_ORIGIN, homeFaq } from './seo.ts';

export function llmsTxt(data: SiteData): string {
  const faq = homeFaq(STRINGS.en)
    .map((i) => `- **${i.q}** ${i.a}`)
    .join('\n');
  const site = (path: string): string => `${SITE_ORIGIN}${path}`;
  const guides = GUIDES.map((g) => `- ${g.title}: ${site(`/docs/${g.slug}/`)}`).join('\n');
  const compare = COMPETITORS.map(
    (c) => `- ${COMPARE.en.pages[c].title}: ${site(`/compare/${c}/`)}`,
  ).join('\n');
  const downloads =
    data.downloads.length > 0
      ? data.downloads.map((d) => `  - ${d.os} (${d.format}): ${d.url}`).join('\n')
      : '';
  return `# Monsters

> ${STRINGS.en.meta.description}

Monsters is a local-first, provider-agnostic agentic hub: an orchestrator (Titan) and a squad of small AI agents ("monsters") that work on your own computer. It is a desktop app for Linux, Windows and macOS, open source under Apache-2.0, currently in alpha${data.version ? ` (latest release ${data.version})` : ''}. Made by ${COMPANY_NAME} (${COMPANY_URL}).

## Who it is for

- People who want AI agents that run on their own machine, with their own keys and data on their own disk.
- Developers and power users who want to choose the model (cloud API, local runtime or an existing subscription) per agent.
- Teams that want an auditable agent system: every action is logged, spending is capped, and a kill switch stops everything.

## Features

- A team of agents: an orchestrator that plans and splits work, and monsters with their own chat, terminal, permissions and model chain. Projects and scheduled automations are proposed as drafts and start only when you confirm.
- Any model: OpenRouter (free models to start), Anthropic, OpenAI, Google, Mistral and Groq with your own API keys; Ollama and LM Studio fully local; the Claude (Claude Code) and ChatGPT (Codex) subscriptions you already pay for. Each monster has a chain of models with fallback.
- An Obsidian-compatible Markdown vault: plain files with wikilinks, hybrid keyword and semantic search, history and trash. Every agent edit is a git commit you can undo. \`monsters mcp\` serves the vault over MCP to Claude Desktop, Codex or Cursor.
- Connectors: any MCP server, and a browser with a profile separate from yours.
- Remote use: Telegram bots, or the terminal chat over SSH (\`monsters chat\`); the desktop app can connect to a core running elsewhere through an SSH tunnel.
- Instinct: a small, fast model decides when to ask you, checks that work is finished, notices agents going in circles, brakes actions that would leave the machine and strips instructions aimed at the monsters out of external text.

## Safety and privacy

- Kill switch: one red lever (the app, \`/stop\` on Telegram, or \`monsters kill\`) aborts every run and kills every child process.
- Local first: the core listens only on 127.0.0.1 and opens no ports to the outside. Notes, logs and settings stay on your disk; only the model calls you choose leave the machine.
- Your keys stay on your computer, in the system keychain. Terminal and file access are off until you grant them, monster by monster.
- Every action is written to the action log. Daily and monthly spending caps apply, per project too.
- Open source: the code, the security model and every technical decision are public.

## Download

- Latest builds: ${RELEASES_URL}
${downloads}
- Linux: AppImage or .deb. macOS: .dmg for Apple silicon and Intel. Windows: .exe installer (not yet signed with a certificate from a public CA, so SmartScreen warns; updates are verified with the project's own signed feed).
- Build from source: Node.js 24 or newer and pnpm 12, see ${blob('README.md')}

## Links

- Website: ${SITE_ORIGIN}/ (Italian: ${SITE_ORIGIN}/it/)
- Source code: ${REPO_URL}
- README: ${blob('README.md')}
- Changelog: ${site('/changelog/')}
- Issues and discussions: ${REPO_URL}/issues
- License (Apache-2.0): ${LICENSE_URL}
- Full text of the guides in one file: ${SITE_ORIGIN}/llms-full.txt

## Documentation

The user guides, English only, also on GitHub (${REPO_URL}/tree/main/docs).

- All guides: ${site('/docs/')}
${guides}

## Comparisons

Honest side-by-side pages, with sources, checked on ${VERIFIED}: where the other project is ahead and when to pick it. Overview: ${site('/compare/')}

${compare}

## Frequently asked questions

${faq}

Made by ${COMPANY_NAME} (${COMPANY_URL}).
`;
}

export function llmsFullTxt(data: SiteData): string {
  const dir = docsDir();
  const guides = GUIDES.map(({ file, title }) => {
    const text = readFileSync(resolve(dir, file), 'utf8').trim();
    return `---\n\n<!-- ${title}: ${blob(`docs/${file}`)} -->\n\n${absolutizeLinks(text, file)}\n`;
  });
  return `${llmsTxt(data).trimEnd()}\n\n# The guides\n\nThe English guides of the repository, in full. Source: ${REPO_URL}/tree/main/docs\n\n${guides.join('\n')}`;
}
