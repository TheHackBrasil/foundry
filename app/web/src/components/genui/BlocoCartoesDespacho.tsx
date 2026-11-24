import {
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import type {
  BlocoGenUI,
  CampoVigiado,
  Contato,
  Parte,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import {
  rotuloCampo,
  rotuloCanalContato,
  rotuloParte,
} from '../../format.ts';
import { agruparTarefas, tarefasDaParte } from '../../matriz.ts';
import { IconeAviso, IconeErro, IconeOk } from '../icones.tsx';
import { estiloEntradaBloco } from './helpers.ts';

export interface BlocoCartoesDespachoProps {
  bloco: Extract<BlocoGenUI, { tipo: 'cartoes_despacho' }>;
  indice: number;
  contatos: readonly Contato[];
  projecao: ProjecaoPedido;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoAnunciar: (texto: string) => void;
}

export function BlocoCartoesDespacho({
  bloco,
  indice,
  contatos,
  projecao,
  aoNotificar,
  aoAbrirAgenda,
  aoAnunciar,
}: BlocoCartoesDespachoProps) {
  const baseId = useId();
  const [rascunhosEditados, setRascunhosEditados] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<Record<string, boolean>>({});
  const [recibos, setRecibos] = useState<
    Record<string, { tipo: 'ok' | 'erro'; texto: string }>
  >({});

  const partesUnicas = useMemo(
    () => Array.from(new Set(bloco.partes)),
    [bloco.partes],
  );

  const contatoPorParte = useMemo(
    () => new Map<Parte, Contato>(contatos.map((c) => [c.parte, c])),
    [contatos],
  );

  async function dispararAviso(parte: Parte, campo?: CampoVigiado) {
    setEnviando((prev) => ({ ...prev, [parte]: true }));
    setRecibos((prev) => {
      const copia = { ...prev };
      delete copia[parte];
      return copia;
    });
    try {
      await aoNotificar(parte, campo);
      const msg = `Aviso disparado para ${rotuloParte(parte)}.`;
      setRecibos((prev) => ({ ...prev, [parte]: { tipo: 'ok', texto: msg } }));
      aoAnunciar(msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Não foi possível avisar ${rotuloParte(parte)}.`;
      setRecibos((prev) => ({ ...prev, [parte]: { tipo: 'erro', texto: msg } }));
      aoAnunciar(msg);
    } finally {
      setEnviando((prev) => ({ ...prev, [parte]: false }));
    }
  }

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      data-bloco-tipo={bloco.tipo}
      data-matriz-bloco={bloco.id}
      data-matriz-idx={indice}
      aria-label={bloco.titulo}
      style={estiloEntradaBloco(indice)}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
      </div>

      {partesUnicas.length === 0 ? (
        <p className="dica">Nenhuma parte selecionada para despacho.</p>
      ) : (
        <div className="despacho-grid">
          {partesUnicas.map((parte, pIdx) => {
            const contato = contatoPorParte.get(parte);
            const rascunho = bloco.rascunhos.find((r) => r.parte === parte);
            const tarefasParte = agruparTarefas(tarefasDaParte(projecao.tarefas, parte));
            const fallbackMsg =
              tarefasParte.length > 0
                ? `${rotuloParte(parte)}: ${tarefasParte.map((g) => g.titulo).join('; ')}.`
                : `Atualização do pedido para ${rotuloParte(parte)}.`;
            const chave = `${bloco.id}:${parte}`;
            const valorTexto = rascunhosEditados[chave] ?? rascunho?.mensagemSugerida ?? fallbackMsg;
            const canalIncompativel = contato?.canal === 'email';
            const bloqueadoCanal = !contato || canalIncompativel;
            const emEnvio = Boolean(enviando[parte]);
            const recibo = recibos[parte];
            const textareaId = `${baseId}-${parte}`;

            return (
              <div
                key={parte}
                className="despacho-card palco-item-cascata"
                style={{ '--item-i': Math.min(pIdx, 6) } as CSSProperties}
              >
                <div className="domino-no-topo">
                  <strong>{rotuloParte(parte)}</strong>
                  {!contato ? (
                    <span className="pilula-warn">
                      <IconeErro />
                      Sem contato
                    </span>
                  ) : canalIncompativel ? (
                    <span className="pilula-warn">
                      <IconeAviso />
                      E-mail incompatível
                    </span>
                  ) : (
                    <span className="pilula-ok">
                      <IconeOk />
                      {rotuloCanalContato(contato.canal)}
                    </span>
                  )}
                </div>

                {contato ? (
                  <p className="meta">
                    {contato.nome} · <span className="mono">{contato.destino}</span>
                  </p>
                ) : (
                  <p className="meta">
                    Nenhum destino cadastrado na agenda para {rotuloParte(parte)}.
                  </p>
                )}

                <div className="drawer-field">
                  <div className="domino-no-topo">
                    <label htmlFor={textareaId}>Mensagem</label>
                    {rascunho && (
                      <span className="pilula-sutil">{rotuloCampo(rascunho.campo)}</span>
                    )}
                  </div>
                  <textarea
                    id={textareaId}
                    className="despacho-textarea"
                    value={valorTexto}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                      setRascunhosEditados((prev) => ({ ...prev, [chave]: e.target.value }))
                    }
                  />
                </div>

                {recibo && (
                  <span
                    role={recibo.tipo === 'erro' ? 'alert' : 'status'}
                    className={recibo.tipo === 'erro' ? 'pilula-erro' : 'pilula-ok'}
                    style={{ width: 'fit-content' }}
                  >
                    {recibo.tipo === 'erro' ? <IconeErro /> : <IconeOk />}
                    {recibo.texto}
                  </span>
                )}

                <div className="despacho-acoes">
                  <button
                    type="button"
                    className={bloqueadoCanal ? 'botao' : 'botao-sutil'}
                    onClick={() => aoAbrirAgenda(parte)}
                  >
                    {bloqueadoCanal ? 'Configurar contato' : 'Editar contato'}
                  </button>

                  <button
                    type="button"
                    className="cmd-btn-enviar"
                    disabled={bloqueadoCanal || emEnvio}
                    onClick={() => void dispararAviso(parte, rascunho?.campo)}
                  >
                    {emEnvio ? (
                      <>
                        <span className="cmd-spinner" aria-hidden="true" />
                        Avisando…
                      </>
                    ) : (
                      `Avisar ${rotuloParte(parte)}`
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
