/**
 * Tests for Issue B2: Simplified Verdict → Action Mapping
 * 
 * Validates that each verdict has exactly one action.
 */

import {
  toSimpleVerdict,
  getSimpleAction,
  getActionForVerdictType,
  validateSimpleVerdictMapping,
} from '../src/engine';
import { VerdictType, SimpleVerdict, SimpleAction } from '../src/types';
import {
  SIMPLE_VERDICT_TO_ACTION,
  VERDICT_TYPE_TO_SIMPLE,
} from '../src/constants';

describe('Issue B2: Simplified Verdict → Action Mapping', () => {
  describe('SimpleVerdict → SimpleAction mapping (1:1)', () => {
    test('GREEN maps to ADVANCE', () => {
      expect(getSimpleAction(SimpleVerdict.GREEN)).toBe(SimpleAction.ADVANCE);
    });

    test('RED maps to ABORT', () => {
      expect(getSimpleAction(SimpleVerdict.RED)).toBe(SimpleAction.ABORT);
    });

    test('HOLD maps to FREEZE', () => {
      expect(getSimpleAction(SimpleVerdict.HOLD)).toBe(SimpleAction.FREEZE);
    });

    test('RETRY maps to RETRY_OPERATION', () => {
      expect(getSimpleAction(SimpleVerdict.RETRY)).toBe(SimpleAction.RETRY_OPERATION);
    });

    test('all simple verdicts have exactly one action', () => {
      const verdicts = Object.values(SimpleVerdict);
      expect(verdicts).toHaveLength(4);

      for (const verdict of verdicts) {
        const action = getSimpleAction(verdict);
        expect(action).toBeDefined();
        expect(Object.values(SimpleAction)).toContain(action);
      }
    });

    test('mapping is deterministic', () => {
      // Same input should always produce same output
      expect(getSimpleAction(SimpleVerdict.GREEN)).toBe(getSimpleAction(SimpleVerdict.GREEN));
      expect(getSimpleAction(SimpleVerdict.RED)).toBe(getSimpleAction(SimpleVerdict.RED));
      expect(getSimpleAction(SimpleVerdict.HOLD)).toBe(getSimpleAction(SimpleVerdict.HOLD));
      expect(getSimpleAction(SimpleVerdict.RETRY)).toBe(getSimpleAction(SimpleVerdict.RETRY));
    });
  });

  describe('VerdictType → SimpleVerdict conversion', () => {
    test('APPROVED converts to GREEN', () => {
      expect(toSimpleVerdict(VerdictType.APPROVED)).toBe(SimpleVerdict.GREEN);
    });

    test('WARNING converts to GREEN (proceed with caution)', () => {
      expect(toSimpleVerdict(VerdictType.WARNING)).toBe(SimpleVerdict.GREEN);
    });

    test('REJECTED converts to RED', () => {
      expect(toSimpleVerdict(VerdictType.REJECTED)).toBe(SimpleVerdict.RED);
    });

    test('ESCALATED converts to HOLD', () => {
      expect(toSimpleVerdict(VerdictType.ESCALATED)).toBe(SimpleVerdict.HOLD);
    });

    test('BLOCKED converts to HOLD', () => {
      expect(toSimpleVerdict(VerdictType.BLOCKED)).toBe(SimpleVerdict.HOLD);
    });

    test('DEFERRED converts to RETRY', () => {
      expect(toSimpleVerdict(VerdictType.DEFERRED)).toBe(SimpleVerdict.RETRY);
    });

    test('PENDING converts to RETRY', () => {
      expect(toSimpleVerdict(VerdictType.PENDING)).toBe(SimpleVerdict.RETRY);
    });

    test('all verdict types have a simple verdict mapping', () => {
      const verdictTypes = Object.values(VerdictType);
      expect(verdictTypes).toHaveLength(7);

      for (const vt of verdictTypes) {
        const simpleVerdict = toSimpleVerdict(vt);
        expect(simpleVerdict).toBeDefined();
        expect(Object.values(SimpleVerdict)).toContain(simpleVerdict);
      }
    });
  });

  describe('VerdictType → SimpleAction direct conversion', () => {
    test('APPROVED → ADVANCE', () => {
      expect(getActionForVerdictType(VerdictType.APPROVED)).toBe(SimpleAction.ADVANCE);
    });

    test('WARNING → ADVANCE', () => {
      expect(getActionForVerdictType(VerdictType.WARNING)).toBe(SimpleAction.ADVANCE);
    });

    test('REJECTED → ABORT', () => {
      expect(getActionForVerdictType(VerdictType.REJECTED)).toBe(SimpleAction.ABORT);
    });

    test('ESCALATED → FREEZE', () => {
      expect(getActionForVerdictType(VerdictType.ESCALATED)).toBe(SimpleAction.FREEZE);
    });

    test('BLOCKED → FREEZE', () => {
      expect(getActionForVerdictType(VerdictType.BLOCKED)).toBe(SimpleAction.FREEZE);
    });

    test('DEFERRED → RETRY_OPERATION', () => {
      expect(getActionForVerdictType(VerdictType.DEFERRED)).toBe(SimpleAction.RETRY_OPERATION);
    });

    test('PENDING → RETRY_OPERATION', () => {
      expect(getActionForVerdictType(VerdictType.PENDING)).toBe(SimpleAction.RETRY_OPERATION);
    });
  });

  describe('Mapping validation', () => {
    test('validateSimpleVerdictMapping returns valid for complete mappings', () => {
      const result = validateSimpleVerdictMapping();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('mapping is deterministic across multiple calls', () => {
      // Test that same input produces same output across multiple invocations
      const verdictTypes = Object.values(VerdictType);

      for (const vt of verdictTypes) {
        const action1 = getActionForVerdictType(vt);
        const action2 = getActionForVerdictType(vt);
        const action3 = getActionForVerdictType(vt);

        expect(action1).toBe(action2);
        expect(action2).toBe(action3);
      }
    });

    test('all mappings are defined in constants', () => {
      // Verify SIMPLE_VERDICT_TO_ACTION has all mappings
      expect(Object.keys(SIMPLE_VERDICT_TO_ACTION)).toHaveLength(4);
      expect(SIMPLE_VERDICT_TO_ACTION[SimpleVerdict.GREEN]).toBe(SimpleAction.ADVANCE);
      expect(SIMPLE_VERDICT_TO_ACTION[SimpleVerdict.RED]).toBe(SimpleAction.ABORT);
      expect(SIMPLE_VERDICT_TO_ACTION[SimpleVerdict.HOLD]).toBe(SimpleAction.FREEZE);
      expect(SIMPLE_VERDICT_TO_ACTION[SimpleVerdict.RETRY]).toBe(SimpleAction.RETRY_OPERATION);

      // Verify VERDICT_TYPE_TO_SIMPLE has all mappings
      expect(Object.keys(VERDICT_TYPE_TO_SIMPLE)).toHaveLength(7);
      expect(VERDICT_TYPE_TO_SIMPLE[VerdictType.APPROVED]).toBe(SimpleVerdict.GREEN);
      expect(VERDICT_TYPE_TO_SIMPLE[VerdictType.REJECTED]).toBe(SimpleVerdict.RED);
      expect(VERDICT_TYPE_TO_SIMPLE[VerdictType.ESCALATED]).toBe(SimpleVerdict.HOLD);
      expect(VERDICT_TYPE_TO_SIMPLE[VerdictType.DEFERRED]).toBe(SimpleVerdict.RETRY);
    });
  });

  describe('Issue B2 specification compliance', () => {
    test('GREEN → Advance/Deploy/Next State', () => {
      const action = getSimpleAction(SimpleVerdict.GREEN);
      expect(action).toBe(SimpleAction.ADVANCE);
      expect(action.toString()).toMatch(/ADVANCE/i);
    });

    test('RED → Abort/Rollback/Kill', () => {
      const action = getSimpleAction(SimpleVerdict.RED);
      expect(action).toBe(SimpleAction.ABORT);
      expect(action.toString()).toMatch(/ABORT/i);
    });

    test('HOLD → Freeze + Human Review', () => {
      const action = getSimpleAction(SimpleVerdict.HOLD);
      expect(action).toBe(SimpleAction.FREEZE);
      expect(action.toString()).toMatch(/FREEZE/i);
    });

    test('RETRY → Deterministic retry attempt', () => {
      const action = getSimpleAction(SimpleVerdict.RETRY);
      expect(action).toBe(SimpleAction.RETRY_OPERATION);
      expect(action.toString()).toMatch(/RETRY/i);
    });
  });

  describe('Practical usage scenarios', () => {
    test('successful deployment proceeds to next state', () => {
      const verdictType = VerdictType.APPROVED;
      const simpleVerdict = toSimpleVerdict(verdictType);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.GREEN);
      expect(action).toBe(SimpleAction.ADVANCE);
    });

    test('critical error aborts the workflow', () => {
      const verdictType = VerdictType.REJECTED;
      const simpleVerdict = toSimpleVerdict(verdictType);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.RED);
      expect(action).toBe(SimpleAction.ABORT);
    });

    test('low confidence verdict requires human review', () => {
      const verdictType = VerdictType.ESCALATED;
      const simpleVerdict = toSimpleVerdict(verdictType);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);
      expect(action).toBe(SimpleAction.FREEZE);
    });

    test('transient condition triggers retry', () => {
      const verdictType = VerdictType.DEFERRED;
      const simpleVerdict = toSimpleVerdict(verdictType);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.RETRY);
      expect(action).toBe(SimpleAction.RETRY_OPERATION);
    });

    test('resource lock causes hold', () => {
      const verdictType = VerdictType.BLOCKED;
      const simpleVerdict = toSimpleVerdict(verdictType);
      const action = getSimpleAction(simpleVerdict);

      expect(simpleVerdict).toBe(SimpleVerdict.HOLD);
      expect(action).toBe(SimpleAction.FREEZE);
    });
  });

  describe('Edge cases and error handling', () => {
    test('constants are immutable', () => {
      // TypeScript const assertions ensure this at compile time
      // Runtime test to verify the objects are defined
      expect(SIMPLE_VERDICT_TO_ACTION).toBeDefined();
      expect(VERDICT_TYPE_TO_SIMPLE).toBeDefined();

      // Verify all expected keys exist
      expect(SIMPLE_VERDICT_TO_ACTION).toHaveProperty(SimpleVerdict.GREEN);
      expect(SIMPLE_VERDICT_TO_ACTION).toHaveProperty(SimpleVerdict.RED);
      expect(SIMPLE_VERDICT_TO_ACTION).toHaveProperty(SimpleVerdict.HOLD);
      expect(SIMPLE_VERDICT_TO_ACTION).toHaveProperty(SimpleVerdict.RETRY);
    });

    test('enum values are stable', () => {
      // Verify enum string values match expected constants
      expect(SimpleVerdict.GREEN).toBe('GREEN');
      expect(SimpleVerdict.RED).toBe('RED');
      expect(SimpleVerdict.HOLD).toBe('HOLD');
      expect(SimpleVerdict.RETRY).toBe('RETRY');

      expect(SimpleAction.ADVANCE).toBe('ADVANCE');
      expect(SimpleAction.ABORT).toBe('ABORT');
      expect(SimpleAction.FREEZE).toBe('FREEZE');
      expect(SimpleAction.RETRY_OPERATION).toBe('RETRY_OPERATION');
    });
  });
});
