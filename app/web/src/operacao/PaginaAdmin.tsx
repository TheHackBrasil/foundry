// Backoffice do time (spec 0017), em /#/admin e fora do menu. Configura o
// que a demo pública não pode deixar aberto a qualquer visitante: os números
// que a IA pode contatar e se a aprovação de ligação e WhatsApp pede senha.
// A senha de admin fica só na memória desta aba.

import { useId, useState, type FormEvent } from 'react';
import { ErroApi } from '../api.ts';
import { lerConfigAdmin, salvarConfigAdmin, type ConfigAdmin } from './api.ts';
import './operacao.css';

const mensagemDe = (e: unknown): string => (e instanceof ErroApi || e instanceof Error ? e.message : 'Erro inesperado.');

export function PaginaAdmin() {
  const [senha, setSenha] = useState('');
  const [config, setConfig] = useState<ConfigAdmin | null>(null);
  const [rascunho, setRascunho] = useState<string[]>([]);
  const [novo, setNovo] = useState('');
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

  return (
    <section className="op op-admin" aria-labelledby="admin-titulo">
      <header className="op-cab">
        <div>
          <h1 id="admin-titulo">Backoffice</h1>
          <p className="meta">Configuração do operador para o time. Vale para todas as sessões da demo.</p>
        </div>
      </header>

      {aviso && (
        <p className={aviso.tipo === 'erro' ? 'aviso-erro' : 'meta'} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
          {aviso.texto}
        </p>
      )}

      {!config ? (
        <form className="op-admin-cartao" onSubmit={(e) => void entrar(e)}>
          <label htmlFor={senhaId} className="op-col-t">
            Senha de admin
          </label>
          <p className="meta">É o valor de OPERADOR_APROVADOR_TOKEN no servidor. Fica só na memória desta aba.</p>
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
