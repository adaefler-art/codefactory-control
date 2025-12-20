/**
 * Issue B6: Reproduzierbare Verdict-Simulation
 * 
 * Tests for reproducible verdict simulations to deliberately trigger
 * GREEN, HOLD, and RED verdicts.
 * 
 * **Ziel**: GREEN / HOLD / RED gezielt testbar
 * 
 * **Acceptance**:
 * - mind. ein absichtlich provozierter HOLD
 * - mind. ein absichtlich provozierter RED
 */

import {
  generateVerdict,
  toSimpleVerdict,
  getSimpleAction,
  getActionForVerdictType,
} from '../src/engine';
import { CfnFailureSignal } from '@codefactory/deploy-memory/src/types';
import { VerdictType, SimpleVerdict, SimpleAction } from '../src/types';

/**
 * Test Helper: Create signals that trigger a specific error class
 */
class VerdictSimulator {
  /**
   * Create signals for a GREEN verdict (no errors, successful deployment)
   * 
   * Note: In the real system, GREEN verdicts don't have signals (no failures).
   * This simulates a successful state by using a low-severity deprecated API warning.
   */
  static createGreenSignals(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::CDK::Metadata',
        logicalId: 'CDKMetadata',
        statusReason: '[DEPRECATED] API method is deprecated - use new method instead',
        timestamp: new Date(),
      },
    ];
  }

  /**
   * Create signals for a RED verdict (critical failure - REJECTED)
   * 
   * Triggers: MISSING_SECRET → OPEN_ISSUE → REJECTED → RED → ABORT
   */
  static createRedSignals_MissingSecret(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::Lambda::Function',
        logicalId: 'MyFunction',
        statusReason: 'ResourceNotFoundException: Secrets Manager cannot find the specified secret',
        timestamp: new Date(),
        resourceStatus: 'CREATE_FAILED',
      },
    ];
  }

  /**
   * Create signals for a RED verdict (critical failure - REJECTED)
   * 
   * Triggers: MISSING_ENV_VAR → OPEN_ISSUE → REJECTED → RED → ABORT
   */
  static createRedSignals_MissingEnvVar(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::ECS::TaskDefinition',
        logicalId: 'TaskDef',
        statusReason: 'Required environment variable DATABASE_URL is not set',
        timestamp: new Date(),
        resourceStatus: 'CREATE_FAILED',
      },
    ];
  }

  /**
   * Create signals for a HOLD verdict (requires human intervention - ESCALATED)
   * 
   * Triggers: ROUTE53_DELEGATION_PENDING → HUMAN_REQUIRED → ESCALATED → HOLD → FREEZE
   */
  static createHoldSignals_Route53Delegation(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::Route53::HostedZone',
        logicalId: 'HostedZone',
        statusReason: 'NS records not configured - delegation pending for zone',
        timestamp: new Date(),
        resourceStatus: 'CREATE_COMPLETE',
      },
    ];
  }

  /**
   * Create signals for a HOLD verdict (resource blocked - BLOCKED)
   * 
   * Triggers: CFN_IN_PROGRESS_LOCK → WAIT_AND_RETRY → BLOCKED → HOLD → FREEZE
   */
  static createHoldSignals_CfnInProgress(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::CloudFormation::Stack',
        logicalId: 'MyStack',
        statusReason: 'Cannot update stack - Stack is in UPDATE_IN_PROGRESS state',
        timestamp: new Date(),
        resourceStatus: 'UPDATE_IN_PROGRESS',
      },
    ];
  }

  /**
   * Create signals for a HOLD verdict (rollback blocked - BLOCKED)
   * 
   * Triggers: CFN_ROLLBACK_LOCK → OPEN_ISSUE → BLOCKED → HOLD → FREEZE
   */
  static createHoldSignals_CfnRollback(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::CloudFormation::Stack',
        logicalId: 'MyStack',
        statusReason: 'Stack is in ROLLBACK_IN_PROGRESS state - cannot update while rolling back',
        timestamp: new Date(),
        resourceStatus: 'ROLLBACK_IN_PROGRESS',
      },
    ];
  }

  /**
   * Create signals for a RETRY verdict (transient condition - DEFERRED)
   * 
   * Triggers: ACM_DNS_VALIDATION_PENDING → WAIT_AND_RETRY → DEFERRED → RETRY → RETRY_OPERATION
   */
  static createRetrySignals_AcmDnsValidation(): CfnFailureSignal[] {
    return [
      {
        resourceType: 'AWS::CertificateManager::Certificate',
        logicalId: 'Certificate',
        statusReason: 'DNS validation is pending. Waiting for CNAME records to propagate.',
        timestamp: new Date(),
        resourceStatus: 'CREATE_IN_PROGRESS',
      },
    ];
  }
}

