import simboloNegativo from '../assets/forseti-simbolo-negativo.svg';
import simboloPetroleo from '../assets/forseti-simbolo-petroleo.svg';
import type { Tema } from '../tema.ts';

// Símbolo oficial do Brandbook v4, copiado sem alteração para src/assets/: a variante
// petróleo serve o fundo claro e a negativa, o escuro. A marca segue decorativa:
// o nome "Forseti" aparece em texto ao lado, nunca dentro da imagem.
export function Marca({ tema, className }: { tema: Tema; className?: string }) {
  return (
    <img className={className} src={tema === 'dark' ? simboloNegativo : simboloPetroleo} alt="" width="22" height="30" />
  );
}
