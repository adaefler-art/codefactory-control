/**
 * Unit Tests: Stage Registry
 *
 * @jest-environment node
 */

import { REQUIRED_STAGE_ROUTES, STAGE_REGISTRY } from "../../src/lib/stage-registry";

describe("stage registry", () => {
  it("defines all stages S1..S9", () => {
    const expected = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"].sort();
    const actual = Object.keys(STAGE_REGISTRY).sort();

    expect(actual).toEqual(expected);
  });

  it("declares required routes and handlers for each stage", () => {
    for (const [stageId, requiredRoutes] of Object.entries(REQUIRED_STAGE_ROUTES)) {
      const entry = STAGE_REGISTRY[stageId as keyof typeof STAGE_REGISTRY];
      expect(entry).toBeDefined();

      for (const routeKey of requiredRoutes) {
        const route = entry.routes[routeKey];
        expect(route).toBeDefined();
        expect(route?.handler).toBeTruthy();
        expect(route?.path).toBeTruthy();
        expect(route?.method).toBeTruthy();
      }
    }
  });
});
