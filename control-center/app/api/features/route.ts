import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createIssue, listIssuesByLabel } from "../../../src/lib/github";

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
    console.error("Error fetching issues:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    const { title, briefing } = await request.json();

    if (!title || !briefing) {
      return NextResponse.json(
        { error: "Title and briefing are required" },
        { status: 400 }
      );
    }

    // Generate technical specification using OpenAI
    const specPrompt = `Ich bin AFU-9 – Autonomous Fabrication Unit, Ninefold Architecture.
Erstelle eine technische Spezifikation zu folgendem Feature:

BRIEFING:
${briefing}

Struktur:
1. Kurzbeschreibung
2. Akzeptanzkriterien (3–7 Bulletpoints)
3. Technische Hinweise (Frontend/Backend/DB)
4. Eventuelle DB-Änderungen
5. Risiken / Edge Cases

Sprache: Deutsch.
Beziehe dich konkret auf das Projekt "rhythmologicum-connect" (Next.js + Supabase).`;

    console.log("Generating specification with OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Du bist AFU-9, ein KI-System zur Erstellung technischer Spezifikationen. Antworte präzise und strukturiert auf Deutsch.",
        },
        {
          role: "user",
          content: specPrompt,
        },
      ],
      temperature: 0.7,
    });

    const specification = completion.choices[0]?.message?.content || "";
    console.log("Specification generated");

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

    const issue = await createIssue({
      title,
      body: issueBody,
      labels: ["source:afu-9", "codefactory"],
    });

    return NextResponse.json({
      status: "ok",
      url: issue.html_url,
      issueNumber: issue.number,
      specification,
    });
  } catch (error) {
    console.error("Error creating feature:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
