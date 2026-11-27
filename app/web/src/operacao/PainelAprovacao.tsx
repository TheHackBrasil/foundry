// Painel de aprovação do plano de contato (spec 0017, US2, RF11, T752).
// Mostra canal, contato com telefone mascarado, campos do roteiro, motivo,
// prazo e custo estimado; aprovar, ajustar e recusar exigem a credencial de
// aprovador, digitada pelo analista e guardada só em memória pelo pai.

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { PlanoContatoProjetado } from '../../../shared/casos.ts';
import { ErroApi } from '../api.ts';
import { formatarMomento } from '../format.ts';
import {
  ajustarPlano,
  aprovarPlano,
  obterEvidencia,
  recusarPlano,
  type CamposRoteiro,
} from './api.ts';
import {
  CAMPOS_AJUSTAVEIS,
  MAX_EMPRESA,
  OPCOES_PERGUNTA,
  camposAlterados,
  classeEstadoPlano,
  formatarBrl,
  lerRoteiro,
  mascararTelefone,
  planoPedeDecisao,
  rotuloCampoRoteiro,
  rotuloCodigo,
  rotuloCanalOperador,
  rotuloEstadoPlano,
  rotuloPergunta,
  type RoteiroLido,
} from './operador.ts';

export type EstadoRoteiro =
  | { estado: 'carregando' }
  | { estado: 'ok'; roteiro: RoteiroLido }
  | { estado: 'indisponivel'; mensagem: string };

export interface PainelAprovacaoProps {
  casoId: string;
  plano: PlanoContatoProjetado;
  motivo?: string;
  // Token de aprovador: estado do pai, nunca gravado no navegador.
  token: string;
  aoMudarToken: (token: string) => void;
  // Backoffice com aprovação aberta (demo): sem campo de senha.
  semSenha?: boolean;
  somenteLeitura?: boolean;
  // Depois de decidir ou de um 409: o pai recarrega planos e linha do tempo.
  aoRecarregar: () => void;
  aoAnunciar: (texto: string) => void;
  // Para teste e pré-carga: com valor, o painel não busca a evidência.
  roteiroInicial?: EstadoRoteiro;
}

const MAX_MOTIVO = 300;

export function mensagemErroDecisao(e: unknown): string {
  if (e instanceof ErroApi) {
    if (e.status === 401) {
      return 'Credencial de aprovador ausente ou inválida. Confira o token e tente de novo.';
    }
    if (e.status === 409) {
      return 'O plano mudou antes da sua decisão: já foi decidido, o prazo venceu ou o caso fechou. A tela mostra o estado atual.';
    }
    if (e.status === 403) return 'Esta sessão não pode decidir este plano.';
    return `Não foi possível registrar a decisão: ${e.message}`;
  }
  return 'Não foi possível registrar a decisão.';
}

async function carregarRoteiro(casoId: string, hash: string): Promise<EstadoRoteiro> {
  if (!hash) return { estado: 'indisponivel', mensagem: 'Plano sem hash de roteiro.' };
  try {
    const ev = await obterEvidencia(casoId, hash);
    const texto = await ev.blob.text();
    let conteudo: unknown = null;
    try {
      conteudo = JSON.parse(texto);
    } catch {
      conteudo = null;
    }
    const roteiro = lerRoteiro(conteudo);
    return roteiro
      ? { estado: 'ok', roteiro }
      : { estado: 'indisponivel', mensagem: 'O roteiro guardado não tem campos legíveis.' };
  } catch (e) {
    return {
      estado: 'indisponivel',
      mensagem: e instanceof Error ? e.message : 'Não foi possível abrir o roteiro.',
    };
  }
}

