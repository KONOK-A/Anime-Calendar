export function splitSynopsis(summary: string): { summary: string; original: string } {
  const text = summary.replace(/\r\n?/g, '\n').trim();
  const marker = /^[\t ]*(?:\[|【)?(?:简介原文|原文简介|日文原文|原文)(?:\]|】)?[：:]?[\t ]*$/m.exec(text);
  if (!marker) return { summary: text, original: '' };
  return { summary: text.slice(0, marker.index).trim(), original: text.slice(marker.index + marker[0].length).trim() };
}
