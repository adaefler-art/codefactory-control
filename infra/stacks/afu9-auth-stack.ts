import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * AFU-9 Authentication Stack
 * 
 * Provides Cognito User Pool for Control Center authentication:
 * - User Pool with username/password authentication
 * - App Client for authentication flows
 * - Outputs for Control Center configuration
 * 
 * Security considerations:
 * - No MFA or password reset flows (per requirements)
 * - Groups for environment-based access control:
 *   - afu9-admin-prod -> prod environment access
 *   - afu9-engineer-stage -> stage environment access
 *   - afu9-readonly-stage -> stage environment access (read-only)
 */

export interface Afu9AuthStackProps extends cdk.StackProps {
  /**
   * Optional: Custom domain prefix for Cognito hosted UI
   * If not provided, no domain will be created (per requirements)
   */
  readonly domainPrefix?: string;
}

export class Afu9AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain?: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: Afu9AuthStackProps) {
    super(scope, id, props);

    // ========================================
    // Cognito User Pool
    // ========================================
    this.userPool = new cognito.UserPool(this, 'Afu9UserPool', {
      userPoolName: 'afu9-control-center',
      // Sign-in configuration
      signInAliases: {
        username: true,
        email: false,
      },
      // Minimal password policy
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      // Account recovery: disabled per requirements (no password reset flows)
      accountRecovery: cognito.AccountRecovery.NONE,
      // MFA: disabled per requirements
      mfa: cognito.Mfa.OFF,
      // Self-service sign-up: disabled (admin creates users)
      selfSignUpEnabled: false,
      // Standard attributes
      standardAttributes: {
        email: {
          required: false,
          mutable: true,
        },
      },
      // Remove user after 1 day if not confirmed (admin must confirm)
      userVerification: {
        emailSubject: 'AFU-9 Control Center - Verify your account',
        emailBody: 'Your verification code is {####}',
      },
      // Removal policy: retain for production safety
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ========================================
    // App Client
    // ========================================
    this.userPoolClient = new cognito.UserPoolClient(this, 'Afu9UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'afu9-control-center-client',
      // Enable USER_PASSWORD_AUTH flow for API-based login
      authFlows: {
        userPassword: true,
        userSrp: false, // Disable SRP (not needed for our use case)
        adminUserPassword: false,
        custom: false,
      },
      // Token validity periods
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      // Prevent client secret generation (not needed for public clients)
      generateSecret: false,
    });

    // ========================================
    // Optional: Cognito Domain
    // ========================================
    // Only create domain if domainPrefix is provided
    if (props?.domainPrefix) {
      this.userPoolDomain = new cognito.UserPoolDomain(this, 'Afu9UserPoolDomain', {
        userPool: this.userPool,
        cognitoDomain: {
          domainPrefix: props.domainPrefix,
        },
      });
    }

    // ========================================
    // CloudFormation Outputs
    // ========================================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID for AFU-9 Control Center',
      exportName: 'Afu9UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID for AFU-9 Control Center',
      exportName: 'Afu9UserPoolClientId',
    });

    // Construct Issuer URL from region and user pool ID
    // Format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
    const issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    new cdk.CfnOutput(this, 'IssuerUrl', {
      value: issuerUrl,
      description: 'Cognito Issuer URL for JWT verification',
      exportName: 'Afu9IssuerUrl',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region for Cognito User Pool',
      exportName: 'Afu9CognitoRegion',
    });

    // Output domain URL if created
    if (this.userPoolDomain) {
      new cdk.CfnOutput(this, 'DomainUrl', {
        value: this.userPoolDomain.domainName,
        description: 'Cognito Domain for hosted UI (if needed)',
        exportName: 'Afu9CognitoDomain',
      });
    }
  }
}
