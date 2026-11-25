// Card de leitura detalhada do painel (spec 0014, THE-17): mostra primeiro
// a evidencia concreta do registro (o que cada fonte declarou, com versao e
// momento reais do ledger) e, a pedido ou por clique interno, um texto que
// o agente compoe ao vivo pelo mesmo SSE do assistente. Estados honestos:
// nunca inventa conteudo — vazio e erro sao visiveis.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjecaoPedido } from '../../../../shared/model.ts';
import { IconeLente } from '../icones.tsx';
import { TextoAgente } from '../assistente/TextoAgente.tsx';
import {
  chaveDescricao,
  guardarDescricaoCache,
  lerDescricaoCache,
  pedirDescricaoAlvo,
} from './descricao.ts';
import {
  descreverAlvoDescricao,
  evidenciasDoAlvo,
  type AlvoDescricao,
} from './contexto.ts';

type FaseDescricao = 'ociosa' | 'carregando' | 'ok' | 'vazio' | 'erro';

interface EstadoDescricao {
  fase: FaseDescricao;
  texto: string;
  mensagem: string;
}

export interface DescricaoAoVivoProps {
  pedidoId: string;
  alvo: AlvoDescricao;
  dados: ProjecaoPedido | null;
  // true quando o alvo foi ativado dentro do painel (clique em campo,
  // divergencia, setor, citacao): a leitura pede-se sozinha. Quando o foco
  // chegou de fora (palco, torre), so o botao a dispara.
  autoPedir: boolean;
  aoAnunciar?: (texto: string) => void;
}

export function DescricaoAoVivo({
  pedidoId,
  alvo,
  dados,
  autoPedir,
  aoAnunciar,
}: DescricaoAoVivoProps) {
  const [estado, setEstado] = useState<EstadoDescricao>(() => {
    const cacheada = lerDescricaoCache(
      chaveDescricao(pedidoId, alvo, dados?.totalEventos ?? 0),
    );
    return cacheada
      ? { fase: 'ok', texto: cacheada, mensagem: '' }
      : { fase: 'ociosa', texto: '', mensagem: '' };
  });
  const abortRef = useRef<AbortController | null>(null);
  const argsRef = useRef({ pedidoId, alvo, dados, aoAnunciar });
  argsRef.current = { pedidoId, alvo, dados, aoAnunciar };

  const pedir = useCallback(() => {
    const { pedidoId: pid, alvo: a, dados: d, aoAnunciar: anunciar } = argsRef.current;
    const cacheada = lerDescricaoCache(chaveDescricao(pid, a, d?.totalEventos ?? 0));
    if (cacheada) {
      setEstado({ fase: 'ok', texto: cacheada, mensagem: '' });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEstado({ fase: 'carregando', texto: '', mensagem: '' });
    void pedirDescricaoAlvo({
      pedidoId: pid,
      alvo: a,
      dados: d,
      signal: ctrl.signal,
      aoDelta: (t) =>
        setEstado((s) =>
          s.fase === 'carregando' ? { fase: 'carregando', texto: t, mensagem: '' } : s,
        ),
    })
      .then((texto) => {
        if (ctrl.signal.aborted) return;
        const limpo = texto.trim();
        if (!limpo) {
          setEstado({ fase: 'vazio', texto: '', mensagem: '' });
          anunciar?.('O agente não trouxe detalhe para este item.');
          return;
        }
        guardarDescricaoCache(chaveDescricao(pid, a, d?.totalEventos ?? 0), limpo);
        setEstado({ fase: 'ok', texto: limpo, mensagem: '' });
        anunciar?.('Leitura detalhada concluída.');
      })
      .catch((erro: unknown) => {
        if (ctrl.signal.aborted) return;
        if (erro instanceof DOMException && erro.name === 'AbortError') return;
        const mensagem =
          erro instanceof Error ? erro.message : 'Não foi possível gerar a leitura agora.';
        setEstado({ fase: 'erro', texto: '', mensagem });
        anunciar?.(`Leitura detalhada falhou: ${mensagem}`);
      });
  }, []);

  // autoPedir muda so com remount do pai (a key leva a chave do alvo); o
  // efeito cobre o mount e limpa a conexao SSE ao sair da tela.
  useEffect(() => {
    if (autoPedir) pedir();
    return () => abortRef.current?.abort();
  }, [autoPedir, pedir]);

  const itens = useMemo(() => evidenciasDoAlvo(alvo, dados), [alvo, dados]);
  const rotulo = descreverAlvoDescricao(alvo);
  const carregando = estado.fase === 'carregando';
  const temTexto = estado.texto !== '';

  return (
    <div className="ev2-descricao" data-fase={estado.fase} aria-busy={carregando || undefined}>
      {itens.length > 0 && (
        <ul className="ev2-provas" aria-label={`Evidências do registro para ${rotulo}`}>
          {itens.map((item) => (
            <li key={item.id} className="ev2-prova">
              <span className="ev2-prova-rotulo">{item.rotulo}</span>
              <span className="ev2-prova-detalhe">{item.detalhe}</span>
            </li>
          ))}
        </ul>
      )}

      {estado.fase === 'ociosa' && (
        <button
          type="button"
          className="ev2-btn ev2-btn-detalhar"
          onClick={pedir}
          aria-label={`Gerar leitura detalhada de ${rotulo} em tempo real`}
        >
          <IconeLente /> Gerar leitura detalhada
        </button>
      )}

      {carregando && !temTexto && (
        <p className="ev2-progresso" role="status">
          <span className="cmd-spinner" aria-hidden="true" /> O agente está lendo o registro…
        </p>
      )}

      {temTexto && <TextoAgente texto={estado.texto} aoVivo={carregando} />}

      {estado.fase === 'vazio' && (
        <p className="ev2-vazio">
          O agente não trouxe detalhe para este item. A evidência do registro está acima.
        </p>
      )}

      {estado.fase === 'erro' && (
        <div className="ev2-erro" role="alert">
          <p className="ev2-erro-msg">{estado.mensagem}</p>
          <button type="button" className="ev2-btn" onClick={pedir}>
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}
