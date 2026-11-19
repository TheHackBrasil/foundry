// Reads the public repo through the GitHub REST API (unauthenticated, 60
// requests per hour per IP). The build takes a full snapshot, file table
// included; the browser refreshes only the cheap parts (four requests).

export const REPO = 'TheHackBrasil/foundry';
const API = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
export const PITCH_TAG = 'pitch-v10';

export type StageStatus = 'done' | 'doing' | 'todo' | 'spec' | 'blocked';
export type Stage = { item: string; status: StageStatus; label: string };
export type Commit = { msg: string; type: string; sha: string; date: string; when: string; url: string; login: string; avatar: string };
export type Entry = { name: string; dir: boolean; msg: string; when: string; url: string };
export type Release = { tag: string; name: string; when: string; url: string; video: string | null };
export type Meta = { description: string; stars: number; forks: number; watchers: number; issues: number };
export type RepoState = {
  meta: Meta;
  stages: Stage[];
  done: number;
  total: number;
  commits: Commit[];
  count: number | null;
  files: Entry[];
  release: Release | null;
  read: string;
};

const LABEL: Record<StageStatus, string> = { done: 'Feito', doing: 'Em andamento', todo: 'Na fila', spec: 'Em spec', blocked: 'Bloqueado' };
export const COLUMNS: StageStatus[] = ['done', 'doing', 'spec', 'todo', 'blocked'];
export const columnLabel = (s: StageStatus) => LABEL[s];

// BACKLOG.md keeps two markdown tables: "## Fila" (# | Item | Status | Nota) and "## Feito" (# | Item | Data).
export function parseBacklog(md: string): Stage[] {
  const section = (title: string) => md.split(/^## /m).find((s) => s.startsWith(title)) ?? '';
  const rows = (block: string) =>
    block
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
      .slice(1)
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')));
  const clean = (s: string) => s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const done = rows(section('Feito')).map(([, item]): Stage => ({ item: clean(item), status: 'done', label: LABEL.done }));
  const queue = rows(section('Fila')).map(([, item, status]): Stage => {
    const head = status.split(/\s/)[0] as StageStatus;
    const s = head in LABEL ? head : 'todo';
    return { item: clean(item), status: s, label: LABEL[s] };
  });
  return [...done, ...queue];
}

const rel = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function ago(iso: string, now = Date.now()): string {
  let v = (new Date(iso).getTime() - now) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12]];
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rel.format(Math.round(v), unit);
    v /= size;
  }
  return rel.format(Math.round(v), 'year');
}

