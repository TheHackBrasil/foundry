// Public links of the LP. Keep a value empty while the thing is not live:
// callers then render a plain state instead of a dead link.
// DEMO_URL points to the public demo on Railway (generated service domain).
export const DEMO_URL = 'https://forseti-production-fcb91f35.up.railway.app';

// Absolute base for og:url and og:image once the LP domain is defined.
// Leave empty to emit relative image paths only.
export const SITE_URL = 'https://forseti-br.vercel.app';

/** The URL when it is a full https link, otherwise null (empty or mistyped). */
export const live = (url: string): string | null => {
  const u = url.trim();
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
};
