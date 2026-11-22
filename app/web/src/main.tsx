import '@fontsource-variable/source-sans-3/wght.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { aplicarTema, temaInicial } from './tema.ts';
import './tokens.css';
import './styles.css';

aplicarTema(temaInicial());

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root ausente em index.html');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
