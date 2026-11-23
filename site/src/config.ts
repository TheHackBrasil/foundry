// Links of the first HackBrasil submission (30/11, 23h59). Keep a value empty
// while the thing is not public yet: the page then says "Em preparação" and
// renders no link, so a visitor never lands on a dead end.
export const DEMO_URL = 'https://forseti-production-fcb91f35.up.railway.app';
export const VIDEO_URL = '';

/** The URL when it is a full https link, otherwise null (empty or mistyped). */
export const live = (url: string): string | null => {
  const u = url.trim();
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
};
