// Busca universal da topbar (spec 0017, item 35): o recorte da call e uma
// busca rapida de navegacao, com resultados ao vivo enquanto digita. Cobre
// so o que ja esta carregado no cliente — lista de pedidos (useTorre),
// agenda de contatos (useTorre) e versoes cujas projecoes ja passaram pelo
// cache de rede.ts. Nenhum endpoint novo nesta wave; o preview rico do
// item 35 fica fora (decisao registrada no brief-topo.md).
//
// Teclado e leitores: combobox com popup listbox e aria-activedescendant,
// mesmo desenho do SeletorPedidoPopover — a diferenca e que aqui o input e
// o proprio gatilho, entao o activedescendant mora nele (o elemento com
// foco), forma que o APG recomenda para autocomplete.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Contato } from '../../../shared/model.ts';
import type { PedidoResumo } from '../api.ts';
import { usePresencaAnimada } from '../usePresencaAnimada.ts';
import type { RotaTorre } from '../useTorre.ts';
import { IconeLupa } from './icones.tsx';
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

// Teto por secao no dropdown: a navegacao rapida fica escaneavel e a lista
// nunca empurra o menu para fora da altura util.
const LIMITE_POR_SECAO: Record<SecaoResultado, number> = {
  pedidos: 6,
  parceiros: 3,
  documentos: 3,
};

type SecaoResultado = Extract<SecaoId, 'pedidos' | 'parceiros' | 'documentos'>;
const ORDEM_SECOES: readonly SecaoResultado[] = ['pedidos', 'parceiros', 'documentos'];

export interface ResultadoBusca {
  chave: string;
  secao: SecaoResultado;
  titulo: string;
  resumo?: string;
  selo?: SeloWiki;
  codigo?: string;
  href?: string;
  abreAgenda?: boolean;
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
      <strong className="busca-mark">{texto.slice(ini, fim)}</strong>
      {texto.slice(fim)}
    </>
  );
}

