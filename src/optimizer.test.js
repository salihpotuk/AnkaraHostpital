import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, optimize } from "./optimizer.js";
const candidates = Array.from({ length: 12 }, (_, i) => ({
  id: `fixture/${i}`,
  lat: 39.9 + i * 0.004,
  lng: 32.8,
  area: 40000,
  land: 30,
  kind: "grid-empty",
}));
const p = {
  count: 6,
  bedsPerThousand: 1,
  radius: 15,
  unitCost: 2.5,
  weight: 40,
  generations: 8,
};
test("assignment conserves demand and uses unique supplied sites", () => {
  const r = evaluate(Array(12).fill(0.5), p, candidates);
  assert.equal(new Set(r.sites.map((s) => s.id)).size, 6);
  assert.equal(r.assignments.length, 25);
  assert.ok(
    Math.abs(
      r.sites.reduce((a, s) => a + s.load, 0) -
        r.assignments.reduce((a, d) => a + d.demand, 0),
    ) < 1e-6,
  );
  assert.ok(
    r.sites.every(
      (s) =>
        candidates.some((c) => c.id === s.id) &&
        s.area === 40000 &&
        s.beds >= 100 &&
        s.beds <= 500,
    ),
  );
});
test("differential evolution returns non-increasing best objective", async () => {
  let previous = Infinity;
  const r = await optimize(
    p,
    ({ result }) => {
      assert.ok(result.score <= previous);
      previous = result.score;
    },
    undefined,
    candidates,
  );
  assert.equal(r.sites.length, p.count);
  assert.ok(Number.isFinite(r.score));
});
test("same parameters and dataset produce the same result", async () => {
  const a = await optimize(p, () => {}, undefined, candidates);
  const b = await optimize(p, () => {}, undefined, candidates);
  assert.deepEqual(a, b);
});
test("missing or insufficient data cannot produce invented candidate sites", async () => {
  assert.throws(() => evaluate(Array(12).fill(0.5), p, []), /yeterli/);
  assert.throws(
    () => evaluate(Array(12).fill(0.5), p, candidates.slice(0, 3)),
    /yeterli/,
  );
  await assert.rejects(
    optimize(p, () => {}, undefined, []),
    /arazi/,
  );
});
