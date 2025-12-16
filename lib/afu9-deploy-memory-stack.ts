import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * AFU-9 Deploy Memory Stack
 * 
 * DynamoDB table for storing and querying deploy failure history
 */
export class Afu9DeployMemoryStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================
    // DynamoDB Table
    // ========================================

    this.table = new dynamodb.Table(this, 'DeployMemoryTable', {
      tableName: 'afu9_deploy_memory',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // ========================================
    // Global Secondary Index: Query by Error Class
    // ========================================

    this.table.addGlobalSecondaryIndex({
      indexName: 'ErrorClassIndex',
      partitionKey: {
        name: 'errorClass',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Global Secondary Index: Query by Service
    // ========================================

    this.table.addGlobalSecondaryIndex({
      indexName: 'ServiceIndex',
      partitionKey: {
        name: 'service',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Tags
    // ========================================

    cdk.Tags.of(this.table).add('Name', 'afu9-deploy-memory');
    cdk.Tags.of(this.table).add('Environment', 'production');
    cdk.Tags.of(this.table).add('Project', 'AFU-9');

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name for deploy memory',
      exportName: 'Afu9DeployMemoryTableName',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN for deploy memory',
      exportName: 'Afu9DeployMemoryTableArn',
    });
  }
}
