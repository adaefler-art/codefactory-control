/**
 * Clinical Intake Schema
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 * 
 * Defines schema for clinical intake records with structured medical data
 * and human-readable clinical summaries.
 * 
 * NON-NEGOTIABLES:
 * - STRUCTURED_INTAKE: Machine-readable, stable, versionable
 * - CLINICAL_SUMMARY: Medically precise, doctor-readable
 * - No chat verbatim, no colloquialisms, no chronological replay
 * - Deterministic validation with rule codes (R-XXX)
 */

import { z } from 'zod';

/**
 * Schema version - increment on breaking changes
 */
export const CLINICAL_INTAKE_SCHEMA_VERSION = '1.0.0';

/**
 * Intake status lifecycle
 */
export const IntakeStatusSchema = z.enum([
  'draft',      // Initial state, being populated
  'active',     // Currently being used for clinical work
  'archived',   // Historical record, no longer active
  'superseded'  // Replaced by newer version
]);

export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;

/**
 * History of Present Illness (HPI) structure
 */
export const HistoryOfPresentIllnessSchema = z.object({
  onset: z.string().max(500).optional().describe('When symptoms started'),
  duration: z.string().max(200).optional().describe('How long symptoms have lasted'),
  course: z.string().max(1000).optional().describe('Progression/pattern of symptoms'),
  associated_symptoms: z.array(z.string().max(200)).default([]).describe('Related symptoms'),
  relieving_factors: z.array(z.string().max(200)).default([]).describe('What makes it better'),
  aggravating_factors: z.array(z.string().max(200)).default([]).describe('What makes it worse'),
});

export type HistoryOfPresentIllness = z.infer<typeof HistoryOfPresentIllnessSchema>;

/**
 * Red flag indicators for urgent medical attention
 */
export const RedFlagSchema = z.object({
  flag: z.string().max(200).describe('The red flag indicator'),
  severity: z.enum(['high', 'medium', 'low']).describe('Urgency level'),
  noted_at: z.string().datetime().optional().describe('When it was identified'),
});

export type RedFlag = z.infer<typeof RedFlagSchema>;

/**
 * Clinical uncertainty that needs clarification
 */
export const UncertaintySchema = z.object({
  topic: z.string().max(200).describe('What is uncertain'),
  reason: z.string().max(500).describe('Why it is uncertain'),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
});

export type Uncertainty = z.infer<typeof UncertaintySchema>;

/**
 * Structured Clinical Intake (machine-readable)
 */
export const StructuredIntakeSchema = z.object({
  status: IntakeStatusSchema.default('draft'),
  chief_complaint: z.string().max(500).optional().describe('Primary reason for visit'),
  history_of_present_illness: HistoryOfPresentIllnessSchema.optional(),
  relevant_negatives: z.array(z.string().max(200)).default([]).describe('Important symptoms ruled out'),
  past_medical_history: z.array(z.string().max(300)).default([]).describe('Previous conditions'),
  medication: z.array(z.string().max(200)).default([]).describe('Current medications'),
  psychosocial_factors: z.array(z.string().max(300)).default([]).describe('Social/psychological context'),
  red_flags: z.array(RedFlagSchema).default([]).describe('Warning signs requiring urgent attention'),
  uncertainties: z.array(UncertaintySchema).default([]).describe('Items needing clarification'),
  last_updated_from_messages: z.array(z.string()).default([]).describe('Message IDs that triggered last update'),
  schema_version: z.string().default(CLINICAL_INTAKE_SCHEMA_VERSION),
});

export type StructuredIntake = z.infer<typeof StructuredIntakeSchema>;

/**
 * Complete Clinical Intake record
 */
export const ClinicalIntakeSchema = z.object({
  id: z.string().uuid().optional().describe('Unique identifier (generated)'),
  session_id: z.string().uuid().describe('Associated conversation session'),
  patient_identifier: z.string().max(100).optional().describe('De-identified patient reference'),
  
  // The two core outputs
  structured_intake: StructuredIntakeSchema.describe('Machine-readable clinical data'),
  clinical_summary: z.string().max(5000).describe('Doctor-readable clinical summary'),
  
  // Metadata
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  created_by: z.string().max(100).optional().describe('User who created the intake'),
  
  // Versioning for updates
  version: z.number().int().positive().default(1).describe('Version number for this intake'),
  previous_version_id: z.string().uuid().optional().describe('ID of previous version if updated'),
});

export type ClinicalIntake = z.infer<typeof ClinicalIntakeSchema>;

/**
 * Input for creating a new clinical intake
 */
export const ClinicalIntakeInputSchema = ClinicalIntakeSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type ClinicalIntakeInput = z.infer<typeof ClinicalIntakeInputSchema>;

/**
 * Database row representation
 */
export interface ClinicalIntakeRow {
  id: string;
  session_id: string;
  patient_identifier: string | null;
  structured_intake: any; // JSONB in Postgres
  clinical_summary: string;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
  previous_version_id: string | null;
}

/**
 * Validate a clinical intake object
 */
export function validateClinicalIntake(data: unknown): { 
  success: true; 
  data: ClinicalIntake;
} | { 
  success: false; 
  error: z.ZodError;
} {
  const result = ClinicalIntakeSchema.safeParse(data);
  
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  return { success: true, data: result.data };
}

/**
 * Normalize a clinical intake (dedup arrays, trim strings, sort)
 */
export function normalizeClinicalIntake(intake: ClinicalIntake): ClinicalIntake {
  const normalized: ClinicalIntake = {
    ...intake,
    clinical_summary: intake.clinical_summary.trim(),
    structured_intake: {
      ...intake.structured_intake,
      chief_complaint: intake.structured_intake.chief_complaint?.trim(),
      relevant_negatives: [...new Set(intake.structured_intake.relevant_negatives)].sort(),
      past_medical_history: [...new Set(intake.structured_intake.past_medical_history)].sort(),
      medication: [...new Set(intake.structured_intake.medication)].sort(),
      psychosocial_factors: [...new Set(intake.structured_intake.psychosocial_factors)].sort(),
    },
  };
  
  return normalized;
}

/**
 * Create a canonical JSON string for hashing/comparison
 */
export function canonicalizeClinicalIntakeToJSON(intake: ClinicalIntake): string {
  const normalized = normalizeClinicalIntake(intake);
  
  // Sort all keys for deterministic output
  const sortObject = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(sortObject);
    }
    if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj)
        .sort()
        .reduce((sorted: any, key) => {
          sorted[key] = sortObject(obj[key]);
          return sorted;
        }, {});
    }
    return obj;
  };
  
  return JSON.stringify(sortObject(normalized));
}
