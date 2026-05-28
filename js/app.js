/* global google */
'use strict';

let map, directionsRenderer, originAutocomplete, destAutocomplete;

const VEHICLE_EMISSION = {
  '普通車':   'GASOLINE',
  '軽自動車': 'GASOLINE',
  '中型車':   'GASOLINE',
  '大型車':   'DIESEL',
  '特大車':   'DIESEL',
};

// ── Monthly budget tracker ($200 free credit) ────────────────
const BUDGET = { monthly: 200, costPerSearch: 0.020, warnAt: 0.80 };

const UsageTracker = {
  _key: 'capymap_usage',
  _monthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  },
  _get() {
    let s = JSON.parse(localStorage.getItem(this._key) || '{}');
    if (s.month !== this._monthKey()) s = { month: this._monthKey(), searches: 0, cost: 0 };
    return s;
  },
  record() {
    const s = this._get();
    s.searches += 1;
    s.cost = +(s.searches * BUDGET.costPerSearch).toFixed(3);
    localStorage.setItem(this._key, JSON.stringify(s));
    this.render();
  },
  render() {
    const s = this._get();
    const used = s.cost || 0;
    const remaining = +(BUDGET.monthly - used).toFixed(2);
    const pct = Math.min((used / BUDGET.monthly) * 100, 100);
    const el = document.getElementById('usage-bar');
    if (!el) return;
    const fill = el.querySelector('.usage-fill');
    const label = el.querySelector('.usage-label');
    fill.style.width = `${pct}%`;
    fill.style.background = pct >= 80 ? '#ea4335' : pct >= 50 ? '#fbbc04' : '#34a853';
    label.textContent = `今月: $${used.toFixed(2)} 使用 / 残り $${remaining.toFixed(2)}（検索 ${s.searches}回）`;
    el.style.display = 'block';
    if (pct >= 80) showError(`⚠️ 月次予算の ${Math.round(pct)}% を使用済み（残り $${remaining}）`);
  },
};
// ─────────────────────────────────────────────────────────────

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.2, lng: 138.0 },
    zoom: 6,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
  });

  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    polylineOptions: { strokeColor: '#1a73e8', strokeWeight: 5 },
  });

  const opts = { componentRestrictions: { country: 'jp' }, fields: ['name', 'geometry'] };
  originAutocomplete = new google.maps.places.Autocomplete(document.getElementById('origin'), opts);
  destAutocomplete   = new google.maps.places.Autocomplete(document.getElementById('destination'), opts);
  originAutocomplete.bindTo('bounds', map);
  destAutocomplete.bindTo('bounds', map);

  document.getElementById('search-btn').addEventListener('click', searchRoute);
  document.getElementById('locate-btn').addEventListener('click', useCurrentLocation);
  document.getElementById('has-etc').addEventListener('change', function() {
    document.getElementById('etc-text').textContent = this.checked ? 'あり' : 'なし';
  });
  document.getElementById('avoid-tolls').addEventListener('change', function() {
    document.getElementById('avoid-text').textContent = this.checked ? '回避' : '使用';
  });
  ['origin','destination'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') searchRoute(); });
  });

  UsageTracker.render();
}

async function searchRoute() {
  const originVal = document.getElementById('origin').value.trim();
  const destVal   = document.getElementById('destination').value.trim();
  if (!originVal || !destVal) { showError('出発地と目的地を入力してください'); return; }

  setLoading(true);
  hideError();
  document.getElementById('result-panel').style.display = 'none';

  const avoidTolls  = document.getElementById('avoid-tolls').checked;
  const hasEtc      = document.getElementById('has-etc').checked;
  const vehicleType = document.getElementById('vehicle-type').value;

  try {
    const [directionsResult, tollInfo] = await Promise.all([
      getDirections(originVal, destVal, avoidTolls),
      avoidTolls ? Promise.resolve(null) : getTollInfo(originVal, destVal, vehicleType, hasEtc),
    ]);
    showResults(directionsResult, tollInfo, avoidTolls);
    UsageTracker.record();
  } catch (err) {
    showError(err.message || '経路の取得に失敗しました');
  } finally {
    setLoading(false);
  }
}

function getDirections(origin, destination, avoidTolls) {
  return new Promise((resolve, reject) => {
    new google.maps.DirectionsService().route(
      {
        origin, destination,
        travelMode: google.maps.TravelMode.DRIVING,
        region: 'jp', avoidTolls,
        drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
      },
      (result, status) => {
        if (status === 'OK') { directionsRenderer.setDirections(result); resolve(result); }
        else {
          const msgs = { NOT_FOUND:'場所が見つかりません', ZERO_RESULTS:'経路が見つかりません', REQUEST_DENIED:'API Keyが無効です' };
          reject(new Error(msgs[status] || `エラー: ${status}`));
        }
      }
    );
  });
}

