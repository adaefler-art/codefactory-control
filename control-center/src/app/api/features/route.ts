import { NextResponse } from "next/server";

type FeatureRequest = {
  title: string;
  briefing: string;
};

export async function POST(req: Request) {
  try {
    const { title, briefing } = (await req.json()) as FeatureRequest;

    if (!title || !briefing) {
      return NextResponse.json(
        { error: "title and briefing are required" },
        { status: 400 }
      );
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const ghToken = process.env.GITHUB_TOKEN;
    const ghOwner = process.env.GITHUB_OWNER;
    const ghRepo = process.env.GITHUB_REPO;

    if (!openaiApiKey || !ghToken || !ghOwner || !ghRepo) {
      console.error("Missing env", {
        hasOpenAI: !!openaiApiKey,
        hasGhToken: !!ghToken,
        ghOwner,
        ghRepo,
      });
      return NextResponse.json(
        { error: "Missing required environment variables" },
        { status: 500 }
      );
    }

    // 1) Spec per LLM generieren
    const specPrompt = `
Du bist AFU-9 – Autonomous Fabrication Unit, Ninefold Architecture.

Projekt: rhythmologicum-connect (Next.js, TypeScript, Supabase, Stress-Funnel).

Erstelle eine präzise technische Spezifikation für folgendes Feature:

---
BRIEFING:
${briefing}
---

Strukturiere die Antwort bitte wie folgt (Markdown):

## Kurzbeschreibung

## Akzeptanzkriterien
- ...

## Technische Hinweise
### Frontend
- ...
### Backend / API
- ...
### Datenbank
- ...

## Risiken / Edge Cases
- ...

Sprache: Deutsch.
`;

    const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", // alternativ: "gpt-4o-mini"
        messages: [{ role: "user", content: specPrompt }],
        temperature: 0.3,
      }),
    });

    if (!llmRes.ok) {
      let errorBody: any;
      try {
        errorBody = await llmRes.json();
      } catch {
        errorBody = await llmRes.text();
      }
      console.error("OpenAI error:", llmRes.status, errorBody);

      return NextResponse.json(
        {
          error:
            "OpenAI-Fehler: " +
            (errorBody?.error?.message ??
              (typeof errorBody === "string"
                ? errorBody
                : JSON.stringify(errorBody))),
        },
        { status: 500 }
      );
    }

    const llmData: any = await llmRes.json();
    const spec: string = llmData.choices?.[0]?.message?.content ?? "";

    if (!spec) {
      console.error("No spec returned from OpenAI", llmData);
      return NextResponse.json(
        { error: "No spec generated from OpenAI" },
        { status: 500 }
      );
    }

    // 2) GitHub-Issue erstellen
    const ghRes = await fetch(
      `https://api.github.com/repos/${ghOwner}/${ghRepo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          "Content-Type": "application/json",
          "User-Agent": "afu-9-control-center",
        },
        body: JSON.stringify({
          title,
          body: spec,
          labels: ["source:afu-9", "codefactory"],
        }),
      }
    );

    if (!ghRes.ok) {
      let ghError: any;
      try {
        ghError = await ghRes.json();
      } catch {
        ghError = await ghRes.text();
      }
      console.error("GitHub error:", ghRes.status, ghError);

      return NextResponse.json(
        {
          error:
            "GitHub-Fehler: " +
            (ghError?.message ??
              (typeof ghError === "string"
                ? ghError
                : JSON.stringify(ghError))),
        },
        { status: 500 }
      );
    }

    const ghData: any = await ghRes.json();

    return NextResponse.json(
      {
        status: "ok",
        issueNumber: ghData.number,
        url: ghData.html_url,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("AFU-9 /api/features error:", err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
