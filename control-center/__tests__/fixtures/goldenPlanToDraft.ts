/**
 * Golden Test Fixtures for Work Plan to Issue Draft Compiler
 * V09-I05: Compile Plan → Draft (Deterministischer Compiler)
 * 
 * These fixtures demonstrate deterministic compilation behavior.
 * Same plan input → Same draft output (including bodyHash)
 */

import type { WorkPlanContentV1 } from '@/lib/schemas/workPlan';
import type { IssueDraft } from '@/lib/schemas/issueDraft';

/**
 * Golden Fixture 1: Minimal Plan
 * Tests: Basic compilation with minimal content
 */
export const GOLDEN_PLAN_MINIMAL: WorkPlanContentV1 = {
  goals: [],
  todos: [],
  options: [],
};

export const GOLDEN_DRAFT_MINIMAL: IssueDraft = {
  issueDraftVersion: '1.0',
  title: 'Work Plan: [Untitled]',
  body: 'Canonical-ID: [TBD]\n\n## Work Plan\n\nNo content available.',
  type: 'issue',
  canonicalId: 'CID:TBD',
  labels: ['from-work-plan'],
  dependsOn: [],
  priority: 'P2',
  acceptanceCriteria: ['Complete all tasks from work plan'],
  verify: {
    commands: ['npm run repo:verify'],
    expected: ['All checks pass'],
  },
  guards: {
    env: 'development',
    prodBlocked: true,
  },
};

export const GOLDEN_BODYHASH_MINIMAL = 'c6f3f3e5b9f6';

/**
 * Golden Fixture 2: Complete Plan with all sections
 * Tests: Full feature compilation with canonical ID derivation
 */
export const GOLDEN_PLAN_COMPLETE: WorkPlanContentV1 = {
  goals: [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      text: 'Implement authentication system',
      priority: 'HIGH',
      completed: false,
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      text: 'Add OAuth integration',
      priority: 'MEDIUM',
      completed: false,
    },
  ],
  context: 'Part of epic:E81 for v0.8 layer:B. Issue I811 implementation.',
  todos: [
    {
      id: '550e8400-e29b-41d4-a716-446655440003',
      text: 'Write unit tests',
      completed: false,
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440004',
      text: 'Update documentation',
      completed: false,
    },
  ],
  options: [
    {
      id: '550e8400-e29b-41d4-a716-446655440005',
      title: 'Option A: JWT tokens',
      description: 'Use JSON Web Tokens for stateless authentication',
      pros: ['Stateless', 'Scalable'],
      cons: ['Token size', 'No server-side revocation'],
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440006',
      title: 'Option B: Session cookies',
      description: 'Use traditional session-based authentication',
      pros: ['Simple', 'Easy revocation'],
      cons: ['Stateful', 'Server memory'],
    },
  ],
  notes: 'Additional considerations: Security audit required before production.',
};

export const GOLDEN_DRAFT_COMPLETE: IssueDraft = {
  issueDraftVersion: '1.0',
  title: 'Implement authentication system',
  body: `Canonical-ID: [TBD]

## Context

Part of epic:E81 for v0.8 layer:B. Issue I811 implementation.

## Goals

1. [ ] Implement authentication system (HIGH)
2. [ ] Add OAuth integration (MEDIUM)

## Options Considered

### Option 1: Option A: JWT tokens

Use JSON Web Tokens for stateless authentication

**Pros:**
- Stateless
- Scalable

**Cons:**
- Token size
- No server-side revocation

### Option 2: Option B: Session cookies

Use traditional session-based authentication

**Pros:**
- Simple
- Easy revocation

**Cons:**
- Stateful
- Server memory

## Tasks

- [ ] Update documentation
- [ ] Write unit tests

## Additional Notes

Additional considerations: Security audit required before production.`,
  type: 'issue',
  canonicalId: 'I811',
  labels: ['epic:E81', 'from-work-plan', 'layer:B', 'v0.8'],
  dependsOn: [],
  priority: 'P1',
  acceptanceCriteria: [
    'Add OAuth integration',
    'Implement authentication system',
  ],
  verify: {
    commands: ['npm run repo:verify'],
    expected: ['All checks pass'],
  },
  guards: {
    env: 'development',
    prodBlocked: true,
  },
};

/**
 * Golden Fixture 3: Priority Ordering Test
 * Tests: Stable ordering of goals by priority then alphabetically
 */
