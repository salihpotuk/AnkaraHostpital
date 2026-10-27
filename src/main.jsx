import boundary from "./ankara-boundary.json";
import gridData from "./data/ankara-grid.json";
import context from "./data/ankara-context.json";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import {
  Activity,
  ArrowUpRight,
  Layers,
  MapPin,
  Play,
  SlidersHorizontal,
  X,
  Plus,
  Minus,
  LocateFixed,
  ChevronRight,
  Info,
  Download,
  Check,
  Building2,
  Users,
  Wallet,
  RotateCcw,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import "./style.css";
import { districts, optimize } from "./optimizer";
const defaults = {
  count: 8,
  radius: 15,
  weight: 35,
  bedsPerThousand: 1,
  unitCost: 2.5,
  generations: 120,
};
const num = (n) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n);
const EARTH_RADIUS = 6371008.8;
const gridFootprint = (lat, lng) => {
  const dy = (100 / EARTH_RADIUS) * (180 / Math.PI);
  const dx =
    (100 / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - dx, lat - dy],
        [lng + dx, lat - dy],
        [lng + dx, lat + dy],
        [lng - dx, lat + dy],
        [lng - dx, lat - dy],
      ],
    ],
  };
};
const emptyResult = {
  sites: [],
  assignments: [],
  cost: 0,
  coverage: 0,
  avgDistance: 0,
  shortage: 0,
  totalBeds: 0,
  radius: 15,
};
const textTooltip = (text) => {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
};
function MapView({ result, selected, onSelect, layers, focus, candidates }) {
  const el = useRef(),
    map = useRef(),
    group = useRef(),
    gridGroup = useRef();
  useEffect(() => {
    map.current = L.map(el.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([39.96, 32.79], 10);
    map.current.getContainer().classList.add("offline-map");
    map.current.zoomControl.setPosition("topright");
    L.geoJSON(boundary, {
      style: {
        color: "#57765a",
        weight: 1.5,
        dashArray: "5 5",
        fillColor: "#edf1e6",
        fillOpacity: 0.72,
      },
      interactive: false,
    }).addTo(map.current);
    L.geoJSON(context, {
      style: (feature) =>
        feature.properties?.kind === "public-hospital"
          ? {
              color: "#b18042",
              weight: 1,
              fillColor: "#dfbd83",
              fillOpacity: 0.35,
            }
          : {
              color:
                feature.properties?.highway === "motorway"
                  ? "#bc9a67"
                  : "#c6b795",
              weight: feature.properties?.highway === "motorway" ? 2.2 : 1.2,
              opacity: 0.75,
            },
      interactive: false,
    }).addTo(map.current);
    districts.forEach((d) =>
      L.marker([d.lat, d.lng], {
        interactive: false,
        icon: L.divIcon({
          className: "district-label",
          html: `<span>${d.name}</span>`,
          iconSize: [90, 18],
          iconAnchor: [45, 9],
        }),
      }).addTo(map.current),
    );
    L.control
      .scale({ imperial: false, position: "bottomright" })
      .addTo(map.current);
    group.current = L.layerGroup().addTo(map.current);
    gridGroup.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);
  useEffect(() => {
    if (!group.current) return;
    group.current.clearLayers();
    if (layers.populationMode === "circle")
      districts.forEach((d) =>
        L.circle([d.lat, d.lng], {
          radius: Math.sqrt(d.pop) * 7,
          color: "#e2a95b",
          weight: 1,
          fillColor: "#e4ab5d",
          fillOpacity: 0.13,
          interactive: false,
        }).addTo(group.current),
      );
    if (layers.populationMode === "heat")
      L.heatLayer(
        districts.map((d) => [d.lat, d.lng, Math.sqrt(d.pop) / 1000]),
        {
          radius: 52,
          blur: 38,
          maxZoom: 12,
          minOpacity: 0.22,
          gradient: {
            0.2: "#d9e9b1",
            0.45: "#f2d476",
            0.7: "#e99b55",
            1: "#bb4f3f",
          },
        },
      ).addTo(group.current);
    if (layers.coverage)
      result.sites.forEach((s) =>
        L.circle([s.lat, s.lng], {
          radius: result.radius * 1000,
          color: "#287761",
          weight: 1,
          dashArray: "5 7",
          fillOpacity: 0.035,
          interactive: false,
        }).addTo(group.current),
      );
    result.sites.forEach((s, i) => {
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="hospital-pin ${selected === s.id ? "active" : ""}"><span>✚</span><b>${String(i + 1).padStart(2, "0")}</b></div>`,
          iconSize: [47, 34],
          iconAnchor: [23, 34],
        }),
      }).addTo(group.current);
      marker.on("click", () => onSelect(s.id));
      marker.bindTooltip(textTooltip(`${s.name} · ${s.beds} yatak`));
    });
  }, [result, selected, layers, candidates]);
  useEffect(() => {
    if (!map.current || !gridGroup.current) return;
    const draw = () => {
      gridGroup.current.clearLayers();
      if (!layers.parcels || map.current.getZoom() < 11) return;
      const bounds = map.current.getBounds();
      candidates
        .filter((s) => bounds.contains([s.lat, s.lng]))
        .slice(0, 6000)
        .forEach((s) => {
          L.geoJSON(
            {
              type: "Feature",
              geometry: gridFootprint(s.lat, s.lng),
              properties: {},
            },
            {
              style: {
                color: s.kind === "hospital-reuse" ? "#ae7a34" : "#43816b",
                weight: 0.7,
                fillOpacity: 0.2,
              },
            },
          )
            .bindTooltip(
              textTooltip(
                `${s.name} · 200 × 200 m · ${s.kind === "hospital-reuse" ? "Kamu hastanesi yeniden kullanım" : "Bina/yol çakışması bulunmayan kare"}`,
              ),
            )
            .addTo(gridGroup.current);
        });
    };
    draw();
    map.current.on("moveend zoomend", draw);
    return () => map.current?.off("moveend zoomend", draw);
  }, [layers.parcels, candidates]);
  useEffect(() => {
    if (focus && map.current)
      focus.all
        ? map.current.fitBounds(L.geoJSON(boundary).getBounds(), {
            padding: [20, 20],
            animate: true,
          })
        : map.current.flyTo([focus.lat, focus.lng], 17, { duration: 1.2 });
  }, [focus]);
  return <div className="map" ref={el} />;
}
function App() {
  const [p, setP] = useState(defaults),
    [result, setResult] = useState(emptyResult),
    [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(null),
    [layers, setLayers] = useState({
      populationMode: "heat",
      parcels: true,
      coverage: false,
    }),
    [running, setRunning] = useState(false),
    [progress, setProgress] = useState(0),
    [history, setHistory] = useState([]),
    [modal, setModal] = useState(false),
    [tab, setTab] = useState("plan"),
    [completed, setCompleted] = useState(false),
    [error, setError] = useState("");
  const control = useRef();
  const land = useRef({
    metadata: gridData.metadata,
    candidates: gridData.candidates.map((candidate) => ({
      ...candidate,
      area: 40000,
      name:
        candidate.name || `${candidate.district} uygun kare ${candidate.id}`,
    })),
  }).current;
  useEffect(() => () => control.current?.abort(), []);
  const dirty = JSON.stringify(p) !== JSON.stringify(result.params || defaults);
  const site = result.sites.find((s) => s.id === selected);
  const hasResult = result.sites.length > 0;
  function update(k, v) {
    setP((x) => ({ ...x, [k]: Number(v) }));
  }
  async function run() {
    setRunning(true);
    setCompleted(false);
    setError("");
    setSelected(null);
    control.current = new AbortController();
    try {
      await optimize(
        p,
        ({ progress, result, history }) => {
          setProgress(progress);
          setResult({ ...result, radius: p.radius, params: { ...p } });
          setHistory(history);
        },
        control.current.signal,
        land.candidates,
      );
      setCompleted(true);
    } catch (e) {
      if (e.message !== "cancelled")
        setError(e.message || "Hesaplama tamamlanamadı. Yeniden deneyin.");
    } finally {
      setRunning(false);
    }
  }
  useEffect(() => {
    if (land.candidates.length >= defaults.count) run();
  }, []);
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            disclaimer:
              "Offline OSM grid screening is preliminary; parcels, zoning and population are not officially verified",
            parameters: result.params || defaults,
            landScreening: land.metadata,
            ...result,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ankara-hastane-senaryosu.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="app">
      <aside className="rail">
        <a className="brandmark" href="#" aria-label="Ankara Atlas">
          a<span>+</span>
        </a>
        <button
          className={tab === "plan" ? "rail-btn chosen" : "rail-btn"}
          onClick={() => setTab("plan")}
          title="Planlama"
        >
          <Layers size={21} />
        </button>
        <button
          className={tab === "results" ? "rail-btn chosen" : "rail-btn"}
          onClick={() => setTab("results")}
          title="Sonuçlar"
        >
          <Activity size={21} />
        </button>
        <button
          className="rail-btn"
          onClick={() => setModal(true)}
          title="Model hakkında"
        >
          <Info size={21} />
        </button>
        <div className="rail-bottom">SP</div>
      </aside>
      <div className="workspace">
        <header>
          <div className="wordmark">
            ankara<span>atlas</span>
            <small>SAĞLIK YERLEŞİM LABORATUVARI</small>
          </div>
          <div className="breadcrumb">
            Çalışma alanı <ChevronRight size={14} />{" "}
            <b>Ankara / Yeni senaryo</b>
          </div>
          <button className="outline" onClick={() => setModal(true)}>
            Modeli keşfet <ArrowUpRight size={15} />
          </button>
          <div className="avatar">SP</div>
        </header>
        <div className="body">
          <aside className="sidebar">
            <div className="section-label">
              <span className="dot" /> STRATEJİK PLANLAMA{" "}
              <span className="version">V.01</span>
            </div>
            <h1>
              Sağlığa erişimi
              <br />
              yeniden düşün.
            </h1>
            <p className="intro">
              Ankara için daha erişilebilir, daha dengeli bir hastane ağı
              tasarla.
            </p>
            <section
              className="land-panel"
              aria-label="Çevrimdışı arazi ızgarası"
            >
              <div className="block-title">
                Hazır arazi ızgarası <span>200 × 200 m</span>
              </div>
              {land.metadata.status === "pending" ? (
                <p className="scan-error">
                  Çevrimdışı Ankara ızgarası GitHub Actions tarafından
                  hazırlanıyor. Veri commit'i tamamlanınca hastaneler otomatik
                  görünecek.
                </p>
              ) : (
                <div className="scan-report">
                  <b>{num(land.metadata.availableCells)} uygun kare hazır</b>
                  <span>
                    {num(land.metadata.checkedCells)} kare,{" "}
                    {num(land.metadata.buildingFeatures)} bina ve{" "}
                    {num(land.metadata.roadFeatures)} yol kaydı bir kez kontrol
                    edildi.
                  </span>
                  <span>
                    {
                      land.candidates.filter((c) => c.kind === "hospital-reuse")
                        .length
                    }{" "}
                    kare kamu hastanesi sahası yeniden kullanım adayı.
                  </span>
                  <span>
                    Üretim:{" "}
                    {new Date(land.metadata.generatedAt).toLocaleDateString(
                      "tr-TR",
                    )}
                  </span>
                </div>
              )}
              <small>
                Uygulama açılırken internetten arazi aramaz. Kareler ilçe
                merkezlerinin nüfusa göre belirlenen planlama çevrelerini
                kapsar. OSM verisi mülkiyet ve imar garantisi vermez.
              </small>
            </section>
            <div className="tabs">
              <button
                className={tab === "plan" ? "on" : ""}
                onClick={() => setTab("plan")}
              >
                <SlidersHorizontal size={14} /> Parametreler
              </button>
              <button
                className={tab === "results" ? "on" : ""}
                onClick={() => setTab("results")}
              >
                <Activity size={14} /> Analiz sonuçları
              </button>
            </div>
            {tab === "plan" ? (
              <>
                <div className="block-title">
                  Yerleşim kurgusu <span>01</span>
                </div>
                <div className="field">
                  <label>
                    Yeni hastane sayısı <Info size={13} />
                  </label>
                  <div className="stepper">
                    <button
                      disabled={running || p.count <= 1}
                      onClick={() => update("count", p.count - 1)}
                      aria-label="Hastane azalt"
                    >
                      <Minus size={16} />
                    </button>
                    <strong>
                      {p.count}
                      <small>hastane</small>
                    </strong>
                    <button
                      disabled={running || p.count >= 20}
                      onClick={() => update("count", p.count + 1)}
                      aria-label="Hastane artır"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <Range
                  label="Hedef erişim yarıçapı"
                  value={p.radius}
                  min={5}
                  max={40}
                  unit="km"
                  onChange={(v) => update("radius", v)}
                  disabled={running}
                />
                <div className="block-title">
                  Optimizasyon öncelikleri <span>02</span>
                </div>
                <div className="balance">
                  <Wallet size={15} />
                  <span>Maliyet</span>
                  <b>%{p.weight}</b>
                </div>
                <input
                  aria-label="Maliyet ağırlığı"
                  type="range"
                  min="10"
                  max="90"
                  value={p.weight}
                  disabled={running}
                  onChange={(e) => update("weight", e.target.value)}
                />
                <div className="range-labels">
                  <span>Erişim önceliği</span>
                  <span>Maliyet önceliği</span>
                </div>
                <div className="priority">
                  <Users size={15} />
                  <span>Erişim ve kapasite önceliği</span>
                  <b>%{100 - p.weight}</b>
                </div>
                <div className="two-fields">
                  <label>
                    Yatak / 1.000 kişi
                    <select
                      disabled={running}
                      value={p.bedsPerThousand}
                      onChange={(e) =>
                        update("bedsPerThousand", e.target.value)
                      }
                    >
                      <option value="0.5">0,5 yatak</option>
                      <option value="1">1,0 yatak</option>
                      <option value="2">2,0 yatak</option>
                      <option value="3">3,0 yatak</option>
                    </select>
                  </label>
                  <label>
                    Yatak maliyeti
                    <select
                      disabled={running}
                      value={p.unitCost}
                      onChange={(e) => update("unitCost", e.target.value)}
                    >
                      <option value="1.5">1,5 M ₺</option>
                      <option value="2.5">2,5 M ₺</option>
                      <option value="4">4,0 M ₺</option>
                    </select>
                  </label>
                </div>
                <div className="block-title">
                  Algoritma <span>03</span>
                </div>
                <div className="algorithm">
                  <div className="alg-icon">
                    <Activity size={19} />
                  </div>
                  <div>
                    <b>Diferansiyel evrim</b>
                    <small>DE/rand/1/bin · 36 birey</small>
                  </div>
                  <span className="alg-check">
                    <Check size={14} />
                  </span>
                </div>
                <Range
                  label="Nesil sayısı"
                  min={40}
                  max={240}
                  value={p.generations}
                  unit=""
                  onChange={(v) => update("generations", v)}
                  disabled={running}
                />
              </>
            ) : (
              <div className="results-list">
                <div className="block-title">
                  Önerilen hastaneler <span>{result.sites.length}</span>
                </div>
                {result.sites.map((s, i) => (
                  <button
                    className={
                      "site-row " + (selected === s.id ? "selected" : "")
                    }
                    key={s.id}
                    onClick={() => {
                      setSelected(s.id);
                      setFocus(s);
                    }}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <b>{s.name}</b>
                      <small>
                        {s.beds} yatak ·{" "}
                        {num(
                          s.land +
                            160 +
                            s.beds * (result.params?.unitCost || 2.5),
                        )}{" "}
                        M ₺
                      </small>
                    </div>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            )}
            <div className="sidebar-footer">
              <div className="assumption">
                <Info size={15} />
                <span>
                  Mevcut hastaneler yok sayılır.
                  <br />
                  Yalnızca önceden kontrol edilmiş 200 × 200 m kareler
                  kullanılır.
                </span>
              </div>
              <button
                className="run"
                disabled={!running && land.candidates.length < p.count}
                onClick={running ? () => control.current.abort() : run}
              >
                {running ? (
                  <>
                    <span className="spinner" /> Durdur · %
                    {Math.round(progress * 100)}
                  </>
                ) : (
                  <>
                    <Play size={16} fill="currentColor" />{" "}
                    {completed
                      ? "Yeniden optimize et"
                      : "Senaryoyu optimize et"}
                    <ArrowUpRight size={17} />
                  </>
                )}
              </button>
              {land.candidates.length < p.count && (
                <small className="dirty">
                  Çevrimdışı veri seti henüz hazır değil veya {p.count} hastane
                  için yeterli aday içermiyor.
                </small>
              )}
              {dirty && (
                <small className="dirty">
                  Parametreler değişti. Sonuçları yeniden hesaplayın.
                </small>
              )}
              {error && <small>{error}</small>}
            </div>
          </aside>
          <main>
            <div className="map-top">
              <div>
                <span className="eyebrow">ANKARA, TÜRKİYE</span>
                <h2>Bir şehir. Daha iyi olasılıklar.</h2>
                <p>Veriden karara, sağlık yatırımlarına yeni bir bakış.</p>
              </div>
              <button
                className="export"
                onClick={download}
                disabled={!hasResult || running}
              >
                <Download size={15} /> Senaryoyu indir
              </button>
            </div>
            <section className="map-shell">
              <MapView
                result={result}
                selected={selected}
                onSelect={setSelected}
                layers={layers}
                focus={focus}
                candidates={land.candidates}
              />
              <div className="map-badge">
                <span className="dot" />{" "}
                {running
                  ? "OPTİMİZASYON ÇALIŞIYOR"
                  : completed
                    ? "OPTİMİZE EDİLEN SENARYO"
                    : "HAZIR SENARYO YÜKLENİYOR"}
                <span className="badge-divider" /> Çevrimdışı 200 m ızgara
              </div>
              <div className="layer-panel">
                <div>
                  <Layers size={15} />
                  <b>Harita katmanları</b>
                </div>
                <label className="population-selector">
                  <span className="legend-dot amber" />
                  <span>Nüfus görünümü</span>
                  <select
                    value={layers.populationMode}
                    onChange={(e) =>
                      setLayers({ ...layers, populationMode: e.target.value })
                    }
                  >
                    <option value="heat">Isı haritası</option>
                    <option value="circle">Daireler</option>
                    <option value="off">Kapalı</option>
                  </select>
                </label>
                {[
                  ["parcels", "Uygun 200 × 200 m kareler", "sage"],
                  ["coverage", "Erişim yarıçapı", "green"],
                ].map(([key, label, color]) => (
                  <label key={key}>
                    <span className={"legend-dot " + color} />
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={() =>
                        setLayers({ ...layers, [key]: !layers[key] })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="map-note">
                <span className="legend-dot green" /> Önerilen hastane{" "}
                <span className="legend-dot sage" /> Uygun 200 m kare{" "}
                <span className="legend-dot hospital" /> Hastane sahası{" "}
                <span className="note-light">
                  © OpenStreetMap contributors · Parsel/imar doğrulanmamıştır
                </span>
              </div>
              <button
                className="all-ankara"
                onClick={() => setFocus({ all: true })}
              >
                <LocateFixed size={14} /> Tüm Ankara
              </button>
              <div className="north">
                N<span>↑</span>
              </div>
              {site && (
                <div className="site-detail">
                  <button
                    className="close"
                    aria-label="Kapat"
                    onClick={() => setSelected(null)}
                  >
                    <X size={17} />
                  </button>
                  <span className="eyebrow">ÖNERİLEN YATIRIM</span>
                  <h3>{site.name}</h3>
                  <p>{site.beds} yatak · 40.000 m² (200 × 200 m) aday alan</p>
                  <div className={"site-kind " + site.kind}>
                    {site.kind === "hospital-reuse"
                      ? "Kamu hastanesi sahası · yeniden kullanım"
                      : "Bina ve yol çakışması bulunmayan ızgara karesi"}
                  </div>
                  <p>
                    {site.kind === "hospital-reuse"
                      ? "Bu sahanın mevcut hastane binaları ve iç servis yolları senaryo gereği kaldırılabilir sayıldı. Dış binalar ve kamu yolları muaf tutulmadı."
                      : "200 × 200 m kare, çevrimdışı OSM verisindeki kayıtlı bina (+5 m) ve yol (genişlik +5 m) geometrileriyle çakışmıyor."}
                  </p>
                  <small>
                    Veri üretimi:{" "}
                    {land.metadata.generatedAt
                      ? new Date(land.metadata.generatedAt).toLocaleDateString(
                          "tr-TR",
                        )
                      : "hazırlanıyor"}
                    . Harita verisindeki eksikler ve değişiklikler için güncel
                    uydu/saha kontrolü gerekir.
                  </small>
                  <div>
                    <b>{num(site.load)}</b> model yatak talebi
                  </div>
                  <p>
                    En yakın tesis atamasında{" "}
                    {result.assignments
                      .filter((d) => result.sites[d.site].id === site.id)
                      .map((d) => d.name)
                      .join(", ") || "hiçbir ilçeye"}{" "}
                    hizmet verir. Seçim, toplam maliyet ve erişim/kapasite
                    cezasının birlikte azaltılmasına dayanır.
                  </p>
                  <small>
                    100–500 yatak kapasitesi, imar ve kat alanı incelemesi
                    gerektiren bir model varsayımıdır.
                  </small>
                </div>
              )}
            </section>
            <div className="metrics">
              <Metric
                icon={<Users />}
                label="Erişim kapsamı"
                value={hasResult ? `%${num(result.coverage * 100)}` : "—"}
                sub={`${result.radius} km içinde yaşayan model nüfusu`}
                trend="Nüfus ağırlıklı"
              />
              <Metric
                icon={<Building2 />}
                label="Toplam yatak kapasitesi"
                value={hasResult ? num(result.totalBeds) : "—"}
                sub={`${result.sites.length} yeni devlet hastanesi`}
                trend="100–500 yatak / tesis"
              />
              <Metric
                icon={<Wallet />}
                label="Tahmini yatırım"
                value={hasResult ? `${num(result.cost / 1000)} Mr ₺` : "—"}
                sub="Arsa + sabit tesis + yatak maliyeti"
                trend="Örnek maliyet modeli"
              />
              <Metric
                icon={<MapPin />}
                label="Ortalama erişim"
                value={hasResult ? `${num(result.avgDistance)} km` : "—"}
                sub="Nüfus ağırlıklı kuş uçuşu mesafe"
                trend={`Kapasite açığı %${num(result.shortage * 100)}`}
              />
            </div>
            <div className="bottom-row">
              <div className="insight">
                <div className="insight-icon">
                  <Activity size={21} />
                </div>
                <div>
                  <b>
                    {completed
                      ? "Senaryonun dengesi görünür oldu."
                      : "Daha adil bir dağılım, veriye dayalı bir başlangıç."}
                  </b>
                  <p>
                    {completed
                      ? `${p.generations} nesil tamamlandı. Sonuç yaklaşık bir çözümdür; küresel optimum garantisi vermez.`
                      : "Parametreleri belirle, algoritmayı çalıştır ve alternatif yerleşimleri haritada keşfet."}
                  </p>
                </div>
                {history.length > 1 ? (
                  <svg viewBox="0 0 150 40" className="spark">
                    <polyline
                      fill="none"
                      stroke="#33846b"
                      strokeWidth="2"
                      points={history
                        .map(
                          (v, i) =>
                            `${(i / (history.length - 1)) * 150},${5 + ((v - Math.min(...history)) / (Math.max(...history) - Math.min(...history) || 1)) * 30}`,
                        )
                        .join(" ")}
                    />
                  </svg>
                ) : (
                  <span className="pill">
                    {land.candidates.length} hazır ızgara adayı
                  </span>
                )}
              </div>
              <button className="method" onClick={() => setModal(true)}>
                Bu model nasıl çalışıyor? <ArrowUpRight size={17} />
              </button>
            </div>
            <footer>
              <span>
                <span className="dot" /> Araştırma ve senaryo geliştirme ortamı
              </span>
              <span>
                Örnek veriler · Resmî yatırım kararı için kullanılamaz
              </span>
            </footer>
          </main>
        </div>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <article
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setModal(false)}
              aria-label="Kapat"
            >
              <X />
            </button>
            <span className="eyebrow">YAKLAŞIM & VERİ ŞEFFAFLIĞI</span>
            <h2 id="model-title">Hangi hastane, nerede ve neden?</h2>
            <p>
              Bu laboratuvar, Ankara'da hiçbir mevcut hastane yokmuş gibi devlet
              hastaneleri planlar. Özel hastaneler de modele dahil edilmez.
            </p>
            <h3>01 / Talep ve adaylar</h3>
            <p>
              25 ilçenin yaklaşık, örnek nüfus değerleri ilçe merkezlerinde
              toplanır. Bunlar resmî güncel veriler değildir; mahalle ölçeğinde
              nüfus yoğunluğu temsil edilmez. Isı haritası bu ilçe noktalarının
              yumuşatılmış görselidir. Ankara, ilçe merkezleri çevresinde 200 ×
              200 metre karelere bölünür. Bir defalık çevrimdışı üretimde
              OpenStreetMap bina geometrilerine 5 m, yol eksenlerine tahmini
              yarı genişlik +5 m pay bırakılır; çakışan kareler elenir.
            </p>
            <p>
              Kamu niteliği etiket/ad üzerinden saptanabilen mevcut hastane
              sınırları yeniden kullanım adayıdır ve kendi yapıları
              kaldırılabilir varsayılır. Özel veya kamu niteliği belirsiz
              hastaneler bu istisnaya girmez. Izgara tüm il yüzeyini taramaz:
              nüfusu 400 bin üzerindeki ilçe merkezlerinde 15 km, 100 bin
              üzerindekilerde 8 km, 50 bin üzerindekilerde 6 km, diğerlerinde 4
              km planlama yarıçapı kullanır.
            </p>
            <p>
              Veri GitHub Actions tarafından üretilip uygulamayla paketlenir;
              tarayıcı harita veya arazi API'sine bağlanmaz. OSM tam/güncel bir
              kadastro değildir. Boş görünen her kare mülkiyet, eğim, zemin,
              çevre ve imar yönünden ayrıca incelenmelidir. Aynı veri ve
              parametreler aynı optimizasyon sonucunu verir.
            </p>
            <h3>02 / Diferansiyel evrim</h3>
            <p>
              36 bireylik popülasyonda her hastanenin konumu ve 100–500 arası
              yatak kapasitesi birlikte aranır. Mutasyon 0,65, çaprazlama
              0,80'dir. Her ilçe en yakın hastaneye atanır; kapasite aşımı
              cezalandırılır. Yolculuk süresi yerine kuş uçuşu mesafe
              kullanılır.
            </p>
            <div className="formula">
              Amaç = w × (maliyet / 5.000 M ₺) + (1 − w) × [2 × kapsam dışı oran
              + ortalama km / 30 + 2 × kapasite açığı oranı]
            </div>
            <p>
              Maliyet = arsa (20–50 M ₺ örnek) + tesis başına 160 M ₺ + yatak
              sayısı × seçilen birim maliyet. İşletme gideri ve iskonto dahil
              değildir. Memnuniyet doğrudan ölçülmez; erişim ve yeterli kapasite
              vekil ölçütleridir.
            </p>
            <h3>03 / Gerçek kullanım için gerekenler</h3>
            <p>
              TÜİK/ADNKS mahalle nüfusu, yapı ve kadastro verisi, imar ve
              mülkiyet bilgisi, eğim/afet kısıtları, yol ağı ve gerçek maliyet
              keşfi gerekir. 40.000 m² aday kare uygunluğu bu veriler olmadan
              yapılamaz. Sonuçlar mevcut haliyle bir senaryo prototipidir.
            </p>
            <button className="run" onClick={() => setModal(false)}>
              Haritayı keşfet <ArrowUpRight size={16} />
            </button>
          </article>
        </div>
      )}
    </div>
  );
}
function Range({ label, value, min, max, unit, onChange, disabled }) {
  return (
    <div className="field range-field">
      <label>
        {label}
        <b>
          {value} <span>{unit}</span>
        </b>
      </label>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="range-labels">
        <span>
          {min} {unit}
        </span>
        <span>
          {max} {unit}
        </span>
      </div>
    </div>
  );
}
function Metric({ icon, label, value, sub, trend }) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{sub}</p>
      <span>{trend}</span>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
