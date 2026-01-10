/**
 * Migration snapshot test: ensure append-only trigger is defined for cost_control_events.
 *
 * @jest-environment node
 */

import fs from 'node:fs';
import path from 'node:path';

describe('scripts/cost-control-schema.sql', () => {
  it('defines no-update/no-delete triggers for cost_control_events', () => {
    const sqlPath = path.resolve(process.cwd(), '..', 'scripts', 'cost-control-schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS cost_control_events');
    expect(sql).toContain('cost_control_events_no_update_delete');
    expect(sql).toContain('trg_cost_control_events_no_update');
    expect(sql).toContain('trg_cost_control_events_no_delete');
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+ON\s+cost_control_events/i);
    expect(sql).toMatch(/BEFORE\s+DELETE\s+ON\s+cost_control_events/i);
  });
});
