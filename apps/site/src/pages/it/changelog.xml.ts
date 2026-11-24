import type { APIRoute } from 'astro';
import { changelogFeed } from '../../lib/feedpage.ts';

export const prerender = true;

/** The Italian changelog as an Atom feed. */
export const GET: APIRoute = ({ site }) =>
  changelogFeed('it', (site?.toString() ?? '').replace(/\/$/, ''));
