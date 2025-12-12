import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

/**
 * AFU-9 Network Infrastructure Stack
 * 
 * Provides the network foundation for AFU-9 v0.2:
 * - VPC with 2 AZs for high availability
 * - Public subnets for Application Load Balancer
 * - Private subnets for ECS tasks
 * - Security groups with least privilege access
 * - Application Load Balancer with target group
 * 
 * Network Architecture:
 * - CIDR: 10.0.0.0/16
 * - AZ1 Public: 10.0.1.0/24
 * - AZ2 Public: 10.0.2.0/24
 * - AZ1 Private: 10.0.11.0/24
 * - AZ2 Private: 10.0.12.0/24
 * 
 * Port Strategy:
 * - 443 (HTTPS): Internet → ALB
 * - 80 (HTTP): Internet → ALB (development, redirect in production)
 * - 3000: ALB → ECS Control Center
 * - 3001: ECS → MCP GitHub Server (internal)
 * - 3002: ECS → MCP Deploy Server (internal)
 * - 3003: ECS → MCP Observability Server (internal)
 * - 5432 (PostgreSQL): ECS → RDS
 */
export interface Afu9NetworkStackProps extends cdk.StackProps {
  /**
   * Optional: ARN of the ACM certificate for HTTPS
   * If not provided, only HTTP listener will be configured
   */
  certificateArn?: string;
}

export class Afu9NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly httpsListener?: elbv2.ApplicationListener;
  public readonly httpListener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props?: Afu9NetworkStackProps) {
    super(scope, id, props);

    // ========================================
    // VPC with Multi-AZ Configuration
    // ========================================
    
    this.vpc = new ec2.Vpc(this, 'Afu9Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2, // High availability across 2 availability zones
      natGateways: 1, // Cost optimization: single NAT for v0.2
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Tag VPC for identification
    cdk.Tags.of(this.vpc).add('Name', 'afu9-vpc');
    cdk.Tags.of(this.vpc).add('Environment', 'production');
    cdk.Tags.of(this.vpc).add('Project', 'AFU-9');

    // ========================================
    // Security Groups (Least Privilege)
    // ========================================

    // ALB Security Group: Allow HTTPS/HTTP from Internet
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ALB - allows HTTPS/HTTP from internet',
      allowAllOutbound: true,
    });

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from internet'
    );

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from internet'
    );

    cdk.Tags.of(this.albSecurityGroup).add('Name', 'afu9-alb-sg');

    // ECS Security Group: Allow traffic only from ALB
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS tasks - allows traffic from ALB only',
      allowAllOutbound: true, // Required for GitHub API, LLM APIs, etc.
    });

    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'Allow traffic from ALB to ECS Control Center on port 3000'
    );

    cdk.Tags.of(this.ecsSecurityGroup).add('Name', 'afu9-ecs-sg');

    // RDS Security Group: Allow PostgreSQL only from ECS
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS - allows PostgreSQL from ECS only',
      allowAllOutbound: false, // No outbound needed for RDS
    });

    this.dbSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL traffic from ECS tasks only'
    );

    cdk.Tags.of(this.dbSecurityGroup).add('Name', 'afu9-rds-sg');

    // ========================================
    // Application Load Balancer
    // ========================================

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Afu9LoadBalancer', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      loadBalancerName: 'afu9-alb',
    });

    cdk.Tags.of(this.loadBalancer).add('Name', 'afu9-alb');
    cdk.Tags.of(this.loadBalancer).add('Environment', 'production');

    // Target Group for ECS Service
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'Afu9TargetGroup', {
      vpc: this.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP, // Required for Fargate
      targetGroupName: 'afu9-tg',
      healthCheck: {
        path: '/api/ready',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        protocol: elbv2.Protocol.HTTP,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    cdk.Tags.of(this.targetGroup).add('Name', 'afu9-target-group');

    // ========================================
    // Listeners (HTTP and optionally HTTPS)
    // ========================================

    // HTTPS Listener (port 443) - only if certificate is provided
    if (props?.certificateArn) {
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        'Certificate',
        props.certificateArn
      );

      this.httpsListener = this.loadBalancer.addListener('HttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [certificate],
        defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
      });

      // HTTP Listener (port 80) - redirect to HTTPS when certificate is configured
      this.httpListener = this.loadBalancer.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    } else {
      // HTTP Listener (port 80) - forward to target group when no certificate
      this.httpListener = this.loadBalancer.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
      });
    }

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for AFU-9',
      exportName: 'Afu9VpcId',
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
      exportName: 'Afu9VpcCidr',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'DNS name of the Application Load Balancer',
      exportName: 'Afu9LoadBalancerDNS',
    });

    new cdk.CfnOutput(this, 'LoadBalancerArn', {
      value: this.loadBalancer.loadBalancerArn,
      description: 'ARN of the Application Load Balancer',
      exportName: 'Afu9LoadBalancerArn',
    });

    new cdk.CfnOutput(this, 'HttpsEnabled', {
      value: props?.certificateArn ? 'true' : 'false',
      description: 'Whether HTTPS is enabled on the ALB',
    });

    new cdk.CfnOutput(this, 'TargetGroupArn', {
      value: this.targetGroup.targetGroupArn,
      description: 'ARN of the ECS target group',
      exportName: 'Afu9TargetGroupArn',
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: this.albSecurityGroup.securityGroupId,
      description: 'Security group ID for ALB',
      exportName: 'Afu9AlbSecurityGroupId',
    });

    new cdk.CfnOutput(this, 'EcsSecurityGroupId', {
      value: this.ecsSecurityGroup.securityGroupId,
      description: 'Security group ID for ECS tasks',
      exportName: 'Afu9EcsSecurityGroupId',
    });

    new cdk.CfnOutput(this, 'DbSecurityGroupId', {
      value: this.dbSecurityGroup.securityGroupId,
      description: 'Security group ID for RDS database',
      exportName: 'Afu9DbSecurityGroupId',
    });
  }
}
