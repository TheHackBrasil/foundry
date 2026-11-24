import { useMemo, useState, type CSSProperties } from 'react';
import {
  IconeCaixa,
  IconeCalendario,
  IconeCaminhao,
  IconeComando,
  IconeErro,
  IconeFiscal,
  IconeGalpao,
  IconeRota,
} from '../icones.tsx';
import type { EtapaStreamGenUI } from '../PalcoGenUI.tsx';
import type { ToolTurnoIA } from './tipos.ts';

// Emblema geométrico estático dos 3 monólitos (evita criar um segundo contexto WebGL na rota #/ia).
export function EmblemaMonolitos({ tamanho = 20 }: { tamanho?: number }) {
  return (
    <svg
      className="ia-selo-monolitos"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.2 10.6L7.4 8.4V18.8L3.2 21V10.6ZM9.8 6.4L14.2 4.1V17.9L9.8 20.2V6.4ZM16.6 5.2L20.8 3V13.4L16.6 15.6V5.2Z"
        fill="var(--primary)"
      />
      <path
        d="M2.6 14.8C7.8 12.2 14.8 11.4 21.4 8.2M2.6 16.5C7.8 13.9 14.8 13.1 21.4 9.9M2.6 18.2C7.8 15.6 14.8 14.8 21.4 11.6M2.6 19.9C7.8 17.3 14.8 16.5 21.4 13.3"
        stroke="var(--change)"
        strokeWidth="1.05"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronSeletor() {
  return (
    <svg
      className="ia-pedido-chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m4 6.25 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconeCheckAnimado() {
  return (
    <svg
      className="ia-check-anim"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.2 8.4 6.5 11.7 12.8 4.8"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function iconeDaTool(nome: string) {
  switch (nome) {
    case 'simular_cenario':
      return <IconeCalendario />;
    case 'comparar_fontes':
      return <IconeCaixa />;
    case 'listar_tarefas_setor':
      return <IconeGalpao />;
    case 'consultar_auditoria':
      return <IconeFiscal />;
    case 'preparar_notificacao':
    case 'enviar_notificacao':
      return <IconeCaminhao />;
    case 'propagar_divergencias':
      return <IconeComando />;
    default:
      return <IconeRota />;
  }
}

export interface TrilhaMatrizAgenteProps {
  etapas: readonly EtapaStreamGenUI[];
  tools: readonly ToolTurnoIA[];
  carregando: boolean;
  temTexto: boolean;
}

// Hub vivo da Matriz Mãe: exibe o raciocínio e as consultas SSE em tempo real
// e serve de âncora física (data-matriz-hub="true") de onde os condutos de
// energia disparam para materializar cada componente GenUI abaixo.
export function TrilhaMatrizAgente({
  etapas,
  tools,
  carregando,
  temTexto,
}: TrilhaMatrizAgenteProps) {
  const [expandidoManual, setExpandidoManual] = useState<boolean | null>(null);
  const ativa = carregando && !temTexto;
  const expandido = expandidoManual !== null ? expandidoManual : ativa;

  const etapaAtual = etapas.at(-1);
  const concluidas = tools.filter((t) => t.status === 'concluida').length;
  const comErro = tools.filter((t) => t.status === 'erro').length;
  const executando = tools.some((t) => t.status === 'executando');

  const tituloResumo = useMemo(() => {
    if (ativa) {
      if (executando) {
        const emCurso = tools.filter((t) => t.status === 'executando');
        if (emCurso.length === 1) return emCurso[0]?.resumo || 'Consultando registro…';
        return `Consultando ${emCurso.length} fontes em paralelo…`;
      }
      return etapaAtual?.rotulo ?? 'Interpretando e consultando o registro…';
    }
    if (tools.length === 0) {
      return etapaAtual?.rotulo ?? 'Consulta concluída';
    }
    const base =
      concluidas === 1 ? '1 consulta concluída' : `${concluidas} consultas concluídas`;
    const ultimaConcluida = [...tools].reverse().find((t) => t.status === 'concluida');
    if (comErro > 0) {
      return `${base} · ${comErro} aviso${comErro === 1 ? '' : 's'}`;
    }
    return ultimaConcluida?.resumo ? `${base} · ${ultimaConcluida.resumo}` : base;
  }, [ativa, executando, tools, etapaAtual, concluidas, comErro]);

  if (!carregando && tools.length === 0) return null;

  return (
    <div
      className="ia-trilha-viva"
      data-matriz-hub="true"
      data-ativa={ativa ? 'true' : 'false'}
      data-expandido={expandido ? 'true' : 'false'}
      aria-live="polite"
    >
      <span className="ia-trilha-feixe" aria-hidden="true" />
      <button
        type="button"
        className="ia-trilha-cab"
        aria-expanded={expandido}
        disabled={tools.length === 0 && etapas.length === 0}
        onClick={() => setExpandidoManual((atual) => !(atual ?? ativa))}
      >
        <span className="ia-trilha-indicador" aria-hidden="true">
          {ativa ? (
            <EmblemaMonolitos tamanho={17} />
          ) : comErro > 0 && concluidas === 0 ? (
            <IconeErro />
          ) : (
            <IconeCheckAnimado />
          )}
        </span>
        <span key={etapaAtual?.id ?? (ativa ? 'ativa' : 'fim')} className="ia-trilha-titulo">
          {tituloResumo}
        </span>
        {(tools.length > 0 || etapas.length > 0) && <ChevronSeletor />}
      </button>

      {(tools.length > 0 || (ativa && etapas.length > 0)) && (
        <div className="ia-trilha-gaveta" data-aberta={expandido ? 'true' : 'false'}>
          <div className="ia-trilha-gaveta-inner">
            <ol className="ia-trilha-lista" aria-label="Ferramentas consultadas pelo agente">
              {tools.length > 0
                ? tools.map((tool, i) => (
                    <li
                      key={tool.id}
                      className="ia-tool-linha"
                      data-status={tool.status}
                      style={{ '--tool-i': Math.min(i, 8) } as CSSProperties}
                    >
                      <span className="ia-tool-estado" aria-hidden="true">
                        {tool.status === 'executando' ? (
                          <span className="ia-tool-pulso" />
                        ) : tool.status === 'concluida' ? (
                          <IconeCheckAnimado />
                        ) : (
                          <IconeErro />
                        )}
                      </span>
                      <span className="ia-tool-icone" aria-hidden="true">
                        {iconeDaTool(tool.nome)}
                      </span>
                      <span className="ia-tool-texto">{tool.resumo || tool.nome}</span>
                    </li>
                  ))
                : etapas.map((et, i) => (
                    <li
                      key={et.id}
                      className="ia-tool-linha"
                      data-status={et.concluida ? 'concluida' : 'executando'}
                      style={{ '--tool-i': Math.min(i, 6) } as CSSProperties}
                    >
                      <span className="ia-tool-estado" aria-hidden="true">
                        {et.concluida ? <IconeCheckAnimado /> : <span className="ia-tool-pulso" />}
                      </span>
                      <span className="ia-tool-texto">
                        {et.rotulo}
                        {et.detalhe ? ` · ${et.detalhe}` : ''}
                      </span>
                    </li>
                  ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
