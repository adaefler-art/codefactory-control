-- Migration 051: Fix schema_migrations table structure
-- 
-- Issue: Table has old column names (migration_id instead of filename)
-- Solution: Rename columns, add missing sha256 column, ensure indexes
-- 
-- This migration is idempotent and safe to run multiple times.

-- Step 1: Rename migration_id to filename (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'schema_migrations' 
    AND column_name = 'migration_id'
  ) THEN
    ALTER TABLE schema_migrations RENAME COLUMN migration_id TO filename;
    RAISE NOTICE 'Renamed migration_id to filename';
  ELSE
    RAISE NOTICE 'Column migration_id does not exist, skipping rename';
  END IF;
END $$;

-- Step 2: Add sha256 column if missing (for migration hash tracking)
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sha256 TEXT;

-- Step 3: Ensure applied_at column exists (should already exist, but be defensive)
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Step 4: Set default timestamp for any null applied_at values
UPDATE schema_migrations 
SET applied_at = NOW() 
WHERE applied_at IS NULL;

-- Step 5: Make applied_at NOT NULL (now that we've filled nulls)
DO $$
BEGIN
  ALTER TABLE schema_migrations 
  ALTER COLUMN applied_at SET NOT NULL;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not set applied_at to NOT NULL: %', SQLERRM;
END $$;

-- Step 6: Set default for applied_at column
ALTER TABLE schema_migrations 
ALTER COLUMN applied_at SET DEFAULT NOW();

-- Step 7: Create index for performance (idempotent)
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
ON schema_migrations(applied_at DESC);

-- Step 8: Ensure filename is the primary key
-- (Primary key should already exist from migration 048 or will be created here)
DO $$
DECLARE
  pk_constraint_name TEXT;
  pk_column_name TEXT;
BEGIN
  -- Get existing primary key info if it exists
  SELECT tc.constraint_name, kcu.column_name INTO pk_constraint_name, pk_column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'schema_migrations'
    AND tc.constraint_type = 'PRIMARY KEY'
  LIMIT 1;
  
  -- If PK exists but on wrong column, drop it
  IF pk_constraint_name IS NOT NULL AND pk_column_name != 'filename' THEN
    EXECUTE 'ALTER TABLE schema_migrations DROP CONSTRAINT ' || pk_constraint_name;
    RAISE NOTICE 'Dropped old primary key constraint on column %', pk_column_name;
    pk_constraint_name := NULL; -- Mark as needing recreation
  END IF;
  
  -- Add primary key on filename if not exists
  IF pk_constraint_name IS NULL THEN
    ALTER TABLE schema_migrations ADD PRIMARY KEY (filename);
    RAISE NOTICE 'Added primary key on filename';
  ELSE
    RAISE NOTICE 'Primary key already exists on filename';
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Error managing primary key: %', SQLERRM;
END $$;

-- Step 9: Verify final structure
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
  AND table_name = 'schema_migrations'
  AND column_name IN ('filename', 'sha256', 'applied_at');
  
  IF col_count = 3 THEN
    RAISE NOTICE '[OK] schema_migrations structure verified: filename, sha256, applied_at';
  ELSE
    RAISE WARNING '[WARNING] schema_migrations structure incomplete (found % columns)', col_count;
  END IF;
END $$;
