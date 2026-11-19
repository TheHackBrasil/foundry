// Domino island: "dominó do atraso" (specs/0002, frente wt/domino).
// Contract: default export, no props, hydrated with client:visible.
// SSR renders the full readable panel at rest (delay = 0).
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { NODES, computeModel, stamp } from './model';
import styles from './Domino.module.css';

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};

const motionSnapshot = () =>
  window.matchMedia(MOTION_QUERY).matches ||
  new URLSearchParams(window.location.search).get('reduce') === '1';

const serverSnapshot = () => false;

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export default function Domino() {
  const [delay, setDelay] = useState(0);
  const [layer, setLayer] = useState(false);
  const [fire, setFire] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, serverSnapshot);
  const sliderId = useId();
  const model = useMemo(() => computeModel(delay, layer), [delay, layer]);

  // Every state change re-runs the cascade: state classes drop for one
  // frame, then come back; per-node transition-delay recreates the
  // ~160ms descending stagger. Reduced motion skips the reset frame
  // (CSS already snaps end states with transition: none).
  useEffect(() => {
    if (delay <= 0 || reduced) {
      setFire(delay > 0);
      return;
    }
    setFire(false);
    const raf = requestAnimationFrame(() => setFire(true));
    return () => cancelAnimationFrame(raf);
  }, [delay, layer, reduced]);

  const firing = fire && delay > 0;

  return (
    <section
      className={styles.dom}
      data-reduce={reduced || undefined}
      aria-label="Simulação fictícia: dominó do atraso"
    >
      <header className={styles.head}>
        <span className={styles.headTitle}>Dominó do atraso</span>
        <span className={styles.fic}>Simulação fictícia</span>
      </header>

      <ol className={styles.chain}>
        {model.nodes.map((s, i) => (
          <li
            key={NODES[i].name}
            className={cx(styles.node, firing && s.cls !== '' && styles[s.cls])}
            style={{ '--i': i } as CSSProperties}
          >
            <div className={styles.row}>
              <span className={styles.acc} aria-hidden="true" />
              <span className={styles.idx}>0{i + 1}</span>
              <div className={styles.meta}>
                <b>{NODES[i].name}</b>
                <span className={styles.role}>{NODES[i].role}</span>
                <span className={styles.status}>{s.status}</span>
              </div>
              <div className={styles.time}>
                <span className={styles.tbase}>{stamp(NODES[i].base)}</span>
                {s.shifted && <span className={styles.tnew}>→ {stamp(s.abs)}</span>}
              </div>
            </div>
            {i < NODES.length - 1 && (
              <div className={styles.rod} style={{ '--i': i + 1 } as CSSProperties} aria-hidden="true">
                <span />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className={styles.ctl}>
        <div className={styles.sliderRow}>
          <label className={styles.sliderLabel} htmlFor={sliderId}>
            Atraso no fornecedor
          </label>
          <output className={styles.out} htmlFor={sliderId}>
            +{delay}h
          </output>
        </div>
        <input
          id={sliderId}
          className={styles.slider}
          type="range"
          min={0}
          max={72}
          step={6}
          value={delay}
          aria-valuetext={`${delay} horas de atraso`}
          onChange={(e) => setDelay(e.currentTarget.valueAsNumber)}
        />
        <div className={styles.scale} aria-hidden="true">
          <span>0h</span>
          <span>72h</span>
        </div>

        <div className={styles.toggle} role="group" aria-label="Cenário da simulação">
          <button
            type="button"
            className={styles.tbtn}
            aria-pressed={!layer}
            onClick={() => setLayer(false)}
          >
            01 · Sem camada
          </button>
          <button
            type="button"
            className={styles.tbtn}
            aria-pressed={layer}
            onClick={() => setLayer(true)}
          >
            02 · Com camada
          </button>
        </div>

        <div className={cx(styles.verdict, styles[model.tone])} role="status" aria-live="polite">
          <span className={styles.vicon} aria-hidden="true">
            {model.mark}
          </span>
          <div>
            <b className={styles.vmain}>{model.main}</b>
            <span className={styles.vsub}>{model.sub}</span>
          </div>
        </div>

        <p className={styles.note}>Dados fictícios. Nenhuma métrica foi medida em operação real.</p>
      </div>
    </section>
  );
}
