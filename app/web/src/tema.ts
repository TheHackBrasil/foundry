export type Tema = 'light' | 'dark';

const CHAVE = 'forseti-tema';

// Claro por padrão; a escolha da pessoa fica no navegador. Sem armazenamento, segue o padrão.
export function temaInicial(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'light' || salvo === 'dark') return salvo;
  } catch {
    // armazenamento bloqueado: usa o padrão
  }
  return 'light';
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset['tema'] = tema;
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    // sem armazenamento: vale só nesta visita
  }
}
