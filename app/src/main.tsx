import { createRoot } from 'react-dom/client';
import { App } from './App';
import './App.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Fablewood: #root element not found');

// No StrictMode: it double-invokes effects in dev, which would create/destroy the
// Phaser game twice and make screenshots/e2e flaky. The shell is thin enough that
// StrictMode buys us little here.
createRoot(rootEl).render(<App />);
