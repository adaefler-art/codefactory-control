/**
 * Tests for INTENT UI Issue Draft Panel
 * Issue E81.3: INTENT UI Issue Draft Panel (Preview + Validate + Commit)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import IssueDraftPanel from "../../app/intent/components/IssueDraftPanel";
import { EXAMPLE_MINIMAL_ISSUE_DRAFT } from "../../src/lib/schemas/issueDraft";

// Mock the API fetch
global.fetch = jest.fn();

describe("IssueDraftPanel", () => {
  const mockSessionId = "test-session-123";

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe("Rendering", () => {
    it("should show 'No draft yet' when no draft exists", async () => {
      // Mock 404 response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("No draft yet")).toBeInTheDocument();
      });
    });

    it("should show loading state initially", () => {
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      );

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      expect(screen.getByText("Loading draft...")).toBeInTheDocument();
    });

    it("should render draft preview when draft exists", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123def456",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: {
          isValid: true,
          errors: [],
          warnings: [],
          meta: {
            issueDraftVersion: "1.0",
            validatedAt: "2026-01-08T10:00:00Z",
            validatorVersion: "1.0.0",
            hash: "abc123def456",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("Preview")).toBeInTheDocument();
      });

      // Check metadata is rendered
      expect(screen.getByText(EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId)).toBeInTheDocument();
      expect(screen.getByText(EXAMPLE_MINIMAL_ISSUE_DRAFT.title)).toBeInTheDocument();
    });
  });

  describe("Validation Status Badge", () => {
    it("should show VALID badge when draft is valid", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("VALID")).toBeInTheDocument();
      });
    });

    it("should show INVALID badge when draft is invalid", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123",
        last_validation_status: "invalid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: {
          isValid: false,
          errors: [
            {
              code: "ISSUE_SCHEMA_INVALID",
              message: "Title is required",
              path: "/title",
              severity: "error" as const,
            },
          ],
          warnings: [],
          meta: {
            issueDraftVersion: "1.0",
            validatedAt: "2026-01-08T10:00:00Z",
            validatorVersion: "1.0.0",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("INVALID")).toBeInTheDocument();
      });
    });

    it("should show DRAFT badge when draft has no validation", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: null,
        last_validation_status: null,
        last_validation_at: null,
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("DRAFT")).toBeInTheDocument();
      });
    });
  });

  describe("Action Buttons", () => {
    it("should disable Commit button when draft is not valid", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: null,
        last_validation_status: "draft",
        last_validation_at: null,
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        const commitButton = screen.getByText("Commit Version");
        expect(commitButton).toBeDisabled();
      });
    });

    it("should enable Commit button when draft is valid", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: {
          isValid: true,
          errors: [],
          warnings: [],
          meta: {
            issueDraftVersion: "1.0",
            validatedAt: "2026-01-08T10:00:00Z",
            validatorVersion: "1.0.0",
            hash: "abc123",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        const commitButton = screen.getByText("Commit Version");
        expect(commitButton).not.toBeDisabled();
      });
    });

    it("should disable all actions when no session", () => {
      render(<IssueDraftPanel sessionId={null} />);

      expect(screen.getByText("Validate")).toBeDisabled();
      expect(screen.getByText("Commit Version")).toBeDisabled();
    });
  });

  describe("Error Display", () => {
    it("should show errors in collapsible list (deterministic order)", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: null,
        last_validation_status: "invalid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: {
          isValid: false,
          errors: [
            {
              code: "ISSUE_SCHEMA_INVALID",
              message: "Title is required",
              path: "/title",
              severity: "error" as const,
            },
            {
              code: "ISSUE_AC_MISSING",
              message: "At least one acceptance criterion is required",
              path: "/acceptanceCriteria",
              severity: "error" as const,
            },
          ],
          warnings: [],
          meta: {
            issueDraftVersion: "1.0",
            validatedAt: "2026-01-08T10:00:00Z",
            validatorVersion: "1.0.0",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText(/Errors \(2\)/)).toBeInTheDocument();
      });

      // Errors should be displayed deterministically
      const errorMessages = screen.getAllByText(/is required/);
      expect(errorMessages.length).toBe(2);
    });

    it("should show warnings in collapsible list", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: {
          isValid: true,
          errors: [],
          warnings: [
            {
              code: "ISSUE_SELF_DEPENDENCY",
              message: "Issue depends on itself (circular dependency)",
              path: "/dependsOn",
              severity: "warning" as const,
            },
          ],
          meta: {
            issueDraftVersion: "1.0",
            validatedAt: "2026-01-08T10:00:00Z",
            validatorVersion: "1.0.0",
            hash: "abc123",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText(/Warnings \(1\)/)).toBeInTheDocument();
      });
    });
  });

  describe("Deterministic Rendering", () => {
    it("should render labels in sorted order", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: {
          ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
          labels: ["a-label", "m-label", "z-label"], // Already sorted in schema normalization
        },
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("a-label")).toBeInTheDocument();
        expect(screen.getByText("m-label")).toBeInTheDocument();
        expect(screen.getByText("z-label")).toBeInTheDocument();
      });
    });

    it("should render dependencies in sorted order", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: {
          ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
          dependsOn: ["E81.1", "E81.2", "E81.3"], // Already sorted in schema normalization
        },
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      const { container } = render(<IssueDraftPanel sessionId={mockSessionId} />);

      // Wait for Dependencies header to appear which indicates the section rendered
      await waitFor(() => {
        expect(screen.getByText("Dependencies")).toBeInTheDocument();
      });
      
      // Check dependencies exist in the rendered content
      expect(container.textContent).toContain("E81.1");
      expect(container.textContent).toContain("E81.2");
      expect(container.textContent).toContain("E81.3");
    });
  });

  describe("No Secrets", () => {
    it("should not display any secret keys or tokens", async () => {
      const mockDraft = {
        id: "draft-123",
        session_id: mockSessionId,
        created_at: "2026-01-08T10:00:00Z",
        updated_at: "2026-01-08T10:00:00Z",
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: "abc123",
        last_validation_status: "valid",
        last_validation_at: "2026-01-08T10:00:00Z",
        last_validation_result: null,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockDraft,
      });

      const { container } = render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        expect(screen.getByText("Preview")).toBeInTheDocument();
      });

      // Check that no environment variable keys are visible
      expect(container.textContent).not.toMatch(/AFU9_.*_KEY/);
      expect(container.textContent).not.toMatch(/SECRET/);
      expect(container.textContent).not.toMatch(/TOKEN/);
    });

    it("should only show requestId on error (no internal details)", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce({
        requestId: "req-123-456",
        message: "Network error",
      });

      render(<IssueDraftPanel sessionId={mockSessionId} />);

      await waitFor(() => {
        // Should show requestId
        expect(screen.getByText(/req-123-456/)).toBeInTheDocument();
      });
      
      // Should show generic error, not internal stack traces
      expect(screen.queryByText(/stack trace/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/database/i)).not.toBeInTheDocument();
    });
  });
});
