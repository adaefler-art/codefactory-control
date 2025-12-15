import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

/**
 * AFU-9 DNS and Certificate Stack
 *
 * Manages DNS and TLS certificates for AFU-9:
 * - Optional Route53 hosted zone (can use existing)
 * - ACM certificate with DNS validation
 * - Exports certificate ARN for ALB usage
 *
 * IMPORTANT:
 * - There is NO default domain.
 * - A domainName MUST be provided explicitly via props or CDK context.
 *
 * Supported CDK context keys:
 * - domainName
 * - afu9-domain
 *
 * Example:
 *   npx cdk deploy Afu9DnsStack \
 *     -c enableDns=true \
 *     -c domainName=afu-9.com
 */
export interface Afu9DnsStackProps extends cdk.StackProps {
  /**
   * Fully qualified domain name for AFU-9 Control Center
   * Example: afu-9.com or control.afu-9.com
   */
  domainName?: string;

  /**
   * Optional: Use an existing Route53 hosted zone
   */
  hostedZoneId?: string;

  /**
   * Optional: Name of the existing hosted zone
   * Required if hostedZoneId is provided
   */
  hostedZoneName?: string;
}

export class Afu9DnsStack extends cdk.Stack {
  public readonly certificate: acm.Certificate;
  public readonly hostedZone: route53.IHostedZone;
  public readonly domainName: string;

  constructor(scope: Construct, id: string, props?: Afu9DnsStackProps) {
    super(scope, id, props);

    // ------------------------------------------------------------
    // Resolve domain name (NO DEFAULTS)
    // ------------------------------------------------------------
    this.domainName =
      props?.domainName ??
      this.node.tryGetContext('domainName') ??
      this.node.tryGetContext('afu9-domain');

    if (!this.domainName) {
      throw new Error(
        'Afu9DnsStack: DNS is enabled but no domainName provided. ' +
          'Provide it via props or CDK context: -c domainName=your-domain.com'
      );
    }

    // ------------------------------------------------------------
    // Hosted Zone Resolution
    // ------------------------------------------------------------
    const hostedZoneId =
      props?.hostedZoneId ??
      this.node.tryGetContext('afu9-hosted-zone-id');

    const hostedZoneName =
      props?.hostedZoneName ??
      this.node.tryGetContext('afu9-hosted-zone-name');

    if (hostedZoneId && hostedZoneName) {
      // Use existing hosted zone
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'HostedZone',
        {
          hostedZoneId,
          zoneName: hostedZoneName,
        }
      );
    } else {
      // Create new hosted zone from domain name
      const zoneName = this.extractZoneName(this.domainName);

      this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName,
        comment: `Hosted zone for AFU-9 (${this.domainName})`,
      });

      cdk.Tags.of(this.hostedZone).add(
        'Name',
        `afu9-hosted-zone-${zoneName}`
      );
      cdk.Tags.of(this.hostedZone).add('Environment', 'production');
      cdk.Tags.of(this.hostedZone).add('Project', 'AFU-9');
    }

    // ------------------------------------------------------------
    // ACM Certificate (with wildcard for subdomains)
    // ------------------------------------------------------------
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: this.domainName,
      subjectAlternativeNames: [
        `*.${this.domainName}`, // Wildcard for stage.afu-9.com, prod.afu-9.com, etc.
      ],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
      certificateName: 'afu9-control-center-cert',
    });

    cdk.Tags.of(this.certificate).add('Name', 'afu9-certificate');
    cdk.Tags.of(this.certificate).add('Environment', 'production');
    cdk.Tags.of(this.certificate).add('Project', 'AFU-9');

    // ------------------------------------------------------------
    // Stack Outputs
    // ------------------------------------------------------------
    new cdk.CfnOutput(this, 'DomainName', {
      value: this.domainName,
      description: 'Domain name for AFU-9 Control Center',
      exportName: 'Afu9DomainName',
    });

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'ARN of the ACM certificate',
      exportName: 'Afu9CertificateArn',
    });

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      description: 'Route53 hosted zone ID',
      exportName: 'Afu9HostedZoneId',
    });

    new cdk.CfnOutput(this, 'HostedZoneNameServers', {
      value: cdk.Fn.join(
        ', ',
        this.hostedZone.hostedZoneNameServers ?? []
      ),
      description:
        'Name servers for the hosted zone (configure these with your registrar)',
      exportName: 'Afu9HostedZoneNameServers',
    });

    new cdk.CfnOutput(this, 'ControlCenterUrl', {
      value: `https://${this.domainName}`,
      description: 'URL of the AFU-9 Control Center',
    });
  }

  /**
   * Extract hosted zone name from a full domain name.
   *
   * Examples:
   * - "control.afu-9.com" -> "afu-9.com"
   * - "afu-9.com" -> "afu-9.com"
   *
   * For multi-part TLDs (e.g. .co.uk), an existing hosted zone
   * must be provided explicitly.
   */
  private extractZoneName(domainName: string): string {
    const parts = domainName.split('.');

    if (parts.length <= 2) {
      return domainName;
    }

    const multiPartTlds = [
      'co.uk',
      'com.au',
      'co.nz',
      'co.za',
      'com.br',
      'co.jp',
      'ac.uk',
      'gov.uk',
      'org.uk',
      'com.mx',
      'com.ar',
      'co.in',
    ];

    const lastTwoParts = parts.slice(-2).join('.');
    if (multiPartTlds.includes(lastTwoParts)) {
      throw new Error(
        `Multi-part TLD detected (.${lastTwoParts}) in domain "${domainName}". ` +
          'Provide hostedZoneId and hostedZoneName explicitly.'
      );
    }

    return lastTwoParts;
  }
}
