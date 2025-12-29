import { Playbook, RunSpec } from '../contracts/schemas';

/**
 * PlaybookManager (I631 MVP)
 * 
 * Simple in-memory playbook storage for demo purposes.
 * Future: Load from S3, DynamoDB, or file system (I632+)
 */
export class PlaybookManager {
  private playbooks: Map<string, Playbook> = new Map();

  constructor() {
    // Initialize with some example playbooks
    this.initializeExamples();
  }

  /**
   * List all available playbooks
   */
  async listPlaybooks(): Promise<Playbook[]> {
    return Array.from(this.playbooks.values());
  }

  /**
   * Get a specific playbook by ID
   */
  async getPlaybook(id: string): Promise<Playbook> {
    const playbook = this.playbooks.get(id);
    
    if (!playbook) {
      throw new Error(`Playbook ${id} not found`);
    }

    return playbook;
  }

  /**
   * Add a playbook (for testing/future use)
   */
  async addPlaybook(playbook: Playbook): Promise<void> {
    this.playbooks.set(playbook.id, playbook);
  }

  /**
   * Initialize example playbooks for demo
   */
  private initializeExamples(): void {
    const examplePlaybooks: Playbook[] = [
      {
        id: 'hello-world',
        name: 'Hello World',
        description: 'Simple hello world example',
        spec: {
          title: 'Hello World Run',
          runtime: 'dummy',
          steps: [
            {
              name: 'Print Hello',
              shell: 'bash',
              command: 'echo "Hello, World!"',
            },
          ],
        },
      },
      {
        id: 'multi-step-build',
        name: 'Multi-Step Build',
        description: 'Example multi-step build process',
        spec: {
          title: 'Multi-Step Build Example',
          runtime: 'dummy',
          steps: [
            {
              name: 'Install Dependencies',
              shell: 'bash',
              command: 'npm install',
              cwd: '/app',
              timeoutSec: 300,
            },
            {
              name: 'Run Tests',
              shell: 'bash',
              command: 'npm test',
              cwd: '/app',
              timeoutSec: 600,
              expect: {
                exitCode: 0,
              },
            },
            {
              name: 'Build Application',
              shell: 'bash',
              command: 'npm run build',
              cwd: '/app',
              artifacts: ['dist/**/*'],
            },
          ],
          envRefs: {
            NODE_ENV: 'production',
          },
        },
      },
      {
        id: 'pwsh-example',
        name: 'PowerShell Example',
        description: 'Example using PowerShell',
        spec: {
          title: 'PowerShell Example Run',
          runtime: 'dummy',
          steps: [
            {
              name: 'Get System Info',
              shell: 'pwsh',
              command: 'Get-Host | Select-Object Version',
            },
            {
              name: 'List Files',
              shell: 'pwsh',
              command: 'Get-ChildItem -Path .',
            },
          ],
        },
      },
    ];

    examplePlaybooks.forEach(playbook => {
      this.playbooks.set(playbook.id, playbook);
    });
  }
}
