/**
 * Unit Tests for AFU9 Issue State Model v1
 * 
 * Tests precedence rules, mapping functions, and deterministic behavior.
 * 
 * Issue: I1 - Define & Publish State Model v1
 * 
 * Test Coverage:
 * - Precedence rule execution
 * - GitHub status mapping (IN_PROGRESS, DONE, UNKNOWN)
 * - Deterministic output verification
 * - Edge cases and semantic protection
 */

import {
  LocalStatus,
  GithubMirrorStatus,
  ExecutionState,
  HandoffState,
  IssueStateModel,
  validateIssueStateModel,
  safeValidateIssueStateModel,
  isLocalStatus,
  isGithubMirrorStatus,
  isExecutionState,
  isHandoffState,
} from '../../../src/lib/schemas/issueStateModel';

import {
  mapGithubMirrorStatusToEffective,
  computeEffectiveStatus,
  mapRawGithubStatus,
  extractGithubMirrorStatus,
  isEffectiveStatusOverridden,
  getEffectiveStatusReason,
  hasGithubStatus,
  detectStateDrift,
} from '../../../src/lib/issues/stateModel';

describe('Issue State Model Schema', () => {
  describe('Schema Validation', () => {
    it('should validate a complete valid state model', () => {
      const validState: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'IN_PROGRESS',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      const result = validateIssueStateModel(validState);
      expect(result).toEqual(validState);
    });

    it('should reject invalid localStatus', () => {
      const invalidState = {
        localStatus: 'INVALID_STATUS',
        githubMirrorStatus: 'IN_PROGRESS',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      expect(() => validateIssueStateModel(invalidState)).toThrow();
    });

    it('should reject invalid githubMirrorStatus', () => {
      const invalidState = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'INVALID',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      expect(() => validateIssueStateModel(invalidState)).toThrow();
    });

    it('should safely validate and return success/error', () => {
      const validState: IssueStateModel = {
        localStatus: 'SPEC_READY',
        githubMirrorStatus: 'TODO',
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      const result = safeValidateIssueStateModel(validState);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validState);
      }
    });

    it('should safely validate and return error for invalid data', () => {
      const invalidState = {
        localStatus: 'INVALID',
      };

      const result = safeValidateIssueStateModel(invalidState);
      expect(result.success).toBe(false);
    });
  });

  describe('Type Guards', () => {
    it('should validate LocalStatus values', () => {
      expect(isLocalStatus('CREATED')).toBe(true);
      expect(isLocalStatus('IMPLEMENTING')).toBe(true);
      expect(isLocalStatus('DONE')).toBe(true);
      expect(isLocalStatus('INVALID')).toBe(false);
      expect(isLocalStatus(123)).toBe(false);
    });

    it('should validate GithubMirrorStatus values', () => {
      expect(isGithubMirrorStatus('TODO')).toBe(true);
      expect(isGithubMirrorStatus('IN_PROGRESS')).toBe(true);
      expect(isGithubMirrorStatus('UNKNOWN')).toBe(true);
      expect(isGithubMirrorStatus('INVALID')).toBe(false);
    });

    it('should validate ExecutionState values', () => {
      expect(isExecutionState('IDLE')).toBe(true);
      expect(isExecutionState('RUNNING')).toBe(true);
      expect(isExecutionState('FAILED')).toBe(true);
      expect(isExecutionState('SUCCEEDED')).toBe(true);
      expect(isExecutionState('INVALID')).toBe(false);
    });

    it('should validate HandoffState values', () => {
      expect(isHandoffState('UNSYNCED')).toBe(true);
      expect(isHandoffState('SYNCED')).toBe(true);
      expect(isHandoffState('INVALID')).toBe(false);
    });
  });
});

