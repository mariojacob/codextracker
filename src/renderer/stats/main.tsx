import React from 'react';
import ReactDOM from 'react-dom/client';
import { Statistics } from './ModuleStatistics.js';
import '../styles/global.css';
import './styles/stats.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Statistics />
  </React.StrictMode>,
);
