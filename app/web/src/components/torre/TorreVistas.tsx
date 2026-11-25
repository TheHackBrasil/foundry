import { useRef, useState, type FormEvent } from 'react';
import type { CardId, VistaTemplate } from './layout.ts';

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
  aoAplicar: (template: VistaTemplate) => void;
  aoSalvarCustom: (nome: string) => void;
  aoExcluirCustom: (id: string) => void;
  aoAlternarCard: (id: CardId) => void;
  aoMostrarTodos: () => void;
  aoAlternarDensidade: () => void;
}

// Barra de vistas do tiling (THE-19): presets aplicam ordem + visibilidade,
// vistas salvas pela pessoa ficam em localStorage e o bloco "Cards" liga e
// desliga card a card. Estado salvo vem do localStorage, nunca inventado.
export function TorreVistas({
  presets,
  customizados,
  ativoId,
  cards,
  densidade,
  aoAplicar,
  aoSalvarCustom,
  aoExcluirCustom,
  aoAlternarCard,
  aoMostrarTodos,
  aoAlternarDensidade,
}: TorreVistasProps) {
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function abrirForm() {
    setFormAberto(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function confirmar(e: FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;
    aoSalvarCustom(limpo);
    setNome('');
    setFormAberto(false);
  }

  return (
    <div className="torre-vistas" role="group" aria-label="Vistas do painel">
      <div className="torre-vistas-linha">
        <div className="torre-vistas-grupo" role="group" aria-label="Vistas prontas">
          {presets.map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip"
              data-ativa={ativoId === t.id ? 'true' : undefined}
              aria-pressed={ativoId === t.id}
              onClick={() => aoAplicar(t)}
            >
              {t.nome}
            </button>
          ))}
        </div>

        {customizados.length > 0 && (
          <div className="torre-vistas-grupo" role="group" aria-label="Vistas salvas por você">
            {customizados.map((t) => (
              <span key={t.id} className="torre-vista-salva">
                <button
                  type="button"
                  className="chip"
                  data-ativa={ativoId === t.id ? 'true' : undefined}
                  aria-pressed={ativoId === t.id}
                  onClick={() => aoAplicar(t)}
                >
                  {t.nome}
                </button>
                <button
                  type="button"
                  className="torre-vista-remover"
                  aria-label={`Excluir vista ${t.nome}`}
                  onClick={() => aoExcluirCustom(t.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="torre-vistas-acoes">
          <button
            type="button"
            className="torre-densidade"
            aria-label={`Densidade da grade: ${['compacta', 'normal', 'grande'][densidade]}. Clique para alternar.`}
            title={`Densidade: ${['compacta', 'normal', 'grande'][densidade]}`}
            onClick={aoAlternarDensidade}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              {densidade === 0 && (
                <>
                  <rect x="1.5" y="1.5" width="3.6" height="3.6" rx="1" />
                  <rect x="6.2" y="1.5" width="3.6" height="3.6" rx="1" />
                  <rect x="10.9" y="1.5" width="3.6" height="3.6" rx="1" />
                  <rect x="1.5" y="6.2" width="3.6" height="3.6" rx="1" />
                  <rect x="6.2" y="6.2" width="3.6" height="3.6" rx="1" />
                  <rect x="10.9" y="6.2" width="3.6" height="3.6" rx="1" />
                  <rect x="1.5" y="10.9" width="3.6" height="3.6" rx="1" />
                  <rect x="6.2" y="10.9" width="3.6" height="3.6" rx="1" />
                  <rect x="10.9" y="10.9" width="3.6" height="3.6" rx="1" />
                </>
              )}
              {densidade === 1 && (
                <>
                  <rect x="1.5" y="1.5" width="6" height="6" rx="1.2" />
                  <rect x="8.5" y="1.5" width="6" height="6" rx="1.2" />
                  <rect x="1.5" y="8.5" width="6" height="6" rx="1.2" />
                  <rect x="8.5" y="8.5" width="6" height="6" rx="1.2" />
                </>
              )}
              {densidade === 2 && (
                <>
                  <rect x="1.5" y="2" width="13" height="5" rx="1.4" />
                  <rect x="1.5" y="9" width="13" height="5" rx="1.4" />
                </>
              )}
            </svg>
          </button>
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
                  if (e.key === 'Escape') {
                    setFormAberto(false);
                    setNome('');
                  }
                }}
              />
              <button type="submit" className="chip" disabled={!nome.trim()}>
                Salvar
              </button>
            </form>
          ) : (
            <button type="button" className="botao-sutil" onClick={abrirForm}>
              Salvar vista atual
            </button>
          )}

          <details className="torre-cards-toggle">
            <summary>
              Cards
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
    </div>
  );
}
