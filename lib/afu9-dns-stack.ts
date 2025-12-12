import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

/**
 * AFU-9 DNS and Certificate Stack
 * 
 * Manages DNS and TLS certificates for AFU-9 v0.2:
 * - Route53 hosted zone (optional, can use existing)
 * - ACM certificate for the domain with DNS validation
 * - Exports certificate ARN for use by ALB
 * 
 * Domain Configuration:
 * - Default domain: afu9.example.com (must be configured via context)
 * - Supports both apex domains and subdomains
 * - Uses DNS validation for automatic certificate issuance
 * 
 * Usage:
 * Configure the domain via CDK context in cdk.json or command line:
 * 
 *   {
 *     "context": {
 *       "afu9-domain": "afu9.yourdomain.com",
 *       "afu9-hosted-zone-id": "Z1234567890ABC" // Optional, if using existing zone
 *     }
 *   }
 * 
 * Or via command line:
 *   npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com
 */
export interface Afu9DnsStackProps extends cdk.StackProps {
  /**
   * The domain name for AFU-9 Control Center
   * @default 'afu9.example.com'
   */
  domainName?: string;

  /**
   * Optional: Use an existing Route53 hosted zone
   * If not provided, a new hosted zone will be created
   */
  hostedZoneId?: string;

  /**
   * Optional: The name of the existing hosted zone
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

    // Get domain name from props, context, or use default
    this.domainName = props?.domainName || 
                      this.node.tryGetContext('afu9-domain') || 
                      'afu9.example.com';

    // Check for existing hosted zone configuration
    const hostedZoneId = props?.hostedZoneId || this.node.tryGetContext('afu9-hosted-zone-id');
    const hostedZoneName = props?.hostedZoneName || this.node.tryGetContext('afu9-hosted-zone-name');

    // ========================================
    // Route53 Hosted Zone
    // ========================================

    if (hostedZoneId && hostedZoneName) {
      // Use existing hosted zone
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId,
        zoneName: hostedZoneName,
      });
    } else {
      // Create new hosted zone
      // Extract the zone name (e.g., "yourdomain.com" from "afu9.yourdomain.com")
      const zoneName = this.extractZoneName(this.domainName);
      
      this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName,
        comment: `Hosted zone for AFU-9 Control Center (${this.domainName})`,
      });

      cdk.Tags.of(this.hostedZone).add('Name', `afu9-hosted-zone-${zoneName}`);
      cdk.Tags.of(this.hostedZone).add('Environment', 'production');
      cdk.Tags.of(this.hostedZone).add('Project', 'AFU-9');
    }

    // ========================================
    // ACM Certificate
    // ========================================

    // Create ACM certificate with DNS validation
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: this.domainName,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
      certificateName: 'afu9-control-center-cert',
    });

    cdk.Tags.of(this.certificate).add('Name', 'afu9-certificate');
    cdk.Tags.of(this.certificate).add('Environment', 'production');
    cdk.Tags.of(this.certificate).add('Project', 'AFU-9');

    // ========================================
    // Stack Outputs
    // ========================================

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
      value: cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers || []),
      description: 'Name servers for the hosted zone (configure these with your domain registrar)',
      exportName: 'Afu9HostedZoneNameServers',
    });

    new cdk.CfnOutput(this, 'ControlCenterUrl', {
      value: `https://${this.domainName}`,
      description: 'URL of the AFU-9 Control Center',
    });
  }

  /**
   * Extract the zone name from a full domain name
   * 
   * Examples:
   * - "afu9.example.com" -> "example.com"
   * - "example.com" -> "example.com"
   * - "afu9.subdomain.example.com" -> "subdomain.example.com"
   * 
   * Limitations:
   * - This method assumes standard TLDs (e.g., .com, .org, .net)
   * - For multi-part TLDs like .co.uk, .com.au, or .ac.uk, the extraction will be incorrect
   * - In these cases, use the hostedZoneId and hostedZoneName props to specify an existing zone
   * 
   * Example for .co.uk domain:
   *   new Afu9DnsStack(app, 'Afu9DnsStack', {
   *     domainName: 'afu9.example.co.uk',
   *     hostedZoneId: 'Z1234567890ABC',
   *     hostedZoneName: 'example.co.uk',
   *   });
   */
  private extractZoneName(domainName: string): string {
    const parts = domainName.split('.');
    
    // If it's just a domain (e.g., "example.com"), return as-is
    if (parts.length <= 2) {
      return domainName;
    }
    
    // Check for known multi-part TLDs that require special handling
    const multiPartTlds = [
      'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp',
      'ac.uk', 'gov.uk', 'org.uk', 'com.mx', 'com.ar', 'co.in',
    ];
    
    const lastTwoParts = parts.slice(-2).join('.');
    if (multiPartTlds.includes(lastTwoParts)) {
      // Multi-part TLD detected - provide helpful error message
      throw new Error(
        `Multi-part TLD detected (.${lastTwoParts}) in domain "${domainName}". ` +
        `Please provide an existing hosted zone using hostedZoneId and hostedZoneName props. ` +
        `Example: { domainName: "${domainName}", hostedZoneId: "Z123...", hostedZoneName: "${parts.slice(-3).join('.')}" }`
      );
    }
    
    // Otherwise, return the last two parts (e.g., "example.com")
    return parts.slice(-2).join('.');
  }
}
