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

// Suprime transicoes por 1 quadro na troca de tema para evitar "borrao"
// simultaneo de fundo, texto e bordas pela tela inteira.
export function aplicarTema(tema: Tema): void {
  const root = document.documentElement;
  root.setAttribute('data-tema-trocando', '');
  root.dataset['tema'] = tema;
  void root.offsetHeight;
  window.requestAnimationFrame(() => {
    root.removeAttribute('data-tema-trocando');
  });
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    // sem armazenamento: vale só nesta visita
  }
}