describe('Issue B6: Reproduzierbare Verdict-Simulation', () => {
  describe('GREEN Verdict Simulation', () => {
    test('should generate GREEN verdict for deprecated API warning (low severity)', () => {
      const signals = VerdictSimulator.createGreenSignals();
      const verdict = generateVerdict({
        execution_id: 'exec-green-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.WARNING);
      expect(verdict.error_class).toBe('DEPRECATED_CDK_API');
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.GREEN);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.ADVANCE);

      // Verify complete mapping chain
      const directAction = getActionForVerdictType(verdict.verdict_type);
      expect(directAction).toBe(SimpleAction.ADVANCE);
    });

    test('GREEN verdict should allow deployment to proceed', () => {
      const signals = VerdictSimulator.createGreenSignals();
      const verdict = generateVerdict({
        execution_id: 'exec-green-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.GREEN);
      expect(action).toBe(SimpleAction.ADVANCE);
      expect(action).not.toBe(SimpleAction.ABORT);
      expect(action).not.toBe(SimpleAction.FREEZE);
    });
  });

  describe('RED Verdict Simulation (Acceptance: absichtlich provozierter RED)', () => {
    test('should generate RED verdict for missing secret (REJECTED)', () => {
      const signals = VerdictSimulator.createRedSignals_MissingSecret();
      const verdict = generateVerdict({
        execution_id: 'exec-red-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.REJECTED);
      expect(verdict.error_class).toBe('MISSING_SECRET');
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.RED);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.ABORT);

      // Verify complete mapping chain
      const directAction = getActionForVerdictType(verdict.verdict_type);
      expect(directAction).toBe(SimpleAction.ABORT);

      console.log('✅ RED verdict successfully triggered (Missing Secret scenario)');
    });

    test('should generate RED verdict for missing environment variable (REJECTED)', () => {
      const signals = VerdictSimulator.createRedSignals_MissingEnvVar();
      const verdict = generateVerdict({
        execution_id: 'exec-red-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.REJECTED);
      expect(verdict.error_class).toBe('MISSING_ENV_VAR');
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.RED);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.ABORT);

      console.log('✅ RED verdict successfully triggered (Missing Env Var scenario)');
    });

    test('RED verdict should trigger ABORT action', () => {
      const signals = VerdictSimulator.createRedSignals_MissingSecret();
      const verdict = generateVerdict({
        execution_id: 'exec-red-003',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.RED);
      expect(action).toBe(SimpleAction.ABORT);
      expect(action).not.toBe(SimpleAction.ADVANCE);
      expect(action).not.toBe(SimpleAction.FREEZE);
      expect(action).not.toBe(SimpleAction.RETRY_OPERATION);
    });

    test('RED verdict mapping is deterministic', () => {
      const signals = VerdictSimulator.createRedSignals_MissingSecret();
      
      // Generate same verdict multiple times
      const verdict1 = generateVerdict({
        execution_id: 'exec-red-det-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });
      
      const verdict2 = generateVerdict({
        execution_id: 'exec-red-det-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Both should produce identical results
      expect(verdict1.verdict_type).toBe(verdict2.verdict_type);
      expect(verdict1.error_class).toBe(verdict2.error_class);
      expect(verdict1.proposed_action).toBe(verdict2.proposed_action);
      expect(verdict1.confidence_score).toBe(verdict2.confidence_score);

      const action1 = getActionForVerdictType(verdict1.verdict_type);
      const action2 = getActionForVerdictType(verdict2.verdict_type);
      expect(action1).toBe(action2);
      expect(action1).toBe(SimpleAction.ABORT);
    });
  });

  describe('HOLD Verdict Simulation (Acceptance: absichtlich provozierter HOLD)', () => {
    test('should generate HOLD verdict for Route53 delegation (ESCALATED)', () => {
      const signals = VerdictSimulator.createHoldSignals_Route53Delegation();
      const verdict = generateVerdict({
        execution_id: 'exec-hold-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.ESCALATED);
      expect(verdict.error_class).toBe('ROUTE53_DELEGATION_PENDING');
      expect(verdict.proposed_action).toBe('HUMAN_REQUIRED');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.FREEZE);

      // Verify complete mapping chain
      const directAction = getActionForVerdictType(verdict.verdict_type);
      expect(directAction).toBe(SimpleAction.FREEZE);

      console.log('✅ HOLD verdict successfully triggered (Route53 Delegation scenario)');
    });

    test('should generate HOLD verdict for CloudFormation in-progress lock (BLOCKED)', () => {
      const signals = VerdictSimulator.createHoldSignals_CfnInProgress();
      const verdict = generateVerdict({
        execution_id: 'exec-hold-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.BLOCKED);
      expect(verdict.error_class).toBe('CFN_IN_PROGRESS_LOCK');
      expect(verdict.proposed_action).toBe('WAIT_AND_RETRY');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.FREEZE);

      console.log('✅ HOLD verdict successfully triggered (CFN In-Progress Lock scenario)');
    });

    test('should generate HOLD verdict for CloudFormation rollback lock (BLOCKED)', () => {
      const signals = VerdictSimulator.createHoldSignals_CfnRollback();
      const verdict = generateVerdict({
        execution_id: 'exec-hold-003',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.BLOCKED);
      expect(verdict.error_class).toBe('CFN_ROLLBACK_LOCK');
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.FREEZE);

      console.log('✅ HOLD verdict successfully triggered (CFN Rollback Lock scenario)');
    });

    test('HOLD verdict should trigger FREEZE action', () => {
      const signals = VerdictSimulator.createHoldSignals_Route53Delegation();
      const verdict = generateVerdict({
        execution_id: 'exec-hold-004',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);
      expect(action).toBe(SimpleAction.FREEZE);
      expect(action).not.toBe(SimpleAction.ADVANCE);
      expect(action).not.toBe(SimpleAction.ABORT);
      expect(action).not.toBe(SimpleAction.RETRY_OPERATION);
    });

    test('HOLD verdict mapping is deterministic', () => {
      const signals = VerdictSimulator.createHoldSignals_Route53Delegation();
      
      // Generate same verdict multiple times
      const verdict1 = generateVerdict({
        execution_id: 'exec-hold-det-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });
      
      const verdict2 = generateVerdict({
        execution_id: 'exec-hold-det-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Both should produce identical results
      expect(verdict1.verdict_type).toBe(verdict2.verdict_type);
      expect(verdict1.error_class).toBe(verdict2.error_class);
      expect(verdict1.proposed_action).toBe(verdict2.proposed_action);
      expect(verdict1.confidence_score).toBe(verdict2.confidence_score);

      const action1 = getActionForVerdictType(verdict1.verdict_type);
      const action2 = getActionForVerdictType(verdict2.verdict_type);
      expect(action1).toBe(action2);
      expect(action1).toBe(SimpleAction.FREEZE);
    });
  });

  describe('RETRY Verdict Simulation (bonus coverage)', () => {
    test('should generate RETRY verdict for ACM DNS validation (DEFERRED)', () => {
      const signals = VerdictSimulator.createRetrySignals_AcmDnsValidation();
      const verdict = generateVerdict({
        execution_id: 'exec-retry-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      // Verify detailed verdict
      expect(verdict.verdict_type).toBe(VerdictType.DEFERRED);
      expect(verdict.error_class).toBe('ACM_DNS_VALIDATION_PENDING');
      expect(verdict.proposed_action).toBe('WAIT_AND_RETRY');

      // Verify simple verdict mapping
      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      expect(simpleVerdict).toBe(SimpleVerdict.RETRY);

      // Verify action mapping
      const action = getSimpleAction(simpleVerdict);
      expect(action).toBe(SimpleAction.RETRY_OPERATION);

      console.log('✅ RETRY verdict successfully triggered (ACM DNS Validation scenario)');
    });

    test('RETRY verdict should trigger RETRY_OPERATION action', () => {
      const signals = VerdictSimulator.createRetrySignals_AcmDnsValidation();
      const verdict = generateVerdict({
        execution_id: 'exec-retry-002',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.RETRY);
      expect(action).toBe(SimpleAction.RETRY_OPERATION);
      expect(action).not.toBe(SimpleAction.ADVANCE);
      expect(action).not.toBe(SimpleAction.ABORT);
      expect(action).not.toBe(SimpleAction.FREEZE);
    });
  });

  describe('Complete Verdict Flow Validation', () => {
    test('all verdict types map to exactly one simple verdict', () => {
      const testCases = [
        {
          signals: VerdictSimulator.createGreenSignals(),
          expectedVerdictType: VerdictType.WARNING,
          expectedSimpleVerdict: SimpleVerdict.GREEN,
          expectedAction: SimpleAction.ADVANCE,
        },
        {
          signals: VerdictSimulator.createRedSignals_MissingSecret(),
          expectedVerdictType: VerdictType.REJECTED,
          expectedSimpleVerdict: SimpleVerdict.RED,
          expectedAction: SimpleAction.ABORT,
        },
        {
          signals: VerdictSimulator.createHoldSignals_Route53Delegation(),
          expectedVerdictType: VerdictType.ESCALATED,
          expectedSimpleVerdict: SimpleVerdict.HOLD,
          expectedAction: SimpleAction.FREEZE,
        },
        {
          signals: VerdictSimulator.createHoldSignals_CfnInProgress(),
          expectedVerdictType: VerdictType.BLOCKED,
          expectedSimpleVerdict: SimpleVerdict.HOLD,
          expectedAction: SimpleAction.FREEZE,
        },
        {
          signals: VerdictSimulator.createRetrySignals_AcmDnsValidation(),
          expectedVerdictType: VerdictType.DEFERRED,
          expectedSimpleVerdict: SimpleVerdict.RETRY,
          expectedAction: SimpleAction.RETRY_OPERATION,
        },
      ];

      testCases.forEach((testCase, index) => {
        const verdict = generateVerdict({
          execution_id: `exec-flow-${index}`,
          policy_snapshot_id: 'policy-v1',
          signals: testCase.signals,
        });

        expect(verdict.verdict_type).toBe(testCase.expectedVerdictType);
        
        const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
        expect(simpleVerdict).toBe(testCase.expectedSimpleVerdict);
        
        const action = getSimpleAction(simpleVerdict);
        expect(action).toBe(testCase.expectedAction);
      });
    });

    test('verdict simulation is reproducible across multiple runs', () => {
      // Run the same simulation multiple times and verify consistency
      const iterations = 5;
      
      for (let i = 0; i < iterations; i++) {
        // RED scenario
        const redSignals = VerdictSimulator.createRedSignals_MissingSecret();
        const redVerdict = generateVerdict({
          execution_id: `exec-repro-red-${i}`,
          policy_snapshot_id: 'policy-v1',
          signals: redSignals,
        });
        expect(toSimpleVerdict(redVerdict.verdict_type)).toBe(SimpleVerdict.RED);
        expect(getSimpleAction(SimpleVerdict.RED)).toBe(SimpleAction.ABORT);

        // HOLD scenario
        const holdSignals = VerdictSimulator.createHoldSignals_Route53Delegation();
        const holdVerdict = generateVerdict({
          execution_id: `exec-repro-hold-${i}`,
          policy_snapshot_id: 'policy-v1',
          signals: holdSignals,
        });
        expect(toSimpleVerdict(holdVerdict.verdict_type)).toBe(SimpleVerdict.HOLD);
        expect(getSimpleAction(SimpleVerdict.HOLD)).toBe(SimpleAction.FREEZE);

        // GREEN scenario
        const greenSignals = VerdictSimulator.createGreenSignals();
        const greenVerdict = generateVerdict({
          execution_id: `exec-repro-green-${i}`,
          policy_snapshot_id: 'policy-v1',
          signals: greenSignals,
        });
        expect(toSimpleVerdict(greenVerdict.verdict_type)).toBe(SimpleVerdict.GREEN);
        expect(getSimpleAction(SimpleVerdict.GREEN)).toBe(SimpleAction.ADVANCE);
      }
    });
  });

  describe('VerdictSimulator Helper Class Coverage', () => {
    test('VerdictSimulator provides all necessary signal generators', () => {
      // Verify all simulator methods exist and return valid signals
      const greenSignals = VerdictSimulator.createGreenSignals();
      expect(greenSignals).toHaveLength(1);
      expect(greenSignals[0].resourceType).toBeTruthy();

      const redSignals1 = VerdictSimulator.createRedSignals_MissingSecret();
      expect(redSignals1).toHaveLength(1);
      expect(redSignals1[0].statusReason).toContain('Secrets Manager');

      const redSignals2 = VerdictSimulator.createRedSignals_MissingEnvVar();
      expect(redSignals2).toHaveLength(1);
      expect(redSignals2[0].statusReason).toContain('environment variable');

      const holdSignals1 = VerdictSimulator.createHoldSignals_Route53Delegation();
      expect(holdSignals1).toHaveLength(1);
      expect(holdSignals1[0].resourceType).toBe('AWS::Route53::HostedZone');

      const holdSignals2 = VerdictSimulator.createHoldSignals_CfnInProgress();
      expect(holdSignals2).toHaveLength(1);
      expect(holdSignals2[0].resourceStatus).toBe('UPDATE_IN_PROGRESS');

      const holdSignals3 = VerdictSimulator.createHoldSignals_CfnRollback();
      expect(holdSignals3).toHaveLength(1);
      expect(holdSignals3[0].resourceStatus).toBe('ROLLBACK_IN_PROGRESS');

      const retrySignals = VerdictSimulator.createRetrySignals_AcmDnsValidation();
      expect(retrySignals).toHaveLength(1);
      expect(retrySignals[0].resourceType).toBe('AWS::CertificateManager::Certificate');
    });

    test('all signal timestamps are valid Date objects', () => {
      const allSignals = [
        ...VerdictSimulator.createGreenSignals(),
        ...VerdictSimulator.createRedSignals_MissingSecret(),
        ...VerdictSimulator.createRedSignals_MissingEnvVar(),
        ...VerdictSimulator.createHoldSignals_Route53Delegation(),
        ...VerdictSimulator.createHoldSignals_CfnInProgress(),
        ...VerdictSimulator.createHoldSignals_CfnRollback(),
        ...VerdictSimulator.createRetrySignals_AcmDnsValidation(),
      ];

      allSignals.forEach(signal => {
        expect(signal.timestamp).toBeInstanceOf(Date);
        expect(signal.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
      });
    });
  });
});
