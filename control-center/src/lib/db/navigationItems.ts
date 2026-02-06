/**
 * Database access layer for navigation items
 * V09-I01: Navigation Management
 */

import { createPgClient } from './client';

export interface NavigationItem {
  id: string;
  role: 'admin' | 'user' | 'guest' | '*';
  href: string;
  label: string;
  position: number;
  enabled: boolean;
  icon?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NavigationItemInput {
  href: string;
  label: string;
  position: number;
  enabled?: boolean;
  icon?: string;
}

/**
 * Get navigation items for a specific role
 * Returns items for the role + items for all roles (*)
 */
export async function getNavigationItems(
  role: 'admin' | 'user' | 'guest'
): Promise<NavigationItem[]> {
  const client = await createPgClient();
  try {
    const result = await client.query<NavigationItem>(
      `SELECT id, role, href, label, position, enabled, icon, created_at, updated_at
       FROM navigation_items
       WHERE (role = $1 OR role = '*') AND enabled = true
       ORDER BY position ASC`,
      [role]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Get navigation items for a specific role (admin management view)
 * Returns only items for the specified role (not wildcard items)
 */
export async function getNavigationItemsByRole(
  role: 'admin' | 'user' | 'guest' | '*'
): Promise<NavigationItem[]> {
  const client = await createPgClient();
  try {
    const result = await client.query<NavigationItem>(
      `SELECT id, role, href, label, position, enabled, icon, created_at, updated_at
       FROM navigation_items
       WHERE role = $1
       ORDER BY position ASC`,
      [role]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Update navigation items for a role
 * Replaces all items for the role with the provided items
 */
export async function updateNavigationItems(
  role: 'admin' | 'user' | 'guest' | '*',
  items: NavigationItemInput[]
): Promise<NavigationItem[]> {
  const client = await createPgClient();
  try {
    await client.query('BEGIN');

    // Delete existing items for this role
    await client.query(
      'DELETE FROM navigation_items WHERE role = $1',
      [role]
    );

    // Insert new items
    const insertedItems: NavigationItem[] = [];
    for (const item of items) {
      const result = await client.query<NavigationItem>(
        `INSERT INTO navigation_items (role, href, label, position, enabled, icon)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, role, href, label, position, enabled, icon, created_at, updated_at`,
        [role, item.href, item.label, item.position, item.enabled ?? true, item.icon ?? null]
      );
      insertedItems.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return insertedItems;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Create a single navigation item
 */
export async function createNavigationItem(
  role: 'admin' | 'user' | 'guest' | '*',
  item: NavigationItemInput
): Promise<NavigationItem> {
  const client = await createPgClient();
  try {
    const result = await client.query<NavigationItem>(
      `INSERT INTO navigation_items (role, href, label, position, enabled, icon)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, role, href, label, position, enabled, icon, created_at, updated_at`,
      [role, item.href, item.label, item.position, item.enabled ?? true, item.icon ?? null]
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/**
 * Delete a navigation item by ID
 */
export async function deleteNavigationItem(id: string): Promise<void> {
  const client = await createPgClient();
  try {
    await client.query(
      'DELETE FROM navigation_items WHERE id = $1',
      [id]
    );
  } finally {
    await client.end();
  }
}
