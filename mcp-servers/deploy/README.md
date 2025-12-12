# MCP Deploy Server

MCP server for AWS ECS deployments with comprehensive logging and task monitoring.

## Overview

The Deploy MCP Server provides tools for managing AWS ECS service deployments:

- **updateService**: Update an ECS service with a new container image or force a new deployment
- **getServiceStatus**: Get comprehensive status of an ECS service including deployments, tasks, and events

## Features

✅ **Image Tag Updates**: Deploy new container images to ECS services  
✅ **Force Deployments**: Trigger new deployments without image changes  
✅ **Task Details**: Get detailed information about running tasks  
✅ **Event Monitoring**: Track deployment events and task status changes  
✅ **Structured Logging**: All actions logged in JSON format for CloudWatch  
✅ **IAM Role Support**: Uses ECS task IAM role for AWS API calls  

## Environment Variables

- `AWS_REGION` - AWS region (default: `eu-central-1`)
- `PORT` - Server port (default: `3002`)

## IAM Permissions Required

The ECS task role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    }
  ]
}
```

## Tools

### updateService

Update an ECS service with a new image or force a new deployment.

**Parameters:**
- `cluster` (required): ECS cluster name
- `service` (required): ECS service name
- `containerName` (optional): Container name to update (required if imageUri is provided)
- `imageUri` (optional): New image URI with tag (e.g., `123456789.dkr.ecr.eu-central-1.amazonaws.com/my-app:v1.2.3`)
- `forceNewDeployment` (optional): Force new deployment, default: `true`

**Example Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "tool": "updateService",
    "arguments": {
      "cluster": "afu9-cluster",
      "service": "afu9-control-center",
      "containerName": "control-center",
      "imageUri": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:v1.2.3"
    }
  }
}
```

**Example Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"serviceArn\":\"arn:aws:ecs:eu-central-1:123456789:service/afu9-cluster/afu9-control-center\",\"serviceName\":\"afu9-control-center\",\"clusterArn\":\"arn:aws:ecs:eu-central-1:123456789:cluster/afu9-cluster\",\"status\":\"ACTIVE\",\"desiredCount\":1,\"runningCount\":1,\"pendingCount\":0,\"taskDefinition\":\"arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42\",\"deployments\":[{\"id\":\"ecs-svc/1234567890\",\"status\":\"PRIMARY\",\"taskDefinition\":\"arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42\",\"desiredCount\":1,\"runningCount\":1,\"pendingCount\":0,\"failedTasks\":0,\"createdAt\":\"2025-12-12T10:30:00.000Z\",\"updatedAt\":\"2025-12-12T10:30:30.000Z\",\"rolloutState\":\"COMPLETED\"}],\"events\":[{\"id\":\"abc-123\",\"message\":\"service afu9-control-center has reached a steady state.\",\"createdAt\":\"2025-12-12T10:30:30.000Z\"}],\"tasks\":[{\"taskArn\":\"arn:aws:ecs:eu-central-1:123456789:task/afu9-cluster/abc123\",\"lastStatus\":\"RUNNING\",\"healthStatus\":\"HEALTHY\",\"containers\":[{\"name\":\"control-center\",\"image\":\"123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:v1.2.3\",\"lastStatus\":\"RUNNING\",\"healthStatus\":\"HEALTHY\"}]}]}"
      }
    ]
  }
}
```

### getServiceStatus

Get comprehensive status information about an ECS service.

**Parameters:**
- `cluster` (required): ECS cluster name
- `service` (required): ECS service name
- `includeTaskDetails` (optional): Include detailed task information, default: `true`

**Example Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "tool": "getServiceStatus",
    "arguments": {
      "cluster": "afu9-cluster",
      "service": "afu9-control-center"
    }
  }
}
```