// Transforma o ItemWiki do menuwiki em linha de resultado, preservando os
// mesmos titulo/resumo/selo/href que o indice lateral ja mostra (mesma
// fonte de verdade, mesmo texto; o href segue a rota, como no seletor).
function deItemWiki(
  item: ItemWiki,
  secao: SecaoResultado,
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

export interface BuscaUniversalProps {
  pedidos: readonly PedidoResumo[];
  contatos: readonly Contato[];
  rota: RotaTorre;
  aoAbrirAgenda: () => void;
}

export function BuscaUniversal({ pedidos, contatos, rota, aoAbrirAgenda }: BuscaUniversalProps) {
  const baseId = useId();
  const listaId = `${baseId}-lista`;
  const raizRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

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
        extra: `${p.pedidoId} ${p.status ?? ''}`,
      }),
    );
    itens.push(
      ...itensContatos(contatos).map((item) =>
        deItemWiki(item, 'parceiros', { abreAgenda: true }),
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

  // Secoes capadas na ordem fixa; a navegacao por setas indexa a lista plana.
  const secoes = useMemo(
    () =>
      ORDEM_SECOES.map((id) => ({
        id,
        titulo: TITULO_SECAO[id],
        itens: filtrados.filter((it) => it.secao === id).slice(0, LIMITE_POR_SECAO[id]),
      })).filter((sec) => sec.itens.length > 0),
    [filtrados],
  );
  const planos = useMemo(() => secoes.flatMap((sec) => sec.itens), [secoes]);
  const indicePorChave = useMemo(
    () => new Map(planos.map((it, i) => [it.chave, i])),
    [planos],
  );

  const fechar = useCallback(() => setAberto(false), []);

  const limpar = useCallback(() => {
    setConsulta('');
    setConsultaAtiva('');
  }, []);

  const ativar = useCallback(
    (idx: number) => {
      const alvo = planos[idx];
      if (!alvo) return;
      fechar();
      limpar();
      if (alvo.abreAgenda) {
        aoAbrirAgenda();
      } else if (alvo.href) {
        window.location.hash = alvo.href;
      }
    },
    [planos, fechar, limpar, aoAbrirAgenda],
  );

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
      ?.querySelector('.busca-opcao[data-ativo="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [aberto, indiceAtivo]);

  // Clique fora fecha; foco fora tambem (Tab navega para frente).
  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: PointerEvent) => {
      if (raizRef.current && e.target instanceof Node && !raizRef.current.contains(e.target)) {
        fechar();
      }
    };
    document.addEventListener('pointerdown', aoClicarFora);
    return () => document.removeEventListener('pointerdown', aoClicarFora);
  }, [aberto, fechar]);

  // "/" abre a busca de qualquer ponto fora de campo editavel — atalho
  // canonico de busca global; a dica visivel e o <kbd> dentro do campo.
  useEffect(() => {
    const aoTeclaGlobal = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (elementoEditavel(e.target instanceof Element ? e.target : null)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', aoTeclaGlobal);
    return () => document.removeEventListener('keydown', aoTeclaGlobal);
  }, []);

  function aoTeclar(e: ReactKeyboardEvent<HTMLInputElement>) {
    const total = planos.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!aberto) {
        setAberto(true);
        setIndiceAtivo(0);
      } else if (total > 0) {
        setIndiceAtivo((atual) => (atual + 1) % total);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (aberto && total > 0) setIndiceAtivo((atual) => (atual - 1 + total) % total);
    } else if (e.key === 'Home') {
      if (aberto && total > 0) {
        e.preventDefault();
        setIndiceAtivo(0);
      }
    } else if (e.key === 'End') {
      if (aberto && total > 0) {
        e.preventDefault();
        setIndiceAtivo(total - 1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (total > 0) ativar(indiceAtivo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (aberto) fechar();
      else limpar();
    } else if (e.key === 'Tab') {
      fechar();
    }
  }

  const opcaoAtivaId =
    aberto && planos[indiceAtivo] ? `${listaId}-op-${indiceAtivo}` : undefined;

  return (
    <div
      ref={raizRef}
      className="busca"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) fechar();
      }}
    >
      <div className="busca-campo">
        <IconeLupa />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-activedescendant={opcaoAtivaId}
          aria-autocomplete="list"
          className="busca-input"
          value={consulta}
          placeholder="Buscar"
          aria-label="Buscar pedidos, parceiros e documentos"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            if (consulta) setAberto(true);
          }}
          onChange={(e) => {
            setConsulta(e.target.value);
            setAberto(true);
          }}
          onKeyDown={aoTeclar}
        />
        <kbd className="busca-atalho" aria-hidden="true">
          /
        </kbd>
      </div>

      {presenca.montado && (
        <div className="busca-menu" data-fase={presenca.fase}>
          <div
            ref={listaRef}
            id={listaId}
            role="listbox"
            aria-label="Resultados da busca"
            className="busca-lista"
          >
            {planos.length === 0 && (
              <div
                className="busca-vazio"
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
              <div key={sec.id} role="group" aria-label={sec.titulo} className="busca-grupo">
                <div className="busca-grupo-titulo" aria-hidden="true">
                  {sec.titulo}
                </div>
                {sec.itens.map((it) => {
                  const idx = indicePorChave.get(it.chave) ?? 0;
                  const ativo = idx === indiceAtivo;
                  return (
                    <div
                      key={it.chave}
                      id={`${listaId}-op-${idx}`}
                      role="option"
                      aria-selected={ativo}
                      className="busca-opcao"
                      data-ativo={ativo ? 'true' : undefined}
                      title={it.dica}
                      onMouseEnter={() => setIndiceAtivo(idx)}
                      onClick={() => ativar(idx)}
                    >
                      <span className="busca-opcao-corpo">
                        <span className="busca-opcao-topo">
                          <span className="busca-opcao-nome">
                            <TrechoDestacado texto={it.titulo} consulta={consultaNorm} />
                          </span>
                          {it.codigo && (
                            <span className="busca-opcao-cod mono num">
                              <TrechoDestacado texto={it.codigo} consulta={consultaNorm} />
                            </span>
                          )}
                        </span>
                        <span className="busca-opcao-sub">
                          {it.resumo && (
                            <span className="busca-opcao-resumo">
                              <TrechoDestacado texto={it.resumo} consulta={consultaNorm} />
                            </span>
                          )}
                          {it.selo && (
                            <span
                              className={`busca-selo${it.selo.mono ? ' mono num' : ''}`}
                              data-tom={it.selo.tom}
                            >
                              {it.selo.texto}
                            </span>
                          )}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {consultaNorm !== '' && planos.length > 0 && (
            <div className="busca-conta" role="status">
              {planos.length === 1 ? '1 resultado' : `${planos.length} resultados`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
