import {
  RunSpecSchema,
  RunResultSchema,
  StepSchema,
  StepResultSchema,
  PlaybookSchema,
  RuntimeSchema,
  StepExpectSchema,
} from '../../src/contracts/schemas';
import { ZodError } from 'zod';

describe('RunSpec Schema', () => {
  it('should validate a valid minimal RunSpec', () => {
    const validSpec = {
      title: 'Test Run',
      runtime: 'dummy' as const,
      steps: [
        {
          name: 'Step 1',
          shell: 'bash' as const,
          command: 'echo "hello"',
        },
      ],
    };

    const result = RunSpecSchema.parse(validSpec);
    expect(result).toEqual(validSpec);
  });

  it('should validate a full RunSpec with all optional fields', () => {
    const fullSpec = {
      runId: 'custom-run-id',
      issueId: 'issue-123',
      title: 'Full Test Run',
      runtime: 'dummy' as const,
      steps: [
        {
          name: 'Build Step',
          shell: 'bash' as const,
          command: 'npm run build',
          cwd: '/app',
          timeoutSec: 300,
          expect: {
            exitCode: 0,
            stdoutRegex: ['Build complete'],
            fileExists: ['dist/index.js'],
          },
          artifacts: ['dist/**/*'],
        },
      ],
      envRefs: {
        NODE_ENV: 'production',
        API_URL: 'https://api.example.com',
      },
    };

    const result = RunSpecSchema.parse(fullSpec);
    expect(result).toEqual(fullSpec);
  });

  it('should reject RunSpec with missing required fields', () => {
    const invalidSpec = {
      runtime: 'dummy',
      steps: [],
    };

    expect(() => RunSpecSchema.parse(invalidSpec)).toThrow(ZodError);
  });

  it('should reject RunSpec with empty title', () => {
    const invalidSpec = {
      title: '',
      runtime: 'dummy',
      steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
    };

    expect(() => RunSpecSchema.parse(invalidSpec)).toThrow(ZodError);
  });

  it('should reject RunSpec with empty steps array', () => {
    const invalidSpec = {
      title: 'Test',
      runtime: 'dummy',
      steps: [],
    };

    expect(() => RunSpecSchema.parse(invalidSpec)).toThrow(ZodError);
  });

  it('should reject RunSpec with invalid runtime', () => {
    const invalidSpec = {
      title: 'Test',
      runtime: 'invalid-runtime',
      steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
    };

    expect(() => RunSpecSchema.parse(invalidSpec)).toThrow(ZodError);
  });

  it('should accept all valid runtime types', () => {
    const runtimes = ['dummy', 'github-runner', 'ecs-task', 'ssm'];
    
    runtimes.forEach(runtime => {
      const spec = {
        title: 'Test',
        runtime,
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };
      
      expect(() => RunSpecSchema.parse(spec)).not.toThrow();
    });
  });
});

describe('Step Schema', () => {
  it('should validate a minimal step', () => {
    const validStep = {
      name: 'Test Step',
      shell: 'bash' as const,
      command: 'ls -la',
    };

    const result = StepSchema.parse(validStep);
    expect(result).toEqual(validStep);
  });

  it('should validate a step with all optional fields', () => {
    const fullStep = {
      name: 'Build Step',
      shell: 'pwsh' as const,
      command: 'dotnet build',
      cwd: '/app/src',
      timeoutSec: 600,
      expect: {
        exitCode: 0,
        stdoutRegex: ['Build succeeded'],
        stderrRegex: [],
        fileExists: ['bin/Release/app.dll'],
      },
      artifacts: ['bin/**/*', 'obj/**/*'],
    };

    const result = StepSchema.parse(fullStep);
    expect(result).toEqual(fullStep);
  });

  it('should reject step with empty name', () => {
    const invalidStep = {
      name: '',
      shell: 'bash',
      command: 'echo',
    };

    expect(() => StepSchema.parse(invalidStep)).toThrow(ZodError);
  });

  it('should reject step with empty command', () => {
    const invalidStep = {
      name: 'Test',
      shell: 'bash',
      command: '',
    };

    expect(() => StepSchema.parse(invalidStep)).toThrow(ZodError);
  });

  it('should reject step with invalid shell', () => {
    const invalidStep = {
      name: 'Test',
      shell: 'zsh',
      command: 'echo',
    };

    expect(() => StepSchema.parse(invalidStep)).toThrow(ZodError);
  });

  it('should accept both bash and pwsh shells', () => {
    const bashStep = { name: 'Bash', shell: 'bash', command: 'echo' };
    const pwshStep = { name: 'PowerShell', shell: 'pwsh', command: 'Write-Host' };

    expect(() => StepSchema.parse(bashStep)).not.toThrow();
    expect(() => StepSchema.parse(pwshStep)).not.toThrow();
  });
});

