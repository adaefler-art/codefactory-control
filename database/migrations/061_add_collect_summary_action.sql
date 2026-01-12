-- Migration 061: Add collect_summary action to registry (E83.3)
--
-- Adds the collect_summary action to the default repository actions registry
-- to enable implementation summary collection from PRs.

-- Add collect_summary action to the default registry
DO $$
DECLARE
  v_registry_id VARCHAR(255) := 'codefactory-control-default';
  v_current_content JSONB;
  v_new_action JSONB;
BEGIN
  -- Get current registry content
  SELECT content INTO v_current_content
  FROM repo_actions_registry
  WHERE registry_id = v_registry_id;

  -- Skip if registry doesn't exist
  IF v_current_content IS NULL THEN
    RAISE NOTICE 'Registry % not found, skipping', v_registry_id;
    RETURN;
  END IF;

  -- Create new action definition
  v_new_action := jsonb_build_object(
    'actionType', 'collect_summary',
    'enabled', true,
    'preconditions', jsonb_build_array(),
    'requireEvidence', true,
    'description', 'Collect implementation summary from PR (description, comments, checks)'
  );

  -- Add action to allowedActions array if not already present
  IF NOT EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(v_current_content->'allowedActions') AS action
    WHERE action->>'actionType' = 'collect_summary'
  ) THEN
    -- Update registry with new action
    UPDATE repo_actions_registry
    SET content = jsonb_set(
      content,
      '{allowedActions}',
      content->'allowedActions' || v_new_action
    ),
    updated_at = NOW(),
    updated_by = 'system'
    WHERE registry_id = v_registry_id;

    RAISE NOTICE 'Added collect_summary action to registry %', v_registry_id;
  ELSE
    RAISE NOTICE 'collect_summary action already exists in registry %', v_registry_id;
  END IF;
END $$;
