/**
 * Chat Command Router Tests
 * 
 * Issue: I201.8 - INTENT Chat Command Router
 * Tests for command detection and routing logic
 */

import { detectCommand, getActionName, requiresDraft, requiresValidation } from "../../../src/lib/intent/chatCommandRouter";

describe("Chat Command Router - I201.8", () => {
  describe("detectCommand", () => {
    describe("validate command", () => {
      it("should detect 'validate' (EN)", () => {
        expect(detectCommand("validate")).toBe("validate");
      });

      it("should detect 'validiere' (DE)", () => {
        expect(detectCommand("validiere")).toBe("validate");
      });

      it("should detect 'prüfe' (DE)", () => {
        expect(detectCommand("prüfe")).toBe("validate");
      });

      it("should detect 'check' (EN)", () => {
        expect(detectCommand("check")).toBe("validate");
      });

      it("should be case-insensitive", () => {
        expect(detectCommand("VALIDATE")).toBe("validate");
        expect(detectCommand("Validiere")).toBe("validate");
        expect(detectCommand("PRÜFE")).toBe("validate");
      });

      it("should handle whitespace", () => {
        expect(detectCommand("  validate  ")).toBe("validate");
        expect(detectCommand("\tvalidiere\n")).toBe("validate");
      });
    });

    describe("commit command", () => {
      it("should detect 'commit' (EN)", () => {
        expect(detectCommand("commit")).toBe("commit");
      });

      it("should detect 'commit version' (EN)", () => {
        expect(detectCommand("commit version")).toBe("commit");
      });

      it("should detect 'committe' (DE)", () => {
        expect(detectCommand("committe")).toBe("commit");
      });

      it("should detect 'versioniere' (DE)", () => {
        expect(detectCommand("versioniere")).toBe("commit");
      });

      it("should be case-insensitive", () => {
        expect(detectCommand("COMMIT")).toBe("commit");
        expect(detectCommand("Commit Version")).toBe("commit");
      });
    });

    describe("publish command", () => {
      it("should detect 'publish' (EN)", () => {
        expect(detectCommand("publish")).toBe("publish");
      });

      it("should detect 'publish to github' (EN)", () => {
        expect(detectCommand("publish to github")).toBe("publish");
      });

      it("should detect 'github' (EN)", () => {
        expect(detectCommand("github")).toBe("publish");
      });

      it("should detect 'handoff' (EN)", () => {
        expect(detectCommand("handoff")).toBe("publish");
      });

      it("should be case-insensitive", () => {
        expect(detectCommand("PUBLISH")).toBe("publish");
        expect(detectCommand("GitHub")).toBe("publish");
        expect(detectCommand("HANDOFF")).toBe("publish");
      });
    });

    describe("create_issue command", () => {
      it("should detect 'create issue' (EN)", () => {
        expect(detectCommand("create issue")).toBe("create_issue");
      });

      it("should detect 'create afu9 issue' (EN)", () => {
        expect(detectCommand("create afu9 issue")).toBe("create_issue");
      });

      it("should detect 'create afu-9 issue' (EN)", () => {
        expect(detectCommand("create afu-9 issue")).toBe("create_issue");
      });

      it("should detect 'issue anlegen' (DE)", () => {
        expect(detectCommand("issue anlegen")).toBe("create_issue");
      });

      it("should be case-insensitive", () => {
        expect(detectCommand("CREATE ISSUE")).toBe("create_issue");
        expect(detectCommand("Issue Anlegen")).toBe("create_issue");
      });
    });

    describe("copy_snippet command", () => {
      it("should detect 'copy snippet' (EN)", () => {
        expect(detectCommand("copy snippet")).toBe("copy_snippet");
      });

      it("should detect 'export' (EN)", () => {
        expect(detectCommand("export")).toBe("copy_snippet");
      });

      it("should detect 'copy' (EN)", () => {
        expect(detectCommand("copy")).toBe("copy_snippet");
      });

      it("should be case-insensitive", () => {
        expect(detectCommand("COPY SNIPPET")).toBe("copy_snippet");
        expect(detectCommand("Export")).toBe("copy_snippet");
      });
    });

    describe("fallback behavior", () => {
      it("should return null for non-command text", () => {
        expect(detectCommand("Hello, how are you?")).toBeNull();
        expect(detectCommand("Please create a new issue")).toBeNull();
        expect(detectCommand("What is the status?")).toBeNull();
      });

      it("should return null for partial matches", () => {
        expect(detectCommand("validation")).toBeNull();
        expect(detectCommand("committed")).toBeNull();
        expect(detectCommand("publishing")).toBeNull();
      });

      it("should return null for empty string", () => {
        expect(detectCommand("")).toBeNull();
        expect(detectCommand("   ")).toBeNull();
      });
    });
  });

  describe("getActionName", () => {
    it("should return action names for commands", () => {
      expect(getActionName("validate")).toBe("VALIDATE");
      expect(getActionName("commit")).toBe("COMMIT_VERSION");
      expect(getActionName("publish")).toBe("PUBLISH_TO_GITHUB");
      expect(getActionName("create_issue")).toBe("CREATE_AFU9_ISSUE");
      expect(getActionName("copy_snippet")).toBe("COPY_SNIPPET");
    });

    it("should return UNKNOWN for null", () => {
      expect(getActionName(null)).toBe("UNKNOWN");
    });
  });

  describe("requiresDraft", () => {
    it("should require draft for all commands except null", () => {
      expect(requiresDraft("validate")).toBe(true);
      expect(requiresDraft("commit")).toBe(true);
      expect(requiresDraft("publish")).toBe(true);
      expect(requiresDraft("create_issue")).toBe(true);
      expect(requiresDraft("copy_snippet")).toBe(true);
      expect(requiresDraft(null)).toBe(false);
    });
  });

  describe("requiresValidation", () => {
    it("should require validation for commit, publish, create_issue", () => {
      expect(requiresValidation("commit")).toBe(true);
      expect(requiresValidation("publish")).toBe(true);
      expect(requiresValidation("create_issue")).toBe(true);
    });

    it("should not require validation for validate and copy_snippet", () => {
      expect(requiresValidation("validate")).toBe(false);
      expect(requiresValidation("copy_snippet")).toBe(false);
      expect(requiresValidation(null)).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should handle mixed case and whitespace in real-world usage", () => {
      // Simulating user inputs
      expect(detectCommand("  Validate  ")).toBe("validate");
      expect(detectCommand("COMMIT VERSION")).toBe("commit");
      expect(detectCommand("publish to github\n")).toBe("publish");
      expect(detectCommand("\tCREATE ISSUE\t")).toBe("create_issue");
    });

    it("should correctly identify fallback scenarios", () => {
      // These should NOT be detected as commands
      expect(detectCommand("I want to validate something")).toBeNull();
      expect(detectCommand("Can you commit this?")).toBeNull();
      expect(detectCommand("Please publish the draft")).toBeNull();
    });
  });
});
