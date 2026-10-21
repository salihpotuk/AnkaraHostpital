import {
  area,
  bbox,
  booleanIntersects,
  buffer,
  difference,
  featureCollection,
  polygon,
  point,
  booleanPointInPolygon,
} from "@turf/turf";
import RBush from "rbush";

const R = 6371008.8;
const DEG = 180 / Math.PI;
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
export const SCREENING_VERSION = "osm-footprint-v1";
export function squareFootprint(lat, lng) {
  // Adjust the latitude extent so spherical polygon area is exactly 10,000 m².
  const dx = (50 / (R * Math.cos(lat / DEG))) * DEG;
  const dy =
    Math.asin(10000 / (4 * R * R * (dx / DEG) * Math.cos(lat / DEG))) * DEG;
  return polygon([
    [
      [lng - dx, lat - dy],
      [lng + dx, lat - dy],
      [lng + dx, lat + dy],
      [lng - dx, lat + dy],
      [lng - dx, lat - dy],
    ],
  ]);
}
export function contained(inner, outer) {
  const remainder = difference(featureCollection([inner, outer]));
  return !remainder || area(remainder) < 0.001;
}
const isPolygon = (f) =>
  ["Polygon", "MultiPolygon"].includes(f?.geometry?.type);
export function sourceKind(f) {
  const t = f.properties || {};
  if (!isPolygon(f) || t.tainted) return null;
  const hospital = t.amenity === "hospital" || t.healthcare === "hospital";
  const name = (t.name || "").toLocaleLowerCase("tr");
  const privateSite =
    t.ownership === "private" ||
    t["operator:type"] === "private" ||
    t.access === "private" ||
    /özel|private|medical park|medicalpark|acıbadem|medicana|liv hospital|lösante|bayındır|güven hastan/.test(
      name,
    );
  const publicOperator =
    /sağlık bakanlığı|ankara üniversitesi|hacettepe üniversitesi|gazi üniversitesi|ankara yıldırım beyazıt üniversitesi|sağlık bilimleri üniversitesi/.test(
      (t.operator || "").toLocaleLowerCase("tr"),
    );
  const publicSite =
    ["public", "state"].includes(t.ownership) ||
    ["public", "government"].includes(t["operator:type"]) ||
    publicOperator ||
    /devlet hastan|şehir hastan|eğitim ve araştırma|eğitim araştırma/.test(
      name,
    );
  if (hospital) return !privateSite && publicSite ? "hospital-reuse" : null;
  // Absence of building data alone never establishes vacancy.
  if (
    ["brownfield", "greenfield"].includes(t.landuse) &&
    !t.building &&
    !t.construction &&
    !t.leisure &&
    !t.water &&
    !t.waterway &&
    !t.military &&
    !t.amenity
  )
    return "mapped-vacant";
  return null;
}
function obstacleType(f) {
  const t = f.properties || {};
  if (t.building || t["building:part"]) return "building";
  if (t.highway) return "road";
  if (
    t.water ||
    t.waterway ||
    ["water", "wetland", "wood", "scrub", "cliff", "tree", "tree_row"].includes(
      t.natural,
    ) ||
    ["trees", "forest", "farmland", "orchard", "water"].includes(t.landcover)
  )
    return "water-or-natural";
  if (t.railway || t.aeroway || t.military || t.boundary === "protected_area")
    return "restricted";
  if (
    t.leisure ||
    [
      "cemetery",
      "forest",
      "farmland",
      "orchard",
      "allotments",
      "construction",
      "military",
      "quarry",
      "landfill",
      "reservoir",
      "basin",
    ].includes(t.landuse)
  )
    return "occupied-use";
  if (t.amenity && !["hospital", "parking"].includes(t.amenity))
    return "occupied-use";
  if (t.amenity === "parking" || t.parking) return "parking";
  return null;
}
function bufferedObstacle(f, type) {
  if (type === "road") {
    const width = Number(f.properties.width);
    const halfWidth =
      Number.isFinite(width) && width > 0
        ? Math.max(width / 2, roadHalfWidth[f.properties.highway] || 8)
        : roadHalfWidth[f.properties.highway] || 8;
    return buffer(f, halfWidth + 5, { units: "meters" });
  }
  if (type === "building") return buffer(f, 5, { units: "meters" });
  if (["LineString", "MultiLineString"].includes(f.geometry.type))
    return buffer(f, 10, { units: "meters" });
  if (f.geometry.type === "Point") return buffer(f, 20, { units: "meters" });
  return f;
}
function boxItem(f, extra = {}) {
  const [minX, minY, maxX, maxY] = bbox(f);
  return { minX, minY, maxX, maxY, ...extra };
}
export function screenFootprints(source, features, centers, boundary) {
  const kind = sourceKind(source);
  if (!kind)
    throw new Error(
      "Arazi kaynağı boş arazi/kamu hastanesi koşullarını sağlamıyor.",
    );
  const tree = new RBush();
  for (const f of features) {
    const type = obstacleType(f);
    if (!type) continue;
    if (f.properties?.tainted)
      throw new Error("Eksik engel geometrisi; alan kabul edilmedi.");
    const hospitalInternal =
      kind === "hospital-reuse" &&
      (type === "building" ||
        type === "parking" ||
        (type === "road" &&
          ["service", "footway", "path"].includes(f.properties.highway))) &&
      isPolygon(f) &&
      contained(f, source);
    // Internal paths are exempt only when their entire buffered footprint lies inside the campus.
    const shape = bufferedObstacle(f, type);
    if (!shape) throw new Error("Engel geometrisi çözümlenemedi.");
    if (
      hospitalInternal ||
      (kind === "hospital-reuse" &&
        type === "road" &&
        ["service", "footway", "path"].includes(f.properties.highway) &&
        contained(shape, source))
    )
      continue;
    tree.insert(boxItem(shape, { shape, type }));
  }
  const accepted = [],
    rejected = { outside: 0, building: 0, road: 0, other: 0 };
  for (const center of centers) {
    const footprint = squareFootprint(center.lat, center.lng);
    if (
      !contained(footprint, source) ||
      (boundary && !contained(footprint, boundary))
    ) {
      rejected.outside++;
      continue;
    }
    const collision = tree
      .search(boxItem(footprint))
      .find((o) => booleanIntersects(footprint, o.shape));
    if (collision) {
      rejected[
        ["building", "road"].includes(collision.type) ? collision.type : "other"
      ]++;
      continue;
    }
    accepted.push({
      ...center,
      footprint: footprint.geometry,
      area: 10000,
      kind,
    });
  }
  return { accepted, rejected };
}
export function sampleCenters(source, limit = 2500) {
  const [west, south, east, north] = bbox(source);
  const mid = (south + north) / 2,
    dy = (50 / R) * DEG,
    dx = (50 / (R * Math.cos(mid / DEG))) * DEG;
  const nx = Math.ceil((east - west) / dx),
    ny = Math.ceil((north - south) / dy);
  const stride = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / limit)));
  const centers = [];
  for (let y = 0; y < ny; y += stride)
    for (let x = 0; x < nx; x += stride) {
      const lat = south + (y + 0.5) * dy,
        lng = west + (x + 0.5) * dx;
      if (booleanPointInPolygon(point([lng, lat]), source))
        centers.push({ lat, lng });
    }
  return centers;
}
export function selectDisjoint(candidates) {
  const tree = new RBush(),
    accepted = [];
  for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    const shape = { type: "Feature", geometry: c.footprint, properties: {} };
    if (
      tree.search(boxItem(shape)).some((o) => booleanIntersects(shape, o.shape))
    )
      continue;
    tree.insert(boxItem(shape, { shape }));
    accepted.push(c);
  }
  return accepted;
}
