/**
 * Tests for GitHub Checks Classifier
 * 
 * @jest-environment node
 */

import { classifyCheck, classifyChecks } from '../../src/lib/github/checks-classifier';

describe('GitHub Checks Classifier', () => {
  describe('classifyCheck', () => {
    describe('lint classification', () => {
      it('should classify ESLint checks as lint', () => {
        expect(classifyCheck('ESLint')).toBe('lint');
        expect(classifyCheck('eslint-check')).toBe('lint');
        expect(classifyCheck('Run ESLint')).toBe('lint');
      });

      it('should classify generic lint checks as lint', () => {
        expect(classifyCheck('Lint')).toBe('lint');
        expect(classifyCheck('Code Lint')).toBe('lint');
        expect(classifyCheck('lint-files')).toBe('lint');
      });

      it('should classify style checks as lint', () => {
        expect(classifyCheck('Style Check')).toBe('lint');
        expect(classifyCheck('Code Style')).toBe('lint');
        expect(classifyCheck('Format Check')).toBe('lint');
      });

      it('should classify Prettier as lint', () => {
        expect(classifyCheck('Prettier')).toBe('lint');
        expect(classifyCheck('prettier-check')).toBe('lint');
      });

      it('should classify Python linters as lint', () => {
        expect(classifyCheck('pylint')).toBe('lint');
        expect(classifyCheck('flake8')).toBe('lint');
        expect(classifyCheck('black-check')).toBe('lint');
      });
    });

    describe('test classification', () => {
      it('should classify Jest checks as test', () => {
        expect(classifyCheck('Jest')).toBe('test');
        expect(classifyCheck('jest-test')).toBe('test');
        expect(classifyCheck('Run Jest Tests')).toBe('test');
      });

      it('should classify generic test checks as test', () => {
        expect(classifyCheck('Test')).toBe('test');
        expect(classifyCheck('Unit Tests')).toBe('test');
        expect(classifyCheck('Integration Tests')).toBe('test');
      });

      it('should classify pytest as test', () => {
        expect(classifyCheck('pytest')).toBe('test');
        expect(classifyCheck('Run pytest')).toBe('test');
      });

      it('should classify vitest as test', () => {
        expect(classifyCheck('vitest')).toBe('test');
        expect(classifyCheck('Vitest Tests')).toBe('test');
      });

      it('should classify RSpec as test', () => {
        expect(classifyCheck('rspec')).toBe('test');
        expect(classifyCheck('RSpec Tests')).toBe('test');
      });
    });

    describe('e2e classification', () => {
      it('should classify Cypress checks as e2e', () => {
        expect(classifyCheck('Cypress')).toBe('e2e');
        expect(classifyCheck('cypress-tests')).toBe('e2e');
        expect(classifyCheck('Run Cypress')).toBe('e2e');
      });

      it('should classify Playwright checks as e2e', () => {
        expect(classifyCheck('Playwright')).toBe('e2e');
        expect(classifyCheck('playwright-tests')).toBe('e2e');
      });

      it('should classify e2e keyword as e2e', () => {
        expect(classifyCheck('E2E Tests')).toBe('e2e');
        expect(classifyCheck('e2e')).toBe('e2e');
        expect(classifyCheck('End-to-End Tests')).toBe('e2e');
      });

      it('should classify UI tests as e2e', () => {
        expect(classifyCheck('UI Tests')).toBe('e2e');
        expect(classifyCheck('ui-test')).toBe('e2e');
      });
    });

    describe('build classification', () => {
      it('should classify build checks as build', () => {
        expect(classifyCheck('Build')).toBe('build');
        expect(classifyCheck('npm build')).toBe('build');
        expect(classifyCheck('Run Build')).toBe('build');
      });

      it('should classify compile checks as build', () => {
        expect(classifyCheck('Compile')).toBe('build');
        expect(classifyCheck('TypeScript Compile')).toBe('build');
      });

      it('should classify TypeScript checks as build', () => {
        expect(classifyCheck('tsc')).toBe('build');
        expect(classifyCheck('TypeScript Check')).toBe('build');
      });

      it('should classify webpack as build', () => {
        expect(classifyCheck('webpack')).toBe('build');
        expect(classifyCheck('Webpack Build')).toBe('build');
      });

      it('should classify Maven/Gradle as build', () => {
        expect(classifyCheck('maven')).toBe('build');
        expect(classifyCheck('gradle')).toBe('build');
      });

      it('should classify cargo build as build', () => {
        expect(classifyCheck('cargo build')).toBe('build');
      });

      it('should classify go build as build', () => {
        expect(classifyCheck('go build')).toBe('build');
      });
    });

    describe('deploy classification', () => {
      it('should classify deploy checks as deploy', () => {
        expect(classifyCheck('Deploy')).toBe('deploy');
        expect(classifyCheck('deploy-staging')).toBe('deploy');
      });

      it('should classify release as deploy', () => {
        expect(classifyCheck('Release')).toBe('deploy');
        expect(classifyCheck('Create Release')).toBe('deploy');
      });

      it('should classify publish as deploy', () => {
        expect(classifyCheck('Publish')).toBe('deploy');
        expect(classifyCheck('npm publish')).toBe('deploy');
      });

      it('should classify Vercel/Netlify as deploy', () => {
        expect(classifyCheck('Vercel')).toBe('deploy');
        expect(classifyCheck('Netlify')).toBe('deploy');
      });

      it('should classify cloud deploy as deploy', () => {
        expect(classifyCheck('AWS Deploy')).toBe('deploy');
        expect(classifyCheck('GCP Deploy')).toBe('deploy');
        expect(classifyCheck('Azure Deploy')).toBe('deploy');
      });
    });

    describe('infra classification', () => {
      it('should classify infrastructure checks as infra', () => {
        expect(classifyCheck('Infrastructure')).toBe('infra');
        expect(classifyCheck('infra-check')).toBe('infra');
      });

      it('should classify Terraform as infra', () => {
        expect(classifyCheck('Terraform')).toBe('infra');
        expect(classifyCheck('terraform-plan')).toBe('infra');
      });

      it('should classify CDK as infra', () => {
        expect(classifyCheck('CDK')).toBe('infra');
        expect(classifyCheck('cdk-synth')).toBe('infra');
      });

      it('should classify Docker as infra', () => {
        expect(classifyCheck('Docker')).toBe('infra');
        expect(classifyCheck('docker-build')).toBe('infra');
      });

      it('should classify Kubernetes as infra', () => {
        expect(classifyCheck('Kubernetes')).toBe('infra');
        expect(classifyCheck('k8s')).toBe('infra');
        expect(classifyCheck('Helm')).toBe('infra');
      });
    });

    describe('unknown classification', () => {
      it('should classify unrecognized checks as unknown', () => {
        expect(classifyCheck('Random Check Name')).toBe('unknown');
        expect(classifyCheck('Custom Validation')).toBe('unknown');
        expect(classifyCheck('Weird-Check-123')).toBe('unknown');
      });

      it('should handle empty string as unknown', () => {
        expect(classifyCheck('')).toBe('unknown');
      });
    });

    describe('case insensitivity', () => {
      it('should handle different cases correctly', () => {
        expect(classifyCheck('ESLINT')).toBe('lint');
        expect(classifyCheck('EsLiNt')).toBe('lint');
        expect(classifyCheck('jest')).toBe('test');
        expect(classifyCheck('JEST')).toBe('test');
        expect(classifyCheck('BUILD')).toBe('build');
        expect(classifyCheck('build')).toBe('build');
      });
    });

    describe('pattern priority', () => {
      it('should match first pattern when multiple patterns could match', () => {
        // "lint test" could match both lint and test, but lint comes first
        expect(classifyCheck('lint test')).toBe('lint');
        
        // "test build" should match test first
        expect(classifyCheck('test build')).toBe('test');
      });
    });
  });

  describe('classifyChecks', () => {
    it('should count classifications correctly', () => {
      const checkNames = [
        'ESLint',
        'Jest Tests',
        'Build',
        'Prettier',
        'Unit Tests',
        'Deploy',
      ];

      const counts = classifyChecks(checkNames);

      expect(counts.get('lint')).toBe(2); // ESLint, Prettier
      expect(counts.get('test')).toBe(2); // Jest Tests, Unit Tests
      expect(counts.get('build')).toBe(1); // Build
      expect(counts.get('deploy')).toBe(1); // Deploy
    });

    it('should handle empty array', () => {
      const counts = classifyChecks([]);
      expect(counts.size).toBe(0);
    });

    it('should count unknown classifications', () => {
      const checkNames = ['Unknown Check', 'Another Unknown'];
      const counts = classifyChecks(checkNames);
      expect(counts.get('unknown')).toBe(2);
    });

    it('should handle duplicate check names', () => {
      const checkNames = ['ESLint', 'ESLint', 'ESLint'];
      const counts = classifyChecks(checkNames);
      expect(counts.get('lint')).toBe(3);
    });
  });
});
