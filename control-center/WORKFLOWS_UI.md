# Workflows View & Trigger UI

This document describes the Workflows view and trigger UI implementation for the AFU-9 Control Center.

## Features Implemented

### 1. Workflows List View (`/workflows`)

**Location:** `app/workflows/page.tsx`

**Features:**
- Lists all defined workflows from the database
- Displays workflow name, description, and enabled status
- Shows execution counts and last run information
- Dark theme UI consistent with existing Control Center design
- Inline workflow execution trigger with JSON input
- Real-time status updates
- Error handling and loading states

**API Endpoint:** `GET /api/workflows`

### 2. Workflow Detail View (`/workflows/[id]`)

**Location:** `app/workflows/[id]/page.tsx`

**Features:**
- Displays complete workflow definition
- Shows workflow metadata (version, status, created/updated dates)
- Lists all workflow steps with tool names
- Execution history table with status indicators
- Manual trigger form with JSON parameter input
- Progress tracking (completed vs. total steps)
- Links to individual execution details
- Responsive design

**API Endpoints:**
- `GET /api/workflows/[id]` - Get workflow details
- `GET /api/workflows/[id]/executions` - Get execution history
- `POST /api/workflows/[id]/trigger` - Trigger workflow execution

### 3. Execution Detail View (`/workflows/executions/[id]`)

**Location:** `app/workflows/executions/[id]/page.tsx`

**Features:**
- Real-time execution status monitoring (auto-refreshes every 3 seconds for running executions)
- Progress bar showing completion percentage
- Step-by-step execution details with expandable sections
- Input/output display for each step in JSON format
- Error messages and retry count tracking
- Duration tracking for steps and overall execution
- Status indicators with icons (✓, ⟳, ✗, ○, ⊘)
- Timing information (started, completed, duration)
- Link back to workflow details

**API Endpoint:** `GET /api/executions/[id]`

## API Routes

All API routes are located in `app/api/`:

### Workflows Management
- **GET `/api/workflows`** - List all workflows with last run info
- **GET `/api/workflows/[id]`** - Get specific workflow details
- **GET `/api/workflows/[id]/executions`** - Get execution history for a workflow
- **POST `/api/workflows/[id]/trigger`** - Manually trigger workflow execution

### Execution Tracking
- **GET `/api/executions/[id]`** - Get detailed execution information with all steps

### Existing Endpoints (not modified)
- **POST `/api/workflow/execute`** - Execute workflow with definition
- **GET `/api/workflow/execution/[id]`** - Get execution status
- **GET `/api/workflow/executions`** - List recent executions

## Database Schema

The implementation uses the following database tables:

### `workflows`
- Stores workflow definitions (name, description, definition JSON, version, enabled status)
- Indexed on name and enabled status

### `workflow_executions`
- Tracks individual workflow runs
- Links to workflows table
- Stores status, input/output, context, timing, and error information
- Indexed on workflow_id, status, and started_at

### `workflow_steps`
- Records each step of an execution
- Links to workflow_executions table
- Stores step input/output, status, timing, error, and retry count
- Indexed on execution_id and status

## Usage Examples

### Listing Workflows
Navigate to `/workflows` to see all available workflows. Each workflow shows:
- Current enabled/disabled status
- Number of execution steps
- Last execution time and status
- Quick trigger button

### Triggering a Workflow
From the workflows list or detail page:
1. Click "Execute" or "Trigger Workflow"
2. Enter input parameters as JSON (e.g., `{"issue_number": 123, "repo": {"owner": "user", "name": "repo"}}`)
3. Click "Start Execution"
4. View execution in real-time on the detail page

### Monitoring Execution
Click on any execution to view:
- Overall progress and status
- Each step's status, input, output, and errors
- Timing information
- Retry attempts

## Navigation

The Workflows link has been added to the main navigation bar, accessible from any page in the Control Center.

## Styling

The implementation uses:
- Tailwind CSS for styling
- Dark theme consistent with the existing Control Center
- Responsive design for mobile and desktop
- Status color coding (green=success, blue=running, red=error, yellow=pending)

## Testing

To test the implementation:

1. Start the PostgreSQL database:
   ```bash
   docker-compose up postgres
   ```

2. Run migrations to create tables and example workflows:
   ```bash
   psql -h localhost -U afu9_admin -d afu9 -f database/migrations/001_initial_schema.sql
   psql -h localhost -U afu9_admin -d afu9 -f database/migrations/002_add_example_workflows.sql
   ```

3. Set up environment variables in `.env.local`:
   ```
   DATABASE_HOST=localhost
   DATABASE_PORT=5432
   DATABASE_NAME=afu9
   DATABASE_USER=afu9_admin
   DATABASE_PASSWORD=dev_password
   ```

4. Start the Control Center:
   ```bash
   cd control-center
   npm run dev
   ```

5. Navigate to http://localhost:3000/workflows

## Future Enhancements

Potential improvements for future iterations:
- Filtering and search functionality for workflows and executions
- Workflow creation/editing UI
- Execution cancellation
- Bulk operations
- Export execution logs
- Execution replay functionality
- Workflow scheduling/cron triggers
- Real-time WebSocket updates instead of polling
- Workflow analytics and performance metrics
