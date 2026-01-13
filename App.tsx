import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { PolicyFactory } from './pages/PolicyFactory';
import { Simulator } from './pages/Simulator';
import { KnowledgeBase } from './pages/KnowledgeBase';

export default function App() {
  const [activePage, setActivePage] = useState('dashboard');

  const renderContent = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard />;
      case 'factory':
        return <PolicyFactory />;
      case 'simulator':
        return <Simulator />;
      case 'knowledge':
      case 'memory':
        return <KnowledgeBase view={activePage} />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout activePage={activePage} onNavigate={setActivePage}>
      {renderContent()}
    </Layout>
  );
}