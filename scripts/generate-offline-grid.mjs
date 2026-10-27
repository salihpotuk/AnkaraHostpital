import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  bbox,
  booleanIntersects,
  booleanPointInPolygon,
  booleanWithin,
  buffer,
  featureCollection,
  point,
  polygon,
  simplify,
} from "@turf/turf";
import RBush from "rbush";
import boundary from "../src/ankara-boundary.json" with { type: "json" };
import { districts, distance } from "../src/optimizer.js";

const input = process.argv[2] || "/tmp/ankara-filtered.geojson";
const outputDir = process.argv[3] || "src/data";
const raw = JSON.parse(await readFile(input, "utf8"));
const features = raw.features || [];
const R = 6371008.8;
const DEG = 180 / Math.PI;
const STEP = 200;
const roadHalfWidth = {
  motorway: 18,
  trunk: 15,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  residential: 6,
  living_street: 5,
  service: 4,
  track: 3,
  path: 2,
  footway: 2,
  cycleway: 2,
};
const isPolygon = (f) =>
  ["Polygon", "MultiPolygon"].includes(f?.geometry?.type);
const tags = (f) => f.properties || {};
const isPrivateHospital = (t) => {
  const name = (t.name || "").toLocaleLowerCase("tr");
  return (
    t.ownership === "private" ||
    t["operator:type"] === "private" ||
    t.access === "private" ||
    /özel|private|medical park|medicalpark|acıbadem|medicana|liv hospital|lösante|bayındır|güven hastan/.test(
      name,
    )
  );
};
const isPublicHospital = (f) => {
  const t = tags(f),
    name = (t.name || "").toLocaleLowerCase("tr"),
    operator = (t.operator || "").toLocaleLowerCase("tr");
  const hospital = t.amenity === "hospital" || t.healthcare === "hospital";
  return (
    hospital &&
    isPolygon(f) &&
    !isPrivateHospital(t) &&
    (["public", "state"].includes(t.ownership) ||
      ["public", "government"].includes(t["operator:type"]) ||
      /sağlık bakanlığı|ankara üniversitesi|hacettepe üniversitesi|gazi üniversitesi|ankara yıldırım beyazıt üniversitesi|sağlık bilimleri üniversitesi/.test(
        operator,
      ) ||
      /devlet hastan|şehir hastan|eğitim ve araştırma|eğitim araştırma/.test(
        name,
      ))
  );
};
const tree = new RBush();
const box = (f, extra = {}) => {
  const [minX, minY, maxX, maxY] = bbox(f);
  return { minX, minY, maxX, maxY, ...extra };
};
let buildingCount = 0,
  roadCount = 0;
for (const f of features) {
  const t = tags(f);
  let shape, type;
  try {
    if (t.building || t["building:part"]) {
      shape = buffer(f, 5, { units: "meters" });
      type = "building";
      buildingCount++;
    } else if (t.highway) {
      const width = Number(t.width);
      const half =
        Number.isFinite(width) && width > 0
          ? Math.max(width / 2, roadHalfWidth[t.highway] || 8)
          : roadHalfWidth[t.highway] || 8;
      shape = buffer(f, half + 5, { units: "meters" });
      type = "road";
      roadCount++;
    }
    if (shape) tree.insert(box(shape, { shape, type }));
  } catch {
    /* Invalid source geometry is ignored and counted in metadata below. */
  }
}
const hospitals = features.filter(isPublicHospital);
const context = [];
for (const f of features) {
  const t = tags(f);
  if (
    t.highway &&
    ["motorway", "trunk", "primary", "secondary"].includes(t.highway)
  ) {
    try {
      const g = simplify(f, {
        tolerance: 0.00035,
        highQuality: false,
        mutate: false,
      });
      g.properties = { highway: t.highway, name: t.name || null };
      context.push(g);
    } catch {}
  }
}
for (const h of hospitals) {
  h.properties = {
    kind: "public-hospital",
    name: tags(h).name || "Kamu hastanesi sahası",
  };
  context.push(h);
}
const square = (lat, lng) => {
  const dy = (STEP / 2 / R) * DEG,
    dx = (STEP / 2 / (R * Math.cos(lat / DEG))) * DEG;
  return polygon([
    [
      [lng - dx, lat - dy],
      [lng + dx, lat - dy],
      [lng + dx, lat + dy],
      [lng - dx, lat + dy],
      [lng - dx, lat - dy],
    ],
  ]);
};
const radiusFor = (pop) =>
  pop >= 400000 ? 15 : pop >= 100000 ? 8 : pop >= 50000 ? 6 : 4;
