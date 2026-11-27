// Backoffice do time (spec 0017), em /#/admin e fora do menu. Configura o
// que a demo pública não pode deixar aberto a qualquer visitante: os números
// que a IA pode contatar e se a aprovação de ligação e WhatsApp pede senha.
// A senha de admin fica só na memória desta aba.

import { useId, useState, type FormEvent } from 'react';
import { ErroApi } from '../api.ts';
import { lerConfigAdmin, salvarConfigAdmin, type AjustesAdmin, type ConfigAdmin } from './api.ts';

type CampoNumero = Exclude<keyof AjustesAdmin, 'janelaTodosDias'>;

// Cada ajuste com rótulo, unidade, limites e o que muda na prática.
const CAMPOS_AJUSTE: Array<{ chave: CampoNumero; rotulo: string; unidade: string; min: number; max: number; ajuda: string }> = [
  {
    chave: 'prazoEmailMin',
    rotulo: 'Espera pela resposta do e-mail',
    unidade: 'minutos',
    min: 1,
    max: 4320,
    ajuda: 'Depois de mandar o e-mail, o operador espera este tempo. Sem resposta, ele passa para o WhatsApp ou a ligação. Para testar rápido, use 1 ou 2.',
  },
  {
    chave: 'prazoWhatsappMin',
    rotulo: 'Espera pela resposta do WhatsApp',
    unidade: 'minutos',
    min: 1,
    max: 2880,
    ajuda: 'Mesmo papel para o WhatsApp: sem resposta neste tempo, o operador propõe a ligação.',
  },
  {
    chave: 'validadeAprovacaoMin',
    rotulo: 'Validade da aprovação',
    unidade: 'minutos',
    min: 1,
    max: 1440,
    ajuda: 'Depois que você aprova um plano de WhatsApp ou ligação, ele precisa sair dentro deste tempo. Passou disso, o operador pede aprovação de novo.',
  },
  {
    chave: 'tentativasDia',
    rotulo: 'Contatos por número por dia',
    unidade: 'vezes',
    min: 1,
    max: 10,
    ajuda: 'Quantas vezes a IA pode ligar ou mandar WhatsApp para o mesmo número no mesmo dia, somando todos os casos.',
  },
  {
    chave: 'tetoCasoBrl',
    rotulo: 'Gasto máximo por caso',
    unidade: 'R$',
    min: 0,
    max: 1000,
    ajuda: 'Custo estimado de WhatsApp e ligação permitido em um caso. Ao atingir, o operador para e passa o caso para você.',
  },
  {
    chave: 'tetoDiaBrl',
    rotulo: 'Gasto máximo por dia',
    unidade: 'R$',
    min: 0,
    max: 10000,
    ajuda: 'O mesmo limite, somando todos os casos do dia.',
  },
  {
    chave: 'janelaInicio',
    rotulo: 'Horário: começa às',
    unidade: 'h',
    min: 0,
    max: 23,
    ajuda: 'WhatsApp e ligação só saem dentro deste horário, no fuso de Brasília. O e-mail sai a qualquer hora.',
  },
  {
    chave: 'janelaFim',
    rotulo: 'Horário: termina às',
    unidade: 'h',
    min: 1,
    max: 24,
    ajuda: 'Use 0 e 24 para liberar o dia inteiro durante os testes.',
  },
];
import './operacao.css';

const mensagemDe = (e: unknown): string => (e instanceof ErroApi || e instanceof Error ? e.message : 'Erro inesperado.');

