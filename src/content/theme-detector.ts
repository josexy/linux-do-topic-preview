function parseRgbColor(color: string): [number, number, number, number] | null {
  const match = color.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (!match) {
    return null;
  }
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] !== undefined ? Number(match[4]) : 1,
  ];
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function detectPageDarkTheme(): boolean {
  const html = document.documentElement;
  const body = document.body;

  const schemeAttr =
    html.getAttribute('data-color-scheme') ||
    body?.getAttribute('data-color-scheme');
  if (schemeAttr) {
    const lower = schemeAttr.toLowerCase();
    if (lower.includes('dark')) return true;
    if (lower.includes('light')) return false;
  }

  if (
    html.classList.contains('dark-theme') ||
    body?.classList.contains('dark-theme')
  ) {
    return true;
  }

  const elements = [body, html].filter((el): el is HTMLElement => Boolean(el));
  for (const el of elements) {
    const bg = window.getComputedStyle(el).backgroundColor;
    const rgba = parseRgbColor(bg);
    if (rgba && rgba[3] > 0.1) {
      return getRelativeLuminance(rgba[0], rgba[1], rgba[2]) < 0.45;
    }
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