**Example Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"serviceArn\":\"arn:aws:ecs:eu-central-1:123456789:service/afu9-cluster/afu9-control-center\",\"serviceName\":\"afu9-control-center\",\"clusterArn\":\"arn:aws:ecs:eu-central-1:123456789:cluster/afu9-cluster\",\"status\":\"ACTIVE\",\"desiredCount\":1,\"runningCount\":1,\"pendingCount\":0,\"taskDefinition\":\"arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42\",\"createdAt\":\"2025-12-01T10:00:00.000Z\",\"launchType\":\"FARGATE\",\"platformVersion\":\"LATEST\",\"deployments\":[{\"id\":\"ecs-svc/1234567890\",\"status\":\"PRIMARY\",\"taskDefinition\":\"arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42\",\"desiredCount\":1,\"runningCount\":1,\"pendingCount\":0,\"failedTasks\":0,\"createdAt\":\"2025-12-12T10:30:00.000Z\",\"updatedAt\":\"2025-12-12T10:30:30.000Z\",\"rolloutState\":\"COMPLETED\"}],\"events\":[{\"id\":\"abc-123\",\"message\":\"service afu9-control-center has reached a steady state.\",\"createdAt\":\"2025-12-12T10:30:30.000Z\"}],\"tasks\":[{\"taskArn\":\"arn:aws:ecs:eu-central-1:123456789:task/afu9-cluster/abc123\",\"taskDefinitionArn\":\"arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42\",\"lastStatus\":\"RUNNING\",\"desiredStatus\":\"RUNNING\",\"healthStatus\":\"HEALTHY\",\"cpu\":\"1024\",\"memory\":\"2048\",\"createdAt\":\"2025-12-12T10:30:00.000Z\",\"startedAt\":\"2025-12-12T10:30:15.000Z\",\"connectivity\":\"CONNECTED\",\"containers\":[{\"name\":\"control-center\",\"image\":\"123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:v1.2.3\",\"lastStatus\":\"RUNNING\",\"healthStatus\":\"HEALTHY\"}]}]}"
      }
    ]
  }
}
```

## Structured Logging

All operations are logged in JSON format for easy CloudWatch parsing:

```json
{
  "timestamp": "2025-12-12T10:30:00.000Z",
  "level": "info",
  "component": "mcp-deploy",
  "message": "Starting service update",
  "data": {
    "cluster": "afu9-cluster",
    "service": "afu9-control-center",
    "containerName": "control-center",
    "imageUri": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:v1.2.3",
    "forceNewDeployment": true
  }
}
```

Log levels:
- `info`: Normal operations (initialization, tool calls, successful operations)
- `warn`: Warnings (e.g., limitations, deprecations)
- `error`: Errors (e.g., service not found, API failures)

## Development

### Install Dependencies

```bash
cd mcp-servers/base && npm install && npm run build
cd ../deploy && npm install
```

### Build

```bash
npm run build
```

### Run Locally

```bash
export AWS_REGION=eu-central-1
export PORT=3002
npm run dev
```

### Test

```bash
# Health check
curl http://localhost:3002/health

# List tools
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }'

# Update service (force new deployment)
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "tool": "updateService",
      "arguments": {
        "cluster": "afu9-cluster",
        "service": "afu9-control-center"
      }
    }
  }'

# Get service status
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "tool": "getServiceStatus",
      "arguments": {
        "cluster": "afu9-cluster",
        "service": "afu9-control-center"
      }
    }
  }'
```

## Docker

Build image:

```bash
cd mcp-servers
docker build -f deploy/Dockerfile -t afu9/mcp-deploy:latest .
```

Run container:

```bash
docker run -d \
  --name mcp-deploy \
  -p 3002:3002 \
  -e AWS_REGION=eu-central-1 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  afu9/mcp-deploy:latest
```

In production, use IAM roles instead of credentials:

```yaml
# ECS task definition
TaskRoleArn: arn:aws:iam::123456789:role/afu9-task-role
```

## Troubleshooting

### Server won't start

- Check that port 3002 is available
- Verify AWS credentials are configured (locally) or IAM role is attached (in ECS)
- Check logs for specific error messages

### Tool calls fail with authentication errors

- Verify IAM role has required ECS permissions
- Check AWS_REGION is set correctly
- Ensure the task is running with the correct execution role

### Service update fails

- Verify cluster and service names are correct
- Check that the service exists in the specified cluster
- Ensure the new image URI is valid and accessible
- Verify the container name matches the task definition

### Task details not returned

- Check that tasks are actually running in the service
- Verify ListTasks and DescribeTasks permissions
- Look for errors in structured logs

## See Also

- [MCP Servers README](../README.md) - Overview of all MCP servers
- [ECS Deployment Guide](../../docs/ECS-DEPLOYMENT.md) - Full deployment documentation
- [Architecture Documentation](../../docs/architecture/README.md) - System architecture
