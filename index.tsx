import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Prevent duplicate root creation during HMR
if (!(window as any).__reactRoot) {
  (window as any).__reactRoot = ReactDOM.createRoot(rootElement);
}
(window as any).__reactRoot.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);