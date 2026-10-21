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

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("İptal edildi", "AbortError"));
      },
      { once: true },
    );
  });
export async function queryOSM(query, signal, fetcher = fetch, options = {}) {
  const endpoints = options.endpoints || OVERPASS_ENDPOINTS;
  const rounds = options.rounds ?? 2;
  const retryWait = options.wait || wait;
  let lastError;
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < endpoints.length; index++) {
      signal?.throwIfAborted();
      const endpoint = endpoints[index];
      const attempt = round * endpoints.length + index + 1;
      options.onRetry?.({
        attempt,
        total: rounds * endpoints.length,
        endpoint: new URL(endpoint).hostname,
      });
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.any([
            signal || new AbortController().signal,
            AbortSignal.timeout(90000),
          ]),
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          const retryAfter = Number(response.headers?.get?.("Retry-After"));
          error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
          throw error;
        }
        const data = await response.json();
        if (
          data.remark ||
          !Array.isArray(data.elements) ||
          !data.osm3s?.timestamp_osm_base
        ) {
          const error = new Error(
            "OSM sorgusu tamamlanmadı; eksik veriyle aday üretilmedi.",
          );
          error.status = 504;
          throw error;
        }
        const collection = osmtogeojson(data);
        if (collection.features.some((f) => f.properties?.tainted))
          throw new Error("OSM geometrisi eksik; alan kabul edilmedi.");
        return {
          collection,
          timestamp: data.osm3s.timestamp_osm_base,
          endpoint: new URL(endpoint).hostname,
          attempts: attempt,
        };
      } catch (error) {
        if (signal?.aborted || error.name === "AbortError") throw error;
        lastError = error;
        const retryable =
          error.name === "TimeoutError" ||
          error instanceof TypeError ||
          RETRYABLE_STATUS.has(error.status);
        const isLast = round === rounds - 1 && index === endpoints.length - 1;
        if (!retryable) throw error;
        if (isLast) break;
        const delay = Math.min(
          8000,
          error.retryAfter ? error.retryAfter * 1000 : 750 * 2 ** round,
        );
        await retryWait(delay, signal);
      }
    }
  }
  const detail = lastError?.status
    ? `HTTP ${lastError.status}`
    : lastError?.name === "TimeoutError"
      ? "zaman aşımı"
      : "bağlantı hatası";
  throw new Error(
    `OSM veri servisleri ${rounds * endpoints.length} denemede yanıt vermedi (${detail}). Birkaç dakika sonra yeniden deneyin.`,
  );
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
  const request = (query, stage, progress) =>
    queryOSM(query, signal, fetcher, {
      onRetry: ({ attempt, total, endpoint }) =>
        onProgress({
          stage: `${stage} · Sunucu denemesi ${attempt}/${total} (${endpoint})`,
          progress,
        }),
    });
  onProgress({
    stage: "Boş arazi ve kamu hastanesi sınırları alınıyor…",
    progress: 0,
  });
  const sourceData = await request(
    sourceQuery(boundary),
    "Boş arazi ve kamu hastanesi sınırları alınıyor…",
    0,
  );
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
    const { collection, timestamp, endpoint, attempts } = await request(
      obstacleQuery(source),
      `Arazi ${i + 1}/${selected.length}: bina ve yol çakışmaları kontrol ediliyor…`,
      i / Math.max(1, selected.length),
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
      endpoint,
      attempts,
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
      sourceEndpoint: sourceData.endpoint,
      sourceAttempts: sourceData.attempts,
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
