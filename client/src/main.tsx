import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { unlockAudioOnFirstGesture } from './sound';
import { initTheme } from './theme';
import './styles.css';

// O tema é aplicado antes do primeiro render (o index.html já evita o flash).
initTheme();

// O navegador só libera áudio após uma interação; destravamos no primeiro clique.
unlockAudioOnFirstGesture();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado no index.html.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
