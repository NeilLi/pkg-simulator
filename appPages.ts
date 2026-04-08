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
  POLICY_ASSISTANT = 'policy-assistant',
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
 * Organized by the SeedCore runtime lifecycle:
 * 
 * 1. Foundation - Baseline runtime surfaces and unified memory
 *    - Initialize: Bootstrap the governed runtime baseline
 *    - Knowledge Graph: Semantic context and custody relationships
 *    - Unified Memory: Event, knowledge, and playback memory tiers
 * 
 * 2. Creation - Mission seeding and policy authoring
 *    - Seed Generator: Generate governed mission requests and incident scenarios
 *    - Policy Studio: Laboratory for rules, conditions, emissions, and runtime facts
 * 
 * 3. Operations - Where perception, policy, and actuator control meet
 *    - Simulator: Virtual world for zero-trust mission testing
 *    - Governance Cockpit: Real-time command center (temporal + custody + digital twin)
 *    - Control Plane: Policy evolution, promotion, and deployment orchestration
 *    - Dashboard: Runtime monitoring and operational posture
 */
export const FEATURE_SEQUENCE: AppPage[] = [
  // Foundation (Core) - Stateful persistent layers
  AppPage.INITIALIZATION,
  AppPage.KNOWLEDGE,
  AppPage.MEMORY,
  
  // Creation (Simulator/Mother) - Gemini as architect
  AppPage.SEED_DATA,
  AppPage.POLICY_ASSISTANT,
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
  [AppPage.POLICY_ASSISTANT]: FeatureGroup.CREATION,
  [AppPage.POLICY_STUDIO]: FeatureGroup.CREATION,
  
  // Operations (Cockpit)
  [AppPage.SIMULATOR]: FeatureGroup.OPERATIONS,
  [AppPage.GOVERNANCE_COCKPIT]: FeatureGroup.OPERATIONS,
  [AppPage.CONTROL_PLANE]: FeatureGroup.OPERATIONS,
  [AppPage.DASHBOARD]: FeatureGroup.OPERATIONS,
};

export const GROUP_LABELS: Record<FeatureGroup, string> = {
  [FeatureGroup.FOUNDATION]: 'Foundation (Core)',
  [FeatureGroup.CREATION]: 'Creation',
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
    description: 'Bootstrap governed runtime baselines, zones, and actuator surfaces',
  },
  [AppPage.KNOWLEDGE]: {
    label: 'Knowledge Graph',
    description: 'View policy knowledge graph, custody relationships, and runtime facts',
  },
  [AppPage.MEMORY]: {
    label: 'Unified Memory',
    description: 'Browse temporal facts, playback evidence, and system memory',
  },
  [AppPage.SEED_DATA]: {
    label: 'Mission Seeds',
    description: 'Generate governed mission requests and incident scenarios using Gemini and PKG policy',
  },
  [AppPage.POLICY_STUDIO]: {
    label: 'Policy Studio',
    description: 'Create and evolve runtime policy artifacts with AI-assisted generation',
  },
  [AppPage.POLICY_ASSISTANT]: {
    label: 'Policy Assistant',
    description: 'Guided policy setup for non-experts with preflight and scenario simulation before commit',
  },
  [AppPage.SIMULATOR]: {
    label: 'Simulator',
    description: 'Simulate zero-trust policy outcomes before deployment',
  },
  [AppPage.CONTROL_PLANE]: {
    label: 'Control Plane',
    opsOnly: true,
    description: 'Policy evolution, validation, and deployment pipeline for runtime surfaces',
  },
  [AppPage.DASHBOARD]: {
    label: 'Dashboard',
    description: 'Runtime observation, deployment posture, and safety monitoring',
  },
  [AppPage.GOVERNANCE_COCKPIT]: {
    label: 'Governance Cockpit',
    description: 'Mission control center for perception, temporal policy, custody state, and digital twin validation',
  },
  [AppPage.SIMULATOR]: {
    label: 'Simulator',
    description: 'Virtual world for zero-trust runtime testing before deployment. Adjacent to Governance Cockpit for seamless workflow.',
  },
};
