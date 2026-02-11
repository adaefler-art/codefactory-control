/**
 * Clinical Intake Validator
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 * 
 * Provides deterministic validation of clinical intake with standardized
 * error format and rule codes for guardrails.
 * 
 * NON-NEGOTIABLES:
 * - Every rule has a code (R-XXX format)
 * - Deterministic validation output with stable error ordering
 * - No network calls (pure validation)
 * - No secrets in error messages
 */

import { createHash } from 'crypto';
import {
  ClinicalIntake,
  ClinicalIntakeSchema,
  validateClinicalIntake,
  normalizeClinicalIntake,
  canonicalizeClinicalIntakeToJSON,
  CLINICAL_INTAKE_SCHEMA_VERSION,
} from '../schemas/clinicalIntake';

/**
 * Validator version - increment on breaking changes
 */
export const VALIDATOR_VERSION = '1.0.0';

/**
 * Error severity levels
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * Standard validation error format
 */
export interface ValidationError {
  code: string;
  message: string;
  path: string;
  severity: ValidationSeverity;
  details?: Record<string, unknown>;
}

/**
 * Validation result metadata
 */
export interface ValidationMeta {
  schemaVersion: string;
  validatedAt: string;
  validatorVersion: string;
  hash?: string;
}

/**
 * Complete validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  meta: ValidationMeta;
}

/**
 * Validation rule codes
 * 
 * Format: R-XXX where XXX is a 3-digit number
 * Categories:
 * - R-001 to R-099: Schema validation
 * - R-100 to R-199: Content quality (clinical summary)
 * - R-200 to R-299: Structural integrity
 * - R-300 to R-399: Security/safety
 */
export const RULE_CODES = {
  // Schema validation (R-001 to R-099)
  SCHEMA_INVALID: 'R-001',
  MISSING_REQUIRED_FIELD: 'R-002',
  INVALID_FIELD_TYPE: 'R-003',
  FIELD_TOO_LONG: 'R-004',
  INVALID_ENUM_VALUE: 'R-005',
  
  // Content quality (R-100 to R-199)
  SUMMARY_CONTAINS_CHAT_LANGUAGE: 'R-100',
  SUMMARY_TOO_SHORT: 'R-101',
  SUMMARY_MISSING_KEY_INFO: 'R-102',
  SUMMARY_HAS_COLLOQUIALISMS: 'R-103',
  SUMMARY_NOT_MEDICAL_LANGUAGE: 'R-104',
  SUMMARY_CHRONOLOGICAL_REPLAY: 'R-105',
  SUMMARY_INCOMPLETE_SENTENCES: 'R-106',
  
  // Structural integrity (R-200 to R-299)
  MISSING_CHIEF_COMPLAINT_IN_DRAFT: 'R-200',
  INCONSISTENT_STATUS: 'R-201',
  INVALID_VERSION_CHAIN: 'R-202',
  MISSING_UPDATE_MESSAGES: 'R-203',
  
  // Security/safety (R-300 to R-399)
  CONTAINS_IDENTIFIABLE_INFO: 'R-300',
  UNSAFE_CONTENT: 'R-301',
  MISSING_RED_FLAG_DOCUMENTATION: 'R-302',
} as const;

/**
 * Patterns that indicate chat-like language (violates R-100)
 */
const CHAT_LANGUAGE_PATTERNS = [
  /\bpatient says\b/i,
  /\bpatient mentioned\b/i,
  /\bpatient told me\b/i,
  /\bthe conversation\b/i,
  /\bin the chat\b/i,
  /\bwe discussed\b/i,
  /\bI asked\b/i,
  /\bthey said\b/i,
];

/**
 * Colloquial terms that should be avoided (violates R-103)
 */
const COLLOQUIAL_PATTERNS = [
  /\bkinda\b/i,
  /\bsorta\b/i,
  /\bgonna\b/i,
  /\bwanna\b/i,
  /\byeah\b/i,
  /\bnah\b/i,
  /\bokay\b/i,
  /\bok\b/i,
];

/**
 * Temporal markers that suggest chronological replay (violates R-105)
 */
const CHRONOLOGICAL_MARKERS = [
  /\bfirst\b.*\bthen\b/i,
  /\binitially\b.*\blater\b/i,
  /\bstarted by saying\b/i,
  /\bin the beginning\b/i,
  /\bat first\b.*\bafter that\b/i,
];

/**
 * Check if clinical summary violates content quality rules
 */
