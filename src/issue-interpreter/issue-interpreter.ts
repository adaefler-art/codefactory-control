/**
 * Issue Interpreter Module
 * Analyzes GitHub issues to extract actionable tasks
 */

export interface IssueAnalysis {
  issueNumber: number;
  repository: string;
  title: string;
  description: string;
  labels: string[];
  actionableTask: boolean;
  taskType: 'bug' | 'feature' | 'enhancement' | 'unknown';
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  suggestedApproach?: string;
}

export class IssueInterpreter {
  /**
   * Analyze a GitHub issue to determine if it's actionable and extract key information
   */
  async analyzeIssue(issueData: {
    number: number;
    repository: string;
    title: string;
    body: string;
    labels: string[];
  }): Promise<IssueAnalysis> {
    const taskType = this.determineTaskType(issueData.title, issueData.body, issueData.labels);
    const priority = this.determinePriority(issueData.labels, issueData.title);
    const complexity = this.estimateComplexity(issueData.body);
    const actionable = this.isActionable(issueData.body);

    return {
      issueNumber: issueData.number,
      repository: issueData.repository,
      title: issueData.title,
      description: issueData.body,
      labels: issueData.labels,
      actionableTask: actionable,
      taskType,
      priority,
      estimatedComplexity: complexity,
      suggestedApproach: this.suggestApproach(taskType, complexity),
    };
  }

  private determineTaskType(
    title: string,
    body: string,
    labels: string[]
  ): 'bug' | 'feature' | 'enhancement' | 'unknown' {
    const lowerLabels = labels.map(l => l.toLowerCase());
    
    if (lowerLabels.includes('bug') || title.toLowerCase().includes('bug') || title.toLowerCase().includes('fix')) {
      return 'bug';
    }
    if (lowerLabels.includes('feature') || title.toLowerCase().includes('feature')) {
      return 'feature';
    }
    if (lowerLabels.includes('enhancement') || title.toLowerCase().includes('enhance')) {
      return 'enhancement';
    }
    
    return 'unknown';
  }

  private determinePriority(labels: string[], title: string): 'low' | 'medium' | 'high' | 'critical' {
    const lowerLabels = labels.map(l => l.toLowerCase());
    
    if (lowerLabels.includes('critical') || lowerLabels.includes('urgent')) {
      return 'critical';
    }
    if (lowerLabels.includes('high') || title.toLowerCase().includes('critical')) {
      return 'high';
    }
    if (lowerLabels.includes('low')) {
      return 'low';
    }
    
    return 'medium';
  }

  private estimateComplexity(body: string): 'simple' | 'moderate' | 'complex' {
    const wordCount = body.split(/\s+/).length;
    const hasCodeBlocks = body.includes('```');
    const hasMultipleSections = (body.match(/##/g) || []).length > 2;

    if (wordCount < 50 && !hasCodeBlocks) {
      return 'simple';
    }
    if (wordCount > 200 || hasMultipleSections) {
      return 'complex';
    }
    
    return 'moderate';
  }

  private isActionable(body: string): boolean {
    // An issue is actionable if it has a clear description
    const hasMinimumContent = body.length > 20;
    const isNotEmpty = body.trim() !== '';
    
    return hasMinimumContent && isNotEmpty;
  }

  private suggestApproach(taskType: string, complexity: string): string {
    if (taskType === 'bug' && complexity === 'simple') {
      return 'Quick fix with unit test';
    }
    if (taskType === 'bug' && complexity === 'complex') {
      return 'Investigate root cause, implement fix with comprehensive tests';
    }
    if (taskType === 'feature') {
      return 'Design component, implement with tests and documentation';
    }
    
    return 'Analyze requirements, implement incrementally';
  }
}

export const issueInterpreter = new IssueInterpreter();
