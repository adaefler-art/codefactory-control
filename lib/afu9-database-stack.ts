import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * AFU-9 Database Stack
 * 
 * Provides RDS Postgres database for AFU-9 v0.2:
 * - PostgreSQL 15.15 on db.t4g.micro
 * - Multi-AZ deployment for high availability (optional)
 * - Automated backups with 7-day retention
 * - Encryption at rest with AWS KMS
 * - Security group allowing access only from ECS tasks
 * - Secrets Manager integration for credentials
 * 
 * Database Configuration:
 * - Engine: PostgreSQL 15.15
 * - Instance: db.t4g.micro (1 vCPU, 1 GB RAM)
 * - Storage: 20 GB GP3 with autoscaling
 * - Region: eu-central-1
 */
export interface Afu9DatabaseStackProps extends cdk.StackProps {
  /**
   * VPC to deploy the database in
   */
  vpc: ec2.Vpc;

  /**
   * Security group for database access
   */
  dbSecurityGroup: ec2.SecurityGroup;

  /**
   * Whether to enable Multi-AZ deployment (default: false for cost optimization)
   */
  multiAz?: boolean;
}

export class Afu9DatabaseStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbName: string = 'afu9';

  constructor(scope: Construct, id: string, props: Afu9DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, dbSecurityGroup, multiAz = false } = props;

    // ========================================
    // Database Credentials Secret
    // ========================================

    // Create secret for database master credentials
    const dbCredentialsSecret = new secretsmanager.Secret(this, 'DbCredentialsSecret', {
      secretName: 'afu9/database/master',
      description: 'Master credentials for AFU-9 RDS Postgres database',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'afu9_admin',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // ========================================
    // Database Subnet Group
    // ========================================

    // Use isolated/private subnets for database
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      vpc,
      description: 'Subnet group for AFU-9 RDS Postgres',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      subnetGroupName: 'afu9-db-subnet-group',
    });

    // ========================================
    // RDS Parameter Group
    // ========================================

    // Custom parameter group for performance tuning
    const parameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of('15.15', '15'),
      }),
      description: 'Custom parameter group for AFU-9 database',
      parameters: {
        // Connection settings
        'max_connections': '100',
        
        // Memory settings (for db.t4g.micro: 1GB RAM)
        // Use 8kB pages to avoid replacements when units change
        'shared_buffers': '32768', // 256MB / 8kB
        'effective_cache_size': '98304', // 768MB / 8kB
        'work_mem': '4096', // 4MB / 1kB
        'maintenance_work_mem': '65536', // 64MB / 1kB
        
        // Write-ahead log settings
        'wal_buffers': '1024', // 8MB / 8kB
        'checkpoint_completion_target': '0.9',
        
        // Query planning
        'random_page_cost': '1.1',
        'effective_io_concurrency': '200',
        
        // Logging (for debugging)
        'log_min_duration_statement': '1000', // Log queries slower than 1s
        'log_connections': '1',
        'log_disconnections': '1',
      },
    });

    // ========================================
    // RDS Database Instance
    // ========================================

    this.dbInstance = new rds.DatabaseInstance(this, 'DbInstance', {
      // Engine configuration
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of('15.15', '15'),
      }),
      
      // Instance configuration
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      instanceIdentifier: 'afu9-postgres',
      
      // Database name
      databaseName: this.dbName,
      
      // Credentials from Secrets Manager
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      
      // Network configuration
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      subnetGroup: dbSubnetGroup,
      
      // High availability (disabled by default for cost)
      multiAz,
      
      // Storage configuration
      allocatedStorage: 20, // 20 GB initial storage
      maxAllocatedStorage: 100, // Auto-scale up to 100 GB
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      
      // Backup configuration
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: '02:00-03:00', // UTC
      deleteAutomatedBackups: false, // Retain backups for compliance and recovery
      
      // Maintenance configuration
      autoMinorVersionUpgrade: true,
      preferredMaintenanceWindow: 'sun:03:00-sun:04:00', // UTC
      
      // Monitoring
      monitoringInterval: cdk.Duration.seconds(60),
      enablePerformanceInsights: false, // Disabled for cost optimization
      cloudwatchLogsExports: ['postgresql'],
      
      // Deletion protection (enable for production)
      deletionProtection: false, // Set to true for production
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      
      // Parameter group
      parameterGroup,
      
      // Public access
      publiclyAccessible: false,
    });

    this.dbSecret = dbCredentialsSecret;

    // ========================================
    // Application Connection Secret
    // ========================================

    // Create a comprehensive secret for application use
    // Note: host/port are not sensitive as database is in private subnet,
    // but keeping all connection details together for convenience
    const appConnectionSecret = new secretsmanager.Secret(this, 'AppConnectionSecret', {
      secretName: 'afu9/database',
      description: 'Database connection details for AFU-9 application',
      secretObjectValue: {
        host: cdk.SecretValue.unsafePlainText(this.dbInstance.dbInstanceEndpointAddress),
        port: cdk.SecretValue.unsafePlainText(this.dbInstance.dbInstanceEndpointPort),
        database: cdk.SecretValue.unsafePlainText(this.dbName),
        username: dbCredentialsSecret.secretValueFromJson('username'),
        password: dbCredentialsSecret.secretValueFromJson('password'),
      },
    });

    // ========================================
    // Tags
    // ========================================

    cdk.Tags.of(this.dbInstance).add('Name', 'afu9-postgres');
    cdk.Tags.of(this.dbInstance).add('Environment', 'production');
    cdk.Tags.of(this.dbInstance).add('Project', 'AFU-9');

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'DbInstanceId', {
      value: this.dbInstance.instanceIdentifier,
      description: 'RDS instance identifier',
      exportName: 'Afu9DbInstanceId',
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbInstance.dbInstanceEndpointAddress,
      description: 'Database endpoint address',
      exportName: 'Afu9DbEndpoint',
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: this.dbInstance.dbInstanceEndpointPort,
      description: 'Database port',
      exportName: 'Afu9DbPort',
    });

    new cdk.CfnOutput(this, 'DbName', {
      value: this.dbName,
      description: 'Database name',
      exportName: 'Afu9DbName',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: appConnectionSecret.secretArn,
      description: 'ARN of the database connection secret',
      exportName: 'Afu9DbSecretArn',
    });

    new cdk.CfnOutput(this, 'DbSecretName', {
      value: appConnectionSecret.secretName,
      description: 'Name of the database connection secret',
      exportName: 'Afu9DbSecretName',
    });

    new cdk.CfnOutput(this, 'MasterSecretArn', {
      value: dbCredentialsSecret.secretArn,
      description: 'ARN of the master credentials secret',
      exportName: 'Afu9DbMasterSecretArn',
    });
  }
}
