/** The static CDN may reach only built scripts, styles and local fonts. */
export function staticAssetPath(path: string): boolean {
  return /^\/assets\/[\w.-]+\.(js|css|woff2)$/.test(path) || /^\/fonts\/[\w.-]+\.woff2$/.test(path);
}
export function assetHtml(html: string, origin: string): string {
  const base = new URL(origin).origin;
  return html.replace(/(<script\b[^>]*\bsrc=")(\/assets\/[\w.-]+\.js)"/g, (_match, start: string, path: string) => `${start}${base}${path}" onerror="this.onerror=null;const s=document.createElement('script');s.type='module';s.src='${path}';document.body.appendChild(s);this.remove()"`)
    .replace(/(<link\b[^>]*\bhref=")(\/assets\/[\w.-]+\.css)"/g, (_match, start: string, path: string) => `${start}${base}${path}" onerror="this.onerror=null;this.href='${path}'"`);
}
