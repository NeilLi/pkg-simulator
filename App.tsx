import React, { Suspense, lazy, useState } from 'react';
import { Layout } from './components/Layout';

// Page Definitions
import { AppPage } from './appPages';

// Lazy page loading keeps initial app startup responsive.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const PolicyStudio = lazy(() => import('./pages/PolicyStudio').then((m) => ({ default: m.PolicyStudio })));
const InitializationPage = lazy(() =>
  import('./pages/InitializationPage').then((m) => ({ default: m.InitializationPage })),
);
const Simulator = lazy(() => import('./pages/SandboxSimulator').then((m) => ({ default: m.Simulator })));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase').then((m) => ({ default: m.KnowledgeBase })));
const ControlPlane = lazy(() => import('./pages/ControlPlane').then((m) => ({ default: m.ControlPlane })));
const SeedData = lazy(() => import('./pages/SeedData').then((m) => ({ default: m.SeedData })));
const GovernanceCockpit = lazy(() =>
  import('./pages/GovernanceCockpit').then((m) => ({ default: m.GovernanceCockpit })),
);
const PolicyAssistantPage = lazy(() =>
  import('./pages/PolicyAssistantPage').then((m) => ({ default: m.PolicyAssistantPage })),
);

/**
 * Centralized Page → Component Mapping
 * 
 * Benefits:
 * - No branching logic (no switch statements)
 * - Easy to add/remove features
 * - Easy to lazy-load later
 * - Clear single source of truth
 */
const PAGE_COMPONENTS: Record<AppPage, React.ComponentType> = {
  // Foundation Plane
  [AppPage.INITIALIZATION]: InitializationPage,
  [AppPage.KNOWLEDGE]: () => <KnowledgeBase view="knowledge" />,
  [AppPage.MEMORY]: () => <KnowledgeBase view="memory" />,
  [AppPage.SEED_DATA]: SeedData,
  [AppPage.POLICY_ASSISTANT]: PolicyAssistantPage,

  // Authoring Plane
  [AppPage.POLICY_STUDIO]: PolicyStudio,

  // Verification Plane
  [AppPage.SIMULATOR]: Simulator,

  // Operational Plane
  [AppPage.CONTROL_PLANE]: ControlPlane,
  [AppPage.DASHBOARD]: Dashboard,
  
  // Governance Plane
  [AppPage.GOVERNANCE_COCKPIT]: GovernanceCockpit,
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
  const ActivePage = PAGE_COMPONENTS[activePage];

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
    >
      <Suspense
        fallback={
          <div className="py-12 text-center text-sm text-gray-500">
            Loading page...
          </div>
        }
      >
        <ActivePage />
      </Suspense>
    </Layout>
  );
}
