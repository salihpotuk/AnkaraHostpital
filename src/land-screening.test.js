import { test } from "node:test";
import assert from "node:assert/strict";
import { area, bboxPolygon, lineString, polygon } from "@turf/turf";
import {
  squareFootprint,
  sourceKind,
  screenFootprints,
  selectDisjoint,
} from "./land-screening.js";
import { queryOSM, loadLandCandidates } from "./land-data.js";

const center = { lat: 40, lng: 32.9 };
const rectangle = (bounds, tags = {}) =>
  bboxPolygon(bounds, { properties: tags });
const vacant = () =>
  rectangle([32.895, 39.995, 32.905, 40.005], { landuse: "greenfield" });
const hospital = () =>
  rectangle([32.895, 39.995, 32.905, 40.005], {
    amenity: "hospital",
    name: "Örnek Devlet Hastanesi",
  });
const building = () =>
  rectangle([32.8998, 39.9998, 32.9002, 40.0002], { building: "yes" });
test("footprint has 10,000 m² at Ankara latitudes", () => {
  for (const lat of [38.9, 40, 40.5])
    assert.ok(Math.abs(area(squareFootprint(lat, 32.9)) - 10000) < 0.001);
});
test("unmapped/residential/private/unknown hospitals never establish vacant land", () => {
  assert.equal(sourceKind(rectangle([32, 39, 33, 40])), null);
  assert.equal(
    sourceKind(rectangle([32, 39, 33, 40], { landuse: "residential" })),
    null,
  );
  assert.equal(
    sourceKind(
      rectangle([32, 39, 33, 40], {
        amenity: "hospital",
        name: "Özel Devlet Hastanesi",
        ownership: "private",
      }),
    ),
    null,
  );
  assert.equal(
    sourceKind(rectangle([32, 39, 33, 40], { amenity: "hospital" })),
    null,
  );
});
test("building in candidate footprint is rejected", () => {
  const r = screenFootprints(vacant(), [building()], [center]);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.building, 1);
});
test("road crossing a footprint with no road vertex inside is rejected, including width buffer", () => {
  const crossing = lineString(
    [
      [32.89, 40],
      [32.91, 40],
    ],
    { highway: "primary" },
  );
  assert.equal(
    screenFootprints(vacant(), [crossing], [center]).rejected.road,
    1,
  );
  const adjacent = lineString(
    [
      [32.89, 40.0005],
      [32.91, 40.0005],
    ],
    { highway: "primary" },
  );
  assert.equal(
    screenFootprints(vacant(), [adjacent], [center]).rejected.road,
    1,
  );
});
test("whole footprint must fit inside source and province, including polygon holes", () => {
  const boundary = rectangle([32.8999, 39.99, 32.91, 40.01]);
  assert.equal(
    screenFootprints(vacant(), [], [center], boundary).accepted.length,
    0,
  );
  const withHole = polygon(
    [
      vacant().geometry.coordinates[0],
      squareFootprint(40, 32.9).geometry.coordinates[0].slice().reverse(),
    ],
    { landuse: "brownfield" },
  );
  assert.equal(screenFootprints(withHole, [], [center]).accepted.length, 0);
});
test("water and parks overlapping mapped vacant land are rejected", () => {
  for (const tags of [
    { natural: "water" },
    { leisure: "park" },
    { landuse: "farmland" },
  ]) {
    const r = screenFootprints(
      vacant(),
      [rectangle([32.899, 39.999, 32.901, 40.001], tags)],
      [center],
    );
    assert.equal(r.rejected.other, 1);
  }
});
test("hospital reuse removes own buildings/internal services, but never through-roads or external buildings", () => {
  const service = lineString(
    [
      [32.899, 40],
      [32.901, 40],
    ],
    { highway: "service" },
  );
  assert.equal(
    screenFootprints(hospital(), [building(), service], [center]).accepted
      .length,
    1,
  );
  const through = lineString(
    [
      [32.89, 40],
      [32.91, 40],
    ],
    { highway: "residential" },
  );
  assert.equal(
    screenFootprints(hospital(), [building(), through], [center]).rejected.road,
    1,
  );
  const external = rectangle([32.89, 39.9998, 32.9002, 40.0002], {
    building: "yes",
  });
  assert.equal(
    screenFootprints(hospital(), [external], [center]).rejected.building,
    1,
  );
});
test("accepted candidates from different source polygons cannot overlap", () => {
  const a = { id: "a", footprint: squareFootprint(40, 32.9).geometry };
  const b = { id: "b", footprint: squareFootprint(40, 32.9001).geometry };
  const c = { id: "c", footprint: squareFootprint(40, 32.91).geometry };
  assert.deepEqual(
    selectDisjoint([b, a, c]).map((c) => c.id),
    ["a", "c"],
  );
});
test("OSM HTTP failures and partial responses fail closed", async () => {
  await assert.rejects(
    queryOSM("", undefined, async () => ({ ok: false, status: 429 }), {
      endpoints: ["https://example.test/api/interpreter"],
      rounds: 1,
      wait: async () => {},
    }),
    /429/,
  );
  await assert.rejects(
    queryOSM(
      "",
      undefined,
      async () => ({
        ok: true,
        json: async () => ({ elements: [], remark: "timeout" }),
      }),
      {
        endpoints: ["https://example.test/api/interpreter"],
        rounds: 1,
        wait: async () => {},
      },
    ),
    /504/,
  );
});
test("HTTP 502 switches to a healthy Overpass endpoint", async () => {
  const called = [];
  const response = await queryOSM(
    "",
    undefined,
    async (url) => {
      called.push(url);
      if (called.length === 1) return { ok: false, status: 502 };
      return {
        ok: true,
        json: async () => ({
          osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
          elements: [],
        }),
      };
    },
    {
      endpoints: [
        "https://first.test/api/interpreter",
        "https://second.test/api/interpreter",
      ],
      rounds: 1,
      wait: async () => {},
    },
  );
  assert.equal(called.length, 2);
  assert.equal(response.endpoint, "second.test");
  assert.equal(response.attempts, 2);
});
test("source-to-obstacle OSM pipeline returns only screened candidates with provenance", async () => {
  const osmWay = (id, tags, coords) => ({
    type: "way",
    id,
    tags,
    nodes: coords.map((_, i) =>
      i === coords.length - 1 ? id * 100 : id * 100 + i,
    ),
    geometry: coords.map(([lon, lat]) => ({ lon, lat })),
  });
  const source = osmWay(
    1,
    { landuse: "greenfield" },
    vacant().geometry.coordinates[0],
  );
  const obstacle = osmWay(
    2,
    { building: "yes" },
    building().geometry.coordinates[0],
  );
  let calls = 0;
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: ++calls === 1 ? [source] : [source, obstacle],
    }),
  });
  const r = await loadLandCandidates(
    rectangle([32.88, 39.98, 32.92, 40.02]),
    true,
    () => {},
    undefined,
    fetcher,
  );
  assert.equal(calls, 2);
  assert.ok(r.candidates.length > 0);
  assert.ok(r.metadata.rejected.building > 0);
  assert.ok(
    r.candidates.every(
      (c) =>
        c.sourceId === "way/1" && c.kind === "mapped-vacant" && c.footprint,
    ),
  );
});
