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
  SEED_DATA = 'seed-data',

  // Authoring Plane - "What should happen?"
  POLICY_STUDIO = 'policy-studio',

  // Verification Plane - "What will happen?"
  SIMULATOR = 'simulator',

  // Operational Plane - "What is happening right now?"
  CONTROL_PLANE = 'control-plane',
  DASHBOARD = 'dashboard',
  
  // Governance Plane - "Mission Control Center"
  GOVERNANCE_COCKPIT = 'governance-cockpit',
}

/**
 * Feature Sequence - System Lifecycle Order
 * 
 * Organized by "The Trinity" (Mother-Core-Simulator):
 * 
 * 1. Foundation (Core) - Stateful persistent layers and Unified Cortex
 *    - Initialize: Bootstrap scenarios and baseline configurations
 *    - Knowledge Graph: Semantic context and relationships
 *    - Unified Memory: Tier 1 (Multimodal) and Tier 2/3 (Graph) memory
 * 
 * 2. Creation (Simulator/Mother) - Gemini acts as architect
 *    - Seed Generator: Mother layer where Gemini creates initial logic
 *    - Policy Studio: Laboratory for rules, conditions, emissions (with Environmental Critic)
 *    - Policy Factory: Mass production of policies
 * 
 * 3. Operations (Cockpit) - Edge where perception meets policy
 *    - Simulator: Virtual world for testing scenarios
 *    - Governance Cockpit: Real-time command center (Temporal + Multimodal)
 *    - Control Plane: Hot-swapping snapshots via Redis pub/sub
 *    - Dashboard: Traditional monitoring and observation
 */
export const FEATURE_SEQUENCE: AppPage[] = [
  // Foundation (Core) - Stateful persistent layers
  AppPage.INITIALIZATION,
  AppPage.KNOWLEDGE,
  AppPage.MEMORY,
  
  // Creation (Simulator/Mother) - Gemini as architect
  AppPage.SEED_DATA,
  AppPage.POLICY_STUDIO,
  
  // Operations (Cockpit) - Edge: perception meets policy
  AppPage.SIMULATOR,
  AppPage.GOVERNANCE_COCKPIT, // Moved adjacent to Simulator for seamless workflow
  AppPage.CONTROL_PLANE,
  AppPage.DASHBOARD,
];

/**
 * Feature Groups - Visual grouping for sidebar
 */
export enum FeatureGroup {
  FOUNDATION = 'foundation',
  CREATION = 'creation',
  OPERATIONS = 'operations',
}

export const FEATURE_GROUPS: Record<AppPage, FeatureGroup> = {
  // Foundation (Core)
  [AppPage.INITIALIZATION]: FeatureGroup.FOUNDATION,
  [AppPage.KNOWLEDGE]: FeatureGroup.FOUNDATION,
  [AppPage.MEMORY]: FeatureGroup.FOUNDATION,
  
  // Creation (Simulator/Mother)
  [AppPage.SEED_DATA]: FeatureGroup.CREATION,
  [AppPage.POLICY_STUDIO]: FeatureGroup.CREATION,
  
  // Operations (Cockpit)
  [AppPage.SIMULATOR]: FeatureGroup.OPERATIONS,
  [AppPage.GOVERNANCE_COCKPIT]: FeatureGroup.OPERATIONS,
  [AppPage.CONTROL_PLANE]: FeatureGroup.OPERATIONS,
  [AppPage.DASHBOARD]: FeatureGroup.OPERATIONS,
};

export const GROUP_LABELS: Record<FeatureGroup, string> = {
  [FeatureGroup.FOUNDATION]: 'Foundation (Core)',
  [FeatureGroup.CREATION]: 'Creation (Mother)',
  [FeatureGroup.OPERATIONS]: 'Operations (Cockpit)',
};

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
  [AppPage.SEED_DATA]: {
    label: 'Seed Generator',
    description: 'Generate wearable design seeds using Gemini AI and PKG policy',
  },
  [AppPage.POLICY_STUDIO]: {
    label: 'Policy Studio',
    description: 'Create and evolve policy artifacts with AI-assisted generation',
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
  [AppPage.GOVERNANCE_COCKPIT]: {
    label: 'Governance Cockpit',
    description: 'Mission Control Center: Real-time perception feed (Step 7), temporal timeline (Step 6), and digital twin validation (Step 5)',
  },
  [AppPage.SIMULATOR]: {
    label: 'Simulator',
    description: 'Virtual world for testing policy scenarios before deployment. Adjacent to Governance Cockpit for seamless workflow.',
  },
};
