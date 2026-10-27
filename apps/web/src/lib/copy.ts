/**
 * Puts a text on the clipboard: the async API where the page may use it, else the old way
 * (a hidden field and `execCommand`), which still works over plain http on the local network.
 * True when it went; the caller says so, or says it could not.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No permission or no secure context: try the old way.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
