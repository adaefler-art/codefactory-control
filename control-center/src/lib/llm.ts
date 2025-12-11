import OpenAI from "openai";

// Environment variables for LLM configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Generates a technical specification for a feature based on a briefing.
 * This function encapsulates all LLM calls to allow easy swapping between
 * OpenAI and other providers (e.g., AWS Bedrock) in the future.
 * 
 * @param briefing - The feature briefing text
 * @returns A promise that resolves to the technical specification as a string
 * @throws Error if OPENAI_API_KEY is not configured
 */
export async function generateFeatureSpec(briefing: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

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
    model: OPENAI_MODEL,
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

  return specification;
}
