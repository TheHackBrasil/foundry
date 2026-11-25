import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react';
import {
  CANAIS_CONTATO,
  PARTES,
  type CanalContato,
  type Contato,
  type Parte,
} from '../../../shared/model.ts';
import { garantirEstilosOps, listarContatos, salvarContato } from '../apiOps.ts';
import { rotuloCanalContato, rotuloParte } from '../format.ts';
import { usePresencaAnimada } from '../usePresencaAnimada.ts';
import { IconeAviso, IconeConfere, IconeErro, IconeFechar, IconeOk } from './icones.tsx';

export interface DrawerAgendaProps {
  aberto: boolean;
  parteInicial?: Parte;
  aoFechar: () => void;
  aoSalvar?: (contato: Contato) => void;
  aoAnunciar?: (texto: string) => void;
}

const MAX_TEXTO = 120;

const ROTULO_FONTE_CONTATO = new Map<Contato['fonte'], string>([
  ['manual', 'Manual'],
  ['documento', 'NF-e/CT-e'],
  ['seed', 'Exemplo'],
]);

function focoElementos(container: HTMLElement): HTMLElement[] {
  const seletores =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(seletores)).filter(
    (el) => el.offsetParent !== null,
  );
}

export function DrawerAgenda({
  aberto,
  parteInicial,
  aoFechar,
  aoSalvar,
  aoAnunciar,
}: DrawerAgendaProps) {
  const tituloId = useId();
  const nomeId = useId();
  const nomeErroId = useId();
  const canalId = useId();
  const destinoId = useId();
  const destinoErroId = useId();

  const painelRef = useRef<HTMLDivElement>(null);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const nomeInputRef = useRef<HTMLInputElement>(null);
  const destinoInputRef = useRef<HTMLInputElement>(null);
  const triggerAnteriorRef = useRef<HTMLElement | null>(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  const [parteAtiva, setParteAtiva] = useState<Parte>(parteInicial ?? 'fornecedor');
  const [nome, setNome] = useState('');
  const [canal, setCanal] = useState<CanalContato>('whatsapp');
  const [destino, setDestino] = useState('');
  const [errosCampo, setErrosCampo] = useState<{ nome?: string; destino?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvoMsg, setSalvoMsg] = useState<string | null>(null);
  const presenca = usePresencaAnimada(aberto, 200);

  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const mapaContatos = useMemo(
    () => new Map<Parte, Contato>(contatos.map((c) => [c.parte, c])),
    [contatos],
  );

  const preencherFormulario = useCallback((parte: Parte, lista: readonly Contato[]) => {
    const existente = lista.find((c) => c.parte === parte);
    setNome(existente?.nome ?? '');
    setCanal(existente?.canal ?? 'whatsapp');
    setDestino(existente?.destino ?? '');
    setErrosCampo({});
    setErroSalvar(null);
  }, []);

  const carregar = useCallback(
    async (parteAlvo: Parte) => {
      setCarregando(true);
      setErroCarga(null);
      try {
        const lista = await listarContatos();
        setContatos(lista);
        preencherFormulario(parteAlvo, lista);
      } catch (err) {
        setErroCarga(
          err instanceof Error ? err.message : 'Não foi possível carregar a agenda de contatos.',
        );
      } finally {
        setCarregando(false);
      }
    },
    [preencherFormulario],
  );

  useEffect(() => {
    if (!aberto) return;
    triggerAnteriorRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const alvo = parteInicial ?? 'fornecedor';
    setParteAtiva(alvo);
    setSalvoMsg(null);
    setErroSalvar(null);
    void carregar(alvo);

    const anteriorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focoFrame = window.requestAnimationFrame(() => {
      fecharBtnRef.current?.focus();
    });

    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        aoFecharRef.current();
        return;
      }
      if (e.key === 'Tab' && painelRef.current) {
        const focaveis = focoElementos(painelRef.current);
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo?.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro?.focus();
        }
      }
    };

    document.addEventListener('keydown', aoTecla);
    return () => {
      window.cancelAnimationFrame(focoFrame);
      document.removeEventListener('keydown', aoTecla);
      document.body.style.overflow = anteriorOverflow;
      triggerAnteriorRef.current?.focus({ preventScroll: true });
    };
  }, [aberto, parteInicial, carregar]);

  function selecionarParte(parte: Parte) {
    setParteAtiva(parte);
    setSalvoMsg(null);
    preencherFormulario(parte, contatos);
  }

  async function enviarFormulario(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSalvoMsg(null);
    setErroSalvar(null);

    const nomeLimpo = nome.trim();
    const destinoLimpo = destino.trim();
    const novosErros: { nome?: string; destino?: string } = {};

    if (!nomeLimpo) {
      novosErros.nome = 'Informe o nome do responsável ou equipe.';
    } else if (nomeLimpo.length > MAX_TEXTO) {
      novosErros.nome = `Use no máximo ${MAX_TEXTO} caracteres.`;
    }

    if (!destinoLimpo) {
      novosErros.destino =
        canal === 'email'
          ? 'Informe o endereço de e-mail.'
          : canal === 'webhook'
            ? 'Informe a URL do endpoint.'
            : 'Informe o número de telefone com DDD/DDI.';
    } else if (destinoLimpo.length > MAX_TEXTO) {
      novosErros.destino = `Use no máximo ${MAX_TEXTO} caracteres.`;
    }

    if (novosErros.nome || novosErros.destino) {
      setErrosCampo(novosErros);
      if (novosErros.nome) nomeInputRef.current?.focus();
      else destinoInputRef.current?.focus();
      return;
    }

    setErrosCampo({});
    setSalvando(true);
    try {
      const salvo = await salvarContato({
        parte: parteAtiva,
        nome: nomeLimpo,
        canal,
        destino: destinoLimpo,
      });
      setContatos((prev) => {
        const semAntigo = prev.filter((c) => c.parte !== salvo.parte);
        return [...semAntigo, salvo];
      });
      const msg = `Contato de ${rotuloParte(salvo.parte)} salvo (${rotuloCanalContato(salvo.canal)}).`;
      setSalvoMsg(msg);
      aoSalvar?.(salvo);
      aoAnunciar?.(msg);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Não foi possível salvar o contato na agenda.';
      setErroSalvar(msg);
      aoAnunciar?.(msg);
    } finally {
      setSalvando(false);
    }
  }

  if (!presenca.montado) return null;

  return (
    <div
      className="drawer-backdrop"
      data-fase={presenca.fase}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={painelRef}
        className="drawer-panel slab-mineral"
        data-fase={presenca.fase}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <header className="drawer-cab">
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <h2 id={tituloId}>Agenda dos 5 setores</h2>
            <p className="meta">
              Configure destino e canal para avisos operacionais da sua sessão.
            </p>
          </div>

          <button
            ref={fecharBtnRef}
            type="button"
            className="botao-fechar"
            onClick={aoFechar}
            aria-label="Fechar agenda de contatos"
          >
            <IconeFechar />
          </button>
        </header>

        <div className="drawer-corpo">
          {erroCarga && (
            <div className="drawer-card" role="alert">
              <p className="aviso-erro">{erroCarga}</p>
              <button
                type="button"
                className="botao-sutil"
                onClick={() => void carregar(parteAtiva)}
              >
                Tentar carregar novamente
              </button>
            </div>
          )}

          {carregando && contatos.length === 0 && (
            <div className="palco-cab-linha" role="status">
              <span className="cmd-spinner" aria-hidden="true" />
              <span className="dica">Carregando contatos dos 5 setores…</span>
            </div>
          )}

          <section aria-label="Contatos por papel" style={{ display: 'grid', gap: '0.5rem' }}>
            {PARTES.map((parte) => {
              const c = mapaContatos.get(parte);
              const selecionado = parteAtiva === parte;
              const emailAlerta = c?.canal === 'email';
              const origem = c ? (ROTULO_FONTE_CONTATO.get(c.fonte) ?? c.fonte) : null;
              const classeOrigem =
                c?.fonte === 'manual'
                  ? 'pilula-ok'
                  : c?.fonte === 'documento'
                    ? 'pilula-neutra'
                    : 'pilula-sutil';

              return (
                <button
                  key={parte}
                  type="button"
                  className="agenda-papel-btn"
                  aria-pressed={selecionado}
                  onClick={() => selecionarParte(parte)}
                >
                  <div className="domino-no-topo">
                    <strong>{rotuloParte(parte)}</strong>
                    <div className="palco-cab-linha">
                      {origem && <span className={classeOrigem}>{origem}</span>}
                      {!c ? (
                        <span className="pilula-warn">
                          <IconeErro />
                          Sem contato
                        </span>
                      ) : emailAlerta ? (
                        <span className="pilula-warn">
                          <IconeAviso />
                          E-mail · envio direto indisponível
                        </span>
                      ) : (
                        <span className="pilula-ok">
                          <IconeOk />
                          {rotuloCanalContato(c.canal)}
                        </span>
                      )}
                    </div>
                  </div>
                  {c ? (
                    <span className="meta">
                      {c.nome} · <span className="mono">{c.destino}</span>
                    </span>
                  ) : (
                    <span className="meta">Sem canal configurado</span>
                  )}
                </button>
              );
            })}
          </section>

          <section className="drawer-card" aria-label={`Editar contato de ${rotuloParte(parteAtiva)}`}>
            <div className="domino-no-topo">
              <strong style={{ fontSize: '0.9375rem' }}>
                Editar {rotuloParte(parteAtiva)}
              </strong>
              <span className="meta">Salva como contato Manual</span>
            </div>

            <form className="drawer-form" onSubmit={(e) => void enviarFormulario(e)} noValidate>
              <div className="drawer-field">
                <label htmlFor={nomeId}>Nome do contato ou equipe</label>
                <input
                  ref={nomeInputRef}
                  id={nomeId}
                  name="nome"
                  type="text"
                  maxLength={MAX_TEXTO}
                  autoComplete="organization"
                  className="drawer-input"
                  value={nome}
                  placeholder={`Ex.: Equipe ${rotuloParte(parteAtiva)}`}
                  aria-invalid={errosCampo.nome ? 'true' : undefined}
                  aria-describedby={errosCampo.nome ? nomeErroId : undefined}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setNome(e.target.value);
                    if (errosCampo.nome) setErrosCampo((prev) => ({ ...prev, nome: undefined }));
                  }}
                />
                {errosCampo.nome && (
                  <span id={nomeErroId} className="aviso-erro" style={{ fontSize: '0.8125rem' }}>
                    {errosCampo.nome}
                  </span>
                )}
              </div>

              <div className="drawer-field">
                <label htmlFor={canalId}>Canal de notificação</label>
                <select
                  id={canalId}
                  name="canal"
                  className="drawer-select"
                  value={canal}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                    const valor = e.target.value as CanalContato;
                    setCanal(valor);
                  }}
                >
                  {CANAIS_CONTATO.map((op) => (
                    <option key={op} value={op}>
                      {rotuloCanalContato(op)}
                    </option>
                  ))}
                </select>
                {canal === 'email' && (
                  <p className="meta" style={{ color: 'var(--warn)' }}>
                    O provedor de disparo ativo entrega por WhatsApp, SMS e Ligação. E-mail fica
                    registrado na agenda, mas gera alerta de canal incompatível no disparo.
                  </p>
                )}
                {canal === 'webhook' && (
                  <p className="meta">
                    O servidor faz um POST JSON com a tarefa nessa URL (ex.: webhook.site). Não
                    depende de provedora de disparo.
                  </p>
                )}
              </div>

              <div className="drawer-field">
                <label htmlFor={destinoId}>
                  {canal === 'email'
                    ? 'Endereço de e-mail'
                    : canal === 'webhook'
                      ? 'URL do webhook'
                      : 'Telefone com DDI/DDD'}
                </label>
                <input
                  ref={destinoInputRef}
                  id={destinoId}
                  name="destino"
                  type={canal === 'email' ? 'email' : canal === 'webhook' ? 'url' : 'tel'}
                  inputMode={canal === 'email' ? 'email' : canal === 'webhook' ? 'url' : 'tel'}
                  maxLength={MAX_TEXTO}
                  autoComplete={canal === 'email' ? 'email' : 'off'}
                  className="drawer-input mono"
                  value={destino}
                  placeholder={
                    canal === 'email'
                      ? 'operacao@empresa.com'
                      : canal === 'webhook'
                        ? 'https://webhook.site/seu-endpoint'
                        : '+55 11 99999-0000'
                  }
                  aria-invalid={errosCampo.destino ? 'true' : undefined}
                  aria-describedby={errosCampo.destino ? destinoErroId : undefined}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setDestino(e.target.value);
                    if (errosCampo.destino) {
                      setErrosCampo((prev) => ({ ...prev, destino: undefined }));
                    }
                  }}
                />
                {errosCampo.destino && (
                  <span
                    id={destinoErroId}
                    className="aviso-erro"
                    style={{ fontSize: '0.8125rem' }}
                  >
                    {errosCampo.destino}
                  </span>
                )}
              </div>

              {erroSalvar && (
                <div role="alert" className="pilula-erro" style={{ width: 'fit-content' }}>
                  <IconeErro />
                  {erroSalvar}
                </div>
              )}

              {salvoMsg && (
                <div role="status" className="pilula-ok" style={{ width: 'fit-content' }}>
                  <IconeConfere />
                  {salvoMsg}
                </div>
              )}

              <div className="despacho-acoes">
                <button type="submit" className="cmd-btn-enviar" disabled={salvando}>
                  {salvando ? (
                    <>
                      <span className="cmd-spinner" aria-hidden="true" />
                      Salvando…
                    </>
                  ) : (
                    `Salvar contato de ${rotuloParte(parteAtiva)}`
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
