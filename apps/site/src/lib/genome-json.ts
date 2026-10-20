/*
 * The genome as pretty JSON with light syntax colouring (keys, numbers), as HTML. Shared by the
 * build (first render) and the generator in the browser.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function genomeJsonHtml(genome: unknown): string {
  const json = JSON.stringify(genome, null, 2);
  return escapeHtml(json)
    .replace(/^(\s*)"([^"]+)":/gm, '$1<span class="k">"$2"</span>:')
    .replace(/: (-?\d+(?:\.\d+)?)(,?)$/gm, ': <span class="n">$1</span>$2');
}
