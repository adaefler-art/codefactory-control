import * as cdk from 'aws-cdk-lib';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/**
 * AFU-9 Routing Stack
 * 
 * Implements host-based routing for multi-environment deployment:
 * - stage.afu-9.com → stage ECS target group
 * - prod.afu-9.com → prod ECS target group
 * - afu-9.com → landing page (simple redirect to prod)
 * 
 * This stack manages ALB listener rules and Route53 DNS records for
 * environment-specific subdomains while sharing a single ALB across
 * all environments for cost optimization.
 * 
 * Low-Cost Pause Mode:
 * When prodPaused=true, PROD listener rules are disabled to prevent
 * routing to non-existent tasks, reducing costs while keeping infrastructure intact.
 */
export interface Afu9RoutingStackProps extends cdk.StackProps {
  /**
   * The Application Load Balancer to configure routing on
   */
  loadBalancer: elbv2.ApplicationLoadBalancer;

  /**
   * The HTTPS listener (port 443) to add rules to
   * If not provided, only HTTP routing will be configured
   */
  httpsListener?: elbv2.ApplicationListener;

  /**
   * The HTTP listener (port 80) to add rules to
   */
  httpListener: elbv2.ApplicationListener;

  /**
   * Target group for stage environment
   */
  stageTargetGroup: elbv2.ApplicationTargetGroup;

  /**
   * Target group for prod environment
   */
  prodTargetGroup: elbv2.ApplicationTargetGroup;

  /**
   * Route53 hosted zone for DNS records
   * Optional - if not provided, no DNS records will be created
   */
  hostedZone?: route53.IHostedZone;

  /**
   * Base domain name (e.g., 'afu-9.com')
   * Required if hostedZone is provided
   */
  baseDomainName?: string;

  /**
   * Enable Low-Cost Pause Mode for PROD
   * When true, PROD routing rules are disabled
   * @default false
   */
  prodPaused?: boolean;
}

export class Afu9RoutingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Afu9RoutingStackProps) {
    super(scope, id, props);

    const {
      loadBalancer,
      httpsListener,
      httpListener,
      stageTargetGroup,
      prodTargetGroup,
      hostedZone,
      baseDomainName,
      prodPaused = false,
    } = props;

    // Optional guard to skip DNS record creation when records already exist
    const manageDnsFlag = this.node.tryGetContext('afu9-manage-dns');
    const manageDns = manageDnsFlag === true || manageDnsFlag === 'true';

    // Validate baseDomainName if routing rules are being created
    if (!baseDomainName) {
      throw new Error(
        'Afu9RoutingStack: baseDomainName is required for creating routing rules'
      );
    }

    // ========================================
    // ALB Listener Rules - HTTPS
    // ========================================

    if (httpsListener) {
      // Priority 10: stage.afu-9.com → stage target group
      new elbv2.ApplicationListenerRule(this, 'StageHttpsRule', {
        listener: httpsListener,
        priority: 10,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([`stage.${baseDomainName}`]),
        ],
        action: elbv2.ListenerAction.forward([stageTargetGroup]),
      });

      // Priority 20: prod.afu-9.com → prod target group (only when not paused)
      if (!prodPaused) {
        new elbv2.ApplicationListenerRule(this, 'ProdHttpsRule', {
          listener: httpsListener,
          priority: 20,
          conditions: [
            elbv2.ListenerCondition.hostHeaders([`prod.${baseDomainName}`]),
          ],
          action: elbv2.ListenerAction.forward([prodTargetGroup]),
        });
      } else {
        // When paused, return 503 Service Unavailable for prod
        new elbv2.ApplicationListenerRule(this, 'ProdHttpsPausedRule', {
          listener: httpsListener,
          priority: 20,
          conditions: [
            elbv2.ListenerCondition.hostHeaders([`prod.${baseDomainName}`]),
          ],
          action: elbv2.ListenerAction.fixedResponse(503, {
            contentType: 'text/plain',
            messageBody: 'Production environment is currently paused (Low-Cost Mode). Please contact support.',
          }),
        });
      }

