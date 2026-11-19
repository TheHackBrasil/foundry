// Reads the public repo through the GitHub REST API (unauthenticated, 60
// requests per hour per IP: three per page view). Shared by the build-time
// snapshot in Progress.astro and the refresh in the browser.

export const REPO = 'TheHackBrasil/foundry';
const API = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const PITCH_TAG = 'pitch-v9';

export type StageStatus = 'done' | 'doing' | 'todo' | 'spec' | 'blocked';
export type Stage = { item: string; status: StageStatus; label: string };
export type Commit = { msg: string; type: string; date: string; when: string; url: string };
export type RepoState = { stages: Stage[]; done: number; total: number; commits: Commit[]; pitch: string | null; read: string };

const LABEL: Record<StageStatus, string> = { done: 'feito', doing: 'em andamento', todo: 'na fila', spec: 'em spec', blocked: 'bloqueado' };

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
    const s = (status.split(/\s/)[0] as StageStatus) in LABEL ? (status.split(/\s/)[0] as StageStatus) : 'todo';
    return { item: clean(item), status: s, label: LABEL[s] };
  });
  return [...done, ...queue];
}

const rel = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function ago(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12]];
  let v = s;
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rel.format(Math.round(v), unit);
    v /= size;
  }
  return rel.format(Math.round(v), 'year');
}

const json = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
};

type ApiCommit = { sha: string; html_url: string; commit: { message: string; author: { date: string } } };
type ApiRelease = { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };

export async function fetchState(): Promise<RepoState> {
  const [commits, backlog, releases] = await Promise.all([
    json<ApiCommit[]>(`${API}/commits?per_page=6`),
    fetch(`${RAW}/BACKLOG.md`).then((r) => (r.ok ? r.text() : '')),
    // The list answers 200 even when empty; the tag endpoint would log a 404 on every visit.
    json<ApiRelease[]>(`${API}/releases?per_page=10`).catch(() => []),
  ]);
  const stages = parseBacklog(backlog);
  const asset = releases.find((r) => r.tag_name === PITCH_TAG)?.assets.find((a) => a.name.endsWith('.mp4'));
  return {
    stages,
    done: stages.filter((s) => s.status === 'done').length,
    total: stages.length,
    commits: commits.map((c) => {
      const line = c.commit.message.split('\n')[0];
      const m = line.match(/^(\w+):\s*(.*)$/);
      return { msg: m ? m[2] : line, type: m ? m[1] : 'commit', date: c.commit.author.date, when: ago(c.commit.author.date), url: c.html_url };
    }),
    pitch: asset?.browser_download_url ?? null,
    read: new Date().toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderState(board: HTMLElement, s: RepoState) {
  const q = <T extends Element>(sel: string) => board.querySelector<T>(sel);
  q('[data-done]')!.textContent = String(s.done);
  q('[data-total]')!.textContent = String(s.total);
  q<HTMLElement>('[data-bar]')!.style.setProperty('--v', String(s.done / Math.max(1, s.total)));
  q('[data-stages]')!.innerHTML = s.stages
    .map((st) => `<li class="st-${st.status}"><span class="pb-chip">${st.label}</span><span class="pb-item">${esc(st.item)}</span></li>`)
    .join('');
  q('[data-commits]')!.innerHTML = s.commits
    .map(
      (c) =>
        `<li><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer"><span class="pb-type" data-type="${esc(c.type)}">${esc(c.type)}</span><span class="pb-msg">${esc(c.msg)}</span><time datetime="${esc(c.date)}">${c.when}</time></a></li>`,
    )
    .join('');
  q('[data-sync]')!.textContent = `Lido do GitHub agora, ${s.read}`;
  if (s.pitch && !q('[data-pitch]')) {
    board.insertAdjacentHTML(
      'beforeend',
      `<figure class="pb-pitch" data-pitch><video controls preload="none" playsinline src="${esc(s.pitch)}"></video><figcaption>Pitch em vídeo</figcaption></figure>`,
    );
  }
}