async function getTollInfo(origin, destination, vehicleType, hasEtc) {
  const [oLatLng, dLatLng] = await Promise.all([geocode(origin), geocode(destination)]);
  const body = {
    origin:      { location: { latLng: { latitude: oLatLng.lat(), longitude: oLatLng.lng() } } },
    destination: { location: { latLng: { latitude: dLatLng.lat(), longitude: dLatLng.lng() } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TOLLS'],
    routeModifiers: {
      vehicleInfo: { emissionType: VEHICLE_EMISSION[vehicleType] || 'GASOLINE' },
      ...(hasEtc ? { tollPasses: ['JP_ETC','JP_ETC2'] } : {}),
    },
  };
  const resp = await fetch(
    `https://routes.googleapis.com/directions/v2:computeRoutes?key=${window.MAPS_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'routes.travelAdvisory.tollInfo' },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.routes?.[0]?.travelAdvisory?.tollInfo ?? null;
}

function geocode(address) {
  return new Promise((resolve, reject) => {
    new google.maps.Geocoder().geocode({ address, region: 'jp' }, (results, status) => {
      if (status === 'OK') resolve(results[0].geometry.location);
      else reject(new Error(`ジオコード失敗: ${address}`));
    });
  });
}

function showResults(directionsResult, tollInfo, avoidTolls) {
  const leg = directionsResult.routes[0].legs[0];
  document.getElementById('result-distance').textContent = leg.distance.text;
  document.getElementById('result-duration').textContent =
    leg.duration_in_traffic ? leg.duration_in_traffic.text : leg.duration.text;

  const tollCard    = document.getElementById('toll-card');
  const tollValue   = document.getElementById('result-toll');
  const tollDetail  = document.getElementById('toll-detail');
  const tollContent = document.getElementById('toll-detail-content');

  if (avoidTolls) {
    tollCard.classList.remove('highlight');
    tollValue.textContent = '無料ルート';
    tollDetail.style.display = 'none';
  } else if (tollInfo?.estimatedPrice?.length) {
    tollCard.classList.add('highlight');
    const price = tollInfo.estimatedPrice[0];
    const amt = parseInt(price.units || 0);
    tollValue.textContent = `¥${amt.toLocaleString('ja-JP')}`;

    if (tollInfo.estimatedPrice.length > 1) {
      const labels = ['通常料金','ETC料金','ETC2.0料金'];
      tollContent.innerHTML = tollInfo.estimatedPrice.map((p, i) =>
        `<div class="toll-detail-item ${i===tollInfo.estimatedPrice.length-1?'total':''}">
          <span>${labels[i]||`料金${i+1}`}</span>
          <span>¥${parseInt(p.units||0).toLocaleString('ja-JP')}</span>
        </div>`
      ).join('') + '<div class="toll-note">※ Google Maps Routes API による実際の料金データ</div>';
      tollDetail.style.display = 'block';
    } else {
      tollContent.innerHTML = `<div class="toll-note">※ Google Maps Routes API による実際の料金データ</div>`;
      tollDetail.style.display = 'block';
    }
  } else {
    tollCard.classList.remove('highlight');
    tollValue.textContent = '情報なし';
    tollDetail.style.display = 'none';
  }

  document.getElementById('result-panel').style.display = 'block';
}

function useCurrentLocation() {
  if (!navigator.geolocation) { showError('位置情報はサポートされていません'); return; }
  const btn = document.getElementById('locate-btn');
  btn.textContent = '⌛'; btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      new google.maps.Geocoder().geocode(
        { location: { lat: pos.coords.latitude, lng: pos.coords.longitude } },
        (results, status) => {
          btn.textContent = '📍'; btn.disabled = false;
          document.getElementById('origin').value =
            status === 'OK' && results[0] ? results[0].formatted_address : `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        }
      );
    },
    () => { btn.textContent = '📍'; btn.disabled = false; showError('現在地の取得に失敗しました'); },
    { timeout: 10000 }
  );
}

function setLoading(on) {
  document.getElementById('search-btn').disabled = on;
  document.getElementById('btn-text').style.display    = on ? 'none'   : 'inline';
  document.getElementById('btn-loading').style.display = on ? 'inline' : 'none';
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg; el.style.display = 'block';
}
function hideError() { document.getElementById('error-msg').style.display = 'none'; }