describe('GitHub Mirror Status Mapping', () => {
  describe('mapGithubMirrorStatusToEffective', () => {
    it('should map TODO to SPEC_READY', () => {
      expect(mapGithubMirrorStatusToEffective('TODO')).toBe('SPEC_READY');
    });

    it('should map IN_PROGRESS to IMPLEMENTING', () => {
      expect(mapGithubMirrorStatusToEffective('IN_PROGRESS')).toBe('IMPLEMENTING');
    });

    it('should map IN_REVIEW to MERGE_READY', () => {
      expect(mapGithubMirrorStatusToEffective('IN_REVIEW')).toBe('MERGE_READY');
    });

    it('should map DONE to DONE', () => {
      expect(mapGithubMirrorStatusToEffective('DONE')).toBe('DONE');
    });

    it('should map BLOCKED to HOLD', () => {
      expect(mapGithubMirrorStatusToEffective('BLOCKED')).toBe('HOLD');
    });

    it('should map UNKNOWN to null (no mapping)', () => {
      expect(mapGithubMirrorStatusToEffective('UNKNOWN')).toBe(null);
    });
  });

  describe('mapRawGithubStatus', () => {
    it('should map "In Progress" to IN_PROGRESS', () => {
      expect(mapRawGithubStatus('In Progress')).toBe('IN_PROGRESS');
      expect(mapRawGithubStatus('in progress')).toBe('IN_PROGRESS');
      expect(mapRawGithubStatus('implementing')).toBe('IN_PROGRESS');
      expect(mapRawGithubStatus('Implementing')).toBe('IN_PROGRESS');
    });

    it('should map "Done" to DONE', () => {
      expect(mapRawGithubStatus('Done')).toBe('DONE');
      expect(mapRawGithubStatus('done')).toBe('DONE');
      expect(mapRawGithubStatus('Completed')).toBe('DONE');
      expect(mapRawGithubStatus('complete')).toBe('DONE');
    });

    it('should map "To Do" to TODO', () => {
      expect(mapRawGithubStatus('To Do')).toBe('TODO');
      expect(mapRawGithubStatus('todo')).toBe('TODO');
      expect(mapRawGithubStatus('Backlog')).toBe('TODO');
    });

    it('should map "In Review" to IN_REVIEW', () => {
      expect(mapRawGithubStatus('In Review')).toBe('IN_REVIEW');
      expect(mapRawGithubStatus('Review')).toBe('IN_REVIEW');
      expect(mapRawGithubStatus('PR')).toBe('IN_REVIEW');
    });

    it('should map "Blocked" to BLOCKED', () => {
      expect(mapRawGithubStatus('Blocked')).toBe('BLOCKED');
      expect(mapRawGithubStatus('Hold')).toBe('BLOCKED');
      expect(mapRawGithubStatus('Waiting')).toBe('BLOCKED');
    });

    it('should map UNKNOWN for unmapped values', () => {
      expect(mapRawGithubStatus('Some Random Status')).toBe('UNKNOWN');
      expect(mapRawGithubStatus('')).toBe('UNKNOWN');
      expect(mapRawGithubStatus(null)).toBe('UNKNOWN');
      expect(mapRawGithubStatus(undefined)).toBe('UNKNOWN');
    });

    it('should apply semantic protection for "closed" from issue state', () => {
      // When isFromIssueState = true, "closed" should NOT map to DONE
      expect(mapRawGithubStatus('closed', true)).toBe('UNKNOWN');
      
      // When isFromIssueState = false, check if it has a mapping (it shouldn't in our spec)
      expect(mapRawGithubStatus('closed', false)).toBe('UNKNOWN');
    });
  });

  describe('extractGithubMirrorStatus', () => {
    it('should prioritize project status over labels and state', () => {
      const result = extractGithubMirrorStatus(
        'In Progress',
        ['status: done'],
        'closed'
      );
      expect(result).toBe('IN_PROGRESS');
    });

    it('should use labels when no project status', () => {
      const result = extractGithubMirrorStatus(
        null,
        ['status: implementing'],
        'open'
      );
      expect(result).toBe('IN_PROGRESS');
    });

    it('should fall back to issue state with semantic protection', () => {
      // "closed" from state should not map to anything (semantic protection)
      const result = extractGithubMirrorStatus(
        null,
        [],
        'closed'
      );
      expect(result).toBe('UNKNOWN');
    });

    it('should return UNKNOWN when no status available', () => {
      const result = extractGithubMirrorStatus(
        null,
        ['bug', 'enhancement'],
        'open'
      );
      expect(result).toBe('UNKNOWN');
    });

    it('should extract status from multiple label formats', () => {
      const result1 = extractGithubMirrorStatus(null, ['status: done'], 'closed');
      expect(result1).toBe('DONE');

      const result2 = extractGithubMirrorStatus(null, ['status: in review'], 'open');
      expect(result2).toBe('IN_REVIEW');
    });
  });
});

