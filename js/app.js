// CapyMap - Japan highway toll calculator
// Map: Leaflet.js + OpenStreetMap (free, no API key)
// Routing: OSRM public API (free, no API key)
// Toll: NEXCO standard rate calculation

'use strict';

// ── Japan NEXCO toll rates ────────────────────────────────────
// Base rate (¥/km) × vehicle multiplier, tiered by distance
const VEHICLE_CONFIG = {
  '普通車':   { multiplier: 1.00, label: '普通車' },
  '軽自動車': { multiplier: 0.80, label: '軽自動車' },
  '中型車':   { multiplier: 1.20, label: '中型車' },
  '大型車':   { multiplier: 1.65, label: '大型車' },
  '特大車':   { multiplier: 2.50, label: '特大車' },
};

// NEXCO distance-tiered rate for 普通車 base
const RATE = { t1: 24.6, t2: 17.6, t3: 13.4 }; // ¥/km per tier
const ETC_DISCOUNT  = 0.10; // standard ETC discount
const ETC2_DISCOUNT = 0.20; // ETC2.0 discount (used on some roads at night)

function calcNexcoToll(distanceKm, vehicleType) {
  const cfg = VEHICLE_CONFIG[vehicleType] || VEHICLE_CONFIG['普通車'];
  let base = 0;
  if (distanceKm <= 100) {
    base = distanceKm * RATE.t1;
  } else if (distanceKm <= 200) {
    base = 100 * RATE.t1 + (distanceKm - 100) * RATE.t2;
  } else {
    base = 100 * RATE.t1 + 100 * RATE.t2 + (distanceKm - 200) * RATE.t3;
  }
  return base * cfg.multiplier;
}

function estimateToll(totalDistanceKm, vehicleType, hasEtc, avoidTolls) {
  if (avoidTolls) return { regular: 0, etc: 0, highwayKm: 0 };

  // Estimate expressway portion: for routes >50km between cities, ~70-80% is typically highway
  const ratio = totalDistanceKm < 30 ? 0.3 : totalDistanceKm < 80 ? 0.55 : 0.72;
  const highwayKm = totalDistanceKm * ratio;

  const regular = Math.round(calcNexcoToll(highwayKm, vehicleType) / 10) * 10;
  const etc = hasEtc ? Math.round(regular * (1 - ETC_DISCOUNT) / 10) * 10 : regular;

  return { regular, etc, highwayKm: Math.round(highwayKm) };
}
// ─────────────────────────────────────────────────────────────

// ── Monthly usage tracker ────────────────────────────────────
// OSRM + Nominatim are free. Tracker is ready for when Google Maps key is added.
const UsageTracker = {
  _key: 'capymap_usage',
  _monthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
  _get() {
    let s = JSON.parse(localStorage.getItem(this._key) || '{}');
    if (s.month !== this._monthKey()) s = { month: this._monthKey(), searches: 0 };
    return s;
  },
  record() {
    const s = this._get();
    s.searches++;
    localStorage.setItem(this._key, JSON.stringify(s));
    this.render();
  },
  render() {
    const s = this._get();
    const el = document.getElementById('usage-bar');
    if (!el) return;
    el.querySelector('.usage-label').textContent =
      `今月 ${s.searches} 回検索（OpenStreetMap + OSRM 使用中 — 無料）`;
    el.style.display = 'block';
    el.querySelector('.usage-fill').style.width = '0%';
  },
};
// ─────────────────────────────────────────────────────────────

// ── Map setup ────────────────────────────────────────────────
let map, routeLayer, originMarker, destMarker;

