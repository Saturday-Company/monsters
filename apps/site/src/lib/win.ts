/* Ids shared by a window and the tab panels its parent puts inside it. */

export const winUid = (key: string): string =>
  `w-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

export const tabPanel = (key: string, tab: string, first = false) => ({
  role: 'tabpanel' as const,
  id: `${winUid(key)}-panel-${tab}`,
  'aria-labelledby': `${winUid(key)}-tab-${tab}`,
  'data-panel': tab,
  ...(first ? {} : { 'data-inactive': '' }),
});