describe('Precedence Rules v1', () => {
  describe('computeEffectiveStatus', () => {
    it('should use localStatus when execution is RUNNING (Rule 1)', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'DONE', // GitHub says done
        executionState: 'RUNNING', // But AFU9 is running
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('IMPLEMENTING'); // Local status takes precedence
    });

    it('should use mapped GitHub status when not running and GitHub status known (Rule 2)', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING', // AFU9 thinks implementing
        githubMirrorStatus: 'IN_REVIEW', // GitHub says in review
        executionState: 'IDLE', // Not running
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('MERGE_READY'); // Mapped GitHub status
    });

    it('should use localStatus when GitHub status is UNKNOWN (Rule 3)', () => {
      const state: IssueStateModel = {
        localStatus: 'SPEC_READY',
        githubMirrorStatus: 'UNKNOWN', // No GitHub status
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('SPEC_READY'); // Fallback to local
    });

    it('should handle FAILED execution state (not RUNNING)', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'IN_PROGRESS',
        executionState: 'FAILED', // Failed, not running
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('IMPLEMENTING'); // Uses GitHub mapping (Rule 2)
    });

    it('should handle SUCCEEDED execution state', () => {
      const state: IssueStateModel = {
        localStatus: 'VERIFIED',
        githubMirrorStatus: 'DONE',
        executionState: 'SUCCEEDED',
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('DONE'); // Uses GitHub mapping
    });
  });

  describe('Example from Documentation: I775 ↔ GitHub#458 Implementing', () => {
    it('should compute effective status as IMPLEMENTING when actively executing', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'IN_PROGRESS',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('IMPLEMENTING');
    });
  });

  describe('Example: GitHub Takes Precedence (Not Executing)', () => {
    it('should use GitHub status when execution finished', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING', // Last AFU9 state
        githubMirrorStatus: 'IN_REVIEW', // GitHub shows in review
        executionState: 'IDLE', // No execution
        handoffState: 'SYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('MERGE_READY'); // Mapped from IN_REVIEW
    });
  });

  describe('Example: GitHub Unknown, Use Local', () => {
    it('should use local status when GitHub not synced', () => {
      const state: IssueStateModel = {
        localStatus: 'SPEC_READY',
        githubMirrorStatus: 'UNKNOWN',
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      const result = computeEffectiveStatus(state);
      expect(result).toBe('SPEC_READY');
    });
  });
});

describe('Determinism Tests', () => {
  it('should produce same result when called multiple times (idempotent)', () => {
    const state: IssueStateModel = {
      localStatus: 'IMPLEMENTING',
      githubMirrorStatus: 'IN_PROGRESS',
      executionState: 'RUNNING',
      handoffState: 'SYNCED',
    };

    const result1 = computeEffectiveStatus(state);
    const result2 = computeEffectiveStatus(state);
    const result3 = computeEffectiveStatus(state);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('should handle all combinations of ExecutionState deterministically', () => {
    const baseState: Omit<IssueStateModel, 'executionState'> = {
      localStatus: 'IMPLEMENTING',
      githubMirrorStatus: 'IN_REVIEW',
      handoffState: 'SYNCED',
    };

    const executionStates: ExecutionState[] = ['IDLE', 'RUNNING', 'FAILED', 'SUCCEEDED'];
    const results = executionStates.map(execState => 
      computeEffectiveStatus({ ...baseState, executionState: execState })
    );

    // RUNNING should use local, others should use GitHub mapping
    expect(results[0]).toBe('MERGE_READY'); // IDLE
    expect(results[1]).toBe('IMPLEMENTING'); // RUNNING
    expect(results[2]).toBe('MERGE_READY'); // FAILED
    expect(results[3]).toBe('MERGE_READY'); // SUCCEEDED
  });

  it('should handle all GithubMirrorStatus mappings deterministically', () => {
    const baseState: Omit<IssueStateModel, 'githubMirrorStatus'> = {
      localStatus: 'CREATED',
      executionState: 'IDLE',
      handoffState: 'SYNCED',
    };

    const githubStatuses: GithubMirrorStatus[] = [
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
      'BLOCKED',
      'UNKNOWN',
    ];

    const results = githubStatuses.map(ghStatus =>
      computeEffectiveStatus({ ...baseState, githubMirrorStatus: ghStatus })
    );

    expect(results[0]).toBe('SPEC_READY'); // TODO
    expect(results[1]).toBe('IMPLEMENTING'); // IN_PROGRESS
    expect(results[2]).toBe('MERGE_READY'); // IN_REVIEW
    expect(results[3]).toBe('DONE'); // DONE
    expect(results[4]).toBe('HOLD'); // BLOCKED
    expect(results[5]).toBe('CREATED'); // UNKNOWN (fallback to local)
  });
});

describe('Helper Functions', () => {
  describe('isEffectiveStatusOverridden', () => {
    it('should return false when effective status equals local status', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'UNKNOWN',
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      expect(isEffectiveStatusOverridden(state)).toBe(false);
    });

    it('should return true when GitHub status overrides local', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'DONE',
        executionState: 'IDLE',
        handoffState: 'SYNCED',
      };

      expect(isEffectiveStatusOverridden(state)).toBe(true);
    });

    it('should return false when execution running uses local status', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'DONE',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      expect(isEffectiveStatusOverridden(state)).toBe(false);
    });
  });

  describe('getEffectiveStatusReason', () => {
    it('should explain when execution is running', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'DONE',
        executionState: 'RUNNING',
        handoffState: 'SYNCED',
      };

      const reason = getEffectiveStatusReason(state);
      expect(reason).toContain('Execution in progress');
      expect(reason).toContain('IMPLEMENTING');
    });

    it('should explain when using GitHub status', () => {
      const state: IssueStateModel = {
        localStatus: 'IMPLEMENTING',
        githubMirrorStatus: 'IN_REVIEW',
        executionState: 'IDLE',
        handoffState: 'SYNCED',
      };

      const reason = getEffectiveStatusReason(state);
      expect(reason).toContain('GitHub status available');
      expect(reason).toContain('IN_REVIEW');
      expect(reason).toContain('MERGE_READY');
    });

    it('should explain when falling back to local status', () => {
      const state: IssueStateModel = {
        localStatus: 'SPEC_READY',
        githubMirrorStatus: 'UNKNOWN',
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      const reason = getEffectiveStatusReason(state);
      expect(reason).toContain('AFU9 local status (no GitHub sync yet)');
      expect(reason).toContain('SPEC_READY');
    });
  });
});

