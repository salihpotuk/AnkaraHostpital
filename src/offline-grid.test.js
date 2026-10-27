import { test } from "node:test";
import assert from "node:assert/strict";
import { area, booleanWithin, polygon } from "@turf/turf";
import boundary from "./ankara-boundary.json" with { type: "json" };
import grid from "./data/ankara-grid.json" with { type: "json" };

test(
  "generated offline grid contains unique 200 metre candidates inside Ankara",
  {
    skip:
      grid.metadata.status === "pending"
        ? "GitHub Actions data generation is pending"
        : false,
  },
  () => {
    assert.equal(grid.metadata.gridMeters, 200);
    assert.equal(grid.metadata.cellAreaM2, 40000);
    assert.ok(grid.candidates.length >= 8);
    assert.equal(
      new Set(grid.candidates.map((c) => c.id)).size,
      grid.candidates.length,
    );
    for (const candidate of grid.candidates) {
      const dy = (100 / 6371008.8) * (180 / Math.PI);
      const dx =
        (100 / (6371008.8 * Math.cos((candidate.lat * Math.PI) / 180))) *
        (180 / Math.PI);
      const feature = polygon([
        [
          [candidate.lng - dx, candidate.lat - dy],
          [candidate.lng + dx, candidate.lat - dy],
          [candidate.lng + dx, candidate.lat + dy],
          [candidate.lng - dx, candidate.lat + dy],
          [candidate.lng - dx, candidate.lat - dy],
        ],
      ]);
      assert.ok(Math.abs(area(feature) - 40000) < 1);
      assert.ok(booleanWithin(feature, boundary));
      assert.ok(["grid-empty", "hospital-reuse"].includes(candidate.kind));
    }
  },
);
