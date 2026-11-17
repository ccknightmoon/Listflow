// eBay's XML responses carry titles with entities still encoded ("Levi
// Strauss &amp; Co"), sometimes twice ("&amp;amp;"). Decode for display.
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  // Up to 3 passes handles double/triple-encoded text without looping forever.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return NAMED[code.toLowerCase()] ?? m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}
