// Busca universal como command palette (spec 0017, refinamento da frente
// topo): overlay modal centralizado no alto da tela, no estilo do Cmd+K do
// Supabase — NAO um dropdown colado no campo. O gatilho da topbar mantem a
// cara de campo (lupa + rotulo + keycap do atalho) porque o recorte da call
// era uma "busca pequena entre agenda e tema", mas ele so abre a paleta:
// quem recebe foco e o input grande dentro do overlay.
//
// Cobertura: so o que ja esta carregado no cliente — lista de pedidos e
// agenda de contatos (useTorre via props) e versoes cujas projecoes ja
// passaram pelo cache de rede.ts. Zero GET novo nesta wave; o preview rico
// do item 35 segue fora (D-T1), mas .paleta-corpo ja e uma grid pensada
// para receber o painel lateral futuro.
//
// Teclado e leitores: a paleta e role=dialog aria-modal; dentro dela o
// input e um combobox APG de verdade — dono do foco e do
// aria-activedescendant, com a lista de resultados como popup listbox.
// Ctrl+K/Cmd+K abrem (ou fecham) de qualquer ponto do app e "/" tambem
// abre fora de campos editaveis; Escape fecha e devolve o foco ao
// elemento que chamou.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Contato } from '../../../shared/model.ts';
import type { PedidoResumo } from '../api.ts';
import { usePresencaAnimada } from '../usePresencaAnimada.ts';
import type { RotaTorre } from '../useTorre.ts';
import {
  IconeAssistente,
  IconeCaixa,
  IconeCaminhao,
  IconeFabrica,
  IconeFiscal,
  IconeFinanceiro,
  IconeGalpao,
  IconeLupa,
} from './icones.tsx';
import { codigoCurtoPedido, elementoEditavel } from './assistente/conversaUtils.ts';
import {
  itemPedido,
  itensContatos,
  itensDocumentos,
  normalizarConsulta,
  TITULO_SECAO,
  type ItemWiki,
  type SecaoId,
  type SeloWiki,
} from './menuwiki/dados.ts';
import { projecaoCacheada } from './menuwiki/rede.ts';
import '../busca.css';

const DEBOUNCE_MS = 150;
const SAIDA_MS = 170;

// Teto por secao dentro da paleta: a lista fica escaneavel e nunca estica
// o painel alem da altura util.
const LIMITE_POR_SECAO: Record<SecaoResultado, number> = {
  pedidos: 6,
  parceiros: 3,
  documentos: 3,
};

type SecaoResultado = Extract<SecaoId, 'pedidos' | 'parceiros' | 'documentos'>;
// 'comandos' nao e uma secao de dados: e o grupo fixo de acoes no fim da
// lista (hoje so a ponte com a IA), separado do inventario filtravel.
type SecaoItem = SecaoResultado | 'comandos';
const ORDEM_SECOES: readonly SecaoResultado[] = ['pedidos', 'parceiros', 'documentos'];
const TITULO_COMANDOS = 'Comandos';

// Icone do tipo na linha do resultado: pedido e carga (caixa), parceiro
// segue a parte que ele representa, documento e o glyph fiscal da casa e o
// comando usa o mesmo icone do Assistente IA do menu.
const ICONES = {
  pedido: IconeCaixa,
  fornecedor: IconeFabrica,
  transportadora: IconeCaminhao,
  cd: IconeGalpao,
  fiscal: IconeFiscal,
  financeiro: IconeFinanceiro,
  documento: IconeFiscal,
  assistente: IconeAssistente,
} as const;
type IconeResultado = keyof typeof ICONES;

export interface ResultadoBusca {
  chave: string;
  secao: SecaoItem;
  titulo: string;
  resumo?: string;
  selo?: SeloWiki;
  codigo?: string;
  icone?: IconeResultado;
  href?: string;
  abreAgenda?: boolean;
  acaoIA?: boolean;
  dica?: string;
  // Haystack normalizavel fora dos campos visiveis (id completo, canal,
  // destino): a consulta colada inteira casa aqui sem poluir a linha.
  extra?: string;
}

