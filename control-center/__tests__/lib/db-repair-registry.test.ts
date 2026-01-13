/**
 * Tests for DB Repair Registry
 * 
 * Issue: E86.5 - Staging DB Repair Mechanism
 */

import {
  getAllRepairPlaybooks,
  getRepairPlaybook,
  validateRepairHash,
} from '@/lib/db/db-repair-registry';

describe('DB Repair Registry', () => {
  describe('getAllRepairPlaybooks', () => {
    it('should return all repair playbooks in stable-sorted order', () => {
      const repairs = getAllRepairPlaybooks();

      expect(repairs).toBeDefined();
      expect(repairs.length).toBeGreaterThan(0);

      // Verify stable sorting by repairId
      for (let i = 1; i < repairs.length; i++) {
        expect(repairs[i].repairId.localeCompare(repairs[i - 1].repairId)).toBeGreaterThan(0);
      }
    });

    it('should return repairs with all required fields', () => {
      const repairs = getAllRepairPlaybooks();

      repairs.forEach((repair) => {
        expect(repair.repairId).toBeDefined();
        expect(typeof repair.repairId).toBe('string');
        expect(repair.repairId).toMatch(/^R-DB-[A-Z-]+-\d+$/);

        expect(repair.description).toBeDefined();
        expect(typeof repair.description).toBe('string');

        expect(repair.hash).toBeDefined();
        expect(typeof repair.hash).toBe('string');
        expect(repair.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256

        expect(repair.version).toBeDefined();
        expect(typeof repair.version).toBe('string');

        expect(repair.stageOnly).toBe(true);
        expect(repair.requiresAdmin).toBe(true);

        expect(Array.isArray(repair.sql)).toBe(true);
        expect(repair.sql.length).toBeGreaterThan(0);
      });
    });

    it('should include expected repair playbooks', () => {
      const repairs = getAllRepairPlaybooks();
      const repairIds = repairs.map(r => r.repairId);

      expect(repairIds).toContain('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repairIds).toContain('R-DB-INTENT-DRAFTS-001');
      expect(repairIds).toContain('R-DB-MIGRATIONS-LEDGER-001');
    });
  });

  describe('getRepairPlaybook', () => {
    it('should return playbook for valid repairId', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');

      expect(repair).toBeDefined();
      expect(repair?.repairId).toBe('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair?.description).toContain('intent_issue_authoring_events');
    });

    it('should return null for invalid repairId', () => {
      const repair = getRepairPlaybook('INVALID-REPAIR-ID');

      expect(repair).toBeNull();
    });

    it('should return playbook with idempotent SQL', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');

      expect(repair).toBeDefined();

      // All SQL should be idempotent (CREATE IF NOT EXISTS, etc.)
      repair?.sql.forEach((stmt) => {
        const normalized = stmt.toLowerCase();
        
        // Should not contain destructive operations
        expect(normalized).not.toContain('drop table');
        expect(normalized).not.toContain('truncate');
        expect(normalized).not.toContain('delete from');
        
        // Should use idempotent patterns
        const isIdempotent =
          normalized.includes('if not exists') ||
          normalized.includes('create or replace') ||
          normalized.includes('do $$');
        
        expect(isIdempotent).toBe(true);
      });
    });
  });

  describe('validateRepairHash', () => {
    it('should validate correct hash', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair).toBeDefined();

      const isValid = validateRepairHash('R-DB-INTENT-AUTH-EVENTS-001', repair!.hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect hash', () => {
      const isValid = validateRepairHash('R-DB-INTENT-AUTH-EVENTS-001', 'invalid-hash');
      expect(isValid).toBe(false);
    });

    it('should reject invalid repairId', () => {
      const isValid = validateRepairHash('INVALID-ID', 'some-hash');
      expect(isValid).toBe(false);
    });
  });

  describe('Repair Playbook: R-DB-INTENT-AUTH-EVENTS-001', () => {
    it('should create intent_issue_authoring_events table', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair).toBeDefined();

      const createTableStmt = repair?.sql[0];
      expect(createTableStmt).toBeDefined();
      expect(createTableStmt?.toLowerCase()).toContain('create table if not exists intent_issue_authoring_events');
    });

    it('should create indexes', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair).toBeDefined();

      const indexStatements = repair?.sql.filter(stmt =>
        stmt.toLowerCase().includes('create index')
      );

      expect(indexStatements).toBeDefined();
      expect(indexStatements!.length).toBeGreaterThan(0);
    });

    it('should create append-only triggers', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair).toBeDefined();

      const triggerStatements = repair?.sql.filter(stmt =>
        stmt.toLowerCase().includes('trigger')
      );

      expect(triggerStatements).toBeDefined();
      expect(triggerStatements!.length).toBeGreaterThan(0);
    });

    it('should have correct requiredTablesAfter', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-AUTH-EVENTS-001');
      expect(repair).toBeDefined();

      expect(repair?.requiredTablesAfter).toContain('intent_issue_authoring_events');
    });
  });

  describe('Repair Playbook: R-DB-INTENT-DRAFTS-001', () => {
    it('should create intent_issue_drafts and intent_issue_sets tables', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-DRAFTS-001');
      expect(repair).toBeDefined();

      const sqlText = repair?.sql.join(' ').toLowerCase();
      expect(sqlText).toContain('intent_issue_drafts');
      expect(sqlText).toContain('intent_issue_sets');
    });

    it('should have correct requiredTablesAfter', () => {
      const repair = getRepairPlaybook('R-DB-INTENT-DRAFTS-001');
      expect(repair).toBeDefined();

      expect(repair?.requiredTablesAfter).toContain('intent_issue_drafts');
      expect(repair?.requiredTablesAfter).toContain('intent_issue_sets');
    });
  });

  describe('Repair Playbook: R-DB-MIGRATIONS-LEDGER-001', () => {
    it('should create afu9_migrations_ledger table', () => {
      const repair = getRepairPlaybook('R-DB-MIGRATIONS-LEDGER-001');
      expect(repair).toBeDefined();

      const createTableStmt = repair?.sql[0];
      expect(createTableStmt).toBeDefined();
      expect(createTableStmt?.toLowerCase()).toContain('create table if not exists afu9_migrations_ledger');
    });

    it('should have append-only triggers', () => {
      const repair = getRepairPlaybook('R-DB-MIGRATIONS-LEDGER-001');
      expect(repair).toBeDefined();

      const triggerStatements = repair?.sql.filter(stmt =>
        stmt.toLowerCase().includes('trigger')
      );

      expect(triggerStatements).toBeDefined();
      expect(triggerStatements!.length).toBeGreaterThan(0);
    });

    it('should have correct requiredTablesAfter', () => {
      const repair = getRepairPlaybook('R-DB-MIGRATIONS-LEDGER-001');
      expect(repair).toBeDefined();

      expect(repair?.requiredTablesAfter).toContain('afu9_migrations_ledger');
    });
  });
});