const cells = new Map();
const originLat = 38.7,
  originLng = 30.8;
for (const d of districts) {
  const radius = radiusFor(d.pop),
    dy = (STEP / R) * DEG;
  const rows = Math.ceil((radius * 1000) / STEP);
  for (let y = -rows; y <= rows; y++) {
    const lat = d.lat + y * dy,
      dx = (STEP / (R * Math.cos(lat / DEG))) * DEG;
    const cols = Math.ceil((radius * 1000) / STEP);
    for (let x = -cols; x <= cols; x++) {
      const lng = d.lng + x * dx;
      if (
        distance(d, { lat, lng }) > radius ||
        !booleanPointInPolygon(point([lng, lat]), boundary)
      )
        continue;
      const row = Math.round((lat - originLat) / dy),
        col = Math.round((lng - originLng) / dx),
        id = `${row}:${col}`;
      if (!cells.has(id))
        cells.set(id, { id, lat, lng, planningDistrict: d.name });
    }
  }
}
const candidates = [],
  rejected = { boundary: 0, building: 0, road: 0 };
for (const cell of cells.values()) {
  const footprint = square(cell.lat, cell.lng);
  if (!booleanWithin(footprint, boundary)) {
    rejected.boundary++;
    continue;
  }
  const hospital = hospitals.find((h) => booleanWithin(footprint, h));
  if (hospital) {
    const nearest = districts.reduce((a, b) =>
      distance(cell, a) < distance(cell, b) ? a : b,
    );
    candidates.push({
      ...cell,
      district: nearest.name,
      name: `${tags(hospital).name || nearest.name + " kamu hastanesi"} · yeniden kullanım`,
      kind: "hospital-reuse",
      area: 40000,
      land: 20,
      footprint: footprint.geometry,
      sourceId: hospital.id || tags(hospital).id || null,
    });
    continue;
  }
  const collision = tree
    .search(box(footprint))
    .find((o) => booleanIntersects(footprint, o.shape));
  if (collision) {
    rejected[collision.type]++;
    continue;
  }
  const nearest = districts.reduce((a, b) =>
    distance(cell, a) < distance(cell, b) ? a : b,
  );
  candidates.push({
    ...cell,
    district: nearest.name,
    name: `${nearest.name} uygun kare ${cell.id}`,
    kind: "grid-empty",
    area: 40000,
    land: 30,
    footprint: footprint.geometry,
  });
}
candidates.sort((a, b) => a.id.localeCompare(b.id));
await mkdir(outputDir, { recursive: true });
await writeFile(
  `${outputDir}/ankara-grid.json`,
  JSON.stringify({
    metadata: {
      generatedAt: new Date().toISOString(),
      source: "OpenStreetMap/Geofabrik Turkey extract",
      sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
      license: "OpenStreetMap contributors, ODbL 1.0",
      gridMeters: 200,
      cellAreaM2: 40000,
      planningRadiusRule: ">=400k:15 km; >=100k:8 km; >=50k:6 km; other:4 km",
      checkedCells: cells.size,
      availableCells: candidates.length,
      buildingFeatures: buildingCount,
      roadFeatures: roadCount,
      publicHospitalAreas: hospitals.length,
      rejected,
      caveat:
        "OSM verisi fiziksel boşluk, mülkiyet, kadastro veya imar uygunluğu garantisi vermez. Planlama yalnız ilçe merkezleri çevresini kapsar.",
    },
    candidates,
  }),
);
await writeFile(
  `${outputDir}/ankara-context.json`,
  JSON.stringify(featureCollection(context)),
);
console.log(
  JSON.stringify({
    checked: cells.size,
    available: candidates.length,
    context: context.length,
    rejected,
  }),
);
