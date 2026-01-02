/**
 * Tests for Deploy Context Guardrail (E7.0.1)
 */

import { resolveDeployContext, DeployContext, normalizeEnvironment } from '../deploy-context-resolver';
import {
  validateProdArtifacts,
  validateStageArtifacts,
  extractArtifactRefs,
} from '../deploy-context-guardrail';

describe('Deploy Context Resolver', () => {
  const originalEnv = process.env.DEPLOY_ENV;

  afterEach(() => {
    process.env.DEPLOY_ENV = originalEnv;
  });

  it('should fail when DEPLOY_ENV is not set (fail-closed)', () => {
    delete process.env.DEPLOY_ENV;
    expect(() => resolveDeployContext()).toThrow('DEPLOY_ENV is required');
  });

  it('should fail when DEPLOY_ENV is invalid', () => {
    expect(() => resolveDeployContext('development')).toThrow('Invalid DEPLOY_ENV');
    expect(() => resolveDeployContext('test')).toThrow('Invalid DEPLOY_ENV');
  });

  it('should accept and normalize "production" alias', () => {
    const context = resolveDeployContext('production');
    expect(context.environment).toBe('production');
  });

  it('should accept and normalize "prod" alias', () => {
    const context = resolveDeployContext('prod');
    expect(context.environment).toBe('production');
    expect(context.service).toBe('afu9-control-center');
  });

  it('should accept and normalize "staging" alias', () => {
    const context = resolveDeployContext('staging');
    expect(context.environment).toBe('staging');
  });

  it('should accept and normalize "stage" alias', () => {
    const context = resolveDeployContext('stage');
    expect(context.environment).toBe('staging');
    expect(context.service).toBe('afu9-control-center-staging');
  });

  it('should normalize environment case-insensitively', () => {
    expect(resolveDeployContext('PRODUCTION').environment).toBe('production');
    expect(resolveDeployContext('Prod').environment).toBe('production');
    expect(resolveDeployContext('STAGING').environment).toBe('staging');
    expect(resolveDeployContext('Stage').environment).toBe('staging');
  });

  it('should resolve production context correctly', () => {
    const context = resolveDeployContext('production');
    expect(context.environment).toBe('production');
    expect(context.cluster).toBe('afu9-cluster');
    expect(context.service).toBe('afu9-control-center');
    expect(context.imageTagPrefix).toBe('prod');
    expect(context.secretsPrefix).toBe('afu9');
    expect(context.readyHost).toBe('afu-9.com');
  });

  it('should resolve staging context correctly', () => {
    const context = resolveDeployContext('staging');
    expect(context.environment).toBe('staging');
    expect(context.service).toBe('afu9-control-center-staging');
    expect(context.imageTagPrefix).toBe('stage');
    expect(context.secretsPrefix).toBe('afu9/stage');
    expect(context.readyHost).toBe('stage.afu-9.com');
  });

  it('should use STAGING_ECS_CLUSTER env var for staging cluster if set', () => {
    process.env.STAGING_ECS_CLUSTER = 'custom-staging-cluster';
    const context = resolveDeployContext('staging');
    expect(context.cluster).toBe('custom-staging-cluster');
    delete process.env.STAGING_ECS_CLUSTER;
  });
});

