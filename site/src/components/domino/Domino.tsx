// Domino island: the hero's claim as a table. One order, five companies, each
// company's own system on one row next to what actually happened.
// Contract: default export, no props, hydrated with client:visible.
// SSR renders a readable state (6h late, no layer), so no-JS still shows the point.
import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { PARTIES, computeModel } from './model';
import styles from './Domino.module.css';

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export default function Domino() {
  const [delay, setDelay] = useState(6);
  const [layer, setLayer] = useState(false);
  const sliderId = useId();
  const model = useMemo(() => computeModel(delay, layer), [delay, layer]);

  return (
    <section className={styles.dom} aria-label="Simulação: um pedido em cinco sistemas">
      <header className={styles.head}>
        <p className={styles.order}>
          Pedido 4821 · 300 caixas <span className={styles.fic}>dados fictícios</span>
        </p>
        <div className={styles.ctl}>
          <label htmlFor={sliderId}>
            O fornecedor atrasa a expedição em <output htmlFor={sliderId}>{delay}h</output>
          </label>
          <input
            id={sliderId}
            className={styles.slider}
            type="range"
            min={0}
            max={36}
            step={2}
            value={delay}
            style={{ '--v': delay / 36 } as CSSProperties}
            aria-valuetext={`${delay} horas de atraso`}
            onChange={(e) => setDelay(e.currentTarget.valueAsNumber)}
          />
        </div>
      </header>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Empresa</th>
            <th scope="col">O sistema dela diz</th>
            <th scope="col">O que aconteceu</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r, i) => (
            <tr key={PARTIES[i].name} className={styles[r.state]} style={{ '--i': i } as CSSProperties}>
              <th scope="row">
                {PARTIES[i].name}
                <span>{PARTIES[i].tracks}</span>
              </th>
              <td className={styles.shows}>{r.shows}</td>
              <td className={styles.real}>
                <i aria-hidden="true" />
                {r.real}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className={styles.foot}>
        <div className={styles.toggle} role="group" aria-label="Cenário">
          <button type="button" aria-pressed={!layer} onClick={() => setLayer(false)}>
            Hoje
          </button>
          <button type="button" aria-pressed={layer} onClick={() => setLayer(true)}>
            Com a camada
          </button>
        </div>
        <p className={cx(styles.verdict, model.wrong > 0 && styles.bad, layer && delay > 0 && styles.good)} role="status" aria-live="polite">
          {model.verdict}
        </p>
      </footer>
    </section>
  );
}
