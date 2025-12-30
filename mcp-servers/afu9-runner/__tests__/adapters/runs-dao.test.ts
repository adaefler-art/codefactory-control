import { Pool } from 'pg';
import { RunsDAO } from '../../src/adapters/runs-dao';
import { RunSpec } from '../../src/contracts/schemas';

/**
 * RunsDAO Contract Tests (I632)
 * 
 * These tests verify database persistence for the runs ledger.
 * They require a test database to be available.
 */

describe('RunsDAO Contract Tests', () => {
  let pool: Pool;
  let dao: RunsDAO;

  beforeAll(() => {
    // Skip tests if no database is available
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_HOST) {
      console.log('Skipping RunsDAO tests - no test database configured');
      return;
    }

    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'afu9_test',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
    });

    dao = new RunsDAO(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (!pool) return;
    
    // Clean up test data
    await pool.query('DELETE FROM run_artifacts WHERE run_id LIKE $1', ['test-%']);
    await pool.query('DELETE FROM run_steps WHERE run_id LIKE $1', ['test-%']);
    await pool.query('DELETE FROM runs WHERE id LIKE $1', ['test-%']);
  });

  const shouldSkip = () => !pool;

  describe('createRun', () => {
    it('should create a run with steps in database', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Test Run',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
          { name: 'Step 2', shell: 'bash', command: 'ls' },
        ],
      };

      const runId = 'test-run-1';
      await dao.createRun(runId, spec);

      const data = await dao.getRun(runId);
      expect(data).not.toBeNull();
      expect(data!.run.id).toBe(runId);
      expect(data!.run.title).toBe('Test Run');
      expect(data!.run.status).toBe('QUEUED');
      expect(data!.steps).toHaveLength(2);
      expect(data!.steps[0].name).toBe('Step 1');
      expect(data!.steps[0].status).toBe('QUEUED');
      expect(data!.steps[1].name).toBe('Step 2');
    });

    it('should create run with issue_id', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Issue Run',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'pwd' }],
      };

      const runId = 'test-run-2';
      await dao.createRun(runId, spec, 'issue-123');

      const data = await dao.getRun(runId);
      expect(data!.run.issue_id).toBe('issue-123');
    });

    it('should create run with playbook_id and parent_run_id', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Playbook Run',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      // Create parent run first
      const parentId = 'test-run-parent';
      await dao.createRun(parentId, spec);

      // Create child run
      const childId = 'test-run-child';
      await dao.createRun(childId, spec, undefined, 'playbook-1', parentId);

      const data = await dao.getRun(childId);
      expect(data!.run.playbook_id).toBe('playbook-1');
      expect(data!.run.parent_run_id).toBe(parentId);
    });
  });

  describe('updateRunStatus', () => {
    it('should update run status to RUNNING', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Status Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const runId = 'test-run-3';
      await dao.createRun(runId, spec);

      const startedAt = new Date();
      await dao.updateRunStatus(runId, 'RUNNING', startedAt);

      const data = await dao.getRun(runId);
      expect(data!.run.status).toBe('RUNNING');
      expect(data!.run.started_at).toBeTruthy();
    });

    it('should update run status to SUCCEEDED with timestamps', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Complete Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const runId = 'test-run-4';
      await dao.createRun(runId, spec);

      const startedAt = new Date();
      await dao.updateRunStatus(runId, 'RUNNING', startedAt);

      const finishedAt = new Date(Date.now() + 1000);
      await dao.updateRunStatus(runId, 'SUCCEEDED', undefined, finishedAt);

      const data = await dao.getRun(runId);
      expect(data!.run.status).toBe('SUCCEEDED');
      expect(data!.run.finished_at).toBeTruthy();
    });
  });

  describe('updateStep', () => {
    it('should update step status and results', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Step Update Test',
        runtime: 'dummy',
        steps: [{ name: 'Step 1', shell: 'bash', command: 'echo "hello"' }],
      };

      const runId = 'test-run-5';
      await dao.createRun(runId, spec);

      await dao.updateStep(
        runId,
        0,
        'SUCCEEDED',
        0,
        123,
        'hello world',
        ''
      );

      const steps = await dao.getRunSteps(runId);
      expect(steps[0].status).toBe('SUCCEEDED');
      expect(steps[0].exit_code).toBe(0);
      expect(steps[0].duration_ms).toBe(123);
      expect(steps[0].stdout_tail).toBe('hello world');
      expect(steps[0].stderr_tail).toBe('');
    });

    it('should cap stdout_tail to 4000 characters', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Cap Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const runId = 'test-run-6';
      await dao.createRun(runId, spec);

      const longOutput = 'x'.repeat(5000);
      await dao.updateStep(runId, 0, 'SUCCEEDED', 0, 100, longOutput, '');

      const steps = await dao.getRunSteps(runId);
      expect(steps[0].stdout_tail.length).toBe(4000);
      expect(steps[0].stdout_tail.startsWith('...')).toBe(true);
    });
  });

  describe('listRunsByIssue', () => {
    it('should list runs by issue_id', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Issue List Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      await dao.createRun('test-run-7', spec, 'issue-abc');
      await dao.createRun('test-run-8', spec, 'issue-abc');
      await dao.createRun('test-run-9', spec, 'issue-xyz');

      const runs = await dao.listRunsByIssue('issue-abc');
      expect(runs.length).toBe(2);
      expect(runs[0].issue_id).toBe('issue-abc');
    });
  });

  describe('reconstructRunResult', () => {
    it('should reconstruct RunResult from database', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Reconstruct Test',
        runtime: 'dummy',
        steps: [
          { name: 'Build', shell: 'bash', command: 'npm run build' },
          { name: 'Test', shell: 'bash', command: 'npm test' },
        ],
      };

      const runId = 'test-run-10';
      await dao.createRun(runId, spec, 'issue-123');

      // Simulate execution
      const startedAt = new Date();
      await dao.updateRunStatus(runId, 'RUNNING', startedAt);
      await dao.updateStep(runId, 0, 'SUCCEEDED', 0, 100, 'build output', '');
      await dao.updateStep(runId, 1, 'SUCCEEDED', 0, 200, 'test output', '');
      
      const finishedAt = new Date(Date.now() + 1000);
      await dao.updateRunStatus(runId, 'SUCCEEDED', undefined, finishedAt);

      const result = await dao.reconstructRunResult(runId);
      expect(result).not.toBeNull();
      expect(result!.runId).toBe(runId);
      expect(result!.issueId).toBe('issue-123');
      expect(result!.title).toBe('Reconstruct Test');
      expect(result!.runtime).toBe('dummy');
      expect(result!.status).toBe('success');
      expect(result!.steps).toHaveLength(2);
      expect(result!.steps[0].name).toBe('Build');
      expect(result!.steps[0].status).toBe('success');
      expect(result!.steps[0].stdout).toBe('build output');
      expect(result!.steps[1].name).toBe('Test');
      expect(result!.createdAt).toBeTruthy();
      expect(result!.startedAt).toBeTruthy();
      expect(result!.completedAt).toBeTruthy();
      expect(result!.durationMs).toBeGreaterThan(0);
    });

    it('should return null for non-existent run', async () => {
      if (shouldSkip()) return;

      const result = await dao.reconstructRunResult('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('immutability', () => {
    it('should preserve spec_json immutably', async () => {
      if (shouldSkip()) return;

      const spec: RunSpec = {
        title: 'Immutable Spec',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const runId = 'test-run-11';
      await dao.createRun(runId, spec);

      // Execute run
      await dao.updateRunStatus(runId, 'RUNNING', new Date());
      await dao.updateStep(runId, 0, 'SUCCEEDED', 0, 100, 'output', '');
      await dao.updateRunStatus(runId, 'SUCCEEDED', undefined, new Date());

      // Verify spec is unchanged
      const data = await dao.getRun(runId);
      expect(data!.run.spec_json).toEqual(spec);
    });
  });
});
