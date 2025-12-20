import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * AFU-9 CloudWatch Alarms Stack
 * 
 * Provides comprehensive monitoring and alerting for AFU-9 infrastructure:
 * - ECS service health (CPU, Memory, Task count)
 * - RDS database health (CPU, Connections, Storage)
 * - ALB health (5xx errors, unhealthy targets, response time)
 * - SNS topic for alarm notifications
 * - Optional email and webhook notifications (Slack, etc.)
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
   * Optional - if not provided, RDS alarms will not be created
   */
  dbInstanceIdentifier?: string;

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
   * Optional - if not provided, SNS topic will be created without email subscriptions
   */
  alarmEmail?: string;

  /**
   * Webhook URL for alarm notifications (e.g., Slack webhook)
   * Optional - if not provided, no webhook notifications will be configured
   */
  webhookUrl?: string;
}

export class Afu9AlarmsStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;
  public readonly webhookFunction?: lambda.Function;

  constructor(scope: Construct, id: string, props: Afu9AlarmsStackProps) {
    super(scope, id, props);

    const {
      ecsClusterName,
      ecsServiceName,
      dbInstanceIdentifier,
      albFullName,
      targetGroupFullName,
      alarmEmail,
      webhookUrl,
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

    // Subscribe webhook if provided (e.g., Slack, Teams, custom webhooks)
    if (webhookUrl) {
      // Create Lambda function to forward SNS notifications to webhook
      const webhookLogGroup = new logs.LogGroup(this, 'WebhookLogGroup', {
        logGroupName: '/aws/lambda/afu9-alarm-webhook',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      this.webhookFunction = new lambda.Function(this, 'WebhookFunction', {
        functionName: 'afu9-alarm-webhook',
        description: 'Forwards CloudWatch alarm notifications to webhook (Slack, Teams, etc.)',
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        logGroup: webhookLogGroup,
        environment: {
          WEBHOOK_URL: webhookUrl,
        },
        code: lambda.Code.fromInline(`
const https = require('https');

exports.handler = async (event) => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));
  
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('WEBHOOK_URL environment variable not set');
  }
  
  // Validate SNS event structure
  if (!event.Records || event.Records.length === 0) {
    throw new Error('Invalid SNS event: no records found');
  }
  
  // Parse SNS message with error handling
  let message;
  try {
    const snsMessage = event.Records[0].Sns;
    message = JSON.parse(snsMessage.Message);
  } catch (error) {
    console.error('Failed to parse SNS message:', error);
    throw new Error('Failed to parse SNS message: ' + error.message);
  }
  
  // Format message for webhook (Slack-compatible format)
  const alarmName = message.AlarmName || 'Unknown Alarm';
  const newState = message.NewStateValue || 'UNKNOWN';
  const reason = message.NewStateReason || 'No reason provided';
  const timestamp = message.StateChangeTime || new Date().toISOString();
  
  // Color coding: red for ALARM, green for OK, gray for INSUFFICIENT_DATA
  const color = newState === 'ALARM' ? '#ff0000' : newState === 'OK' ? '#00ff00' : '#cccccc';
  const emoji = newState === 'ALARM' ? '🔴' : newState === 'OK' ? '✅' : '⚠️';
  
  const payload = {
    text: emoji + ' CloudWatch Alarm: ' + alarmName,
    attachments: [
      {
        color: color,
        fields: [
          {
            title: 'Alarm Name',
            value: alarmName,
            short: true
          },
          {
            title: 'State',
            value: newState,
            short: true
          },
          {
            title: 'Reason',
            value: reason,
            short: false
          },
          {
            title: 'Time',
            value: timestamp,
            short: false
          }
        ],
        footer: 'AFU-9 CloudWatch Alarms',
        ts: Math.floor(Date.parse(timestamp) / 1000)
      }
    ]
  };
  
  // Send to webhook using modern URL API
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch (error) {
    throw new Error('Invalid webhook URL: ' + error.message);
  }
  
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      console.log('Webhook response status:', res.statusCode);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Successfully sent to webhook');
          resolve({ statusCode: 200, body: 'Success' });
        } else {
          console.error('Webhook returned error:', res.statusCode, data);
          reject(new Error('Webhook error: ' + res.statusCode));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Error sending to webhook:', error);
      reject(error);
    });
    
    req.write(JSON.stringify(payload));
    req.end();
  });
};
        `),
      });

      // Grant Lambda permission to be invoked by SNS
      this.webhookFunction.addPermission('AllowSNSInvoke', {
        principal: new iam.ServicePrincipal('sns.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: this.alarmTopic.topicArn,
      });

      // Subscribe Lambda to SNS topic
      this.alarmTopic.addSubscription(
        new subscriptions.LambdaSubscription(this.webhookFunction)
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
    // RDS Database Alarms (only if database is enabled)
    // ========================================

    if (dbInstanceIdentifier) {
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
    }

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

    if (this.webhookFunction) {
      new cdk.CfnOutput(this, 'WebhookFunctionArn', {
        value: this.webhookFunction.functionArn,
        description: 'Lambda function ARN for webhook notifications',
        exportName: 'Afu9WebhookFunctionArn',
      });

      new cdk.CfnOutput(this, 'WebhookFunctionName', {
        value: this.webhookFunction.functionName,
        description: 'Lambda function name for webhook notifications',
        exportName: 'Afu9WebhookFunctionName',
      });
    }
  }
}
