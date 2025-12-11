import { NextRequest, NextResponse } from "next/server";
import { createIssue, listIssuesByLabel } from "../../../src/lib/github";
import { generateFeatureSpec } from "../../../src/lib/llm";

export async function GET() {
  try {
    const issues = await listIssuesByLabel("source:afu-9");

    const formattedIssues = issues.map((issue) => ({
      number: issue.id,
      title: issue.title,
      state: issue.state as "open" | "closed",
      createdAt: issue.created_at,
      htmlUrl: issue.html_url,
    }));

    return NextResponse.json({
      status: "ok",
      issues: formattedIssues,
    });
  } catch (error) {
    console.error("Error fetching issues:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { title, briefing } = await request.json();

    if (!title || !briefing) {
      return NextResponse.json(
        { error: "Title and briefing are required" },
        { status: 400 }
      );
    }

    // Generate technical specification using the LLM helper
    let specification: string;
    try {
      specification = await generateFeatureSpec(briefing);
    } catch (error) {
      console.error("LLM specification generation failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // Create GitHub issue
    const issueBody = `**Quelle:** AFU-9 Control Center

## Feature-Briefing
${briefing}

---

## Technische Spezifikation
${specification}

---
*Erstellt durch AFU-9 v0.1*
*Label: source:afu-9*`;

    let issue: { html_url: string; number: number };
    try {
      issue = await createIssue({
        title,
        body: issueBody,
        labels: ["source:afu-9", "codefactory"],
      });
    } catch (error) {
      console.error("GitHub issue creation failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return NextResponse.json({
      status: "ok",
      url: issue.html_url,
      issueNumber: issue.number,
      specification,
    });
  } catch (error) {
    console.error("Error creating feature:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
