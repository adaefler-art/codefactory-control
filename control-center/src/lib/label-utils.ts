/**
 * Label Normalization Utilities
 * 
 * Handles normalization and validation of labels/tags for GitHub handoff.
 * Ensures labels meet GitHub requirements before handoff.
 * 
 * GitHub Label Requirements:
 * - Max length: 50 characters
 * - Cannot be empty
 * - Leading/trailing whitespace is trimmed
 */

/**
 * GitHub label name maximum length
 */
export const GITHUB_LABEL_MAX_LENGTH = 50;

/**
 * Validation error for a label
 */
export interface LabelValidationError {
  label: string;
  reason: string;
}

/**
 * Result of label validation
 */
export interface LabelValidationResult {
  valid: boolean;
  errors: LabelValidationError[];
  normalizedLabels: string[];
}

/**
 * Normalizes a single label string
 * - Trims whitespace
 * - Collapses multiple spaces into single space
 * - Returns empty string if invalid
 * 
 * @param label - Raw label string
 * @returns Normalized label or empty string
 */
export function normalizeLabel(label: string): string {
  if (typeof label !== 'string') {
    return '';
  }
  
  // Trim and collapse multiple spaces
  return label
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parses label input that may contain comma-separated, whitespace-separated,
 * or newline-separated labels into an array
 * 
 * Behavior:
 * - If input contains commas: splits by comma (preserves spaces within labels like "bug fix")
 * - If input contains newlines: splits by newline
 * - Otherwise: input is returned as single label
 * 
 * Examples:
 * - "bug, feature" → ["bug", "feature"]
 * - "bug\nfeature" → ["bug", "feature"]
 * - "bug fix" → ["bug fix"] (single multi-word label)
 * - "bug, feature request" → ["bug", "feature request"]
 * 
 * @param input - Raw input string or array
 * @returns Array of raw label strings
 */
export function parseLabelsInput(input: string | string[]): string[] {
  // If already an array, return as-is
  if (Array.isArray(input)) {
    return input;
  }
  
  if (typeof input !== 'string') {
    return [];
  }
  
  // Split by comma or newline, trim each part
  const labels: string[] = [];
  
  // Check if input contains commas or newlines
  const hasComma = input.includes(',');
  const hasNewline = input.includes('\n');
  
  if (hasComma || hasNewline) {
    // Split by both comma and newline
    const parts = input.split(/[,\n]/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        labels.push(trimmed);
      }
    }
  } else {
    // No separators found - treat as single label
    const trimmed = input.trim();
    if (trimmed) {
      labels.push(trimmed);
    }
  }
  
  return labels;
}

/**
 * Normalizes an array of labels
 * - Parses input if it's a string
 * - Trims each label
 * - Removes empty labels
 * - Removes duplicates
 * - Collapses multiple spaces
 * 
 * @param input - Raw labels input (string or array)
 * @returns Array of normalized, unique labels
 */
export function normalizeLabels(input: string | string[]): string[] {
  const parsed = parseLabelsInput(input);
  
  const normalized = parsed
    .map(normalizeLabel)
    .filter(label => label.length > 0);
  
  // Remove duplicates (case-sensitive)
  return Array.from(new Set(normalized));
}

/**
 * Validates labels against GitHub requirements
 * 
 * @param labels - Array of labels to validate
 * @returns Validation result with errors and normalized labels
 */
export function validateLabels(labels: string[]): LabelValidationResult {
  const errors: LabelValidationError[] = [];
  const normalizedLabels = normalizeLabels(labels);
  
  for (const label of normalizedLabels) {
    // Check length
    if (label.length > GITHUB_LABEL_MAX_LENGTH) {
      errors.push({
        label,
        reason: `Label exceeds maximum length of ${GITHUB_LABEL_MAX_LENGTH} characters (current: ${label.length})`,
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    normalizedLabels: errors.length === 0 ? normalizedLabels : [],
  };
}

/**
 * Validates and normalizes labels for GitHub handoff
 * Throws an error if any labels are invalid
 * 
 * @param labels - Raw labels input (string or array)
 * @returns Normalized labels array
 * @throws Error if validation fails with detailed message
 */
export function validateAndNormalizeLabelsForHandoff(labels: string | string[]): string[] {
  // First normalize the input (handles comma-separated strings, etc.)
  const normalized = normalizeLabels(labels);
  
  // Then validate
  const validation = validateLabels(normalized);
  
  if (!validation.valid) {
    const errorMessages = validation.errors
      .map(err => `"${err.label}": ${err.reason}`)
      .join('; ');
    throw new Error(`Invalid labels for GitHub handoff: ${errorMessages}`);
  }
  
  return validation.normalizedLabels;
}
