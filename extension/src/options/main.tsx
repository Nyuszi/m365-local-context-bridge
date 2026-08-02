import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Options } from './Options';

document.body.classList.add('options-page');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
