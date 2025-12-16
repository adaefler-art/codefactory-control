/**
 * Factory Uptime Metrics
 * 
 * Tracks and emits CloudWatch metrics for Factory Control Plane uptime and health.
 * Provides KPIs: Factory Uptime and MTTR (Mean Time To Recovery)
 */

import { 
  CloudWatchClient, 
  PutMetricDataCommand,
  Dimension,
  MetricDatum,
  StandardUnit
} from '@aws-sdk/client-cloudwatch';

const NAMESPACE = 'AFU9/Factory';
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

export class FactoryMetrics {
  private cloudwatch: CloudWatchClient;
  private enabled: boolean;

  constructor() {
    this.cloudwatch = new CloudWatchClient({ region: AWS_REGION });
    
    // Only enable metrics in production/staging
    const env = process.env.NODE_ENV;
    this.enabled = env === 'production' || env === 'staging';
  }

  /**
   * Emit Factory Availability metric
   * 
   * @param available - true if all critical services are healthy
   * @param dimensions - optional additional dimensions (e.g., environment)
   */
  async emitAvailability(available: boolean, dimensions?: Record<string, string>): Promise<void> {
    if (!this.enabled) {
      console.log('[FactoryMetrics] Skipping in non-prod environment');
      return;
    }

    const metricDimensions: Dimension[] = [
      { Name: 'Environment', Value: process.env.NODE_ENV || 'unknown' }
    ];

    if (dimensions) {
      Object.entries(dimensions).forEach(([name, value]) => {
        metricDimensions.push({ Name: name, Value: value });
      });
    }

    const metric: MetricDatum = {
      MetricName: 'Availability',
      Value: available ? 1 : 0,
      Unit: StandardUnit.None,
      Timestamp: new Date(),
      Dimensions: metricDimensions,
    };

    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [metric],
      }));

      console.log('[FactoryMetrics] Availability metric emitted', { available });
    } catch (error) {
      console.error('[FactoryMetrics] Failed to emit availability metric', error);
    }
  }

  /**
   * Emit Service Health metric for individual services
   * 
   * @param serviceName - Name of the service (e.g., 'control-center', 'mcp-github')
   * @param healthy - true if service is healthy
   */
  async emitServiceHealth(serviceName: string, healthy: boolean): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const metric: MetricDatum = {
      MetricName: 'ServiceHealth',
      Value: healthy ? 1 : 0,
      Unit: StandardUnit.None,
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'ServiceName', Value: serviceName },
        { Name: 'Environment', Value: process.env.NODE_ENV || 'unknown' }
      ],
    };

    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [metric],
      }));
    } catch (error) {
      console.error('[FactoryMetrics] Failed to emit service health metric', error);
    }
  }

  /**
   * Emit Dependency Check metric
   * 
   * @param serviceName - Name of the service
   * @param dependencyName - Name of the dependency
   * @param status - Status of the dependency check ('ok', 'warning', 'error')
   * @param latencyMs - Latency of the dependency check in milliseconds
   */
  async emitDependencyCheck(
    serviceName: string,
    dependencyName: string,
    status: string,
    latencyMs?: number
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const metrics: MetricDatum[] = [
      {
        MetricName: 'DependencyCheckSuccess',
        Value: status === 'ok' ? 1 : 0,
        Unit: StandardUnit.None,
        Timestamp: new Date(),
        Dimensions: [
          { Name: 'ServiceName', Value: serviceName },
          { Name: 'DependencyName', Value: dependencyName },
          { Name: 'Environment', Value: process.env.NODE_ENV || 'unknown' }
        ],
      }
    ];

    if (latencyMs !== undefined) {
      metrics.push({
        MetricName: 'DependencyCheckLatency',
        Value: latencyMs,
        Unit: StandardUnit.Milliseconds,
        Timestamp: new Date(),
        Dimensions: [
          { Name: 'ServiceName', Value: serviceName },
          { Name: 'DependencyName', Value: dependencyName },
          { Name: 'Environment', Value: process.env.NODE_ENV || 'unknown' }
        ],
      });
    }

    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: metrics,
      }));
    } catch (error) {
      console.error('[FactoryMetrics] Failed to emit dependency check metric', error);
    }
  }

  /**
   * Emit MTTR (Mean Time To Recovery) metric
   * 
   * @param incidentId - Unique identifier for the incident
   * @param mttrSeconds - Time to recovery in seconds
   * @param incidentType - Type of incident (e.g., 'deployment', 'service_failure')
   */
  async emitMTTR(incidentId: string, mttrSeconds: number, incidentType?: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const dimensions: Dimension[] = [
      { Name: 'Environment', Value: process.env.NODE_ENV || 'unknown' }
    ];

    if (incidentType) {
      dimensions.push({ Name: 'IncidentType', Value: incidentType });
    }

    const metric: MetricDatum = {
      MetricName: 'MTTR',
      Value: mttrSeconds,
      Unit: StandardUnit.Seconds,
      Timestamp: new Date(),
      Dimensions: dimensions,
    };

    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [metric],
      }));

      console.log('[FactoryMetrics] MTTR metric emitted', { incidentId, mttrSeconds });
    } catch (error) {
      console.error('[FactoryMetrics] Failed to emit MTTR metric', error);
    }
  }

  /**
   * Record incident start for MTTR tracking
   * Stores incident start time in memory/database for later MTTR calculation
   * 
   * @param incidentId - Unique identifier for the incident
   * @param incidentType - Type of incident
   */
  recordIncidentStart(incidentId: string, incidentType: string): void {
    // In production, this should persist to database
    // For now, we log it for manual tracking
    console.log('[FactoryMetrics] Incident started', {
      incidentId,
      incidentType,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record incident recovery for MTTR tracking
   * Calculates and emits MTTR metric
   * 
   * @param incidentId - Unique identifier for the incident
   * @param startTime - When the incident started
   * @param incidentType - Type of incident
   */
  async recordIncidentRecovery(
    incidentId: string,
    startTime: Date,
    incidentType: string
  ): Promise<void> {
    const recoveryTime = new Date();
    const mttrMs = recoveryTime.getTime() - startTime.getTime();
    const mttrSeconds = Math.floor(mttrMs / 1000);

    console.log('[FactoryMetrics] Incident recovered', {
      incidentId,
      incidentType,
      startTime: startTime.toISOString(),
      recoveryTime: recoveryTime.toISOString(),
      mttrSeconds,
    });

    await this.emitMTTR(incidentId, mttrSeconds, incidentType);
  }
}

// Singleton instance
export const factoryMetrics = new FactoryMetrics();
