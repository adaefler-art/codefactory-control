/**
 * Tests for Issue Interpreter
 */

import { IssueInterpreter } from '../issue-interpreter/issue-interpreter';

describe('IssueInterpreter', () => {
  let interpreter: IssueInterpreter;

  beforeEach(() => {
    interpreter = new IssueInterpreter();
  });

  describe('analyzeIssue', () => {
    it('should identify a bug issue', async () => {
      const issueData = {
        number: 1,
        repository: 'test/repo',
        title: 'Fix: Login button not working',
        body: 'The login button does not respond when clicked',
        labels: ['bug'],
      };

      const result = await interpreter.analyzeIssue(issueData);

      expect(result.taskType).toBe('bug');
      expect(result.actionableTask).toBe(true);
      expect(result.issueNumber).toBe(1);
    });

    it('should identify a feature request', async () => {
      const issueData = {
        number: 2,
        repository: 'test/repo',
        title: 'Add dark mode support',
        body: 'We should add a dark mode theme option for users',
        labels: ['feature'],
      };

      const result = await interpreter.analyzeIssue(issueData);

      expect(result.taskType).toBe('feature');
      expect(result.actionableTask).toBe(true);
    });

    it('should determine priority from labels', async () => {
      const issueData = {
        number: 3,
        repository: 'test/repo',
        title: 'Critical security vulnerability',
        body: 'SQL injection vulnerability found',
        labels: ['bug', 'critical'],
      };

      const result = await interpreter.analyzeIssue(issueData);

      expect(result.priority).toBe('critical');
    });

    it('should estimate complexity based on content', async () => {
      const issueData = {
        number: 4,
        repository: 'test/repo',
        title: 'Simple typo fix',
        body: 'Fix typo in readme',
        labels: [],
      };

      const result = await interpreter.analyzeIssue(issueData);

      expect(result.estimatedComplexity).toBe('simple');
    });

    it('should mark empty issues as non-actionable', async () => {
      const issueData = {
        number: 5,
        repository: 'test/repo',
        title: 'Test',
        body: '',
        labels: [],
      };

      const result = await interpreter.analyzeIssue(issueData);

      expect(result.actionableTask).toBe(false);
    });
  });
});