describe('Edge Cases and Semantic Protection', () => {
  it('should not map closed GitHub issues without explicit done signal', () => {
    const githubStatus = extractGithubMirrorStatus(null, [], 'closed');
    expect(githubStatus).toBe('UNKNOWN');

    const state: IssueStateModel = {
      localStatus: 'IMPLEMENTING',
      githubMirrorStatus: githubStatus,
      executionState: 'IDLE',
      handoffState: 'SYNCED',
    };

    // Should fall back to local status, not assume DONE
    expect(computeEffectiveStatus(state)).toBe('IMPLEMENTING');
  });

  it('should handle null and undefined inputs gracefully', () => {
    expect(mapRawGithubStatus(null)).toBe('UNKNOWN');
    expect(mapRawGithubStatus(undefined)).toBe('UNKNOWN');
    expect(mapRawGithubStatus('')).toBe('UNKNOWN');
  });

  it('should handle case-insensitive status matching', () => {
    expect(mapRawGithubStatus('DONE')).toBe('DONE');
    expect(mapRawGithubStatus('done')).toBe('DONE');
    expect(mapRawGithubStatus('DoNe')).toBe('DONE');
    expect(mapRawGithubStatus('IN PROGRESS')).toBe('IN_PROGRESS');
    expect(mapRawGithubStatus('in progress')).toBe('IN_PROGRESS');
  });

  it('should handle whitespace in status strings', () => {
    expect(mapRawGithubStatus('  done  ')).toBe('DONE');
    expect(mapRawGithubStatus(' In Progress ')).toBe('IN_PROGRESS');
  });

  it('should handle all LocalStatus values in state model', () => {
    const localStatuses: LocalStatus[] = [
      'CREATED',
      'SPEC_READY',
      'IMPLEMENTING',
      'VERIFIED',
      'MERGE_READY',
      'DONE',
      'HOLD',
      'KILLED',
    ];

    localStatuses.forEach(status => {
      const state: IssueStateModel = {
        localStatus: status,
        githubMirrorStatus: 'UNKNOWN',
        executionState: 'IDLE',
        handoffState: 'UNSYNCED',
      };

      // Should always return the local status when GitHub is UNKNOWN
      expect(computeEffectiveStatus(state)).toBe(status);
    });
  });
});

/**
 * State Model v1.4: Enhanced GitHub Status Detection & Drift
 */
describe('State Model v1.4: hasGithubStatus', () => {
  it('should return true when mirror status is not UNKNOWN', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'CLOSED' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: null,
    };
    
    expect(hasGithubStatus(state)).toBe(true);
  });
  
  it('should return true when raw status exists (even if mirror is UNKNOWN)', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'UNKNOWN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"closed","labels":[],"updatedAt":"2026-01-07"}',
    };
    
    expect(hasGithubStatus(state)).toBe(true);
  });
  
  it('should return false when both mirror=UNKNOWN and raw=null', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'UNKNOWN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: null,
    };
    
    expect(hasGithubStatus(state)).toBe(false);
  });

  it('should return false when github_status_raw is empty string', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'UNKNOWN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '   ',
    };
    
    expect(hasGithubStatus(state)).toBe(false);
  });
});

