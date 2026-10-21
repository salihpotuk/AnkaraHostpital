import osmtogeojson from "osmtogeojson";
import { area, bbox, booleanIntersects } from "@turf/turf";
import {
  sourceKind,
  screenFootprints,
  sampleCenters,
  selectDisjoint,
  SCREENING_VERSION,
} from "./land-screening.js";
import { districts, distance } from "./optimizer.js";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
export async function queryOSM(query, signal, fetcher = fetch) {
  const response = await fetcher(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(90000),
    ]),
  });
  if (!response.ok)
    throw new Error(
      `OSM veri servisi yanıt vermedi (HTTP ${response.status}).`,
    );
  const data = await response.json();
  if (
    data.remark ||
    !Array.isArray(data.elements) ||
    !data.osm3s?.timestamp_osm_base
  )
    throw new Error("OSM sorgusu tamamlanmadı; eksik veriyle aday üretilmedi.");
  const collection = osmtogeojson(data);
  if (collection.features.some((f) => f.properties?.tainted))
    throw new Error("OSM geometrisi eksik; alan kabul edilmedi.");
  return { collection, timestamp: data.osm3s.timestamp_osm_base };
}
export function sourceQuery(boundary) {
  const [w, s, e, n] = bbox(boundary),
    box = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:60];(nwr["landuse"~"^(brownfield|greenfield)$"]${box};nwr["amenity"="hospital"]${box};nwr["healthcare"="hospital"]${box};);out geom;`;
}
export function obstacleQuery(source) {
  const [w, s, e, n] = bbox(source),
    box = `(${s - 0.001},${w - 0.0015},${n + 0.001},${e + 0.0015})`;
  return `[out:json][timeout:60];(${["building", "building:part", "highway", "waterway", "water", "natural", "landuse", "landcover", "leisure", "amenity", "railway", "aeroway", "military"].map((k) => `nwr["${k}"]${box};`).join("")}nwr["boundary"="protected_area"]${box};);out geom;`;
}
export async function loadLandCandidates(
  boundary,
  includeHospitals,
  onProgress,
  signal,
  fetcher,
) {
  onProgress({
    stage: "Boş arazi ve kamu hastanesi sınırları alınıyor…",
    progress: 0,
  });
  const sourceData = await queryOSM(sourceQuery(boundary), signal, fetcher);
  const sources = sourceData.collection.features.filter(
    (f) =>
      sourceKind(f) &&
      (includeHospitals || sourceKind(f) !== "hospital-reuse") &&
      booleanIntersects(f, boundary),
  );
  sources.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Avoid unbounded public API load. Every excluded source is reported, never called screened.
  const selected = sources.filter((s) => area(s) <= 5000000).slice(0, 60);
  let all = [],
    rejected = { outside: 0, building: 0, road: 0, other: 0 },
    obstacleCount = 0;
  const scans = [];
  for (let i = 0; i < selected.length; i++) {
    if (signal?.aborted) throw new DOMException("İptal edildi", "AbortError");
    const source = selected[i];
    onProgress({
      stage: `Arazi ${i + 1}/${selected.length}: bina ve yol çakışmaları kontrol ediliyor…`,
      progress: i / Math.max(1, selected.length),
    });
    const { collection, timestamp } = await queryOSM(
      obstacleQuery(source),
      signal,
      fetcher,
    );
    const refreshed = collection.features.find((f) => f.id === source.id);
    if (
      !refreshed ||
      sourceKind(refreshed) !== sourceKind(source) ||
      JSON.stringify(refreshed.geometry) !== JSON.stringify(source.geometry)
    )
      throw new Error(
        "Kaynak arazi iki sorgu arasında değişti veya eksik geldi; yeniden tarayın.",
      );
    const result = screenFootprints(
      source,
      collection.features,
      sampleCenters(source),
      boundary,
    );
    obstacleCount += collection.features.length;
    const stats = {
      source: source.id,
      name: source.properties.name || source.id,
      timestamp,
      accepted: result.accepted.length,
      rejected: result.rejected,
    };
    scans.push(stats);
    for (const k of Object.keys(rejected)) rejected[k] += result.rejected[k];
    const siteName = source.properties.name;
    result.accepted.forEach((c, j) => {
      const district = districts.reduce((a, b) =>
        distance(c, a) < distance(c, b) ? a : b,
      );
      all.push({
        ...c,
        id: `${source.id}/${j}`,
        name: `${siteName || district.name + " boş arazi"} · ${j + 1}`,
        district: district.name,
        land: 30,
        sourceId: source.id,
        sourceName: siteName || source.properties.landuse,
        sourceUrl: `https://www.openstreetmap.org/${source.id}`,
        sourceTimestamp: timestamp,
        sourceTags: Object.fromEntries(
          [
            "landuse",
            "amenity",
            "healthcare",
            "name",
            "ownership",
            "operator:type",
          ]
            .filter((key) => source.properties[key])
            .map((key) => [key, source.properties[key]]),
        ),
        screeningVersion: SCREENING_VERSION,
      });
    });
    // Yield to the UI and pace serial public API requests. No parallel fan-out.
    await new Promise((r) => setTimeout(r, 1000));
  }
  signal?.throwIfAborted();
  const candidates = selectDisjoint(all);
  return {
    candidates,
    metadata: {
      version: SCREENING_VERSION,
      queriedAt: new Date().toISOString(),
      sourceTimestamp: sourceData.timestamp,
      includeHospitals,
      sourcesFound: sources.length,
      sourcesScreened: selected.length,
      sourcesUnscreened: sources.length - selected.length,
      obstacleCount,
      rejected,
      overlappingCandidatesRemoved: all.length - candidates.length,
      scans,
      note: "Yalnızca OSM greenfield/brownfield poligonları ve izin verilen kamu hastanesi sahaları tarandı. Kaydı olmayan araziler boş sayılmadı. Parsel, imar ve güncel fiziksel boşluk doğrulanmış değildir.",
    },
  };
}