function CampoRoteiro({
  chave,
  valor,
  editavel,
  aoMudar,
}: {
  chave: string;
  valor: string | number | boolean;
  editavel: boolean;
  aoMudar: (v: string | number | boolean) => void;
}) {
  const id = useId();
  const rotulo = rotuloCampoRoteiro(chave);
  if (!editavel) {
    const mostrado =
      typeof valor === 'boolean' ? (valor ? 'sim' : 'não') : chave === 'pergunta' ? rotuloPergunta(String(valor)) : String(valor);
    return (
      <div className="op-roteiro-campo">
        <dt className="meta">{rotulo}</dt>
        <dd className={chave === 'pergunta' ? undefined : 'mono'}>{mostrado}</dd>
      </div>
    );
  }
  if (chave === 'pergunta') {
    return (
      <div className="op-roteiro-campo">
        <label className="meta" htmlFor={id}>
          {rotulo}
        </label>
        <select id={id} value={String(valor)} onChange={(e) => aoMudar(e.target.value)}>
          {OPCOES_PERGUNTA.map(([codigo, texto]) => (
            <option key={codigo} value={codigo}>
              {texto}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (typeof valor === 'boolean') {
    return (
      <div className="op-roteiro-campo op-roteiro-check">
        <input id={id} type="checkbox" checked={valor} onChange={(e) => aoMudar(e.target.checked)} />
        <label htmlFor={id}>{rotulo}</label>
      </div>
    );
  }
  return (
    <div className="op-roteiro-campo">
      <label className="meta" htmlFor={id}>
        {rotulo}
      </label>
      <input
        id={id}
        type={typeof valor === 'number' ? 'number' : 'text'}
        inputMode={typeof valor === 'number' ? 'decimal' : undefined}
        maxLength={typeof valor === 'number' ? undefined : MAX_EMPRESA}
        value={String(valor)}
        onChange={(e) => {
          if (typeof valor === 'number') {
            const n = Number(e.target.value);
            aoMudar(Number.isFinite(n) ? n : valor);
          } else {
            aoMudar(e.target.value);
          }
        }}
      />
    </div>
  );
}

// Só leitura vira lista de definição; editável vira grupo de campos.
function ListaCampos({ editavel, children }: { editavel: boolean; children: ReactNode }) {
  return editavel ? (
    <div className="op-roteiro-campos" role="group" aria-label="Campos editáveis do roteiro">
      {children}
    </div>
  ) : (
    <dl className="op-roteiro-campos">{children}</dl>
  );
}

export function PainelAprovacao({
  casoId,
  plano,
  motivo,
  token,
  aoMudarToken,
  semSenha = false,
  somenteLeitura = false,
  aoRecarregar,
  aoAnunciar,
  roteiroInicial,
}: PainelAprovacaoProps) {
  const tituloId = useId();
  const tokenId = useId();
  const tokenAjudaId = useId();
  const motivoId = useId();
  const [roteiro, setRoteiro] = useState<EstadoRoteiro>(roteiroInicial ?? { estado: 'carregando' });
  const [editados, setEditados] = useState<CamposRoteiro>(
    roteiroInicial?.estado === 'ok' ? roteiroInicial.roteiro.campos : {},
  );
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Cada versão nova do plano tem outro roteiro: recarrega e zera a edição.
  useEffect(() => {
    if (roteiroInicial) return;
    let vivo = true;
    setRoteiro({ estado: 'carregando' });
    void carregarRoteiro(casoId, plano.hashRoteiro).then((r) => {
      if (!vivo) return;
      setRoteiro(r);
      setEditados(r.estado === 'ok' ? r.roteiro.campos : {});
    });
    return () => {
      vivo = false;
    };
  }, [casoId, plano.planoId, plano.versao, plano.hashRoteiro, roteiroInicial]);

  const aberto = planoPedeDecisao(plano) && !somenteLeitura;
  const semToken = !semSenha && token.trim().length === 0;
  const lido = roteiro.estado === 'ok' ? roteiro.roteiro : null;
  const motivoTexto = motivo ?? (lido?.motivo ? rotuloCodigo(lido.motivo) : undefined);
  const podeAjustar = aberto && lido !== null && Object.keys(lido.campos).some((k) => CAMPOS_AJUSTAVEIS.includes(k));

  async function decidir(acao: () => Promise<unknown>, textoOk: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await acao();
      setAviso(textoOk);
      aoAnunciar(textoOk);
      aoRecarregar();
    } catch (e) {
      const msg = mensagemErroDecisao(e);
      setErro(msg);
      aoAnunciar(msg);
      if (e instanceof ErroApi && e.status === 409) aoRecarregar();
    } finally {
      setOcupado(false);
    }
  }

  const alterados = lido ? camposAlterados(lido.campos, editados) : {};
  const temAlteracao = Object.keys(alterados).length > 0;

  return (
    <article className="op-aprovacao" aria-labelledby={tituloId}>
      <div className="op-caso-topo">
        <h4 id={tituloId} className="op-aprovacao-t">
          {rotuloCanalOperador(plano.canal)} <span className="meta num">versão {plano.versao}</span>
        </h4>
        <span className={classeEstadoPlano(plano.estado)}>{rotuloEstadoPlano(plano.estado)}</span>
      </div>

      <dl className="op-fat-lista">
        <div>
          <dt className="meta">Contato</dt>
          <dd className="mono">
            {lido?.nomeContato ? `${lido.nomeContato} · ` : ''}
            {lido?.destino ? mascararTelefone(lido.destino) : `contato nº ${plano.contatoId}`}
          </dd>
        </div>
        <div>
          <dt className="meta">Motivo</dt>
          <dd>{motivoTexto ?? 'não informado'}</dd>
        </div>
        {plano.prazo && (
          <div>
            <dt className="meta">Decidir até</dt>
            <dd className="mono">
              <time dateTime={plano.prazo}>{formatarMomento(plano.prazo)}</time>
            </dd>
          </div>
        )}
        <div>
          <dt className="meta">
            Custo estimado <span className="pilula-sutil">estimativa</span>
          </dt>
          <dd className="num">{formatarBrl(plano.custoEstimadoBrl)}</dd>
        </div>
      </dl>

      <section className="op-roteiro" aria-label="Campos do roteiro">
        <span className="meta">
          Campos do roteiro{podeAjustar ? ' (pergunta e empresa podem ser ajustadas; a chave da nota não)' : ''}
        </span>
        {roteiro.estado === 'carregando' && <p className="meta">Carregando roteiro…</p>}
        {roteiro.estado === 'indisponivel' && <p className="meta">{roteiro.mensagem}</p>}
        {lido && Object.keys(lido.campos).length === 0 && <p className="meta">Roteiro sem campos tipados.</p>}
        {lido && Object.keys(lido.campos).length > 0 && (
          <ListaCampos editavel={podeAjustar}>
            {Object.keys(lido.campos).map((k) => (
              <CampoRoteiro
                key={k}
                chave={k}
                valor={editados[k] ?? lido.campos[k]!}
                editavel={aberto && CAMPOS_AJUSTAVEIS.includes(k)}
                aoMudar={(v) => setEditados((prev) => ({ ...prev, [k]: v }))}
              />
            ))}
          </ListaCampos>
        )}
        {lido && lido.perguntas.length > 0 && (
          <details>
            <summary className="meta">Perguntas fechadas do roteiro ({lido.perguntas.length})</summary>
            <ol className="meta op-roteiro-perguntas">
              {lido.perguntas.map((p, i) => (
                <li key={`${i}-${p}`}>{p}</li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {aberto && (
        <div className="op-acoes">
          {!semSenha && (
          <div className="op-acao">
            <label className="meta" htmlFor={tokenId}>
              Credencial de aprovador
            </label>
            <input
              id={tokenId}
              className="op-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              aria-describedby={tokenAjudaId}
              onChange={(e) => aoMudarToken(e.target.value)}
            />
            <p id={tokenAjudaId} className="meta">
              Fica só na memória desta aba. Recarregar a página apaga o token.
            </p>
          </div>
          )}

          <div className="op-acao-linha">
            <button
              type="button"
              className="botao"
              disabled={ocupado || semToken || roteiro.estado === 'carregando'}
              onClick={() =>
                void decidir(
                  () => aprovarPlano(plano.planoId, token.trim(), { versao: plano.versao, hashRoteiro: plano.hashRoteiro }),
                  `Plano de ${rotuloCanalOperador(plano.canal)} aprovado.`,
                )
              }
            >
              Aprovar
            </button>
            <button
              type="button"
              className="botao-sutil"
              disabled={ocupado || semToken || !temAlteracao}
              onClick={() =>
                void decidir(
                  () => ajustarPlano(plano.planoId, token.trim(), { versao: plano.versao, campos: alterados }),
                  'Roteiro ajustado. A versão nova aguarda decisão.',
                )
              }
            >
              Ajustar campos
            </button>
          </div>

          <div className="op-acao">
            <label className="meta" htmlFor={motivoId}>
              Motivo da recusa
            </label>
            <div className="op-acao-linha">
              <input
                id={motivoId}
                type="text"
                maxLength={MAX_MOTIVO}
                placeholder="Ex.: contato já respondeu por telefone"
                value={motivoRecusa}
                onChange={(e) => setMotivoRecusa(e.target.value)}
              />
              <button
                type="button"
                className="botao-sutil"
                disabled={ocupado || semToken || motivoRecusa.trim().length === 0}
                onClick={() =>
                  void decidir(
                    () => recusarPlano(plano.planoId, token.trim(), { versao: plano.versao, motivo: motivoRecusa.trim() }),
                    'Plano recusado. O contato não sai.',
                  )
                }
              >
                Recusar
              </button>
            </div>
          </div>
          {semToken && <p className="meta">Digite a credencial de aprovador para liberar as decisões.</p>}
        </div>
      )}

      {erro && (
        <p role="alert" className="aviso-erro">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="meta">
          {aviso}
        </p>
      )}
    </article>
  );
}