describe('State Model v1.4: Enhanced getEffectiveStatusReason', () => {
  it('should NOT show "no GitHub status" hint when mirror=CLOSED + raw exists', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'CLOSED' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"closed"}',
      github_status_updated_at: '2026-01-07T10:00:00Z',
    };
    
    const reason = getEffectiveStatusReason(state);
    
    expect(reason).not.toContain('No execution or GitHub status');
    expect(reason).toContain('GitHub mirror');
    expect(reason).toContain('CLOSED');
  });

  it('should show sync date when github_status_updated_at is available', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'OPEN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"open"}',
      github_status_updated_at: '2026-01-07T10:00:00Z',
    };
    
    const reason = getEffectiveStatusReason(state);
    
    expect(reason).toContain('synced:');
  });

  it('should handle raw GitHub data when mirror=UNKNOWN', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'UNKNOWN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"open","labels":[]}',
    };
    
    const reason = getEffectiveStatusReason(state);
    
    expect(reason).toContain('GitHub data available but not yet mapped');
  });

  it('should prioritize execution state over GitHub', () => {
    const state = {
      localStatus: 'IMPLEMENTING' as LocalStatus,
      githubMirrorStatus: 'OPEN' as GithubMirrorStatus,
      executionState: 'RUNNING' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"open"}',
    };
    
    const reason = getEffectiveStatusReason(state);
    
    expect(reason).toContain('Execution in progress');
    expect(reason).toContain('IMPLEMENTING');
  });
});

describe('State Model v1.4: detectStateDrift', () => {
  it('should detect drift when local=CREATED but mirror=CLOSED', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'CLOSED' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"closed"}',
    };
    
    const drift = detectStateDrift(state);
    
    expect(drift.hasDrift).toBe(true);
    expect(drift.severity).toBe('warning');
    expect(drift.message).toContain('GitHub issue is CLOSED');
    expect(drift.message).toContain('local status is still CREATED');
  });

  it('should detect drift for all active work states', () => {
    const activeStates: LocalStatus[] = ['CREATED', 'SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 'MERGE_READY'];
    
    activeStates.forEach(localStatus => {
      const state = {
        localStatus,
        githubMirrorStatus: 'CLOSED' as GithubMirrorStatus,
        executionState: 'IDLE' as ExecutionState,
        handoffState: 'SYNCED' as HandoffState,
        github_status_raw: '{"state":"closed"}',
      };
      
      const drift = detectStateDrift(state);
      expect(drift.hasDrift).toBe(true);
      expect(drift.severity).toBe('warning');
    });
  });

  it('should NOT detect drift when local=DONE and mirror=CLOSED', () => {
    const state = {
      localStatus: 'DONE' as LocalStatus,
      githubMirrorStatus: 'CLOSED' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"closed"}',
    };
    
    const drift = detectStateDrift(state);
    
    expect(drift.hasDrift).toBe(false);
  });

  it('should detect info drift when local=DONE but mirror=OPEN', () => {
    const state = {
      localStatus: 'DONE' as LocalStatus,
      githubMirrorStatus: 'OPEN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"open"}',
    };
    
    const drift = detectStateDrift(state);
    
    expect(drift.hasDrift).toBe(true);
    expect(drift.severity).toBe('info');
    expect(drift.message).toContain('Local status is DONE');
    expect(drift.message).toContain('GitHub issue is still OPEN');
  });

  it('should NOT detect drift when no GitHub status available', () => {
    const state = {
      localStatus: 'CREATED' as LocalStatus,
      githubMirrorStatus: 'UNKNOWN' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: null,
    };
    
    const drift = detectStateDrift(state);
    
    expect(drift.hasDrift).toBe(false);
  });

  it('should NOT detect drift when states are aligned', () => {
    const state = {
      localStatus: 'IMPLEMENTING' as LocalStatus,
      githubMirrorStatus: 'IN_PROGRESS' as GithubMirrorStatus,
      executionState: 'IDLE' as ExecutionState,
      handoffState: 'SYNCED' as HandoffState,
      github_status_raw: '{"state":"open","labels":["status: in progress"]}',
    };
    
    const drift = detectStateDrift(state);
    
    expect(drift.hasDrift).toBe(false);
  });
});