// Mapa indice-normalizado -> indice-original: NFD e strip de diacriticos
// mudam o comprimento da string, entao indexOf no texto normalizado nao
// serve para fatiar o original. Cada caractere normalizado guarda o
// intervalo [ini, fim) do caractere de origem.
export function intervaloCasado(
  texto: string,
  consultaNormalizada: string,
): readonly [number, number] | null {
  if (!consultaNormalizada) return null;
  let normalizado = '';
  const origem: { ini: number; fim: number }[] = [];
  let i = 0;
  for (const ch of texto) {
    const n = ch
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (let k = 0; k < n.length; k += 1) origem.push({ ini: i, fim: i + ch.length });
    normalizado += n;
    i += ch.length;
  }
  const pos = normalizado.indexOf(consultaNormalizada);
  if (pos === -1) return null;
  const primeiro = origem[pos];
  const ultimo = origem[pos + consultaNormalizada.length - 1];
  if (!primeiro || !ultimo) return null;
  return [primeiro.ini, ultimo.fim] as const;
}

function TrechoDestacado({ texto, consulta }: { texto: string; consulta: string }) {
  const iv = intervaloCasado(texto, consulta);
  if (!iv) return <>{texto}</>;
  const [ini, fim] = iv;
  return (
    <>
      {texto.slice(0, ini)}
      <strong className="paleta-mark">{texto.slice(ini, fim)}</strong>
      {texto.slice(fim)}
    </>
  );
}

// Transforma o ItemWiki do menuwiki em linha de resultado, preservando os
// mesmos titulo/resumo/selo/href que o indice lateral ja mostra (mesma
// fonte de verdade, mesmo texto; o href segue a rota, como no seletor).
function deItemWiki(
  item: ItemWiki,
  secao: SecaoItem,
  extra: Partial<ResultadoBusca>,
): ResultadoBusca {
  return {
    chave: item.id,
    secao,
    titulo: item.titulo,
    resumo: item.resumo,
    selo: item.selo,
    href: item.href,
    dica: item.tituloCompleto,
    ...extra,
  };
}

// O id do ItemWiki de contato e `contato:${parte}:${destino}` — a parte e a
// chave do icone da linha.
function iconeDeContato(id: string): IconeResultado {
  const parte = id.split(':')[1];
  return parte && parte in ICONES ? (parte as IconeResultado) : 'fornecedor';
}

const ehMac =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

export interface BuscaUniversalProps {
  pedidos: readonly PedidoResumo[];
  contatos: readonly Contato[];
  rota: RotaTorre;
  aoAbrirAgenda: () => void;
  aoPerguntarIA: (comando?: string) => void;
}

