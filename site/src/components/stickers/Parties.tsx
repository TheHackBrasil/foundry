// FORMA chapter: the four parties of one order as live stickers over a shared layer.
// Each figure ships a PNG poster for no-JS; the poster hides only once the canvas is live.
import { useEffect, useState } from 'react';
import { Sticker } from './Sticker';
import { FORSETI, PARTIES } from './icons';

const LABELS: Record<string, [string, string]> = {
  crate: ['Fornecedor', 'Caixa de papelão com fita petróleo'],
  truck: ['Transportadora', 'Caminhão com baú claro e cabine petróleo'],
  warehouse: ['Centro de distribuição', 'Armazém com porta de doca que abre'],
  coins: ['Financeiro', 'Pilha de moedas'],
};

export default function Parties() {
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  return (
    <ol className="parties" data-live={live || undefined}>
      {PARTIES.map((icon, i) => {
        const [name, alt] = LABELS[icon.name];
        return (
          <li key={icon.name} className="party">
            <figure>
              <img className="party-poster" src={`./assets/stickers/${icon.name}.png`} alt={alt} width={400} height={400} loading="lazy" />
              {live && <Sticker icon={icon} palette={FORSETI} offset={i * 22} enter={0.15 + i * 0.12} label={alt} className="party-live" />}
            </figure>
            <span className="party-name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
