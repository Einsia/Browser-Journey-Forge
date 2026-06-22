import { createRoot } from 'react-dom/client';
import { DashboardApp } from './App';
import '@/styles.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<DashboardApp />);
}