export function BuscaUniversal({
  pedidos,
  contatos,
  rota,
  aoAbrirAgenda,
  aoPerguntarIA,
}: BuscaUniversalProps) {
  const baseId = useId();
  const listaId = `${baseId}-lista`;
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  const [consulta, setConsulta] = useState('');
  const [consultaAtiva, setConsultaAtiva] = useState('');
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const presenca = usePresencaAnimada(aberto, SAIDA_MS);

  // Resultados ao vivo com debounce curto: a lista responde a cada tecla sem
  // recomputar haystack a cada frame de digitacao.
  useEffect(() => {
    const timer = window.setTimeout(() => setConsultaAtiva(consulta), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [consulta]);

  // Inventario navegavel: mesmos itens do indice lateral — pedidos e
  // parceiros direto dos dados carregados, documentos das projecoes ja em
  // cache (pedido aberto ou visitado na sessao; zero GET novo).
  const inventario = useMemo<ResultadoBusca[]>(() => {
    const itens: ResultadoBusca[] = pedidos.map((p) =>
      deItemWiki(itemPedido(p, rota), 'pedidos', {
        codigo: codigoCurtoPedido(p.pedidoId),
        icone: 'pedido',
        extra: `${p.pedidoId} ${p.status ?? ''}`,
      }),
    );
    itens.push(
      ...itensContatos(contatos).map((item) =>
        deItemWiki(item, 'parceiros', { abreAgenda: true, icone: iconeDeContato(item.id) }),
      ),
    );
    const entradas = pedidos
      .map((p) => ({
        pedido: p,
        versoes: projecaoCacheada(p.pedidoId, p.totalEventos)?.versoes ?? [],
      }))
      .filter((e) => e.versoes.length > 0);
    itens.push(
      ...itensDocumentos(entradas, rota, 12).map((item) =>
        deItemWiki(item, 'documentos', {
          codigo: item.pedidoId ? codigoCurtoPedido(item.pedidoId) : undefined,
          icone: 'documento',
        }),
      ),
    );
    return itens;
  }, [pedidos, contatos, rota]);

  const consultaNorm = useMemo(() => normalizarConsulta(consultaAtiva), [consultaAtiva]);

  const filtrados = useMemo(() => {
    if (!consultaNorm) return inventario;
    return inventario.filter((it) =>
      normalizarConsulta(
        `${it.titulo} ${it.resumo ?? ''} ${it.selo?.texto ?? ''} ${it.dica ?? ''} ${it.codigo ?? ''} ${it.extra ?? ''}`,
      ).includes(consultaNorm),
    );
  }, [inventario, consultaNorm]);

  // Secoes de dados capadas na ordem fixa; a navegacao por setas indexa a
  // lista plana. O grupo de comandos fica de fora do filtro: "Perguntar a
  // IA" e sempre a ultima linha, inclusive quando nada casa (atalho de
  // escape para o assistente).
  const secoes = useMemo(
    () =>
      ORDEM_SECOES.map((id) => ({
        id,
        titulo: TITULO_SECAO[id],
        itens: filtrados.filter((it) => it.secao === id).slice(0, LIMITE_POR_SECAO[id]),
      })).filter((sec) => sec.itens.length > 0),
    [filtrados],
  );
  // O comando usa a consulta crua (nao a debounced): o que o titulo
  // promete e exatamente o que sera enviado se o usuario der Enter antes
  // dos 150ms do debounce.
  const comandos = useMemo<ResultadoBusca[]>(() => {
    const alvo = consulta.trim();
    return [
      {
        chave: 'cmd:ia',
        secao: 'comandos',
        titulo: alvo ? `Perguntar à IA sobre “${alvo}”` : 'Perguntar à IA',
        resumo: alvo
          ? 'Abre o assistente executando essa busca'
          : 'Abre o assistente sem comando inicial',
        icone: 'assistente',
        acaoIA: true,
      },
    ];
  }, [consulta]);
  const planos = useMemo(
    () => [...secoes.flatMap((sec) => sec.itens), ...comandos],
    [secoes, comandos],
  );
  const indicePorChave = useMemo(
    () => new Map(planos.map((it, i) => [it.chave, i])),
    [planos],
  );
  // Rotulos de grupo so quando ha mais de um grupo visivel — uma secao
  // sozinha nao precisa de legenda repetindo o obvio.
  const mostrarRotulos = secoes.length + (comandos.length > 0 ? 1 : 0) > 1;
  // Contagem do rodape conta so resultados de dados — o comando fixo de
  // IA nao e "resultado" e inflaria o numero quando nada casa.
  const totalVisiveis = secoes.reduce((n, sec) => n + sec.itens.length, 0);

  const fechar = useCallback(() => {
    setAberto(false);
    // Escape fecha e devolve o foco a quem chamou (refinamento do brief);
    // a mesma devolucao vale para selecao e clique no veu.
    const alvo = focoAnteriorRef.current;
    focoAnteriorRef.current = null;
    if (alvo && document.contains(alvo)) alvo.focus({ preventScroll: true });
  }, []);

  const abrir = useCallback(() => {
    focoAnteriorRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : gatilhoRef.current;
    // Cada abertura comeca limpa: consulta vazia = modo browse do inventario.
    setConsulta('');
    setConsultaAtiva('');
    setIndiceAtivo(0);
    setAberto(true);
  }, []);

  const ativar = useCallback(
    (idx: number) => {
      const alvo = planos[idx];
      if (!alvo) return;
      fechar();
      if (alvo.acaoIA) {
        // O comando inicial executa sozinho na pagina do assistente.
        aoPerguntarIA(consulta.trim() || undefined);
      } else if (alvo.abreAgenda) {
        aoAbrirAgenda();
      } else if (alvo.href) {
        window.location.hash = alvo.href;
      }
    },
    [planos, fechar, aoPerguntarIA, aoAbrirAgenda, consulta],
  );

  // Paleta aberta: o input interno assume o foco assim que monta.
  useEffect(() => {
    if (presenca.montado) inputRef.current?.focus();
  }, [presenca.montado]);

  // A lista encolhe com a consulta: o indice ativo trava no ultimo valido.
  useEffect(() => {
    setIndiceAtivo((i) => Math.min(i, Math.max(0, planos.length - 1)));
  }, [planos.length]);

  // Consulta nova reinicia o destaque no primeiro resultado.
  useEffect(() => {
    setIndiceAtivo(0);
  }, [consultaNorm]);

  // O destaque acompanha a rolagem para nao sair da area visivel.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current
      ?.querySelector('.paleta-opcao[data-ativo="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [aberto, indiceAtivo]);

  // Atalhos globais: Ctrl+K/Cmd+K alternam a paleta de qualquer lugar
  // (padrao command palette; preventDefault desvia a barra de busca do
  // navegador). "/" tambem abre, fora de campo editavel. Escape e o
  // fechamento reserva caso o foco escape do input (leitor de tela).
  useEffect(() => {
    const aoTeclaGlobal = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        if (aberto) fechar();
        else abrir();
        return;
      }
      if (aberto) {
        if (e.key === 'Escape') {
          e.preventDefault();
          fechar();
        }
        return;
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (elementoEditavel(e.target instanceof Element ? e.target : null)) return;
      e.preventDefault();
      abrir();
    };
    document.addEventListener('keydown', aoTeclaGlobal);
    return () => document.removeEventListener('keydown', aoTeclaGlobal);
  }, [aberto, abrir, fechar]);

  function aoTeclar(e: ReactKeyboardEvent<HTMLInputElement>) {
    const total = planos.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo((atual) => (atual + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo((atual) => (atual - 1 + total) % total);
    } else if (e.key === 'Home') {
      if (total > 0) {
        e.preventDefault();
        setIndiceAtivo(0);
      }
    } else if (e.key === 'End') {
      if (total > 0) {
        e.preventDefault();
        setIndiceAtivo(total - 1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (total > 0) ativar(indiceAtivo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar();
    } else if (e.key === 'Tab') {
      // O input e o unico elemento focavel da paleta: segurar o Tab aqui e o
      // mini-trap inteiro (navegacao dos resultados e por activedescendant).
      e.preventDefault();
    }
  }

  const opcaoAtivaId =
    aberto && planos[indiceAtivo] ? `${listaId}-op-${indiceAtivo}` : undefined;

  function renderOpcao(it: ResultadoBusca) {
    const idx = indicePorChave.get(it.chave) ?? 0;
    const ativo = idx === indiceAtivo;
    const Icone = it.icone ? ICONES[it.icone] : null;
    return (
      <div
        key={it.chave}
        id={`${listaId}-op-${idx}`}
        role="option"
        aria-selected={ativo}
        className="paleta-opcao"
        data-ativo={ativo ? 'true' : undefined}
        title={it.dica}
        onMouseEnter={() => setIndiceAtivo(idx)}
        onClick={() => ativar(idx)}
      >
        {Icone && (
          <span className="paleta-opcao-icone" aria-hidden="true">
            <Icone />
          </span>
        )}
        <span className="paleta-opcao-corpo">
          <span className="paleta-opcao-topo">
            <span className="paleta-opcao-nome">
              <TrechoDestacado texto={it.titulo} consulta={consultaNorm} />
            </span>
            {it.codigo && (
              <span className="paleta-opcao-cod mono num">
                <TrechoDestacado texto={it.codigo} consulta={consultaNorm} />
              </span>
            )}
          </span>
          <span className="paleta-opcao-sub">
            {it.resumo && (
              <span className="paleta-opcao-resumo">
                <TrechoDestacado texto={it.resumo} consulta={consultaNorm} />
              </span>
            )}
            {it.selo && (
              <span
                className={`paleta-selo${it.selo.mono ? ' mono num' : ''}`}
                data-tom={it.selo.tom}
              >
                {it.selo.texto}
              </span>
            )}
          </span>
        </span>
      </div>
    );
  }

  const paleta = presenca.montado ? (
    <div
      className="paleta-veu"
      data-fase={presenca.fase}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
    >
      <div
        className="paleta"
        data-fase={presenca.fase}
        role="dialog"
        aria-modal="true"
        aria-label="Busca universal"
      >
        <div className="paleta-entrada">
          <IconeLupa />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls={listaId}
            aria-activedescendant={opcaoAtivaId}
            aria-autocomplete="list"
            className="paleta-input"
            value={consulta}
            placeholder="Buscar pedidos, parceiros e documentos"
            aria-label="Buscar pedidos, parceiros e documentos"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={aoTeclar}
          />
          <kbd className="paleta-esc" aria-hidden="true">
            esc
          </kbd>
        </div>
        {/* .paleta-corpo ja e uma grid de colunas: quando o preview rico do
            item 35 entrar, a segunda coluna nasce aqui sem refazer o painel. */}
        <div className="paleta-corpo">
          <div
            ref={listaRef}
            id={listaId}
            role="listbox"
            aria-label="Resultados da busca"
            className="paleta-lista"
          >
            {secoes.length === 0 && (
              <div
                className="paleta-vazio"
                role="option"
                aria-selected={false}
                aria-disabled="true"
              >
                {consultaNorm
                  ? `Nada corresponde a “${consulta}”.`
                  : 'Nenhum item para buscar ainda.'}
              </div>
            )}
            {secoes.map((sec) => (
              <div key={sec.id} role="group" aria-label={sec.titulo} className="paleta-grupo">
                {mostrarRotulos && (
                  <div className="paleta-grupo-titulo" aria-hidden="true">
                    {sec.titulo}
                  </div>
                )}
                {sec.itens.map(renderOpcao)}
              </div>
            ))}
            <div role="group" aria-label={TITULO_COMANDOS} className="paleta-grupo">
              {mostrarRotulos && (
                <div className="paleta-grupo-titulo" aria-hidden="true">
                  {TITULO_COMANDOS}
                </div>
              )}
              {comandos.map(renderOpcao)}
            </div>
          </div>
        </div>
        <div className="paleta-rodape">
          <span className="paleta-dica">
            <kbd aria-hidden="true">↑</kbd>
            <kbd aria-hidden="true">↓</kbd>
            navegar
          </span>
          <span className="paleta-dica">
            <kbd aria-hidden="true">↵</kbd>
            abrir
          </span>
          <span className="paleta-dica">
            <kbd aria-hidden="true">esc</kbd>
            fechar
          </span>
          <span className="paleta-conta" role="status">
            {consultaNorm !== '' && totalVisiveis > 0
              ? totalVisiveis === 1
                ? '1 resultado'
                : `${totalVisiveis} resultados`
              : ''}
          </span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="busca">
      {/* Gatilho com cara de campo: herda o "input pequeno na topbar" do
          recorte original, mas so abre a paleta (aria-haspopup=dialog) —
          o input de verdade mora no overlay. */}
      <button
        ref={gatilhoRef}
        type="button"
        className="busca-gatilho"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Buscar pedidos, parceiros e documentos"
      >
        <IconeLupa />
        <span className="busca-gatilho-texto">Buscar</span>
        <span className="busca-atalhos" aria-hidden="true">
          <kbd>{ehMac ? '⌘' : 'Ctrl'}</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      {/* Portal no body: a paleta nao pode nascer dentro de .palco-coluna,
          que recebe inert quando gaveta ou menu mobile abrem. */}
      {paleta && createPortal(paleta, document.body)}
    </div>
  );
}