function validateClinicalSummaryQuality(summary: string): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // R-100: Check for chat language
  for (const pattern of CHAT_LANGUAGE_PATTERNS) {
    if (pattern.test(summary)) {
      errors.push({
        code: RULE_CODES.SUMMARY_CONTAINS_CHAT_LANGUAGE,
        message: `Clinical summary contains chat-like language. Use medical terminology instead of conversational references. Pattern: ${pattern.source}`,
        path: '/clinical_summary',
        severity: 'error',
      });
      break; // Only report once
    }
  }
  
  // R-101: Check minimum length (should be substantive)
  if (summary.trim().length < 50) {
    errors.push({
      code: RULE_CODES.SUMMARY_TOO_SHORT,
      message: 'Clinical summary is too brief. Should provide substantive clinical information.',
      path: '/clinical_summary',
      severity: 'error',
      details: { length: summary.trim().length, minimum: 50 },
    });
  }
  
  // R-103: Check for colloquialisms
  for (const pattern of COLLOQUIAL_PATTERNS) {
    if (pattern.test(summary)) {
      errors.push({
        code: RULE_CODES.SUMMARY_HAS_COLLOQUIALISMS,
        message: `Clinical summary contains colloquial language. Use formal medical terminology. Pattern: ${pattern.source}`,
        path: '/clinical_summary',
        severity: 'error',
      });
      break;
    }
  }
  
  // R-105: Check for chronological replay
  for (const pattern of CHRONOLOGICAL_MARKERS) {
    if (pattern.test(summary)) {
      errors.push({
        code: RULE_CODES.SUMMARY_CHRONOLOGICAL_REPLAY,
        message: 'Clinical summary appears to replay conversation chronologically. Synthesize information instead.',
        path: '/clinical_summary',
        severity: 'warning',
        details: { pattern: pattern.source },
      });
      break;
    }
  }
  
  // R-106: Check for incomplete sentences (common in rushed summaries)
  const sentences = summary.split(/[.!?]+/).filter(s => s.trim());
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length > 0 && words.length < 3) {
      errors.push({
        code: RULE_CODES.SUMMARY_INCOMPLETE_SENTENCES,
        message: 'Clinical summary contains very short sentence fragments. Use complete medical sentences.',
        path: '/clinical_summary',
        severity: 'warning',
        details: { fragment: sentence.trim().substring(0, 50) },
      });
      break;
    }
  }
  
  return errors;
}

/**
 * Check structural integrity rules
 */
function validateStructuralIntegrity(intake: ClinicalIntake): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // R-200: Draft status should have some content
  if (intake.structured_intake.status === 'draft') {
    if (!intake.structured_intake.chief_complaint?.trim()) {
      errors.push({
        code: RULE_CODES.MISSING_CHIEF_COMPLAINT_IN_DRAFT,
        message: 'Draft intake should have at least a chief complaint.',
        path: '/structured_intake/chief_complaint',
        severity: 'warning',
      });
    }
  }
  
  // R-201: Inconsistent status
  if (intake.structured_intake.status === 'superseded' && !intake.previous_version_id) {
    errors.push({
      code: RULE_CODES.INCONSISTENT_STATUS,
      message: 'Superseded intake must reference the previous version.',
      path: '/previous_version_id',
      severity: 'error',
    });
  }
  
  // R-203: Active or archived intakes should have message references
  if (['active', 'archived'].includes(intake.structured_intake.status)) {
    if (intake.structured_intake.last_updated_from_messages.length === 0) {
      errors.push({
        code: RULE_CODES.MISSING_UPDATE_MESSAGES,
        message: 'Active/archived intake should track source messages.',
        path: '/structured_intake/last_updated_from_messages',
        severity: 'warning',
      });
    }
  }
  
  return errors;
}

/**
 * Check security/safety rules
 */
function validateSecuritySafety(intake: ClinicalIntake): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // R-300: Check for potentially identifiable information in summary
  // Note: This is a basic check. Production would need more sophisticated PII detection
  const piiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN pattern
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b.*\b(Street|Avenue|Road|Drive)\b/i, // Address-like
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone number
  ];
  
  for (const pattern of piiPatterns) {
    if (pattern.test(intake.clinical_summary)) {
      errors.push({
        code: RULE_CODES.CONTAINS_IDENTIFIABLE_INFO,
        message: 'Clinical summary may contain identifiable information. Ensure proper de-identification.',
        path: '/clinical_summary',
        severity: 'error',
      });
      break;
    }
  }
  
  // R-302: High-severity red flags should be documented in summary
  const highRedFlags = intake.structured_intake.red_flags?.filter(f => f.severity === 'high') || [];
  if (highRedFlags.length > 0) {
    const summaryLower = intake.clinical_summary.toLowerCase();
    const hasRedFlagMention = summaryLower.includes('red flag') || 
                              summaryLower.includes('urgent') ||
                              summaryLower.includes('warning sign');
    
    if (!hasRedFlagMention) {
      errors.push({
        code: RULE_CODES.MISSING_RED_FLAG_DOCUMENTATION,
        message: 'High-severity red flags present but not explicitly mentioned in clinical summary.',
        path: '/clinical_summary',
        severity: 'warning',
        details: { redFlagCount: highRedFlags.length },
      });
    }
  }
  
  return errors;
}

