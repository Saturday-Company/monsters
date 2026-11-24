import type { APIRoute } from 'astro';
import { changelogFeed } from '../lib/feedpage.ts';

export const prerender = true;

/** The changelog as an Atom feed. */
export const GET: APIRoute = ({ site }) =>
  changelogFeed('en', (site?.toString() ?? '').replace(/\/$/, ''));
