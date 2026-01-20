import { parseChatCommand } from "../../src/lib/intent/issueDraftActions";

describe("parseChatCommand", () => {
  it("matches supported commands", () => {
    expect(parseChatCommand("validate")).toBe("validate");
    expect(parseChatCommand("validiere")).toBe("validate");
    expect(parseChatCommand("prüfe")).toBe("validate");
    expect(parseChatCommand("commit")).toBe("commit");
    expect(parseChatCommand("committe")).toBe("commit");
    expect(parseChatCommand("commit version")).toBe("commit");
    expect(parseChatCommand("versioniere")).toBe("commit");
    expect(parseChatCommand("publish")).toBe("publishGithub");
    expect(parseChatCommand("github")).toBe("publishGithub");
    expect(parseChatCommand("handoff")).toBe("publishGithub");
    expect(parseChatCommand("create issue")).toBe("createIssue");
    expect(parseChatCommand("issue anlegen")).toBe("createIssue");
    expect(parseChatCommand("create afu9 issue")).toBe("createIssue");
  });

  it("returns null for non-commands", () => {
    expect(parseChatCommand("hello world")).toBeNull();
    expect(parseChatCommand(" ")).toBeNull();
  });
});
