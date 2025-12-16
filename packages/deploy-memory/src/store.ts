/**
 * AFU-9 Deploy Memory - DynamoDB Store
 * 
 * Persists deploy memory events to DynamoDB
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeployMemoryEvent } from './types';

const TABLE_NAME = process.env.AFU9_DEPLOY_MEMORY_TABLE || 'afu9_deploy_memory';

export class DeployMemoryStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(region: string = 'us-east-1', tableName?: string) {
    const dynamoClient = new DynamoDBClient({ region });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = tableName || TABLE_NAME;
  }

  /**
   * Stores a deploy memory event
   * 
   * @param event Deploy memory event to store
   */
  async putEvent(event: DeployMemoryEvent): Promise<void> {
    const item = {
      ...event,
      pk: `FINGERPRINT#${event.fingerprintId}`,
      sk: `EVENT#${event.timestamp}`,
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days TTL
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  /**
   * Queries events by fingerprint ID
   * 
   * @param fingerprintId Fingerprint to query
   * @param limit Maximum number of events to return
   * @returns Array of matching events
   */
  async queryByFingerprint(
    fingerprintId: string,
    limit: number = 50
  ): Promise<DeployMemoryEvent[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `FINGERPRINT#${fingerprintId}`,
        },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
      })
    );

    return (result.Items || []).map(item => ({
      fingerprintId: item.fingerprintId,
      errorClass: item.errorClass,
      service: item.service,
      confidence: item.confidence,
      tokens: item.tokens,
      timestamp: item.timestamp,
      stackName: item.stackName,
      region: item.region,
      rawSignals: item.rawSignals,
    }));
  }

  /**
   * Gets the most recent event for a fingerprint
   * 
   * @param fingerprintId Fingerprint to query
   * @returns Most recent event or null
   */
  async getLatestEvent(fingerprintId: string): Promise<DeployMemoryEvent | null> {
    const events = await this.queryByFingerprint(fingerprintId, 1);
    return events.length > 0 ? events[0] : null;
  }

  /**
   * Gets event statistics for a fingerprint
   * 
   * @param fingerprintId Fingerprint to analyze
   * @returns Statistics about the error pattern
   */
  async getEventStats(fingerprintId: string): Promise<{
    totalOccurrences: number;
    firstSeen: string;
    lastSeen: string;
    averageConfidence: number;
  }> {
    const events = await this.queryByFingerprint(fingerprintId, 1000);

    if (events.length === 0) {
      return {
        totalOccurrences: 0,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        averageConfidence: 0,
      };
    }

    const confidences = events.map(e => e.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    // Events are sorted most recent first
    const lastSeen = events[0].timestamp;
    const firstSeen = events[events.length - 1].timestamp;

    return {
      totalOccurrences: events.length,
      firstSeen,
      lastSeen,
      averageConfidence: avgConfidence,
    };
  }
}
