import React, { useState } from 'react';
import { Layout } from './components/Layout';

// Page Components
import { Dashboard } from './pages/Dashboard';
import { PolicyStudio } from './pages/PolicyStudio';
import { InitializationPage } from './pages/InitializationPage';
import { Simulator } from './pages/Simulator';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { ControlPlane } from './pages/ControlPlane';
import { SeedData } from './pages/SeedData';
import { GovernanceCockpit } from './pages/GovernanceCockpit';

// Page Definitions
import { AppPage } from './appPages';

/**
 * Centralized Page → Component Mapping
 * 
 * Benefits:
 * - No branching logic (no switch statements)
 * - Easy to add/remove features
 * - Easy to lazy-load later
 * - Clear single source of truth
 */
const PAGE_COMPONENTS: Record<AppPage, React.ReactNode> = {
  // Foundation Plane
  [AppPage.INITIALIZATION]: <InitializationPage />,
  [AppPage.KNOWLEDGE]: <KnowledgeBase view="knowledge" />,
  [AppPage.MEMORY]: <KnowledgeBase view="memory" />,
  [AppPage.SEED_DATA]: <SeedData />,

  // Authoring Plane
  [AppPage.POLICY_STUDIO]: <PolicyStudio />,

  // Verification Plane
  [AppPage.SIMULATOR]: <Simulator />,

  // Operational Plane
  [AppPage.CONTROL_PLANE]: <ControlPlane />,
  [AppPage.DASHBOARD]: <Dashboard />,
  
  // Governance Plane
  [AppPage.GOVERNANCE_COCKPIT]: <GovernanceCockpit />,
};

/**
 * App - SeedCore PKG Manager
 * 
 * Architecture:
 * - Typed page navigation (AppPage enum)
 * - Lifecycle-driven feature sequence
 * - Centralized component mapping
 * - Future-proof for routing/access control
 */
export default function App() {
  const [activePage, setActivePage] = useState<AppPage>(AppPage.DASHBOARD);

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
    >
      {PAGE_COMPONENTS[activePage]}
    </Layout>
  );
}