export const GOLDEN_PLAN_PRIORITY_ORDERING: WorkPlanContentV1 = {
  goals: [
    { id: '1', text: 'Z Low', priority: 'LOW', completed: false },
    { id: '2', text: 'B High', priority: 'HIGH', completed: false },
    { id: '3', text: 'M Medium', priority: 'MEDIUM', completed: false },
    { id: '4', text: 'A High', priority: 'HIGH', completed: false },
    { id: '5', text: 'Y Low', priority: 'LOW', completed: false },
  ],
  todos: [],
  options: [],
};

// Expected body should have goals in order: A High, B High, M Medium, Y Low, Z Low
export const GOLDEN_EXPECTED_GOAL_ORDER = [
  'A High (HIGH)',
  'B High (HIGH)',
  'M Medium (MEDIUM)',
  'Y Low (LOW)',
  'Z Low (LOW)',
];

/**
 * Golden Fixture 4: Label Extraction Test
 * Tests: Label extraction from context with dedup and sorting
 */
export const GOLDEN_PLAN_LABEL_EXTRACTION: WorkPlanContentV1 = {
  goals: [],
  context: 'epic:E81 epic:E82 v0.8 v0.9 layer:A layer:B epic:E81',
  todos: [],
  options: [],
};

export const GOLDEN_EXPECTED_LABELS = [
  'epic:E81',
  'epic:E82',
  'from-work-plan',
  'layer:A',
  'layer:B',
  'v0.8',
  'v0.9',
];

/**
 * Golden Fixture 5: Dependency Extraction Test
 * Tests: Dependency extraction with self-exclusion
 */
export const GOLDEN_PLAN_DEPENDENCY_EXTRACTION: WorkPlanContentV1 = {
  goals: [],
  context: 'I811 depends on I812 and E81.1',
  notes: 'Also related to I813',
  todos: [],
  options: [],
};

// I811 is the canonical ID, should be excluded from dependencies
export const GOLDEN_EXPECTED_DEPENDENCIES = ['E81.1', 'I812', 'I813'];

/**
 * Golden Fixture 6: Title Truncation Test
 * Tests: Title truncation to 200 chars
 */
export const GOLDEN_PLAN_LONG_TITLE: WorkPlanContentV1 = {
  goals: [
    {
      id: '1',
      text: 'A'.repeat(250),
      completed: false,
    },
  ],
  todos: [],
  options: [],
};

// Expected title should be truncated to 200 chars with ellipsis
export const GOLDEN_EXPECTED_TITLE_LENGTH = 200;

/**
 * Helper function to validate golden test fixtures
 * 
 * @param actual - Actual compiled draft
 * @param expected - Expected draft from golden fixture
 * @returns True if match, error message if mismatch
 */
export function validateGoldenFixture(
  actual: IssueDraft,
  expected: IssueDraft
): true | string {
  // Compare all fields
  const fields: (keyof IssueDraft)[] = [
    'issueDraftVersion',
    'title',
    'body',
    'type',
    'canonicalId',
    'priority',
  ];

  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      return `Field ${field} mismatch: ${JSON.stringify(actual[field])} !== ${JSON.stringify(expected[field])}`;
    }
  }

  // Compare arrays (labels, dependsOn, acceptanceCriteria)
  if (JSON.stringify(actual.labels) !== JSON.stringify(expected.labels)) {
    return `Labels mismatch: ${JSON.stringify(actual.labels)} !== ${JSON.stringify(expected.labels)}`;
  }

  if (JSON.stringify(actual.dependsOn) !== JSON.stringify(expected.dependsOn)) {
    return `DependsOn mismatch: ${JSON.stringify(actual.dependsOn)} !== ${JSON.stringify(expected.dependsOn)}`;
  }

  if (JSON.stringify(actual.acceptanceCriteria) !== JSON.stringify(expected.acceptanceCriteria)) {
    return `AcceptanceCriteria mismatch: ${JSON.stringify(actual.acceptanceCriteria)} !== ${JSON.stringify(expected.acceptanceCriteria)}`;
  }

  // Compare nested objects
  if (JSON.stringify(actual.verify) !== JSON.stringify(expected.verify)) {
    return `Verify mismatch: ${JSON.stringify(actual.verify)} !== ${JSON.stringify(expected.verify)}`;
  }

  if (JSON.stringify(actual.guards) !== JSON.stringify(expected.guards)) {
    return `Guards mismatch: ${JSON.stringify(actual.guards)} !== ${JSON.stringify(expected.guards)}`;
  }

  return true;
}
