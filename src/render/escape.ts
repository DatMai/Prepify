export function esc(s: string | undefined | null): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function hl(s: string, q: string): string {
  if (!q) return esc(s);
  const escaped = esc(s);
  const escapedQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + escapedQ + ')', 'gi');
  return escaped.replace(re, '<span class="hl">$1</span>');
}
