import boundary from "./ankara-boundary.json";
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
    group = useRef();
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    map.current = L.map(el.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([39.96, 32.79], 10);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
      crossOrigin: true,
    })
      .on("tileerror", () => setTileError(true))
      .on("tileload", () => setTileError(false))
      .addTo(map.current);
    map.current.zoomControl.setPosition("topright");
    L.geoJSON(boundary, {
      style: {
        color: "#57765a",
        weight: 1.5,
        dashArray: "5 5",
        fillOpacity: 0.015,
      },
      interactive: false,
    }).addTo(map.current);
    L.control
      .scale({ imperial: false, position: "bottomright" })
      .addTo(map.current);
    group.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);
  useEffect(() => {
    if (!group.current) return;
    group.current.clearLayers();
    if (layers.population)
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
    if (layers.parcels)
      candidates.forEach((s) => {
        L.geoJSON(
          { type: "Feature", geometry: s.footprint, properties: {} },
          {
            style: {
              color: s.kind === "hospital-reuse" ? "#ae7a34" : "#43816b",
              weight: 1,
              fillOpacity: 0.25,
            },
          },
        )
          .bindTooltip(
            textTooltip(
              `${s.name} · 10.000 m² · ${s.kind === "hospital-reuse" ? "Kamu hastanesi sahası (yeniden kullanım)" : "OSM boş arazi taraması"}`,
            ),
          )
          .addTo(group.current);
      });
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
    if (focus && map.current)
      focus.all
        ? map.current.fitBounds(L.geoJSON(boundary).getBounds(), {
            padding: [20, 20],
            animate: true,
          })
        : map.current.flyTo([focus.lat, focus.lng], 17, { duration: 1.2 });
  }, [focus]);
  return (
    <>
      <div className="map" ref={el} />
      {tileError && (
        <div className="tile-warning">
          Altlık harita yüklenemedi. İnternet erişimini kontrol edin; il sınırı
          ve model katmanları kullanılabilir.
        </div>
      )}
    </>
  );
}
function App() {
  const [p, setP] = useState(defaults),
    [result, setResult] = useState(emptyResult),
    [land, setLand] = useState({ candidates: [], metadata: null }),
    [includeHospitals, setIncludeHospitals] = useState(true),
    [scanning, setScanning] = useState(false),
    [scanStatus, setScanStatus] = useState({
      stage: "Henüz arazi taraması yapılmadı.",
      progress: 0,
    }),
    [scanError, setScanError] = useState(""),
    [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(null),
    [layers, setLayers] = useState({
      population: true,
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
  const scanControl = useRef();
  useEffect(
    () => () => {
      control.current?.abort();
      scanControl.current?.abort();
    },
    [],
  );
  const dirty = JSON.stringify(p) !== JSON.stringify(result.params || defaults);
  const site = result.sites.find((s) => s.id === selected);
  const hasResult = result.sites.length > 0;
  async function scan() {
    setScanning(true);
    setScanError("");
    setLand({ candidates: [], metadata: null });
    setResult(emptyResult);
    setSelected(null);
    setCompleted(false);
    setHistory([]);
    scanControl.current = new AbortController();
    try {
      const { loadLandCandidates } = await import("./land-data");
      const data = await loadLandCandidates(
        boundary,
        includeHospitals,
        setScanStatus,
        scanControl.current.signal,
      );
      setLand(data);
      setScanStatus({
        progress: 1,
        stage: `${data.candidates.length} çakışmayan aday bulundu.`,
      });
      if (!data.candidates.length)
        setScanError(
          "Bu taramada koşulları sağlayan alan bulunamadı. Veri kaydı olmayan yerler boş kabul edilmedi.",
        );
    } catch (e) {
      setScanError(
        e.name === "AbortError"
          ? "Tarama iptal edildi. Eksik veriyle aday üretilmedi."
          : `${e.message} Eksik veriyle aday üretilmedi.`,
      );
    } finally {
      setScanning(false);
    }
  }
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
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            disclaimer:
              "Illustrative model, not verified parcels or official population data",
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
              aria-label="Arazi uygunluk taraması"
            >
              <div className="block-title">
                Arazi uygunluk taraması <span>OSM</span>
              </div>
              <p>
                Yalnızca haritada boş/geliştirilmemiş işaretli alanlar taranır.
                Bina, yol, su ve korunan kullanımlarla çakışan kareler elenir.
              </p>
              <label className="hospital-toggle">
                <input
                  type="checkbox"
                  checked={includeHospitals}
                  disabled={running || scanning}
                  onChange={(e) => {
                    setIncludeHospitals(e.target.checked);
                    setLand({ candidates: [], metadata: null });
                    setResult(emptyResult);
                    setCompleted(false);
                    setHistory([]);
                    setSelected(null);
                    setScanError("");
                    setScanStatus({
                      stage:
                        "Seçenek değişti. Arazi taramasını yeniden çalıştırın.",
                      progress: 0,
                    });
                  }}
                />
                Kamu hastanesi sahalarını yeniden kullan
              </label>
              <small>
                Bu sahaların kendi binaları ve iç servis yolları senaryo gereği
                kaldırılabilir sayılır. Özel ve sahipliği belirsiz hastaneler
                dahil edilmez.
              </small>
              <button
                className="scan-button"
                disabled={running}
                onClick={scanning ? () => scanControl.current.abort() : scan}
              >
                {scanning ? (
                  <>
                    <span className="spinner" /> Taramayı durdur
                  </>
                ) : (
                  <>
                    <MapPin size={14} />{" "}
                    {land.metadata
                      ? "Arazileri yeniden tara"
                      : "Aday arazileri tara"}
                  </>
                )}
              </button>
              <p role="status">{scanStatus.stage}</p>
              {scanning && (
                <progress
                  aria-label="Arazi tarama ilerlemesi"
                  max="1"
                  value={scanStatus.progress}
                />
              )}
              {scanError && (
                <p className="scan-error" role="alert">
                  {scanError}
                </p>
              )}
              {land.metadata && (
                <div className="scan-report">
                  <b>
                    {
                      land.candidates.filter((c) => c.kind === "mapped-vacant")
                        .length
                    }{" "}
                    boş arazi adayı ·{" "}
                    {
                      land.candidates.filter((c) => c.kind === "hospital-reuse")
                        .length
                    }{" "}
                    hastane sahası
                  </b>
                  <span>
                    {land.metadata.rejected.building} bina,{" "}
                    {land.metadata.rejected.road} yol,{" "}
                    {land.metadata.rejected.other} diğer kullanım çakışması
                    elendi.
                  </span>
                  <span>
                    {land.metadata.sourcesScreened} kaynak saha tarandı;{" "}
                    {land.metadata.sourcesUnscreened} saha boyut/sorgu sınırı
                    nedeniyle taranmadı.
                  </span>
                  <span>
                    Veri:{" "}
                    {new Date(land.metadata.sourceTimestamp).toLocaleDateString(
                      "tr-TR",
                    )}{" "}
                    · Örneklemeli tarama; tüm Ankara'nın boş parsel envanteri
                    değildir.
                  </span>
                </div>
              )}
              <small>
                OSM taraması fiziksel boşluk, mülkiyet ve imar garantisi vermez.
                Güncel görüntü ve saha kontrolü gerekir.
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
                  Yalnızca arazi taramasını geçen 10.000 m² adaylar kullanılır.
                </span>
              </div>
              <button
                className="run"
                disabled={
                  scanning || (!running && land.candidates.length < p.count)
                }
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
              {!scanning && land.candidates.length < p.count && (
                <small className="dirty">
                  {land.candidates.length} taranmış aday var; {p.count} hastane
                  için yeterli değil. Önce tarayın veya hastane sayısını
                  azaltın.
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
                disabled={!hasResult || running || scanning}
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
                    : scanning
                      ? "ARAZİ TARAMASI"
                      : "ARAZİ VERİSİ BEKLENİYOR"}
                <span className="badge-divider" /> OSM arazi ön incelemesi
              </div>
              <div className="layer-panel">
                <div>
                  <Layers size={15} />
                  <b>Harita katmanları</b>
                </div>
                {[
                  ["population", "Nüfus talebi", "amber"],
                  ["parcels", "Taranan 10.000 m² alanlar", "sage"],
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
                <span className="legend-dot sage" /> OSM boş alan adayı{" "}
                <span className="legend-dot hospital" /> Hastane sahası{" "}
                <span className="note-light">
                  Parsel uygunluğu doğrulanmamıştır
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
                  <p>{site.beds} yatak · 10.000 m² aday alan</p>
                  <div className={"site-kind " + site.kind}>
                    {site.kind === "hospital-reuse"
                      ? "Kamu hastanesi sahası · yeniden kullanım"
                      : "OSM boş/geliştirilmemiş arazi adayı"}
                  </div>
                  <p>
                    {site.kind === "hospital-reuse"
                      ? "Bu sahanın mevcut hastane binaları ve iç servis yolları senaryo gereği kaldırılabilir sayıldı. Dış binalar ve kamu yolları muaf tutulmadı."
                      : "100 × 100 m kare, OSM boş/geliştirilmemiş poligonunun tamamen içinde. Kayıtlı bina (+5 m), yol (genişlik +5 m), su ve korunan kullanımlarla çakışma bulunmadı."}
                  </p>
                  <a
                    className="source-link"
                    href={site.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OSM kaynak sahayı incele ↗
                  </a>
                  <small>
                    Kaynak tarihi:{" "}
                    {new Date(site.sourceTimestamp).toLocaleDateString("tr-TR")}
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
                    {land.candidates.length} taranmış aday
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
              nüfus yoğunluğu temsil edilmez. Sabit/rastgele aday konumlar
              kaldırılmıştır. OpenStreetMap'te greenfield/brownfield olarak
              işaretlenmiş poligonlarda 100 × 100 metre kareler aranır. Kayıtlı
              binalara 5 m, yollara tahmini yarı genişliği +5 m pay bırakılır.
              Su, korunan alan, tarım, orman, park ve diğer kayıtlı
              kullanımlarla çakışan kareler elenir. Kare il sınırının ve kaynak
              poligonun tamamen içinde olmalıdır. Sadece bina kaydı bulunmaması
              boşluk kanıtı sayılmaz.
            </p>
            <p>
              Kamu hastanelerini yeniden kullan seçeneği açıksa, kamu niteliği
              etiket/ad üzerinden saptanabilen hastane poligonları da adaydır.
              Kendi binaları, otoparkları ve iç servis yolları kaldırılabilir
              varsayılır; dış yollar ve diğer kullanımlar elenir. Özel veya kamu
              niteliği belirsiz hastaneler dahil edilmez. Bunlar boş arazi
              olarak etiketlenmez, yeniden kullanım olarak gösterilir.
            </p>
            <p>
              OSM tam veya güncel bir kadastro değildir. Yalnızca kayıtlı aday
              kaynaklar taranır; 5 km²'den büyük kaynaklar atlanır ve en fazla
              60 kaynak, kaynak başına yaklaşık 2.500 merkez örneklenir. Atlanan
              kaynak sayısı ve eleme nedenleri gösterilir. Aday karelerin
              birbirleriyle çakışması engellenir. Yetersiz aday/veri hatasında
              optimizasyon çalışmaz. Aynı veri ve parametreler aynı sonucu
              verir.
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
              keşfi gerekir. 10.000 m² boş alan tespiti bu veriler olmadan
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
