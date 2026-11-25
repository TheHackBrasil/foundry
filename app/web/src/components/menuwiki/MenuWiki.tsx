// Indice wiki do rail esquerdo (spec 0014, THE-20): secoes dobraveis para
// pedidos, parceiros (agenda), documentos (versoes dos pedidos) e regras
// (propostas de mapeamento da fila de revisao). Mantem o contrato do antigo
// PedidoLista: href por rota, aria-current no selecionado, retry no erro e
// aoSelecionarMobile em todo item navegavel.
import { useEffect, useId, useMemo, useState } from 'react';
import type { Contato, ItemRevisao, VersaoPedido } from '../../../../shared/model.ts';
import { obterPedido, type PedidoResumo } from '../../api.ts';
import { listarContatos, listarRevisao } from '../../apiOps.ts';
import { IconeChevron, IconeLupa } from '../icones.tsx';
import type { Carga, RotaTorre } from '../../useTorre.ts';
import '../../menuwiki.css';
import {
  CHAVE_COLAPSO,
  filtrarSecoes,
  itemPedido,
  itensContatos,
  itensDocumentos,
  itensRegras,
  lerColapso,
  normalizarConsulta,
  serializarColapso,
  TITULO_SECAO,
  type Colapso,
  type ItemWiki,
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
// A projecao de cada pedido e buscada uma vez por ciclo de lista; o teto
// protege workspaces grandes de uma rajada de GETs por render.
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
  const [consulta, setConsulta] = useState('');
  const [abertas, setAbertas] = useState<Colapso>(carregarColapso);
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

  // Agenda e fila mudam por ingest e por decisao na revisao: a rebusta segue
  // o mesmo ciclo da lista de pedidos (SSE ja a atualiza).
  useEffect(() => {
    let vivo = true;
    listarContatos()
      .then((dados) => {
        if (vivo) setContatos({ estado: 'ok', dados });
      })
      .catch((e) => {
        if (vivo) setContatos({ estado: 'erro', mensagem: mensagemDe(e) });
      });
    listarRevisao()
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

  // Documentos: uma versao na projecao = um documento recebido (RF18). Pedido
  // que falha contribui zero documentos, nao derruba a secao.
  useEffect(() => {
    let vivo = true;
    if (listaCompleta.length === 0) {
      setDocs({ estado: 'ok', dados: [] });
      return;
    }
    const alvos = listaCompleta.slice(0, MAX_PEDIDOS_DOC);
    Promise.all(
      alvos.map((p) =>
        obterPedido(p.pedidoId)
          .then((proj) => ({ pedido: p, versoes: proj.versoes }))
          .catch((): { pedido: PedidoResumo; versoes: VersaoPedido[] } => ({ pedido: p, versoes: [] })),
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
  }, [listaCompleta, rota]);

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

  const consultaAtiva = normalizarConsulta(consulta) !== '';
  const secoesVisiveis = useMemo(() => {
    const filtradas = consultaAtiva ? filtrarSecoes(secoesBase, consulta) : secoesBase;
    const visiveis = filtradas.filter((sec) => {
      if (sec.id === 'pedidos') return true;
      const carga = sec.id === 'parceiros' ? contatos : sec.id === 'documentos' ? docs : revisao;
      // Carregando ou com erro a secao aparece (a linha de status vem dentro);
      // vazia de verdade ela some do indice.
      return consultaAtiva ? sec.itens.length > 0 : carga.estado !== 'ok' || sec.itens.length > 0;
    });
    // Mesmo filtrada a secao Pedidos fica: e onde moram o erro e o retry.
    if (pedidos.estado !== 'ok' && !visiveis.some((s) => s.id === 'pedidos')) {
      const base = secoesBase.find((s) => s.id === 'pedidos');
      if (base) visiveis.unshift(base);
    }
    return visiveis;
  }, [secoesBase, consulta, consultaAtiva, contatos, docs, revisao, pedidos.estado]);

  const alternar = (id: SecaoId) =>
    setAbertas((prev) => ({ ...prev, [id]: !prev[id] }));

  const corpoItem = (item: ItemWiki) => (
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

  const renderItem = (sec: SecaoWiki, item: ItemWiki) => {
    const aoAbrirExtra =
      sec.id === 'parceiros' ? aoAbrirAgenda : sec.id === 'regras' ? aoAbrirRevisao : undefined;
    return (
      <li key={item.id}>
        {item.href ? (
          <a
            className="mw-item mw-item-link"
            href={item.href}
            title={item.tituloCompleto}
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
            title={item.tituloCompleto}
            onClick={aoAbrirExtra}
          >
            {corpoItem(item)}
          </button>
        ) : (
          <div className="mw-item" title={item.tituloCompleto}>
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
    <section className="mw" aria-labelledby={`${baseId}-titulo`}>
      <div className="mw-cab">
        <h2 id={`${baseId}-titulo`}>Índice</h2>
        <div className="mw-busca">
          <IconeLupa />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Filtrar o índice"
            aria-label="Filtrar o índice"
            autoComplete="off"
          />
        </div>
      </div>

      <nav className="mw-secoes" aria-label="Índice do workspace">
        {secoesVisiveis.map((sec) => {
          const carga = statusDaSecao(sec);
          const headingId = `${baseId}-h-${sec.id}`;
          const contentId = `${baseId}-c-${sec.id}`;
          // Durante a busca as secoes abrem para mostrar os resultados; o
          // colapso gravado volta a valer quando o campo esvazia.
          const aberta = consultaAtiva ? true : abertas[sec.id];

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

              <div id={contentId} className="mw-conteudo" hidden={!aberta}>
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
                  listaCompleta.length === 0 &&
                  !consultaAtiva && (
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

      {consultaAtiva && secoesVisiveis.every((s) => s.itens.length === 0) && (
        <div className="mw-vazio-grupo">
          <p className="mw-vazio" role="status">
            Nenhum item corresponde ao filtro.
          </p>
          <button type="button" className="rail-btn-sutil" onClick={() => setConsulta('')}>
            Limpar filtro
          </button>
        </div>
      )}
    </section>
  );
}