/**
 * Validate a clinical intake with all rules
 * 
 * Returns deterministic validation result with errors sorted by:
 * 1. Severity (errors before warnings)
 * 2. Rule code (alphabetically)
 * 3. Path (alphabetically)
 */
export function validateClinicalIntakeWithRules(data: unknown): ValidationResult {
  const now = new Date().toISOString();
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  
  // Step 1: Schema validation
  const schemaResult = validateClinicalIntake(data);
  
  if (!schemaResult.success) {
    // Convert Zod errors to our format
    for (const issue of schemaResult.error.issues) {
      errors.push({
        code: RULE_CODES.SCHEMA_INVALID,
        message: issue.message,
        path: '/' + issue.path.join('/'),
        severity: 'error',
        details: { zodCode: issue.code },
      });
    }
    
    // Return early if schema is invalid
    return {
      isValid: false,
      errors: sortValidationErrors(errors),
      warnings: [],
      meta: {
        schemaVersion: CLINICAL_INTAKE_SCHEMA_VERSION,
        validatedAt: now,
        validatorVersion: VALIDATOR_VERSION,
      },
    };
  }
  
  const intake = schemaResult.data;
  
  // Step 2: Content quality validation
  const qualityErrors = validateClinicalSummaryQuality(intake.clinical_summary);
  for (const error of qualityErrors) {
    if (error.severity === 'error') {
      errors.push(error);
    } else {
      warnings.push(error);
    }
  }
  
  // Step 3: Structural integrity validation
  const structuralErrors = validateStructuralIntegrity(intake);
  for (const error of structuralErrors) {
    if (error.severity === 'error') {
      errors.push(error);
    } else {
      warnings.push(error);
    }
  }
  
  // Step 4: Security/safety validation
  const securityErrors = validateSecuritySafety(intake);
  for (const error of securityErrors) {
    if (error.severity === 'error') {
      errors.push(error);
    } else {
      warnings.push(error);
    }
  }
  
  // Step 5: Calculate hash of normalized intake
  const normalized = normalizeClinicalIntake(intake);
  const canonical = canonicalizeClinicalIntakeToJSON(normalized);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  
  return {
    isValid: errors.length === 0,
    errors: sortValidationErrors(errors),
    warnings: sortValidationErrors(warnings),
    meta: {
      schemaVersion: intake.structured_intake.schema_version || CLINICAL_INTAKE_SCHEMA_VERSION,
      validatedAt: now,
      validatorVersion: VALIDATOR_VERSION,
      hash,
    },
  };
}

/**
 * Sort validation errors deterministically
 */
function sortValidationErrors(errors: ValidationError[]): ValidationError[] {
  return errors.sort((a, b) => {
    // First by severity
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1;
    }
    // Then by code
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    // Then by path
    return a.path.localeCompare(b.path);
  });
}

/**
 * Get human-readable description of a rule code
 */
export function getRuleDescription(code: string): string {
  const descriptions: Record<string, string> = {
    'R-001': 'Schema validation failed',
    'R-002': 'Required field is missing',
    'R-003': 'Field has invalid type',
    'R-004': 'Field exceeds maximum length',
    'R-005': 'Invalid enum value',
    'R-100': 'Clinical summary contains chat-like language',
    'R-101': 'Clinical summary is too short',
    'R-102': 'Clinical summary missing key information',
    'R-103': 'Clinical summary has colloquialisms',
    'R-104': 'Clinical summary lacks medical terminology',
    'R-105': 'Clinical summary replays conversation chronologically',
    'R-106': 'Clinical summary has incomplete sentences',
    'R-200': 'Draft intake missing chief complaint',
    'R-201': 'Intake status is inconsistent with data',
    'R-202': 'Invalid version chain',
    'R-203': 'Missing source message references',
    'R-300': 'Contains potentially identifiable information',
    'R-301': 'Contains unsafe content',
    'R-302': 'High-severity red flags not documented in summary',
  };
  
  return descriptions[code] || 'Unknown rule';
}