function initLeafletMap() {
  map = L.map('map', {
    center: [36.2, 138.0], // Center of Japan
    zoom: 6,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

const ICON_BLUE = L.divIcon({
  html: '<div style="width:14px;height:14px;background:#1a73e8;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7], className: '',
});
const ICON_RED = L.divIcon({
  html: '<div style="width:14px;height:14px;background:#ea4335;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7], className: '',
});
// ─────────────────────────────────────────────────────────────

// ── Geocoding via Nominatim ──────────────────────────────────
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(address)}&format=json&countrycodes=jp&limit=1&accept-language=ja`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
  if (!resp.ok) throw new Error('ジオコードに失敗しました');
  const data = await resp.json();
  if (!data.length) throw new Error(`「${address}」が見つかりません`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
}
// ─────────────────────────────────────────────────────────────

// ── Routing via OSRM ─────────────────────────────────────────
async function getRoute(origin, dest) {
  const url = `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
    `?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('経路取得に失敗しました');
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error('経路が見つかりません');
  return data.routes[0];
}
// ─────────────────────────────────────────────────────────────

// ── Main search ──────────────────────────────────────────────
async function searchRoute() {
  const originVal = document.getElementById('origin').value.trim();
  const destVal   = document.getElementById('destination').value.trim();
  if (!originVal || !destVal) { showError('出発地と目的地を入力してください'); return; }

  setLoading(true);
  hideError();
  document.getElementById('result-panel').style.display = 'none';

  const vehicleType = document.getElementById('vehicle-type').value;
  const hasEtc      = document.getElementById('has-etc').checked;
  const avoidTolls  = document.getElementById('avoid-tolls').checked;

  try {
    const [originCoord, destCoord] = await Promise.all([
      geocode(originVal),
      geocode(destVal),
    ]);

    const route = await getRoute(originCoord, destCoord);
    drawRoute(route, originCoord, destCoord);

    const distanceKm = route.distance / 1000;
    const durationSec = route.duration;
    const toll = estimateToll(distanceKm, vehicleType, hasEtc, avoidTolls);

    showResults(distanceKm, durationSec, toll, vehicleType, hasEtc, avoidTolls);
    UsageTracker.record();
  } catch (err) {
    showError(err.message || '検索に失敗しました');
  } finally {
    setLoading(false);
  }
}

function drawRoute(route, origin, dest) {
  if (routeLayer) map.removeLayer(routeLayer);
  if (originMarker) map.removeLayer(originMarker);
  if (destMarker) map.removeLayer(destMarker);

  routeLayer = L.geoJSON(route.geometry, {
    style: { color: '#1a73e8', weight: 5, opacity: 0.85 },
  }).addTo(map);

  originMarker = L.marker([origin.lat, origin.lng], { icon: ICON_BLUE }).addTo(map);
  destMarker   = L.marker([dest.lat, dest.lng],   { icon: ICON_RED  }).addTo(map);

  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
}
// ─────────────────────────────────────────────────────────────

// ── Results display ──────────────────────────────────────────
function showResults(distanceKm, durationSec, toll, vehicleType, hasEtc, avoidTolls) {
  document.getElementById('result-distance').textContent = formatDistance(distanceKm);
  document.getElementById('result-duration').textContent = formatDuration(durationSec);

  const tollCard  = document.getElementById('toll-card');
  const tollValue = document.getElementById('result-toll');
  const tollDetail = document.getElementById('toll-detail');
  const tollContent = document.getElementById('toll-detail-content');

  if (avoidTolls) {
    tollCard.classList.remove('highlight');
    tollValue.textContent = '無料ルート';
    tollDetail.style.display = 'none';
  } else {
    tollCard.classList.add('highlight');
    const displayAmt = hasEtc ? toll.etc : toll.regular;
    tollValue.textContent = displayAmt > 0 ? `¥${displayAmt.toLocaleString('ja-JP')}` : '料金なし';

    const etcDiff = toll.regular - toll.etc;
    tollContent.innerHTML = `
      <div class="toll-detail-item"><span>高速区間（推定）</span><span>${toll.highwayKm} km</span></div>
      <div class="toll-detail-item"><span>通常料金</span><span>¥${toll.regular.toLocaleString('ja-JP')}</span></div>
      ${hasEtc ? `<div class="toll-detail-item"><span>ETC割引（-10%）</span><span>-¥${etcDiff.toLocaleString('ja-JP')}</span></div>` : ''}
      <div class="toll-detail-item total"><span>${hasEtc ? 'ETC料金' : '合計料金'}</span><span>¥${displayAmt.toLocaleString('ja-JP')}</span></div>
      <div class="toll-note">※ NEXCO標準料金による概算。実際の料金は異なる場合があります。</div>
    `;
    tollDetail.style.display = 'block';
  }

  document.getElementById('result-panel').style.display = 'block';
}

function formatDistance(km) {
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m > 0 ? m + '分' : ''}`;
  return `${m}分`;
}
// ─────────────────────────────────────────────────────────────

// ── UI helpers ───────────────────────────────────────────────
function setLoading(on) {
  const btn = document.getElementById('search-btn');
  btn.disabled = on;
  document.getElementById('btn-text').style.display    = on ? 'none'   : 'inline';
  document.getElementById('btn-loading').style.display = on ? 'inline' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('error-msg').style.display = 'none';
}
// ─────────────────────────────────────────────────────────────

// ── Current location ─────────────────────────────────────────
function useCurrentLocation() {
  if (!navigator.geolocation) { showError('位置情報はサポートされていません'); return; }
  const btn = document.getElementById('locate-btn');
  btn.textContent = '⌛';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async pos => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?` +
          `lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&accept-language=ja`;
        const resp = await fetch(url);
        const data = await resp.json();
        document.getElementById('origin').value = data.display_name || '現在地';
      } catch {
        document.getElementById('origin').value =
          `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      } finally {
        btn.textContent = '📍';
        btn.disabled = false;
      }
    },
    () => { btn.textContent = '📍'; btn.disabled = false; showError('現在地の取得に失敗しました'); },
    { timeout: 10000 }
  );
}
// ─────────────────────────────────────────────────────────────

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLeafletMap();
  UsageTracker.render();

  document.getElementById('search-btn').addEventListener('click', searchRoute);
  document.getElementById('locate-btn').addEventListener('click', useCurrentLocation);

  document.getElementById('has-etc').addEventListener('change', function () {
    document.getElementById('etc-text').textContent = this.checked ? 'あり' : 'なし';
  });
  document.getElementById('avoid-tolls').addEventListener('change', function () {
    document.getElementById('avoid-text').textContent = this.checked ? '回避' : '使用';
  });

  ['origin', 'destination'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') searchRoute();
    });
  });
});
// ─────────────────────────────────────────────────────────────
