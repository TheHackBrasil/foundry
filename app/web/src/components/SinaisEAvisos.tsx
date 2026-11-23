import type { CSSProperties } from 'react';
import type { Notificacao, Sinal } from '../../../shared/model.ts';
import {
  formatarConfianca,
  rotuloCanalContato,
  rotuloFonte,
  rotuloMotivoNotificacao,
  rotuloParte,
  rotuloTipoSinal,
} from '../format.ts';
import { IconeAviso, IconeErro, IconeOk, IconeSinal } from './icones.tsx';

export const chaveSinal = (s: Sinal): string => `${s.tipo}|${s.fonte}|${s.resumo}|${s.confianca}`;
export const chaveNotificacao = (n: Notificacao): string =>
  `${n.parte ?? ''}|${n.canal ?? ''}|${n.status}|${n.motivo ?? ''}|${n.mensagem}`;

interface Props {
  sinais: readonly Sinal[];
  notificacoes: readonly Notificacao[];
  sinaisNovos: ReadonlySet<string>;
  avisosNovos: ReadonlySet<string>;
}

export function SinaisEAvisos({ sinais, notificacoes, sinaisNovos, avisosNovos }: Props) {
  if (sinais.length === 0 && notificacoes.length === 0) return null;
  const ambos = sinais.length > 0 && notificacoes.length > 0;

  return (
    <div className="sinais-avisos" data-ambos={ambos ? 'true' : 'false'}>
      {sinais.length > 0 && (
        <section aria-labelledby="bloco-sinais">
          <div className="sec-cab">
            <h3 id="bloco-sinais" className="sec-titulo-icone">
              <IconeSinal />
              Sinais consultivos
            </h3>
            <span className="meta">Leitura de texto livre: não altera campos vigiados.</span>
          </div>
          <ul className="registros-lista">
            {sinais.map((s, i) => {
              const chave = chaveSinal(s);
              const novo = sinaisNovos.has(chave);
              const escala = Number.isFinite(s.confianca) ? Math.min(1, Math.max(0, s.confianca)) : 0;
              return (
                <li key={`${chave}-${i}`} className={novo ? 'registro-item item-novo' : 'registro-item'}>
                  <div className="registro-topo">
                    <span className="etiqueta etiqueta-sinal">{rotuloTipoSinal(s.tipo)}</span>
                    <span className="meta">Fonte: {rotuloFonte(s.fonte)}</span>
                    <span className="confianca" aria-label={`Confiança ${formatarConfianca(s.confianca)}`}>
                      <span className="confianca-trilha" aria-hidden="true">
                        <span
                          className="confianca-barra"
                          style={{ '--escala': escala } as CSSProperties}
                        />
                      </span>
                      <span className="mono num">{formatarConfianca(s.confianca)}</span>
                    </span>
                    {novo && <span className="etiqueta etiqueta-nova">Novo</span>}
                  </div>
                  <p className="registro-texto">{s.resumo}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {notificacoes.length > 0 && (
        <section aria-labelledby="bloco-avisos">
          <div className="sec-cab">
            <h3 id="bloco-avisos" className="sec-titulo-icone">
              <IconeAviso />
              Avisos
            </h3>
            <span className="meta">Registro do que saiu ou do motivo de não entrega.</span>
          </div>
          <ul className="registros-lista">
            {notificacoes.map((n, i) => {
              const chave = chaveNotificacao(n);
              const novo = avisosNovos.has(chave);
              const entregue = n.status === 'entregue';
              const falhaRede = n.motivo === 'falha_envio';
              const classeStatus = entregue
                ? 'estado estado-ok'
                : falhaRede
                  ? 'estado estado-erro'
                  : 'estado estado-warn';
              return (
                <li key={`${chave}-${i}`} className={novo ? 'registro-item item-novo' : 'registro-item'}>
                  <div className="registro-topo">
                    <span className={classeStatus}>
                      {entregue ? <IconeOk /> : <IconeErro />}
                      {entregue ? 'Entregue' : 'Não entregue'}
                    </span>
                    <span className="registro-parte">
                      {n.parte ? rotuloParte(n.parte) : 'Parte não identificada'}
                    </span>
                    <span className="meta">
                      {n.canal ? rotuloCanalContato(n.canal) : 'Sem canal'}
                    </span>
                    {novo && <span className="etiqueta etiqueta-nova">Novo</span>}
                  </div>
                  {n.motivo && <p className="meta">{rotuloMotivoNotificacao(n.motivo)}</p>}
                  {n.mensagem.trim() && <p className="aviso-msg">{n.mensagem}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