export function PaginaAdmin() {
  const [senha, setSenha] = useState('');
  const [config, setConfig] = useState<ConfigAdmin | null>(null);
  const [rascunho, setRascunho] = useState<string[]>([]);
  const [novo, setNovo] = useState('');
  const [ajustes, setAjustes] = useState<AjustesAdmin | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const senhaId = useId();
  const novoId = useId();
  const listaId = useId();

  async function executar<T>(acao: () => Promise<T>, ok: (r: T) => string) {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await acao();
      setAviso({ tipo: 'ok', texto: ok(r) });
      return r;
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDe(e) });
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    const r = await executar(() => lerConfigAdmin(senha.trim()), () => 'Configuração carregada.');
    if (r) {
      setConfig(r);
      setRascunho(r.destinos);
      setAjustes(r.ajustes);
    }
  }

  async function salvarAjustes() {
    if (!ajustes) return;
    const r = await executar(
      () => salvarConfigAdmin(senha.trim(), { ajustes }),
      () => 'Prazos e limites salvos. Valem para os casos acionados a partir de agora.',
    );
    if (r) {
      setConfig(r);
      setAjustes(r.ajustes);
    }
  }

  function adicionar(e: FormEvent) {
    e.preventDefault();
    const n = novo.trim();
    if (!n) return;
    if (!rascunho.includes(n)) setRascunho([...rascunho, n]);
    setNovo('');
  }

  async function salvarDestinos() {
    const r = await executar(
      () => salvarConfigAdmin(senha.trim(), { destinos: rascunho }),
      (c) => `Lista salva: ${c.destinos.length} ${c.destinos.length === 1 ? 'número' : 'números'}.`,
    );
    if (r) {
      setConfig(r);
      setRascunho(r.destinos);
    }
  }

  async function alternarAprovacao(aberta: boolean) {
    const r = await executar(
      () => salvarConfigAdmin(senha.trim(), { aprovacaoAberta: aberta }),
      (c) => (c.aprovacaoAberta ? 'Aprovação sem senha ligada.' : 'Aprovação volta a pedir a senha de admin.'),
    );
    if (r) setConfig(r);
  }

  const mudou = config !== null && JSON.stringify(rascunho) !== JSON.stringify(config.destinos);
  const ajustesMudaram = config !== null && ajustes !== null && JSON.stringify(ajustes) !== JSON.stringify(config.ajustes);

  return (
    <section className="op op-admin" aria-labelledby="admin-titulo">
      <header className="op-cab">
        <div>
          <h1 id="admin-titulo">Backoffice</h1>
          <p className="meta">Configuração do operador para o time. Vale para todas as sessões da demo.</p>
        </div>
      </header>

      {aviso && (
        <div className="op-retorno op-admin-aviso" data-tipo={aviso.tipo} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
          <span>{aviso.texto}</span>
          <button type="button" className="botao-sutil" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            Fechar
          </button>
        </div>
      )}

      {!config ? (
        <form className="op-admin-cartao" onSubmit={(e) => void entrar(e)}>
          <label htmlFor={senhaId} className="op-col-t">
            Senha do backoffice
          </label>
          <p className="meta">
            Ao entrar, você cadastra os números que a IA pode contatar e liga ou desliga a aprovação sem senha. A
            senha é só do backoffice: aprovar ligação na Operação não pede senha. Ela é o valor de
            OPERADOR_APROVADOR_TOKEN no servidor e fica só na memória desta aba.
          </p>
          <div className="op-admin-linha">
            <input
              id={senhaId}
              type="password"
              className="op-busca"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            <button type="submit" className="botao" disabled={ocupado || !senha.trim()}>
              Entrar
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className="op-admin-cartao" aria-labelledby={listaId}>
            <h2 id={listaId} className="op-col-t">
              Números que a IA pode contatar
            </h2>
            <p className="meta">
              WhatsApp e ligação só saem para estes números. Pelo regulamento da demo, só números do time, com
              consentimento.{' '}
              {config.origemDestinos === 'env'
                ? 'Hoje a lista vem do .env do servidor; ao salvar aqui, a do banco passa a valer.'
                : 'A lista vem do banco.'}
            </p>
            {rascunho.length === 0 ? (
              <p className="meta">Nenhum número liberado: a IA não liga nem manda WhatsApp para ninguém.</p>
            ) : (
              <ul className="op-admin-lista">
                {rascunho.map((n) => (
                  <li key={n}>
                    <span className="mono num">{n}</span>
                    <button
                      type="button"
                      className="botao-sutil"
                      aria-label={`Remover ${n}`}
                      onClick={() => setRascunho(rascunho.filter((x) => x !== n))}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="op-admin-linha" onSubmit={adicionar}>
              <label htmlFor={novoId} className="so-leitor">
                Novo número
              </label>
              <input
                id={novoId}
                type="tel"
                className="op-busca"
                placeholder="+55 11 99999-9999"
                autoComplete="off"
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
              />
              <button type="submit" className="botao-sutil" disabled={!novo.trim()}>
                Adicionar
              </button>
            </form>
            <div className="op-admin-linha">
              <button type="button" className="botao" disabled={ocupado || !mudou} onClick={() => void salvarDestinos()}>
                Salvar lista
              </button>
              {mudou && <span className="meta">Alterações não salvas.</span>}
            </div>
            <p className="meta">Casos em andamento que já iam ligar voltam para o analista se a lista mudar no meio.</p>
          </section>

          {ajustes && (
            <section className="op-admin-cartao" aria-labelledby="admin-ajustes-t">
              <h2 id="admin-ajustes-t" className="op-col-t">
                Prazos e limites
              </h2>
              <p className="meta">
                Valem para os casos acionados depois de salvar. Um caso já em andamento segue com os valores do momento
                em que começou.
              </p>
              <div className="op-admin-ajustes">
                {CAMPOS_AJUSTE.map((c) => (
                  <div key={c.chave} className="op-admin-ajuste">
                    <label htmlFor={`aj-${c.chave}`} className="op-acao-t">
                      {c.rotulo}
                    </label>
                    <div className="op-admin-linha">
                      <input
                        id={`aj-${c.chave}`}
                        type="number"
                        inputMode="numeric"
                        className="op-busca op-admin-numero"
                        min={c.min}
                        max={c.max}
                        step={1}
                        value={ajustes[c.chave]}
                        aria-describedby={`aj-${c.chave}-ajuda`}
                        onChange={(e) => setAjustes({ ...ajustes, [c.chave]: Number(e.target.value) })}
                      />
                      <span className="meta">{c.unidade}</span>
                    </div>
                    <p id={`aj-${c.chave}-ajuda`} className="meta">
                      {c.ajuda}
                    </p>
                  </div>
                ))}
                <label className="op-check">
                  <input
                    type="checkbox"
                    checked={ajustes.janelaTodosDias}
                    onChange={(e) => setAjustes({ ...ajustes, janelaTodosDias: e.target.checked })}
                  />
                  Contatar também sábado e domingo (para a demo)
                </label>
              </div>
              <div className="op-admin-linha">
                <button type="button" className="botao" disabled={ocupado || !ajustesMudaram} onClick={() => void salvarAjustes()}>
                  Salvar prazos e limites
                </button>
                {ajustesMudaram && <span className="meta">Alterações não salvas.</span>}
              </div>
            </section>
          )}

          <section className="op-admin-cartao" aria-labelledby="admin-aprovacao-t">
            <h2 id="admin-aprovacao-t" className="op-col-t">
              Aprovação de ligação e WhatsApp
            </h2>
            <label className="op-check">
              <input
                type="checkbox"
                checked={config.aprovacaoAberta}
                disabled={ocupado}
                onChange={(e) => void alternarAprovacao(e.target.checked)}
              />
              Aprovar sem senha (demo)
            </label>
            <p className="meta">
              O plano continua precisando do clique de uma pessoa. Desligado, a aprovação pede esta mesma senha de
              admin.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
