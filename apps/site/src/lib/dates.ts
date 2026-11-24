/* Dates on the pages: ISO days (`2026-11-24`) written out in the page's language. */

/** `2026-11-24` to "24 November 2026" or "24 novembre 2026". Anything unreadable comes back as is. */
export function formatDate(iso: string, lang: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** The day part of an ISO timestamp: `2026-10-25T23:16:36+01:00` to `2026-10-25`. */
export const isoDay = (iso: string): string => iso.slice(0, 10);