describe('Production Deploy Validation', () => {
  const prodContext: DeployContext = {
    environment: 'production',
    cluster: 'afu9-cluster',
    service: 'afu9-control-center',
    imageTagPrefix: 'prod',
    secretsPrefix: 'afu9',
    readyHost: 'afu-9.com',
  };

  it('should detect stage secret ARN in prod deploy', () => {
    const artifacts = {
      secretArns: ['arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123'],
      secretNames: [],
      imageRefs: [],
      serviceNames: [],
      envVars: {},
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('stage reference');
  });

  it('should detect stage image tag in prod deploy', () => {
    const artifacts = {
      secretArns: [],
      secretNames: [],
      imageRefs: ['123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123'],
      serviceNames: [],
      envVars: {},
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('stage tag');
  });

  it('should detect staging service name in prod deploy', () => {
    const artifacts = {
      secretArns: [],
      secretNames: [],
      imageRefs: [],
      serviceNames: ['afu9-control-center-staging'],
      envVars: {},
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('staging');
  });

  it('should detect CREATE_STAGING_SERVICE=true in prod deploy', () => {
    const artifacts = {
      secretArns: [],
      secretNames: [],
      imageRefs: [],
      serviceNames: [],
      envVars: { CREATE_STAGING_SERVICE: 'true' },
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('CREATE_STAGING_SERVICE');
  });

  it('should NOT flag false positives like "product" or "production"', () => {
    const artifacts = {
      secretArns: ['arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/product-catalog'],
      secretNames: ['production-database'], // This is OK - it's the word "production"
      imageRefs: ['123456789.dkr.ecr.eu-central-1.amazonaws.com/products:prod-abc123'],
      serviceNames: ['product-service'],
      envVars: { PRODUCT_MODE: 'production' },
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    // Should have no violations - these are not stage artifacts
    expect(violations).toEqual([]);
  });

  it('should pass when prod uses only prod artifacts', () => {
    const artifacts = {
      secretArns: ['arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123'],
      secretNames: ['afu9/database'],
      imageRefs: ['123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123'],
      serviceNames: ['afu9-control-center'],
      envVars: { CREATE_STAGING_SERVICE: 'false' },
    };
    const violations = validateProdArtifacts(prodContext, artifacts);
    expect(violations).toEqual([]);
  });
});

describe('Staging Deploy Validation', () => {
  const stageContext: DeployContext = {
    environment: 'staging',
    cluster: 'afu9-cluster',
    service: 'afu9-control-center-staging',
    imageTagPrefix: 'stage',
    secretsPrefix: 'afu9/stage',
    readyHost: 'stage.afu-9.com',
  };

  it('should detect prod service name in stage deploy', () => {
    const artifacts = {
      secretArns: [],
      secretNames: [],
      imageRefs: [],
      serviceNames: ['afu9-control-center'], // Missing "staging"
      envVars: {},
    };
    const violations = validateStageArtifacts(stageContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('should include "staging"');
  });

  it('should detect prod image tag in stage deploy', () => {
    const artifacts = {
      secretArns: [],
      secretNames: [],
      imageRefs: ['123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123'],
      serviceNames: [],
      envVars: {},
    };
    const violations = validateStageArtifacts(stageContext, artifacts);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('prod tag');
  });

  it('should pass when staging uses stage artifacts', () => {
    const artifacts = {
      secretArns: ['arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123'],
      secretNames: ['afu9/stage/smoke-key'],
      imageRefs: ['123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123'],
      serviceNames: ['afu9-control-center-staging'],
      envVars: { CREATE_STAGING_SERVICE: 'true' },
    };
    const violations = validateStageArtifacts(stageContext, artifacts);
    expect(violations).toEqual([]);
  });
});

describe('Artifact Extraction', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should extract secret ARNs from environment', () => {
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123';
    process.env.SMOKE_KEY_SECRET_ARN = 'arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-xyz';
    
    const artifacts = extractArtifactRefs();
    expect(artifacts.secretArns).toContain('arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123');
    expect(artifacts.secretArns).toContain('arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-xyz');
  });

  it('should extract service names from environment', () => {
    process.env.ECS_SERVICE = 'afu9-control-center-staging';
    
    const artifacts = extractArtifactRefs();
    expect(artifacts.serviceNames).toContain('afu9-control-center-staging');
  });

  it('should extract AFU9 env vars', () => {
    process.env.AFU9_ENABLE_HTTPS = 'true';
    process.env.CREATE_STAGING_SERVICE = 'false';
    
    const artifacts = extractArtifactRefs();
    expect(artifacts.envVars.AFU9_ENABLE_HTTPS).toBe('true');
    expect(artifacts.envVars.CREATE_STAGING_SERVICE).toBe('false');
  });
});
