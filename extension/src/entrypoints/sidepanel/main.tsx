import { createRoot } from 'react-dom/client';
import { SidePanelApp } from './App';
import '@/styles.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<SidePanelApp />);
}
