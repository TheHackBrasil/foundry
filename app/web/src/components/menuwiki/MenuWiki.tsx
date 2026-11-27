// Indice wiki do rail esquerdo (spec 0014, THE-20): secoes dobraveis para
// pedidos, parceiros (agenda), documentos (versoes dos pedidos) e regras
// (propostas de mapeamento da fila de revisao). Mantem o contrato do antigo
// PedidoLista: href por rota, aria-current no selecionado, retry no erro e
// aoSelecionarMobile em todo item navegavel. O modo compacto (spec 0017,
// item 40) e o padrao: uma linha por item so com o nome (menu rapido,
// call 26/11); selo e resumo saem da tela e continuam acessiveis via
// title/aria-label. O toggle ao lado da busca persiste em CHAVE_MODO.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Contato, ItemRevisao } from '../../../../shared/model.ts';
import type { PedidoResumo } from '../../api.ts';
import { IconeChevron } from '../icones.tsx';
import type { Carga, RotaTorre } from '../../useTorre.ts';
import { buscarContatos, buscarRevisao, buscarVersoesPedido } from './rede.ts';
import '../../menuwiki.css';
import {
  CHAVE_COLAPSO,
  CHAVE_MODO,
  dicaItem,
  itemPedido,
  itensContatos,
  itensDocumentos,
  itensRegras,
  lerColapso,
  lerModo,
  nomeAcessivelItem,
  serializarColapso,
  serializarModo,
  TITULO_SECAO,
  type Colapso,
  type ItemWiki,
  type ModoLista,
  type SecaoId,
  type SecaoWiki,
  type SeloWiki,
} from './dados.ts';

export interface MenuWikiProps {
  pedidos: Carga<PedidoResumo[]>;
  selecionado: string | null;
  rota: RotaTorre;
  aoTentarDeNovo: () => void;
  aoSelecionarMobile?: () => void;
  // Fiacao opcional para a integracao: ligam Parceiros e Regras aos drawers
  // ja existentes. Sem elas, os itens dessas secoes sao informativos.
  aoAbrirAgenda?: () => void;
  aoAbrirRevisao?: () => void;
}

const LISTA_VAZIA: readonly PedidoResumo[] = [];
// A projecao de cada pedido e buscada sob demanda (secao aberta e visivel);
// o teto protege workspaces grandes de uma rajada de GETs por render.
const MAX_PEDIDOS_DOC = 8;
const MAX_ITENS_DOC = 20;

const CLASSE_SELO: Record<SeloWiki['tom'], string> = {
  ok: 'rail-badge-ok',
  warn: 'rail-badge-warn',
  coord: 'rail-badge-coord',
  erro: 'rail-badge-erro',
  sutil: 'mw-selo-sutil',
};

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : 'Erro inesperado.');

function carregarColapso(): Colapso {
  try {
    return lerColapso(window.localStorage.getItem(CHAVE_COLAPSO));
  } catch {
    return lerColapso(null);
  }
}

function carregarModo(): ModoLista {
  try {
    return lerModo(window.localStorage.getItem(CHAVE_MODO));
  } catch {
    return lerModo(null);
  }
}

// Glifo do modo compacto: quatro tracos densos, uma linha por item. Mesma
// materia da familia de icones (stroke currentColor sobre grade 16x16).
function IconeCompacto() {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable={false}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h10"
      />
    </svg>
  );
}

