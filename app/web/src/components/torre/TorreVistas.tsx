import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  LAYOUT_PADRAO,
  TEMPLATE_LAYOUT_PADRAO,
  definirVistaGlobal,
  guardarVistaMeta,
  lerLayoutPedido,
  lerVistasMeta,
  mesclarMetaTemplate,
  templateDeLayout,
  type CardId,
  type LayoutTorre,
  type VistaMeta,
  type VistaTemplate,
} from './layout.ts';
import '../../vistas.css';

interface CardVisibilidade {
  id: CardId;
  titulo: string;
  oculto: boolean;
}

interface TorreVistasProps {
  presets: readonly VistaTemplate[];
  customizados: readonly VistaTemplate[];
  ativoId: string | null;
  cards: readonly CardVisibilidade[];
  densidade: 0 | 1 | 2;
  // Pedido aberto: base dos snapshots de Desfazer e da captura completa da
  // vista (recolhidos/densidade moram no layout persistido). Sem a prop, a
  // rota #/pedido/:id é usada como fallback; sem as duas, o Desfazer deixa de
  // ser oferecido sem quebrar o resto.
  pedidoId?: string;
  aoAplicar: (template: VistaTemplate) => void;
  // Segundo argumento opcional: o layout vigente no salvar, para a integração
  // gravar a vista completa direto no template. O callback atual do Grid o
  // ignora sem custo (argumento extra é descartado).
  aoSalvarCustom: (nome: string, layoutAtual?: LayoutTorre) => void;
  aoExcluirCustom: (id: string) => void;
  // Reinsere uma vista excluída (Desfazer de excluir). Opcional: ausente, o
  // toast de exclusão informa sem oferecer a reversão.
  aoRestaurarVista?: (template: VistaTemplate) => void;
  aoAlternarCard: (id: CardId) => void;
  aoMostrarTodos: () => void;
  aoAlternarDensidade: () => void;
  // Contrato com polish-motor (spec 0015): define a densidade explicitamente.
  // Sem a prop, o fallback chama o ciclo atual as vezes necessárias — defensivo
  // e temporário até a integração.
  aoDefinirDensidade?: (d: 0 | 1 | 2) => void;
  // Ponte para a região aria-live global do app; o toast local (role=status)
  // anuncia sozinho quando ela não é passada.
  aoAnunciar?: (texto: string) => void;
}

const DENSIDADES: ReadonlyArray<{ valor: 0 | 1 | 2; rotulo: string }> = [
  { valor: 0, rotulo: 'Compacta' },
  { valor: 1, rotulo: 'Normal' },
  { valor: 2, rotulo: 'Grande' },
];

interface Toast {
  key: number;
  texto: string;
  desfazer?: () => void;
}