describe('StepExpect Schema', () => {
  it('should validate empty expect object', () => {
    const validExpect = {};
    const result = StepExpectSchema.parse(validExpect);
    expect(result).toEqual(validExpect);
  });

  it('should validate expect with exitCode', () => {
    const validExpect = { exitCode: 0 };
    const result = StepExpectSchema.parse(validExpect);
    expect(result).toEqual(validExpect);
  });

  it('should validate expect with regex arrays', () => {
    const validExpect = {
      stdoutRegex: ['pattern1', 'pattern2'],
      stderrRegex: ['error.*'],
    };
    const result = StepExpectSchema.parse(validExpect);
    expect(result).toEqual(validExpect);
  });

  it('should validate expect with fileExists', () => {
    const validExpect = {
      fileExists: ['dist/app.js', 'dist/app.js.map'],
    };
    const result = StepExpectSchema.parse(validExpect);
    expect(result).toEqual(validExpect);
  });
});

describe('RunResult Schema', () => {
  it('should validate a minimal RunResult', () => {
    const validResult = {
      runId: 'run-123',
      title: 'Test Run',
      runtime: 'dummy' as const,
      status: 'created' as const,
      steps: [],
      createdAt: new Date().toISOString(),
    };

    const result = RunResultSchema.parse(validResult);
    expect(result).toEqual(validResult);
  });

  it('should validate a complete RunResult', () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 5000).toISOString();
    
    const fullResult = {
      runId: 'run-456',
      issueId: 'issue-789',
      title: 'Complete Run',
      runtime: 'dummy' as const,
      status: 'success' as const,
      steps: [
        {
          name: 'Step 1',
          status: 'success' as const,
          exitCode: 0,
          stdout: 'Success output',
          stderr: '',
          startedAt: now,
          completedAt: later,
          durationMs: 5000,
        },
      ],
      createdAt: now,
      startedAt: now,
      completedAt: later,
      durationMs: 5000,
    };

    const result = RunResultSchema.parse(fullResult);
    expect(result).toEqual(fullResult);
  });

  it('should validate all valid status values', () => {
    const statuses = ['created', 'running', 'success', 'failed', 'timeout', 'cancelled'];
    
    statuses.forEach(status => {
      const result = {
        runId: 'run-123',
        title: 'Test',
        runtime: 'dummy',
        status,
        steps: [],
        createdAt: new Date().toISOString(),
      };
      
      expect(() => RunResultSchema.parse(result)).not.toThrow();
    });
  });
});

describe('StepResult Schema', () => {
  it('should validate a minimal StepResult', () => {
    const validStepResult = {
      name: 'Step 1',
      status: 'pending' as const,
    };

    const result = StepResultSchema.parse(validStepResult);
    expect(result).toEqual(validStepResult);
  });

  it('should validate all valid step statuses', () => {
    const statuses = ['pending', 'running', 'success', 'failed', 'timeout', 'skipped'];
    
    statuses.forEach(status => {
      const stepResult = {
        name: 'Test Step',
        status,
      };
      
      expect(() => StepResultSchema.parse(stepResult)).not.toThrow();
    });
  });

  it('should validate StepResult with error', () => {
    const stepResult = {
      name: 'Failed Step',
      status: 'failed' as const,
      exitCode: 1,
      error: 'Command execution failed',
    };

    const result = StepResultSchema.parse(stepResult);
    expect(result).toEqual(stepResult);
  });
});

describe('Playbook Schema', () => {
  it('should validate a minimal Playbook', () => {
    const validPlaybook = {
      id: 'playbook-1',
      name: 'Test Playbook',
      spec: {
        title: 'Test',
        runtime: 'dummy' as const,
        steps: [
          { name: 'Step', shell: 'bash' as const, command: 'echo' },
        ],
      },
    };

    const result = PlaybookSchema.parse(validPlaybook);
    expect(result).toEqual(validPlaybook);
  });

  it('should validate Playbook with description', () => {
    const playbook = {
      id: 'playbook-2',
      name: 'Build Playbook',
      description: 'Builds the application',
      spec: {
        title: 'Build',
        runtime: 'dummy' as const,
        steps: [
          { name: 'Build', shell: 'bash' as const, command: 'npm run build' },
        ],
      },
    };

    const result = PlaybookSchema.parse(playbook);
    expect(result).toEqual(playbook);
  });
});

describe('Runtime Schema', () => {
  it('should validate all runtime types', () => {
    const runtimes = ['dummy', 'github-runner', 'ecs-task', 'ssm'];
    
    runtimes.forEach(runtime => {
      expect(() => RuntimeSchema.parse(runtime)).not.toThrow();
    });
  });

  it('should reject invalid runtime', () => {
    expect(() => RuntimeSchema.parse('invalid')).toThrow(ZodError);
  });
});