export function MenuWiki({
  pedidos,
  selecionado,
  rota,
  aoTentarDeNovo,
  aoSelecionarMobile,
  aoAbrirAgenda,
  aoAbrirRevisao,
}: MenuWikiProps) {
  const baseId = useId();
  const [abertas, setAbertas] = useState<Colapso>(carregarColapso);
  const [modo, setModo] = useState<ModoLista>(carregarModo);
  const [contatos, setContatos] = useState<Carga<Contato[]>>({ estado: 'carregando' });
  const [revisao, setRevisao] = useState<Carga<ItemRevisao[]>>({ estado: 'carregando' });
  const [docs, setDocs] = useState<Carga<ItemWiki[]>>({ estado: 'carregando' });

  const listaCompleta = pedidos.estado === 'ok' ? pedidos.dados : LISTA_VAZIA;

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_COLAPSO, serializarColapso(abertas));
    } catch {
      // Modo privado ou cota cheia: o colapso vira so estado de memoria.
    }
  }, [abertas]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_MODO, serializarModo(modo));
    } catch {
      // Mesmo caso do colapso: sem storage, o modo vira so memoria.
    }
  }, [modo]);

  const compacto = modo === 'compacto';

  // Agenda e fila mudam por ingest e por decisao na revisao: a rebusta segue
  // o mesmo ciclo da lista de pedidos (SSE ja a atualiza). Os GETs passam pelo
  // dedupe de rede.ts: quem chega junto divide a mesma promise em voo.
  useEffect(() => {
    let vivo = true;
    buscarContatos()
      .then((dados) => {
        if (vivo) setContatos({ estado: 'ok', dados });
      })
      .catch((e) => {
        if (vivo) setContatos({ estado: 'erro', mensagem: mensagemDe(e) });
      });
    buscarRevisao()
      .then((r) => {
        if (vivo) setRevisao({ estado: 'ok', dados: Array.isArray(r.itens) ? r.itens : [] });
      })
      .catch((e) => {
        if (vivo) setRevisao({ estado: 'erro', mensagem: mensagemDe(e) });
      });
    return () => {
      vivo = false;
    };
  }, [listaCompleta]);

  const secoesBase = useMemo<SecaoWiki[]>(
    () => [
      {
        id: 'pedidos',
        titulo: TITULO_SECAO.pedidos,
        itens: listaCompleta.map((p) => itemPedido(p, rota)),
      },
      {
        id: 'parceiros',
        titulo: TITULO_SECAO.parceiros,
        itens: contatos.estado === 'ok' ? itensContatos(contatos.dados) : [],
      },
      {
        id: 'documentos',
        titulo: TITULO_SECAO.documentos,
        itens: docs.estado === 'ok' ? docs.dados : [],
      },
      {
        id: 'regras',
        titulo: TITULO_SECAO.regras,
        itens: revisao.estado === 'ok' ? itensRegras(revisao.dados) : [],
      },
    ],
    [listaCompleta, rota, contatos, docs, revisao],
  );

  const secoesVisiveis = useMemo(() => {
    const visiveis = secoesBase.filter((sec) => {
      if (sec.id === 'pedidos') return true;
      const carga = sec.id === 'parceiros' ? contatos : sec.id === 'documentos' ? docs : revisao;
      // Carregando ou com erro a secao aparece (a linha de status vem dentro);
      // vazia de verdade ela some do indice.
      return carga.estado !== 'ok' || sec.itens.length > 0;
    });
    if (pedidos.estado !== 'ok' && !visiveis.some((s) => s.id === 'pedidos')) {
      const base = secoesBase.find((s) => s.id === 'pedidos');
      if (base) visiveis.unshift(base);
    }
    return visiveis;
  }, [secoesBase, contatos, docs, revisao, pedidos.estado]);

  const abertaDocumentos = abertas.documentos;
  const secaoDocumentosRef = useRef<HTMLDivElement | null>(null);
  const [documentosVisiveis, setDocumentosVisiveis] = useState(false);

  // Documentos carrega tarde: a secao so busca versoes quando aberta e dentro
  // da viewport (ou imediatamente se o navegador nao tem IntersectionObserver).
  useEffect(() => {
    const el = secaoDocumentosRef.current;
    if (!abertaDocumentos || !el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setDocumentosVisiveis(true);
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        const entrada = entradas[0];
        if (!entrada) return;
        if (entrada.isIntersecting) {
          setDocumentosVisiveis(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [abertaDocumentos, listaCompleta.length]);

  // Documentos: uma versao na projecao = um documento recebido (RF18). Pedido
  // que falha contribui zero documentos, nao derruba a secao. Cache por
  // revisao (rede.ts): pedido sem evento novo nao refaz GET.
  useEffect(() => {
    let vivo = true;
    if (!documentosVisiveis) return;
    if (listaCompleta.length === 0) {
      setDocs({ estado: 'ok', dados: [] });
      return;
    }
    const alvos = listaCompleta.slice(0, MAX_PEDIDOS_DOC);
    Promise.all(
      alvos.map((p) =>
        buscarVersoesPedido(p)
          .then((proj) => ({ pedido: p, versoes: proj.versoes }))
          .catch(() => ({ pedido: p, versoes: [] as const })),
      ),
    )
      .then((entradas) => {
        if (vivo) setDocs({ estado: 'ok', dados: itensDocumentos(entradas, rota, MAX_ITENS_DOC) });
      })
      .catch((e) => {
        if (vivo) setDocs({ estado: 'erro', mensagem: mensagemDe(e) });
      });
    return () => {
      vivo = false;
    };
  }, [listaCompleta, rota, documentosVisiveis]);

  const alternar = (id: SecaoId) =>
    setAbertas((prev) => ({ ...prev, [id]: !prev[id] }));

  // Strip da call 26/11: no compacto so o nome sai na tela, sem selo nem
  // linha de resumo ("tem que ser tipo um menu rapido"). Selo e resumo
  // continuam no title/aria-label (dicaItem/nomeAcessivelItem) e viram
  // spans .so-leitor no item estatico (div sem papel), onde aria-label nao
  // e honrado; nos navegaveis o aria-label vence e nada duplica.
  const corpoItem = (item: ItemWiki) => {
    if (compacto) {
      return (
        <>
          <span className="mw-item-titulo">{item.titulo}</span>
          {item.selo && <span className="so-leitor">{item.selo.texto}</span>}
          {item.resumo && <span className="so-leitor">{item.resumo}</span>}
        </>
      );
    }
    return (
      <>
        <span className="mw-item-topo">
          <span className="mw-item-titulo">{item.titulo}</span>
          {item.selo && (
            <span
              className={`rail-badge num ${item.selo.mono ? 'mono ' : ''}${CLASSE_SELO[item.selo.tom]}`}
            >
              {item.selo.texto}
            </span>
          )}
        </span>
        {item.resumo && <span className="mw-item-sub">{item.resumo}</span>}
      </>
    );
  };

  const renderItem = (sec: SecaoWiki, item: ItemWiki) => {
    const aoAbrirExtra =
      sec.id === 'parceiros' ? aoAbrirAgenda : sec.id === 'regras' ? aoAbrirRevisao : undefined;
    const dica = dicaItem(item, compacto);
    const nome = nomeAcessivelItem(item, compacto);
    return (
      <li key={item.id}>
        {item.href ? (
          <a
            className="mw-item mw-item-link"
            href={item.href}
            title={dica}
            aria-label={nome}
            // aria-current so na secao Pedidos: um documento aponta para o
            // mesmo pedido, mas a pagina corrente e o pedido, nao o documento.
            aria-current={
              sec.id === 'pedidos' && item.pedidoId === selecionado ? 'page' : undefined
            }
            onClick={aoSelecionarMobile}
          >
            {corpoItem(item)}
          </a>
        ) : aoAbrirExtra ? (
          <button
            type="button"
            className="mw-item mw-item-link"
            title={dica}
            aria-label={nome}
            onClick={aoAbrirExtra}
          >
            {corpoItem(item)}
          </button>
        ) : (
          <div className="mw-item" title={dica}>
            {corpoItem(item)}
          </div>
        )}
      </li>
    );
  };

  const statusDaSecao = (sec: SecaoWiki) => {
    if (sec.id === 'pedidos') return pedidos;
    return sec.id === 'parceiros' ? contatos : sec.id === 'documentos' ? docs : revisao;
  };

  return (
    <section className={compacto ? 'mw mw-compacto' : 'mw'} aria-labelledby={`${baseId}-titulo`}>
      <div className="mw-cab">
        <h2 id={`${baseId}-titulo`}>Índice</h2>
        <div className="mw-cab-linha">
          <button
            type="button"
            className="mw-modo"
            aria-pressed={compacto}
            aria-label="Lista compacta"
            title={compacto ? 'Mostrar resumo dos itens' : 'Ocultar resumo dos itens'}
            onClick={() => setModo(compacto ? 'expandido' : 'compacto')}
          >
            <IconeCompacto />
          </button>
        </div>
      </div>

      <nav className="mw-secoes" aria-label="Índice do workspace">
        {secoesVisiveis.map((sec) => {
          const carga = statusDaSecao(sec);
          const headingId = `${baseId}-h-${sec.id}`;
          const contentId = `${baseId}-c-${sec.id}`;
          // Pedidos abre a forca enquanto o erro/retry precisa ficar a vista.
          const aberta = abertas[sec.id] || (sec.id === 'pedidos' && carga.estado === 'erro');

          return (
            <section key={sec.id} className="mw-secao" aria-labelledby={headingId}>
              <h3 id={headingId} className="mw-secao-titulo">
                <button
                  type="button"
                  className="mw-secao-btn"
                  aria-expanded={aberta}
                  aria-controls={contentId}
                  onClick={() => alternar(sec.id)}
                >
                  <IconeChevron />
                  <span className="mw-secao-nome">{sec.titulo}</span>
                  {sec.itens.length > 0 && <span className="mw-conta">{sec.itens.length}</span>}
                </button>
              </h3>

              <div
                id={contentId}
                className="mw-conteudo"
                hidden={!aberta}
                ref={sec.id === 'documentos' ? secaoDocumentosRef : undefined}
              >
                {sec.id === 'pedidos' && carga.estado === 'carregando' && (
                  <p className="mw-vazio">Carregando pedidos…</p>
                )}

                {sec.id === 'pedidos' && carga.estado === 'erro' && (
                  <div className="aviso-erro" role="alert">
                    <p>Não foi possível carregar os pedidos: {carga.mensagem}</p>
                    <button type="button" className="botao" onClick={aoTentarDeNovo}>
                      Tentar de novo
                    </button>
                  </div>
                )}

                {sec.id === 'pedidos' &&
                  carga.estado === 'ok' &&
                  listaCompleta.length === 0 && (
                    <p className="mw-vazio">
                      Nenhum pedido ainda. Envie uma NF-e em XML para criar o primeiro.
                    </p>
                  )}

                {sec.id !== 'pedidos' && carga.estado === 'carregando' && (
                  <p className="mw-vazio">Carregando {sec.titulo.toLowerCase()}…</p>
                )}

                {sec.id !== 'pedidos' && carga.estado === 'erro' && (
                  <p className="mw-vazio" role="status">
                    {carga.mensagem}
                  </p>
                )}

                {sec.itens.length > 0 && (
                  <ul className="mw-itens">{sec.itens.map((item) => renderItem(sec, item))}</ul>
                )}
              </div>
            </section>
          );
        })}
      </nav>

    </section>
  );
}
