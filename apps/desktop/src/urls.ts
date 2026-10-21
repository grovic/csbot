// Renderer URL helpers. Pure: unit-tested without Electron.

/** The renderer URL, with ?signal= when tests (or a self-hosted relay) override room signaling. */
export function rendererUrlFor(base: string, signal?: string): string {
  if (!signal) return base;
  const u = new URL(base);
  u.searchParams.set('signal', signal);
  return u.href;
}

/** Same page as the renderer? file: compares the path only (the app sets its own query and hash). */
export function samePage(url: string, renderer: string): boolean {
  try {
    const a = new URL(url), b = new URL(renderer);
    if (b.protocol === 'file:') return a.protocol === 'file:' && decodeURIComponent(a.pathname).toLowerCase() === decodeURIComponent(b.pathname).toLowerCase();
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/**
 * Where the built web UI is, for each way csbot runs:
 * - packaged (electron-builder): `<app>/web/index.html` inside app.asar
 * - dev and the playtest copy: `<app>/../web/dist/index.html`
 * Returns the first that exists, or the dev path (so the "not built yet" page shows).
 */
export function webIndexFor(appDir: string, exists: (p: string) => boolean, join: (...p: string[]) => string): string {
  const candidates = [join(appDir, 'web', 'index.html'), join(appDir, '..', 'web', 'dist', 'index.html')];
  return candidates.find(exists) ?? candidates[1]!;
}
