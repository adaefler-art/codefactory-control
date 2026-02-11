/**
 * Clinical Intake Synthesis Service
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 * 
 * LLM-based service to synthesize clinical intakes from conversation messages.
 * 
 * NON-NEGOTIABLES:
 * - Temperature=0 for deterministic outputs
 * - Bounded tokens to control cost
 * - No secrets in prompts or responses
 * - Medically precise language in outputs
 * - Clear separation of STRUCTURED_INTAKE and CLINICAL_SUMMARY
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";
import type { IntentMessage } from '../intent-agent';
import type { 
  StructuredIntake, 
  ClinicalIntake,
  ClinicalIntakeInput 
} from '../schemas/clinicalIntake';

// Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Bounding constants
const MAX_OUTPUT_TOKENS = 2000;
const API_TIMEOUT_MS = 60000; // 60 seconds for synthesis

// Singleton OpenAI client
let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client instance
 */
function getOpenAIClient(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: OPENAI_API_KEY,
      timeout: API_TIMEOUT_MS,
    });
  }

  return openaiClient;
}

/**
 * Trigger conditions for intake synthesis
 */
export interface SynthesisTrigger {
  type: 'new_medical_info' | 'clarification' | 'thematic_block_complete' | 'time_based' | 'manual';
  messageIds: string[];
  reason?: string;
}

/**
 * Result of synthesis operation
 */
export interface SynthesisResult {
  success: boolean;
  structuredIntake?: StructuredIntake;
  clinicalSummary?: string;
  error?: string;
  metadata?: {
    triggeredBy: SynthesisTrigger;
    synthesizedAt: string;
    model: string;
  };
}

/**
 * System prompt for clinical intake synthesis
 */
const SYSTEM_PROMPT = `You are a clinical reasoning module operating at primary care level.

Your task is to synthesize a clinical intake from patient conversation messages.

CRITICAL RULES:
1. Do NOT copy raw sentences from the chat
2. Do NOT use colloquial language (no "kinda", "sorta", "okay", etc.)
3. Do NOT replay the conversation chronologically
4. Do NOT use chat references ("patient said", "we discussed", etc.)

WHAT YOU MUST DO:
1. Use medically precise language
2. Make implicit information explicit
3. Resolve contradictions (e.g., "initially stated X, later corrected to Y")
4. Filter for clinical relevance
5. Clearly state what is known, what is ruled out, and what is uncertain

OUTPUT FORMAT:
You must return a JSON object with two parts:

{
  "structured_intake": {
    "status": "draft" | "active",
    "chief_complaint": "...",
    "history_of_present_illness": {
      "onset": "...",
      "duration": "...",
      "course": "...",
      "associated_symptoms": [...],
      "relieving_factors": [...],
      "aggravating_factors": [...]
    },
    "relevant_negatives": [...],
    "past_medical_history": [...],
    "medication": [...],
    "psychosocial_factors": [...],
    "red_flags": [{
      "flag": "...",
      "severity": "high" | "medium" | "low",
      "noted_at": "ISO-8601-timestamp"
    }],
    "uncertainties": [{
      "topic": "...",
      "reason": "...",
      "priority": "high" | "medium" | "low"
    }],
    "last_updated_from_messages": [...]
  },
  "clinical_summary": "A concise, medically-formatted narrative suitable for physician review. Example: '54-year-old male patient. Currently episodic frontal headaches for approximately 2 hours, without neurological accompaniments. No known cardiac history, initial report of arrhythmias later clearly denied by patient. No chronic medications, only supplements (Omega-3, Vitamin D, B12, Magnesium). Psychosocially currently stress-burdened. No indication of acute red flags.'"
}

CLINICAL SUMMARY STYLE:
- Write as if for a doctor who has NOT seen the chat
- Use complete medical sentences (no bullet points)
- Be concise but comprehensive
- Explicitly note contradictions/corrections
- Clearly state uncertainties
- NO chat-like language`;

/**
 * Synthesize clinical intake from conversation messages
 */
