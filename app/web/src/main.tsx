import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
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
