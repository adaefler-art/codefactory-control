/**
 * Parser Unit Tests for parseChatCommand
 * 
 * Issue: I201.9 - Shared Draft Actions + Parser Tests
 * Requirement R3: Parser Unit Tests
 * 
 * Tests:
 * - Basic commands (validate, commit, publish, createIssue)
 * - German/English synonyms
 * - Negative cases
 * - Edge cases (empty, whitespace, mixed case)
 * 
 * @jest-environment node
 */

import { parseChatCommand } from "../../src/lib/intent/issueDraftActions";

describe("parseChatCommand - Basic Commands", () => {
  describe("validate command", () => {
    test("should parse 'validate' (English)", () => {
      expect(parseChatCommand("validate")).toBe("validate");
    });

    test("should parse 'validiere' (German)", () => {
      expect(parseChatCommand("validiere")).toBe("validate");
    });

    test("should parse 'prüfe' (German with umlaut)", () => {
      expect(parseChatCommand("prüfe")).toBe("validate");
    });

    test("should parse 'pruefe' (German without umlaut)", () => {
      expect(parseChatCommand("pruefe")).toBe("validate");
    });

    test("should be case-insensitive", () => {
      expect(parseChatCommand("VALIDATE")).toBe("validate");
      expect(parseChatCommand("Validate")).toBe("validate");
      expect(parseChatCommand("VaLiDaTe")).toBe("validate");
    });

    test("should handle leading/trailing whitespace", () => {
      expect(parseChatCommand("  validate  ")).toBe("validate");
      expect(parseChatCommand("\tvalidate\n")).toBe("validate");
    });
  });

  describe("commit command", () => {
    test("should parse 'commit' (English)", () => {
      expect(parseChatCommand("commit")).toBe("commit");
    });

    test("should parse 'committe' (alternative spelling)", () => {
      expect(parseChatCommand("committe")).toBe("commit");
    });

    test("should parse 'commit version' (English variant)", () => {
      expect(parseChatCommand("commit version")).toBe("commit");
    });

    test("should parse 'versioniere' (German)", () => {
      expect(parseChatCommand("versioniere")).toBe("commit");
    });

    test("should be case-insensitive", () => {
      expect(parseChatCommand("COMMIT")).toBe("commit");
      expect(parseChatCommand("Commit")).toBe("commit");
    });
  });

  describe("publishGithub command", () => {
    test("should parse 'publish' (English)", () => {
      expect(parseChatCommand("publish")).toBe("publishGithub");
    });

    test("should parse 'github' (keyword)", () => {
      expect(parseChatCommand("github")).toBe("publishGithub");
    });

    test("should parse 'handoff' (English)", () => {
      expect(parseChatCommand("handoff")).toBe("publishGithub");
    });

    test("should be case-insensitive", () => {
      expect(parseChatCommand("PUBLISH")).toBe("publishGithub");
      expect(parseChatCommand("GitHub")).toBe("publishGithub");
    });
  });

  describe("createIssue command", () => {
    test("should parse 'create issue' (English)", () => {
      expect(parseChatCommand("create issue")).toBe("createIssue");
    });

    test("should parse 'issue anlegen' (German)", () => {
      expect(parseChatCommand("issue anlegen")).toBe("createIssue");
    });

    test("should parse 'create afu9 issue' (English variant)", () => {
      expect(parseChatCommand("create afu9 issue")).toBe("createIssue");
    });

    test("should be case-insensitive", () => {
      expect(parseChatCommand("CREATE ISSUE")).toBe("createIssue");
      expect(parseChatCommand("Create Issue")).toBe("createIssue");
    });
  });
});

describe("parseChatCommand - Negative Cases", () => {
  test("should return null for empty string", () => {
    expect(parseChatCommand("")).toBe(null);
  });

  test("should return null for whitespace-only string", () => {
    expect(parseChatCommand("   ")).toBe(null);
    expect(parseChatCommand("\t\n")).toBe(null);
  });

  test("should return null for unrecognized command", () => {
    expect(parseChatCommand("hello")).toBe(null);
    expect(parseChatCommand("delete")).toBe(null);
    expect(parseChatCommand("update")).toBe(null);
  });

  test("should return null for natural language questions (documented behavior)", () => {
    // R3: Negative cases - "can you validate this?" should return null
    // This is the expected behavior: strict command matching only
    expect(parseChatCommand("can you validate this?")).toBe(null);
    expect(parseChatCommand("please commit the draft")).toBe(null);
    expect(parseChatCommand("I want to publish")).toBe(null);
  });

  test("should return null for partial matches", () => {
    expect(parseChatCommand("vali")).toBe(null);
    expect(parseChatCommand("com")).toBe(null);
    expect(parseChatCommand("pub")).toBe(null);
  });
});

describe("parseChatCommand - Multi-Command Scenarios", () => {
  test("should return null for multi-command input (first-only not supported)", () => {
    // R3: Document behavior - multi-command parsing not supported
    // "dann validate und commit" should return null
    expect(parseChatCommand("dann validate und commit")).toBe(null);
    expect(parseChatCommand("validate and commit")).toBe(null);
    expect(parseChatCommand("commit then publish")).toBe(null);
  });

  test("should return null for commands with extra text", () => {
    // Only exact matches (after normalization) are supported
    expect(parseChatCommand("validate the draft")).toBe(null);
    expect(parseChatCommand("commit now")).toBe(null);
    expect(parseChatCommand("publish to github")).toBe(null);
  });
});

describe("parseChatCommand - Edge Cases", () => {
  test("should handle special characters gracefully", () => {
    expect(parseChatCommand("validate!")).toBe(null);
    expect(parseChatCommand("commit?")).toBe(null);
    expect(parseChatCommand("publish.")).toBe(null);
  });

  test("should handle numeric input", () => {
    expect(parseChatCommand("123")).toBe(null);
    expect(parseChatCommand("validate123")).toBe(null);
  });

  test("should handle mixed language input", () => {
    expect(parseChatCommand("validate bitte")).toBe(null);
    expect(parseChatCommand("bitte commit")).toBe(null);
  });
});

describe("parseChatCommand - Documentation Examples", () => {
  test("should parse all documented German synonyms", () => {
    // validate synonyms
    expect(parseChatCommand("validiere")).toBe("validate");
    expect(parseChatCommand("prüfe")).toBe("validate");
    expect(parseChatCommand("pruefe")).toBe("validate");
    
    // commit synonyms
    expect(parseChatCommand("versioniere")).toBe("commit");
  });

  test("should parse all documented English synonyms", () => {
    // validate
    expect(parseChatCommand("validate")).toBe("validate");
    
    // commit
    expect(parseChatCommand("commit")).toBe("commit");
    expect(parseChatCommand("commit version")).toBe("commit");
    
    // publish
    expect(parseChatCommand("publish")).toBe("publishGithub");
    expect(parseChatCommand("github")).toBe("publishGithub");
    expect(parseChatCommand("handoff")).toBe("publishGithub");
    
    // create issue
    expect(parseChatCommand("create issue")).toBe("createIssue");
    expect(parseChatCommand("create afu9 issue")).toBe("createIssue");
  });
});