export async function synthesizeClinicalIntake(
  messages: IntentMessage[],
  trigger: SynthesisTrigger,
  sessionId: string,
  currentIntake?: ClinicalIntake
): Promise<SynthesisResult> {
  try {
    const client = getOpenAIClient();
    
    // Build context for LLM
    const conversationContext = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    
    const userPrompt = currentIntake 
      ? `Update the following clinical intake based on new conversation messages.

CURRENT INTAKE:
${JSON.stringify(currentIntake.structured_intake, null, 2)}

CURRENT CLINICAL SUMMARY:
${currentIntake.clinical_summary}

NEW MESSAGES:
${conversationContext}

TRIGGER: ${trigger.type}
${trigger.reason ? `REASON: ${trigger.reason}` : ''}

Provide an updated clinical intake in the required JSON format.`
      : `Synthesize a clinical intake from the following patient conversation.

CONVERSATION:
${conversationContext}

TRIGGER: ${trigger.type}
${trigger.reason ? `REASON: ${trigger.reason}` : ''}

Provide a clinical intake in the required JSON format.`;

    // Call OpenAI API
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0, // Deterministic
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" }, // Ensure JSON response
    });

    const responseContent = completion.choices[0]?.message?.content;
    
    if (!responseContent) {
      return {
        success: false,
        error: 'No response from LLM',
      };
    }

    // Parse JSON response
    let parsed: any;
    try {
      parsed = JSON.parse(responseContent);
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse LLM response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      };
    }

    // Extract and validate structure
    if (!parsed.structured_intake || !parsed.clinical_summary) {
      return {
        success: false,
        error: 'LLM response missing required fields (structured_intake or clinical_summary)',
      };
    }

    const structuredIntake: StructuredIntake = {
      ...parsed.structured_intake,
      last_updated_from_messages: trigger.messageIds,
    };

    return {
      success: true,
      structuredIntake,
      clinicalSummary: parsed.clinical_summary,
      metadata: {
        triggeredBy: trigger,
        synthesizedAt: new Date().toISOString(),
        model: OPENAI_MODEL,
      },
    };

  } catch (error) {
    console.error('Error synthesizing clinical intake:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during synthesis',
    };
  }
}

/**
 * Check if messages contain medical information that should trigger synthesis
 */
export function shouldTriggerSynthesis(
  messages: IntentMessage[],
  lastSynthesisMessageIds: string[]
): SynthesisTrigger | null {
  // For MVP: Simple heuristic based on medical keywords
  // Production would use more sophisticated classification
  
  const medicalKeywords = [
    'pain', 'symptom', 'medication', 'diagnosis', 'treatment',
    'doctor', 'hospital', 'surgery', 'condition', 'illness',
    'fever', 'headache', 'nausea', 'fatigue', 'weakness',
    'allergy', 'allergic', 'reaction', 'side effect',
  ];
  
  const recentMessages = messages.slice(-5); // Check last 5 messages
  
  for (const msg of recentMessages) {
    const contentLower = msg.content.toLowerCase();
    
    // Check for medical keywords
    const hasMedicalContent = medicalKeywords.some(keyword => 
      contentLower.includes(keyword)
    );
    
    if (hasMedicalContent) {
      return {
        type: 'new_medical_info',
        messageIds: recentMessages.map((_, idx) => `msg_${messages.length - 5 + idx}`),
        reason: 'Detected new medical information in conversation',
      };
    }
  }
  
  return null;
}

/**
 * Detect clarifications or corrections in messages
 */
export function detectClarification(messages: IntentMessage[]): SynthesisTrigger | null {
  const clarificationPatterns = [
    /actually/i,
    /correction/i,
    /no, I meant/i,
    /to clarify/i,
    /let me correct/i,
    /not.*rather/i,
  ];
  
  const recentMessages = messages.slice(-3);
  
  for (const msg of recentMessages) {
    const hasClarification = clarificationPatterns.some(pattern =>
      pattern.test(msg.content)
    );
    
    if (hasClarification) {
      return {
        type: 'clarification',
        messageIds: recentMessages.map((_, idx) => `msg_${messages.length - 3 + idx}`),
        reason: 'Detected clarification or correction in conversation',
      };
    }
  }
  
  return null;
}
