/**
 * App Pages - Centralized Page Definitions
 * 
 * This file defines:
 * - Page identifiers (typed enum)
 * - Feature sequence (system lifecycle)
 * - Page metadata (for future RBAC/features)
 */

export enum AppPage {
  // Foundation Plane - "What exists?"
  INITIALIZATION = 'initialize',
  KNOWLEDGE = 'knowledge',
  MEMORY = 'memory',

  // Authoring Plane - "What should happen?"
  POLICY_STUDIO = 'policy-studio',
  POLICY_FACTORY = 'factory',

  // Verification Plane - "What will happen?"
  SIMULATOR = 'simulator',

  // Operational Plane - "What is happening right now?"
  CONTROL_PLANE = 'control-plane',
  DASHBOARD = 'dashboard',
}

/**
 * Feature Sequence - System Lifecycle Order
 * 
 * This defines the logical flow through SeedCore:
 * 1. Initialize the system (bootstrap scenarios)
 * 2. Manage knowledge base (facts, rules, snapshots)
 * 3. Author policies (create and evolve)
 * 4. Simulate outcomes (verify before deployment)
 * 5. Control deployment (operational plane)
 * 6. Monitor system (dashboard observation)
 */
export const FEATURE_SEQUENCE: AppPage[] = [
  // Foundation Plane
  AppPage.INITIALIZATION,
  AppPage.KNOWLEDGE,
  AppPage.MEMORY,
  
  // Authoring Plane
  AppPage.POLICY_STUDIO,
  AppPage.POLICY_FACTORY,
  
  // Verification Plane
  AppPage.SIMULATOR,
  
  // Operational Plane
  AppPage.CONTROL_PLANE,
  AppPage.DASHBOARD,
];

/**
 * Page Metadata - Future: RBAC, feature flags, descriptions
 * 
 * This can be extended later with:
 * - Access control requirements
 * - Feature flags
 * - Breadcrumbs
 * - Onboarding hints
 */
export interface PageMetadata {
  label: string;
  icon?: string;
  adminOnly?: boolean;
  opsOnly?: boolean;
  requiresAuth?: boolean;
  description?: string;
}

export const PAGE_METADATA: Partial<Record<AppPage, PageMetadata>> = {
  [AppPage.INITIALIZATION]: {
    label: 'Initialize',
    adminOnly: true,
    description: 'Bootstrap system scenarios and baseline configurations',
  },
  [AppPage.KNOWLEDGE]: {
    label: 'Knowledge Graph',
    description: 'View policy knowledge graph and relationships',
  },
  [AppPage.MEMORY]: {
    label: 'Unified Memory',
    description: 'Browse temporal facts and system memory',
  },
  [AppPage.POLICY_STUDIO]: {
    label: 'Policy Studio',
    description: 'Create and evolve policy artifacts',
  },
  [AppPage.POLICY_FACTORY]: {
    label: 'Policy Factory',
    description: 'AI-assisted policy generation and refinement',
  },
  [AppPage.SIMULATOR]: {
    label: 'Simulator',
    description: 'Simulate policy outcomes before deployment',
  },
  [AppPage.CONTROL_PLANE]: {
    label: 'Control Plane',
    opsOnly: true,
    description: 'Autonomous policy evolution and deployment pipeline',
  },
  [AppPage.DASHBOARD]: {
    label: 'Dashboard',
    description: 'Real-time system observation and health monitoring',
  },
};
