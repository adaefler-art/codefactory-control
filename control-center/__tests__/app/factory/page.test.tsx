/**
 * Tests for Factory UI Page
 * 
 * Tests the Factory Status read-only UI component
 * EPIC 08: Factory UI (Read-only) – Transparenz & Beobachtbarkeit
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import FactoryPage from '../../../app/factory/page';

// Mock Next.js router and link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock fetch for API calls
global.fetch = jest.fn();

describe('Factory Status UI Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      new Promise(() => {}) // Never resolves
    );

    render(<FactoryPage />);
    
    expect(screen.getByText('Loading factory status...')).toBeInTheDocument();
  });

  test('should display factory status data when loaded', async () => {
    const mockFactoryStatus = {
      api: { version: '1.1.0' },
      timestamp: '2024-01-15T10:00:00Z',
      runs: {
        recent: [
          {
            id: 'exec-1',
            workflowId: 'wf-1',
            status: 'completed',
            startedAt: '2024-01-15T09:00:00Z',
            completedAt: '2024-01-15T09:05:00Z',
            durationMs: 300000,
            triggeredBy: 'user@example.com',
            error: null,
            policySnapshotId: 'policy-1',
            policyVersion: 'v1.0.0',
          },
        ],
        total: 156,
      },
      errors: {
        recent: [],
        total: 0,
      },
      kpis: {
        meanTimeToInsightMs: 285000,
        totalExecutions: 45,
        completedExecutions: 38,
        failedExecutions: 7,
        successRate: 84.44,
        avgExecutionDurationMs: 275000,
        runningExecutions: 2,
      },
      verdicts: {
        enabled: true,
        summary: [],
        kpis: {
          totalVerdicts: 0,
          avgConfidence: 0,
          consistencyScore: 0,
          byAction: {
            waitAndRetry: 0,
            openIssue: 0,
            humanRequired: 0,
          },
          topErrorClasses: [],
        },
      },
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockFactoryStatus,
    });

    render(<FactoryPage />);

    // Wait for the component to load data and KPIs to be displayed
    await waitFor(() => {
      expect(screen.getByText('Mean Time to Insight')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Check other KPI cards are displayed
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('Total Executions')).toBeInTheDocument();
    expect(screen.getByText('Verdicts')).toBeInTheDocument();

    // Check KPI values
    expect(screen.getByText('84.4%')).toBeInTheDocument(); // Success rate
    expect(screen.getByText('45')).toBeInTheDocument(); // Total executions

    // Check read-only message
    expect(screen.getByText(/Read-only mode.*No mutations allowed/i)).toBeInTheDocument();
  });

  test('should display error message when API fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<FactoryPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading factory status...')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/API error: 500/i)).toBeInTheDocument();
  });

  test('should show factory runs section', async () => {
    const mockFactoryStatus = {
      api: { version: '1.1.0' },
      timestamp: '2024-01-15T10:00:00Z',
      runs: {
        recent: [
          {
            id: 'exec-1',
            workflowId: 'test-workflow',
            status: 'completed',
            startedAt: '2024-01-15T09:00:00Z',
            completedAt: '2024-01-15T09:05:00Z',
            durationMs: 300000,
            triggeredBy: 'user@example.com',
            error: null,
            policySnapshotId: null,
            policyVersion: null,
          },
        ],
        total: 1,
      },
      errors: { recent: [], total: 0 },
      kpis: {
        meanTimeToInsightMs: 285000,
        totalExecutions: 1,
        completedExecutions: 1,
        failedExecutions: 0,
        successRate: 100,
        avgExecutionDurationMs: 285000,
        runningExecutions: 0,
      },
      verdicts: {
        enabled: true,
        summary: [],
        kpis: {
          totalVerdicts: 0,
          avgConfidence: 0,
          consistencyScore: 0,
          byAction: { waitAndRetry: 0, openIssue: 0, humanRequired: 0 },
          topErrorClasses: [],
        },
      },
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockFactoryStatus,
    });

    render(<FactoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Recent Factory Runs')).toBeInTheDocument();
      expect(screen.getByText('test-workflow')).toBeInTheDocument();
    });
  });

  test('should display "no factory runs" message when no runs exist', async () => {
    const mockFactoryStatus = {
      api: { version: '1.1.0' },
      timestamp: '2024-01-15T10:00:00Z',
      runs: { recent: [], total: 0 },
      errors: { recent: [], total: 0 },
      kpis: {
        meanTimeToInsightMs: null,
        totalExecutions: 0,
        completedExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        avgExecutionDurationMs: null,
        runningExecutions: 0,
      },
      verdicts: {
        enabled: true,
        summary: [],
        kpis: {
          totalVerdicts: 0,
          avgConfidence: 0,
          consistencyScore: 0,
          byAction: { waitAndRetry: 0, openIssue: 0, humanRequired: 0 },
          topErrorClasses: [],
        },
      },
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockFactoryStatus,
    });

    render(<FactoryPage />);

    await waitFor(() => {
      expect(screen.getByText('No factory runs found')).toBeInTheDocument();
    });
  });

  test('should render auto-refresh toggle button', async () => {
    const mockFactoryStatus = {
      api: { version: '1.1.0' },
      timestamp: '2024-01-15T10:00:00Z',
      runs: { recent: [], total: 0 },
      errors: { recent: [], total: 0 },
      kpis: {
        meanTimeToInsightMs: null,
        totalExecutions: 0,
        completedExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        avgExecutionDurationMs: null,
        runningExecutions: 0,
      },
      verdicts: {
        enabled: true,
        summary: [],
        kpis: {
          totalVerdicts: 0,
          avgConfidence: 0,
          consistencyScore: 0,
          byAction: { waitAndRetry: 0, openIssue: 0, humanRequired: 0 },
          topErrorClasses: [],
        },
      },
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockFactoryStatus,
    });

    render(<FactoryPage />);

    await waitFor(() => {
      expect(screen.getByText(/✓ Auto-refresh/)).toBeInTheDocument();
    });
  });

  test('should display verdict statistics when verdicts are enabled', async () => {
    const mockFactoryStatus = {
      api: { version: '1.1.0' },
      timestamp: '2024-01-15T10:00:00Z',
      runs: { recent: [], total: 0 },
      errors: { recent: [], total: 0 },
      kpis: {
        meanTimeToInsightMs: null,
        totalExecutions: 0,
        completedExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        avgExecutionDurationMs: null,
        runningExecutions: 0,
      },
      verdicts: {
        enabled: true,
        summary: [],
        kpis: {
          totalVerdicts: 100,
          avgConfidence: 85,
          consistencyScore: 98,
          byAction: {
            waitAndRetry: 50,
            openIssue: 30,
            humanRequired: 20,
          },
          topErrorClasses: [
            { errorClass: 'DNS_ERROR', count: 25, avgConfidence: 90 },
          ],
        },
      },
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockFactoryStatus,
    });

    render(<FactoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Verdict Statistics')).toBeInTheDocument();
      expect(screen.getByText('Actions Proposed')).toBeInTheDocument();
      expect(screen.getByText('Verdict Quality')).toBeInTheDocument();
    });
  });
});