      // Priority 100: afu-9.com → redirect to prod.afu-9.com (landing page)
      // When prod is paused, still redirect but user will see 503 at prod subdomain
      new elbv2.ApplicationListenerRule(this, 'LandingHttpsRule', {
        listener: httpsListener,
        priority: 100,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([baseDomainName]),
        ],
        action: elbv2.ListenerAction.redirect({
          host: `prod.${baseDomainName}`,
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    }

    // ========================================
    // ALB Listener Rules - HTTP
    // ========================================

    // If HTTPS is configured, HTTP should redirect to HTTPS for all hosts
    // Otherwise, HTTP should route to appropriate target groups
    if (httpsListener) {
      // Priority 10: Redirect stage.afu-9.com HTTP to HTTPS
      new elbv2.ApplicationListenerRule(this, 'StageHttpRedirectRule', {
        listener: httpListener,
        priority: 10,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([`stage.${baseDomainName}`]),
        ],
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });

      // Priority 20: Redirect prod.afu-9.com HTTP to HTTPS
      // (Redirect happens regardless of pause state; 503 will be shown at HTTPS endpoint)
      new elbv2.ApplicationListenerRule(this, 'ProdHttpRedirectRule', {
        listener: httpListener,
        priority: 20,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([`prod.${baseDomainName}`]),
        ],
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });

      // Priority 100: Redirect base domain HTTP to HTTPS
      new elbv2.ApplicationListenerRule(this, 'LandingHttpRedirectRule', {
        listener: httpListener,
        priority: 100,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([baseDomainName]),
        ],
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    } else {
      // No HTTPS - route HTTP directly to target groups
      new elbv2.ApplicationListenerRule(this, 'StageHttpRule', {
        listener: httpListener,
        priority: 10,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([`stage.${baseDomainName}`]),
        ],
        action: elbv2.ListenerAction.forward([stageTargetGroup]),
      });

      if (!prodPaused) {
        new elbv2.ApplicationListenerRule(this, 'ProdHttpRule', {
          listener: httpListener,
          priority: 20,
          conditions: [
            elbv2.ListenerCondition.hostHeaders([`prod.${baseDomainName}`]),
          ],
          action: elbv2.ListenerAction.forward([prodTargetGroup]),
        });
      } else {
        new elbv2.ApplicationListenerRule(this, 'ProdHttpPausedRule', {
          listener: httpListener,
          priority: 20,
          conditions: [
            elbv2.ListenerCondition.hostHeaders([`prod.${baseDomainName}`]),
          ],
          action: elbv2.ListenerAction.fixedResponse(503, {
            contentType: 'text/plain',
            messageBody: 'Production environment is currently paused (Low-Cost Mode). Please contact support.',
          }),
        });
      }

      // Redirect base domain to prod
      new elbv2.ApplicationListenerRule(this, 'LandingHttpRule', {
        listener: httpListener,
        priority: 100,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([baseDomainName]),
        ],
        action: elbv2.ListenerAction.redirect({
          host: `prod.${baseDomainName}`,
          protocol: 'HTTP',
          port: '80',
          permanent: true,
        }),
      });
    }

    // ========================================
    // Route53 DNS Records
    // ========================================

    if (manageDns && hostedZone && baseDomainName) {
      // A record for stage.afu-9.com
      new route53.ARecord(this, 'StageARecord', {
        zone: hostedZone,
        recordName: `stage.${baseDomainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(loadBalancer)
        ),
        comment: 'A record for AFU-9 Stage environment',
      });

      // A record for prod.afu-9.com
      new route53.ARecord(this, 'ProdARecord', {
        zone: hostedZone,
        recordName: `prod.${baseDomainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(loadBalancer)
        ),
        comment: 'A record for AFU-9 Production environment',
      });

      // A record for afu-9.com (base domain - landing page)
      new route53.ARecord(this, 'LandingARecord', {
        zone: hostedZone,
        recordName: baseDomainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(loadBalancer)
        ),
        comment: 'A record for AFU-9 landing page (redirects to prod)',
      });
    } else if (!manageDns) {
      cdk.Annotations.of(this).addInfo('DNS record creation skipped (afu9-manage-dns=false).');
    }

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'ProdPauseMode', {
      value: prodPaused ? 'ENABLED' : 'DISABLED',
      description: 'Low-Cost Pause Mode status for PROD environment',
    });

    new cdk.CfnOutput(this, 'StageUrl', {
      value: baseDomainName
        ? `https://stage.${baseDomainName}`
        : `http://${loadBalancer.loadBalancerDnsName}`,
      description: 'URL for Stage environment',
    });

    new cdk.CfnOutput(this, 'ProdUrl', {
      value: baseDomainName
        ? `https://prod.${baseDomainName}`
        : `http://${loadBalancer.loadBalancerDnsName}`,
      description: prodPaused 
        ? 'URL for Production environment (currently paused - returns 503)'
        : 'URL for Production environment',
    });

    new cdk.CfnOutput(this, 'LandingUrl', {
      value: baseDomainName
        ? `https://${baseDomainName}`
        : `http://${loadBalancer.loadBalancerDnsName}`,
      description: 'URL for Landing page (redirects to prod)',
    });
  }
}
