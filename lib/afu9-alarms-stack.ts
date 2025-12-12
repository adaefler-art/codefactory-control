import * as cdk from 'aws-cdk-lib';
import { aws_cloudwatch as cloudwatch, aws_sns as sns, aws_sns_subscriptions as subscriptions, aws_cloudwatch_actions as actions } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * AFU-9 CloudWatch Alarms Stack
 * 
 * Provides comprehensive monitoring and alerting for AFU-9 infrastructure:
 * - ECS service health (CPU, Memory, Task count)
 * - RDS database health (CPU, Connections, Storage)
 * - ALB health (5xx errors, unhealthy targets, response time)
 * - SNS topic for alarm notifications
 * 
 * This stack creates alarms that trigger when key metrics exceed thresholds,
 * ensuring operators are notified of potential issues before they impact users.
 */
export interface Afu9AlarmsStackProps extends cdk.StackProps {
  /**
   * ECS cluster name to monitor
   */
  ecsClusterName: string;

  /**
   * ECS service name to monitor
   */
  ecsServiceName: string;

  /**
   * RDS database instance identifier
   */
  dbInstanceIdentifier: string;

  /**
   * ALB full name (from LoadBalancer.loadBalancerFullName)
   */
  albFullName: string;

  /**
   * Target group full name (from TargetGroup.targetGroupFullName)
   */
  targetGroupFullName: string;

  /**
   * Email address for alarm notifications
   * Optional - if not provided, SNS topic will be created without subscriptions
   */
  alarmEmail?: string;
}

export class Afu9AlarmsStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: Afu9AlarmsStackProps) {
    super(scope, id, props);

    const {
      ecsClusterName,
      ecsServiceName,
      dbInstanceIdentifier,
      albFullName,
      targetGroupFullName,
      alarmEmail,
    } = props;

    // ========================================
    // SNS Topic for Alarm Notifications
    // ========================================

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'afu9-alarms',
      displayName: 'AFU-9 CloudWatch Alarms',
    });

    // Subscribe email if provided
    if (alarmEmail) {
      this.alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(alarmEmail)
      );
    }

    const alarmAction = new actions.SnsAction(this.alarmTopic);

    // ========================================
    // ECS Service Alarms
    // ========================================

    // High CPU Utilization
    const ecsHighCpuAlarm = new cloudwatch.Alarm(this, 'EcsHighCpuAlarm', {
      alarmName: 'afu9-ecs-high-cpu',
      alarmDescription: 'ECS service CPU utilization is above 80% for 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ServiceName: ecsServiceName,
          ClusterName: ecsClusterName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsHighCpuAlarm.addAlarmAction(alarmAction);

    // High Memory Utilization
    const ecsHighMemoryAlarm = new cloudwatch.Alarm(this, 'EcsHighMemoryAlarm', {
      alarmName: 'afu9-ecs-high-memory',
      alarmDescription: 'ECS service memory utilization is above 80% for 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        dimensionsMap: {
          ServiceName: ecsServiceName,
          ClusterName: ecsClusterName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsHighMemoryAlarm.addAlarmAction(alarmAction);

    // Low Running Task Count (service degraded)
    const ecsLowTaskCountAlarm = new cloudwatch.Alarm(this, 'EcsLowTaskCountAlarm', {
      alarmName: 'afu9-ecs-no-running-tasks',
      alarmDescription: 'ECS service has no running tasks',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ServiceName: ecsServiceName,
          ClusterName: ecsClusterName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    ecsLowTaskCountAlarm.addAlarmAction(alarmAction);

    // ========================================
    // RDS Database Alarms
    // ========================================

    // High CPU Utilization
    const rdsHighCpuAlarm = new cloudwatch.Alarm(this, 'RdsHighCpuAlarm', {
      alarmName: 'afu9-rds-high-cpu',
      alarmDescription: 'RDS database CPU utilization is above 80% for 10 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBInstanceIdentifier: dbInstanceIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsHighCpuAlarm.addAlarmAction(alarmAction);

    // Low Free Storage Space
    const rdsLowStorageAlarm = new cloudwatch.Alarm(this, 'RdsLowStorageAlarm', {
      alarmName: 'afu9-rds-low-storage',
      alarmDescription: 'RDS database has less than 2GB free storage',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'FreeStorageSpace',
        dimensionsMap: {
          DBInstanceIdentifier: dbInstanceIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2 * 1024 * 1024 * 1024, // 2 GB in bytes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsLowStorageAlarm.addAlarmAction(alarmAction);

    // High Database Connections
    const rdsHighConnectionsAlarm = new cloudwatch.Alarm(this, 'RdsHighConnectionsAlarm', {
      alarmName: 'afu9-rds-high-connections',
      alarmDescription: 'RDS database has more than 80 connections',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        dimensionsMap: {
          DBInstanceIdentifier: dbInstanceIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsHighConnectionsAlarm.addAlarmAction(alarmAction);

    // ========================================
    // ALB Alarms
    // ========================================

    // High 5xx Error Rate
    const albHigh5xxAlarm = new cloudwatch.Alarm(this, 'AlbHigh5xxAlarm', {
      alarmName: 'afu9-alb-high-5xx-rate',
      alarmDescription: 'ALB is returning 5xx errors at high rate',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: albFullName,
          TargetGroup: targetGroupFullName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    albHigh5xxAlarm.addAlarmAction(alarmAction);

    // Unhealthy Target Count
    const albUnhealthyTargetAlarm = new cloudwatch.Alarm(this, 'AlbUnhealthyTargetAlarm', {
      alarmName: 'afu9-alb-unhealthy-targets',
      alarmDescription: 'ALB has unhealthy targets',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'UnHealthyHostCount',
        dimensionsMap: {
          LoadBalancer: albFullName,
          TargetGroup: targetGroupFullName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    albUnhealthyTargetAlarm.addAlarmAction(alarmAction);

    // High Response Time
    const albHighResponseTimeAlarm = new cloudwatch.Alarm(this, 'AlbHighResponseTimeAlarm', {
      alarmName: 'afu9-alb-high-response-time',
      alarmDescription: 'ALB target response time is above 5 seconds',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensionsMap: {
          LoadBalancer: albFullName,
          TargetGroup: targetGroupFullName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    albHighResponseTimeAlarm.addAlarmAction(alarmAction);

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS topic ARN for CloudWatch alarms',
      exportName: 'Afu9AlarmTopicArn',
    });

    new cdk.CfnOutput(this, 'AlarmTopicName', {
      value: this.alarmTopic.topicName,
      description: 'SNS topic name for CloudWatch alarms',
      exportName: 'Afu9AlarmTopicName',
    });
  }
}
