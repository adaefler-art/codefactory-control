/**
 * Tests for Label Normalization Utilities
 * @jest-environment node
 */

import {
  normalizeLabel,
  parseLabelsInput,
  normalizeLabels,
  validateLabels,
  validateAndNormalizeLabelsForHandoff,
  GITHUB_LABEL_MAX_LENGTH,
} from '../../src/lib/label-utils';

describe('Label Normalization Utilities', () => {
  describe('normalizeLabel', () => {
    it('trims whitespace', () => {
      expect(normalizeLabel('  tag  ')).toBe('tag');
      expect(normalizeLabel('\ttag\t')).toBe('tag');
      expect(normalizeLabel('\ntag\n')).toBe('tag');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeLabel('my   label')).toBe('my label');
      expect(normalizeLabel('my  label  name')).toBe('my label name');
    });

    it('returns empty string for invalid input', () => {
      expect(normalizeLabel('   ')).toBe('');
      expect(normalizeLabel('')).toBe('');
    });

    it('handles non-string input', () => {
      expect(normalizeLabel(null as any)).toBe('');
      expect(normalizeLabel(undefined as any)).toBe('');
      expect(normalizeLabel(123 as any)).toBe('');
    });
  });

  describe('parseLabelsInput', () => {
    it('returns array as-is', () => {
      const input = ['tag1', 'tag2'];
      expect(parseLabelsInput(input)).toEqual(input);
    });

    it('parses comma-separated labels', () => {
      expect(parseLabelsInput('tag1, tag2, tag3')).toEqual(['tag1', 'tag2', 'tag3']);
      expect(parseLabelsInput('tag1,tag2,tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('parses newline-separated labels', () => {
      expect(parseLabelsInput('tag1\ntag2\ntag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('handles mixed separators', () => {
      expect(parseLabelsInput('tag1, tag2\ntag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('preserves multi-word labels when comma-separated', () => {
      expect(parseLabelsInput('bug report, feature request')).toEqual(['bug report', 'feature request']);
    });

    it('returns empty array for invalid input', () => {
      expect(parseLabelsInput(null as any)).toEqual([]);
      expect(parseLabelsInput(undefined as any)).toEqual([]);
      expect(parseLabelsInput(123 as any)).toEqual([]);
    });

    it('filters out empty strings', () => {
      expect(parseLabelsInput('tag1,,tag2')).toEqual(['tag1', 'tag2']);
      expect(parseLabelsInput('tag1\n\ntag2')).toEqual(['tag1', 'tag2']);
    });
  });

  describe('normalizeLabels', () => {
    it('normalizes comma-separated input', () => {
      expect(normalizeLabels('tag1, tag2, tag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('removes duplicates', () => {
      expect(normalizeLabels('tag1, tag2, tag1')).toEqual(['tag1', 'tag2']);
      expect(normalizeLabels(['tag1', 'tag2', 'tag1'])).toEqual(['tag1', 'tag2']);
    });

    it('removes empty labels', () => {
      expect(normalizeLabels(['tag1', '', 'tag2', '   '])).toEqual(['tag1', 'tag2']);
      expect(normalizeLabels('tag1, , tag2')).toEqual(['tag1', 'tag2']);
    });

    it('trims whitespace from each label', () => {
      expect(normalizeLabels(['  tag1  ', '  tag2  '])).toEqual(['tag1', 'tag2']);
    });

    it('handles newline-separated input', () => {
      expect(normalizeLabels('tag1\ntag2\ntag3')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('handles already normalized array', () => {
      expect(normalizeLabels(['tag1', 'tag2'])).toEqual(['tag1', 'tag2']);
    });

    it('handles the issue scenario: "tag, tag2"', () => {
      expect(normalizeLabels('tag, tag2')).toEqual(['tag', 'tag2']);
    });
  });

  describe('validateLabels', () => {
    it('validates labels within length limit', () => {
      const result = validateLabels(['tag1', 'tag2']);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.normalizedLabels).toEqual(['tag1', 'tag2']);
    });

    it('rejects labels exceeding max length', () => {
      const longLabel = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH + 1);
      const result = validateLabels([longLabel]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].label).toBe(longLabel);
      expect(result.errors[0].reason).toContain('exceeds maximum length');
      expect(result.normalizedLabels).toEqual([]);
    });

    it('normalizes before validating', () => {
      const result = validateLabels(['  tag1  ', 'tag2', '  tag1  ']);
      expect(result.valid).toBe(true);
      expect(result.normalizedLabels).toEqual(['tag1', 'tag2']);
    });

    it('accepts label at exactly max length', () => {
      const maxLabel = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH);
      const result = validateLabels([maxLabel]);
      expect(result.valid).toBe(true);
      expect(result.normalizedLabels).toEqual([maxLabel]);
    });

    it('reports multiple errors', () => {
      const long1 = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH + 1);
      const long2 = 'b'.repeat(GITHUB_LABEL_MAX_LENGTH + 5);
      const result = validateLabels([long1, long2]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('validateAndNormalizeLabelsForHandoff', () => {
    it('returns normalized labels for valid input', () => {
      expect(validateAndNormalizeLabelsForHandoff(['tag1', 'tag2'])).toEqual(['tag1', 'tag2']);
      expect(validateAndNormalizeLabelsForHandoff('tag1, tag2')).toEqual(['tag1', 'tag2']);
    });

    it('throws error for invalid labels', () => {
      const longLabel = 'a'.repeat(GITHUB_LABEL_MAX_LENGTH + 1);
      expect(() => {
        validateAndNormalizeLabelsForHandoff([longLabel]);
      }).toThrow('Invalid labels for GitHub handoff');
    });

    it('normalizes comma-separated input', () => {
      expect(validateAndNormalizeLabelsForHandoff('tag, tag2')).toEqual(['tag', 'tag2']);
    });

    it('removes duplicates and empty strings', () => {
      expect(validateAndNormalizeLabelsForHandoff(['tag1', '', 'tag2', 'tag1'])).toEqual(['tag1', 'tag2']);
    });
  });

  describe('Real-world scenarios', () => {
    it('handles user input: "bug, feature"', () => {
      const result = normalizeLabels('bug, feature');
      expect(result).toEqual(['bug', 'feature']);
    });

    it('handles user input with extra spaces: "bug,  feature,  documentation"', () => {
      const result = normalizeLabels('bug,  feature,  documentation');
      expect(result).toEqual(['bug', 'feature', 'documentation']);
    });

    it('handles multiline input', () => {
      const result = normalizeLabels('bug\nfeature\ndocumentation');
      expect(result).toEqual(['bug', 'feature', 'documentation']);
    });

    it('handles mixed input with duplicates', () => {
      const result = normalizeLabels('bug, feature\nbug, documentation');
      expect(result).toEqual(['bug', 'feature', 'documentation']);
    });

    it('validates and normalizes for handoff', () => {
      const result = validateAndNormalizeLabelsForHandoff('bug, feature, P1');
      expect(result).toEqual(['bug', 'feature', 'P1']);
    });
  });
});