// O pedido aberto está na rota hash (#/pedido/:id, mesma leitura de useTorre).
function pedidoIdDaUrl(): string | null {
  try {
    const m = /^#\/pedido\/([^/?#]+)/.exec(window.location.hash);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// Barra de vistas do tiling (THE-19 + spec 0015): presets aplicam ordem +
// visibilidade, vistas salvas persistem em localStorage e o bloco "Cards" liga
// e desliga card a card. Estado salvo vem do localStorage, nunca inventado.
export function TorreVistas({
  presets,
  customizados,
  ativoId,
  cards,
  densidade,
  pedidoId,
  aoAplicar,
  aoSalvarCustom,
  aoExcluirCustom,
  aoRestaurarVista,
  aoAlternarCard,
  aoMostrarTodos,
  aoAlternarDensidade,
  aoDefinirDensidade,
  aoAnunciar,
}: TorreVistasProps) {
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  // Espelho do sidecar em state (rerender) + ref (leitura síncrona no clique).
  const [meta, setMeta] = useState<Record<string, VistaMeta>>(() => lerVistasMeta());
  const metaRef = useRef(meta);

  const inputRef = useRef<HTMLInputElement>(null);
  const botaoSalvarRef = useRef<HTMLButtonElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const chipsSalvosRef = useRef(new Map<string, HTMLButtonElement>());
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null]);
  // Id da vista vizinha que recebe o foco depois de uma exclusão (V6).
  const focoPendenteRef = useRef<string | null>(null);
  // Diff pós-salvar: o id novo em `customizados` recebe os campos do sidecar e
  // vira alvo do Desfazer — cobre a captura que o Grid ainda não faz (V5).
  const pendenteSalvarRef = useRef<{ nome: string; idsAntes: Set<string> } | null>(null);

  function pedidoAtual(): string | null {
    return pedidoId ?? pedidoIdDaUrl();
  }

  function layoutPersistido(): LayoutTorre | null {
    const pid = pedidoAtual();
    return pid ? lerLayoutPedido(pid) : null;
  }

  function atualizarMeta() {
    const m = lerVistasMeta();
    metaRef.current = m;
    setMeta(m);
  }

  function mostrarToast(texto: string, desfazer?: () => void) {
    setToast({ key: Date.now(), texto, desfazer });
    aoAnunciar?.(texto);
  }

  // Template do estado vigente: reaplicá-lo é o "Desfazer" das mutações da
  // barra. Sem layout persistido, o padrão é um fallback seguro.
  function snapshotTemplate(): VistaTemplate {
    return templateDeLayout(layoutPersistido() ?? { ...LAYOUT_PADRAO });
  }

  function aplicarVista(t: VistaTemplate) {
    const antes = snapshotTemplate();
    // Sidecar entra aqui: recolhidos/densidade salvos pela barra viajam no
    // template mesmo quando o Grid ainda não os capturou (V5).
    aoAplicar(mesclarMetaTemplate(t, metaRef.current[t.id]));
    mostrarToast(`Vista "${t.nome}" aplicada.`, () => {
      aoAplicar(antes);
      mostrarToast('Aplicação desfeita.');
    });
  }

  function restaurarPadrao() {
    const antes = snapshotTemplate();
    aoAplicar(TEMPLATE_LAYOUT_PADRAO);
    mostrarToast('Layout padrão restaurado.', () => {
      aoAplicar(antes);
      mostrarToast('Layout anterior restaurado.');
    });
  }

  function definirDensidade(d: 0 | 1 | 2) {
    if (d === densidade) return;
    if (aoDefinirDensidade) {
      aoDefinirDensidade(d);
      return;
    }
    // Fallback do contrato tolerante: o ciclo do Grid atual avança +1 (mod 3).
    const passos = (d - densidade + 3) % 3;
    for (let i = 0; i < passos; i += 1) aoAlternarDensidade();
  }

  function teclaRadio(e: KeyboardEvent<HTMLButtonElement>, atual: number) {
    let prox: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') prox = (atual + 1) % 3;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prox = (atual + 2) % 3;
    else if (e.key === 'Home') prox = 0;
    else if (e.key === 'End') prox = 2;
    if (prox === null) return;
    e.preventDefault();
    definirDensidade(prox as 0 | 1 | 2);
    // APG radio: a seta move a seleção e o foco junto dela.
    radioRefs.current[prox]?.focus();
  }

  function abrirForm() {
    setFormAberto(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  // V6: sair do form (submit ou Escape) devolve o foco ao botão que o abriu.
  function fecharFormComFoco() {
    setFormAberto(false);
    setNome('');
    window.setTimeout(() => botaoSalvarRef.current?.focus(), 0);
  }

  function confirmar(e: FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;
    pendenteSalvarRef.current = {
      nome: limpo,
      idsAntes: new Set(customizados.map((t) => t.id)),
    };
    aoSalvarCustom(limpo, layoutPersistido() ?? undefined);
    fecharFormComFoco();
  }

  function excluirVista(t: VistaTemplate, indice: number) {
    // V6: o foco vai para a vista que ocupa o lugar da excluída (ou a anterior);
    // sem vizinhas, cai no botão "Salvar vista atual", nunca no body.
    const vizinha = customizados[indice + 1] ?? customizados[indice - 1];
    focoPendenteRef.current = vizinha ? vizinha.id : 'acoes';
    // Captura antes de limpar o sidecar: é o que o Desfazer reinsere.
    const completa = mesclarMetaTemplate(t, metaRef.current[t.id]);
    aoExcluirCustom(t.id);
    guardarVistaMeta(t.id, null);
    atualizarMeta();
    if (aoRestaurarVista) {
      mostrarToast(`Vista "${t.nome}" excluída.`, () => {
        aoRestaurarVista(completa);
        mostrarToast(`Vista "${t.nome}" restaurada.`);
      });
    } else {
      mostrarToast(`Vista "${t.nome}" excluída.`);
    }
  }

  function alternarGlobal(t: VistaTemplate) {
    const marcada = meta[t.id]?.global ?? t.global ?? false;
    definirVistaGlobal(marcada ? null : t.id);
    atualizarMeta();
    mostrarToast(
      marcada
        ? `"${t.nome}" deixou de ser a vista padrão.`
        : `"${t.nome}" agora abre em todos os pedidos.`,
    );
  }

  // V5: quando a vista recém-salva aparece na lista, grava no sidecar os
  // campos que o salvar do Grid ainda não captura e arma o Desfazer dela.
  useEffect(() => {
    const pend = pendenteSalvarRef.current;
    if (!pend) return;
    const nova = customizados.find((t) => !pend.idsAntes.has(t.id));
    if (!nova) return;
    pendenteSalvarRef.current = null;
    const l = layoutPersistido();
    guardarVistaMeta(nova.id, {
      ...(l?.recolhidos.length ? { recolhidos: l.recolhidos } : {}),
      ...(l?.densidade !== undefined ? { densidade: l.densidade } : {}),
    });
    atualizarMeta();
    mostrarToast(`Vista "${pend.nome}" salva.`, () => {
      aoExcluirCustom(nova.id);
      guardarVistaMeta(nova.id, null);
      atualizarMeta();
      mostrarToast(`Vista "${pend.nome}" removida.`);
    });
    // Deps propositalmente só em customizados: o gatilho é a chegada da vista
    // nova; layoutPersistido/mostrarToast leem refs e storage, não estado.
  }, [customizados]);

  // V6: foco devolvido à vizinha depois que a exclusão re-renderiza a lista.
  useEffect(() => {
    const alvo = focoPendenteRef.current;
    if (alvo === null) return;
    focoPendenteRef.current = null;
    const el = alvo === 'acoes' ? null : chipsSalvosRef.current.get(alvo);
    (el ?? botaoSalvarRef.current ?? barraRef.current)?.focus();
  }, [customizados]);

  // Toast sem ação some sozinho; com "Desfazer" fica até a pessoa dispensar
  // (regra a11y: toast que carrega ação não pode expirar embaixo do usuário).
  useEffect(() => {
    if (!toast || toast.desfazer) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const ocultosCount = cards.filter((c) => c.oculto).length;

  return (
    <div className="torre-vistas" role="group" aria-label="Vistas do painel" ref={barraRef} tabIndex={-1}>
      <div className="torre-vistas-linha">
        <div className="vistas-zona" role="group" aria-labelledby="vistas-zona-rotulo">
          <span id="vistas-zona-rotulo" className="vistas-rotulo">
            Layouts
          </span>
          <div className="torre-vistas-grupo" role="group" aria-label="Layouts prontos">
            {presets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                data-ativa={ativoId === t.id ? 'true' : undefined}
                aria-pressed={ativoId === t.id}
                aria-label={`Aplicar layout ${t.nome}`}
                title={`Aplicar layout ${t.nome}`}
                onClick={() => aplicarVista(t)}
              >
                {t.nome}
              </button>
            ))}
          </div>

          {customizados.length > 0 && (
            <div className="torre-vistas-grupo" role="group" aria-label="Vistas salvas por você">
              {customizados.map((t, i) => {
                const ehGlobal = meta[t.id]?.global ?? t.global ?? false;
                return (
                  <span key={t.id} className="torre-vista-salva">
                    <button
                      ref={(el) => {
                        if (el) chipsSalvosRef.current.set(t.id, el);
                        else chipsSalvosRef.current.delete(t.id);
                      }}
                      type="button"
                      className="chip"
                      data-ativa={ativoId === t.id ? 'true' : undefined}
                      aria-pressed={ativoId === t.id}
                      aria-label={`Aplicar vista ${t.nome}`}
                      title={`Aplicar vista ${t.nome}`}
                      onClick={() => aplicarVista(t)}
                    >
                      {t.nome}
                    </button>
                    <button
                      type="button"
                      className="vista-pin"
                      data-ativa={ehGlobal ? 'true' : undefined}
                      aria-pressed={ehGlobal}
                      aria-label={
                        ehGlobal
                          ? `Deixar de abrir a vista ${t.nome} em todos os pedidos`
                          : `Abrir a vista ${t.nome} em todos os pedidos`
                      }
                      title="Usar em todos os pedidos"
                      onClick={() => alternarGlobal(t)}
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                        <path
                          d="M8 1.8 9.9 5.7l4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"
                          fill={ehGlobal ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="torre-vista-remover"
                      aria-label={`Excluir vista ${t.nome}`}
                      onClick={() => excluirVista(t, i)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="torre-vistas-acoes">
          <div className="vistas-densidade" role="radiogroup" aria-label="Densidade da grade">
            {DENSIDADES.map(({ valor, rotulo }) => (
              <button
                key={valor}
                ref={(el) => {
                  radioRefs.current[valor] = el;
                }}
                type="button"
                role="radio"
                aria-checked={densidade === valor}
                tabIndex={densidade === valor ? 0 : -1}
                data-ativa={densidade === valor ? 'true' : undefined}
                onClick={() => definirDensidade(valor)}
                onKeyDown={(e) => teclaRadio(e, valor)}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {formAberto ? (
            <form className="torre-vista-form" onSubmit={confirmar}>
              <input
                ref={inputRef}
                type="text"
                className="torre-vista-input"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome da vista"
                aria-label="Nome da nova vista"
                maxLength={40}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') fecharFormComFoco();
                }}
              />
              <button type="submit" className="chip" disabled={!nome.trim()}>
                Salvar
              </button>
            </form>
          ) : (
            <button
              ref={botaoSalvarRef}
              type="button"
              className="botao-sutil"
              onClick={abrirForm}
            >
              Salvar vista atual
            </button>
          )}

          <button type="button" className="botao-sutil" onClick={restaurarPadrao}>
            Restaurar layout padrão
          </button>

          <details className="torre-cards-toggle">
            <summary
              aria-label={
                ocultosCount > 0 ? `Cards, ${ocultosCount} ocultos` : 'Cards'
              }
            >
              Cards
              {ocultosCount > 0 && (
                <span className="vistas-badge" aria-hidden="true">
                  {ocultosCount}
                </span>
              )}
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                <path
                  d="m4.5 6 3.5 3.5L11.5 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="torre-cards-toggle-lista" role="group" aria-label="Ligar e desligar cards">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  data-ativa={!c.oculto ? 'true' : undefined}
                  aria-pressed={!c.oculto}
                  onClick={() => aoAlternarCard(c.id)}
                >
                  {c.titulo}
                </button>
              ))}
              <button type="button" className="botao-sutil" onClick={aoMostrarTodos}>
                Mostrar todos
              </button>
            </div>
          </details>
        </div>
      </div>

      {toast && (
        <div
          key={toast.key}
          className="vistas-toast"
          // Com a ponte aoAnunciar a região global já anuncia; sem ela, o
          // próprio toast vira status (evita anúncio duplicado no leitor).
          role={aoAnunciar ? undefined : 'status'}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setToast(null);
            }
          }}
        >
          <span className="vistas-toast-texto">{toast.texto}</span>
          {toast.desfazer && (
            <button
              type="button"
              className="vistas-toast-acao"
              onClick={() => {
                const d = toast.desfazer;
                setToast(null);
                d?.();
              }}
            >
              Desfazer
            </button>
          )}
          <button
            type="button"
            className="vistas-toast-fechar"
            aria-label="Fechar aviso"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