// Set only by the build (Progress.astro frontmatter); the browser never sees a token.
let token: string | undefined;
const get = (url: string) =>
  fetch(url, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = async <T>(url: string): Promise<T> => {
  const r = await get(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
};

type ApiCommit = { sha: string; html_url: string; author: { login: string; avatar_url: string } | null; commit: { message: string; author: { name: string; date: string } } };
type ApiRelease = { tag_name: string; name: string | null; html_url: string; published_at: string; assets: Array<{ name: string; browser_download_url: string }> };
type ApiRepo = { description: string | null; stargazers_count: number; forks_count: number; subscribers_count?: number; watchers_count: number; open_issues_count: number };
type ApiEntry = { name: string; type: string; path: string; html_url: string };

const toCommit = (c: ApiCommit): Commit => {
  const line = c.commit.message.split('\n')[0];
  const m = line.match(/^(\w+):\s*(.*)$/);
  return {
    msg: m ? m[2] : line,
    type: m ? m[1] : 'commit',
    sha: c.sha.slice(0, 7),
    date: c.commit.author.date,
    when: ago(c.commit.author.date),
    url: c.html_url,
    login: c.author?.login ?? c.commit.author.name,
    avatar: c.author?.avatar_url ?? '',
  };
};

/** Total commits on main, read off the last page of a one-per-page listing. */
async function commitCount(): Promise<number | null> {
  const r = await get(`${API}/commits?per_page=1`);
  const last = r.headers.get('link')?.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return last ? Number(last[1]) : null;
}

/** Top-level entries with the last commit that touched each one (one request per entry: build only). */
async function fileTable(): Promise<Entry[]> {
  const entries = await json<ApiEntry[]>(`${API}/contents`);
  const sorted = entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return Promise.all(
    sorted.map(async (e) => {
      const [last] = await json<ApiCommit[]>(`${API}/commits?per_page=1&path=${encodeURIComponent(e.path)}`).catch(() => []);
      const c = last ? toCommit(last) : null;
      return { name: e.name, dir: e.type === 'dir', msg: c ? `${c.type}: ${c.msg}` : '', when: c?.when ?? '', url: e.html_url };
    }),
  );
}

export async function fetchState(full = false, auth?: string): Promise<RepoState> {
  token = auth;
  const [repo, commits, backlog, releases, count, files] = await Promise.all([
    json<ApiRepo>(API),
    json<ApiCommit[]>(`${API}/commits?per_page=8`),
    fetch(`${RAW}/BACKLOG.md`).then((r) => (r.ok ? r.text() : '')),
    // The list answers 200 even when empty; the tag endpoint would log a 404.
    json<ApiRelease[]>(`${API}/releases?per_page=10`).catch(() => []),
    full ? commitCount().catch(() => null) : Promise.resolve(null),
    full ? fileTable().catch(() => []) : Promise.resolve([]),
  ]);
  const stages = parseBacklog(backlog);
  const r = releases.find((x) => x.tag_name === PITCH_TAG) ?? releases[0];
  return {
    meta: {
      description: repo.description ?? '',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.subscribers_count ?? repo.watchers_count,
      issues: repo.open_issues_count,
    },
    stages,
    done: stages.filter((s) => s.status === 'done').length,
    total: stages.length,
    commits: commits.map(toCommit),
    count,
    files,
    release: r
      ? {
          tag: r.tag_name,
          name: r.name ?? r.tag_name,
          when: ago(r.published_at),
          url: r.html_url,
          video: r.assets.find((a) => a.name.endsWith('.mp4'))?.browser_download_url ?? null,
        }
      : null,
    read: new Date().toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const commitRow = (c: Commit) =>
  `<li><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">` +
  (c.avatar ? `<img src="${esc(c.avatar)}&s=40" alt="" width="20" height="20">` : '<span class="gh-ava"></span>') +
  `<span class="gh-cmsg"><b>${esc(c.type)}:</b> ${esc(c.msg)}</span>` +
  `<span class="gh-cmeta">${esc(c.login)} · <time datetime="${esc(c.date)}">${c.when}</time></span>` +
  `<code>${c.sha}</code></a></li>`;

export const card = (s: Stage) => `<li class="gh-card st-${s.status}"><span class="gh-dot"></span>${esc(s.item)}</li>`;

/** Browser refresh: everything except the file table, which needs one request per entry. */
export function renderState(root: HTMLElement, s: RepoState) {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const set = (sel: string, html: string) => {
    const el = q(sel);
    if (el) el.innerHTML = html;
  };
  const head = s.commits[0];
  if (head) {
    set('[data-head-msg]', `<b>${esc(head.type)}:</b> ${esc(head.msg)}`);
    set('[data-head-meta]', `<code>${head.sha}</code> · <time datetime="${esc(head.date)}">${head.when}</time>`);
    set('[data-head-login]', esc(head.login));
    const img = q<HTMLImageElement>('[data-head-ava]');
    if (img && head.avatar) img.src = `${head.avatar}&s=40`;
  }
  set('[data-commits]', s.commits.map(commitRow).join(''));
  for (const col of COLUMNS) {
    const items = s.stages.filter((x) => x.status === col);
    set(`[data-col="${col}"] ol`, items.map(card).join(''));
    set(`[data-col="${col}"] .gh-colcount`, String(items.length));
  }
  set('[data-done]', String(s.done));
  set('[data-total]', String(s.total));
  q('[data-bar]')?.style.setProperty('--v', String(s.done / Math.max(1, s.total)));
  set('[data-sync]', `Lido do GitHub agora, ${esc(s.read)}`);
  if (s.release?.video && !q('[data-pitch] video')) {
    set('[data-pitch]', `<video controls preload="metadata" playsinline src="${esc(s.release.video)}"></video>`);
    q('[data-pitch]')?.removeAttribute('hidden');
  }
}
