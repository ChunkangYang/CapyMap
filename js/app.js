/* global google */
'use strict';

// ── Auth ──────────────────────────────────────────────────────
const ALLOWED_EMAILS = ['cky1983@gmail.com', 'meilin709@gmail.com'];
const SESSION_KEY    = 'capymap_session';
const SESSION_TTL    = 7 * 24 * 60 * 60 * 1000;

const VEHICLE_EMISSION = {
  '普通車':'GASOLINE','軽自動車':'GASOLINE','中型車':'GASOLINE',
  '大型車':'DIESEL','特大車':'DIESEL',
};

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s || Date.now() > s.exp || !ALLOWED_EMAILS.includes(s.email)) {
      localStorage.removeItem(SESSION_KEY); return null;
    }
    return s;
  } catch { return null; }
}

function saveSession(email, name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email, name, exp: Date.now() + SESSION_TTL }));
}

function parseJwt(token) {
  const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(decodeURIComponent(
    atob(b64).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')
  ));
}

window.handleCredentialResponse = function(response) {
  const { email, name } = parseJwt(response.credential);
  if (!ALLOWED_EMAILS.includes(email)) {
    document.getElementById('login-error').textContent = `${email} はアクセス権がありません。`;
    return;
  }
  saveSession(email, name);
  launchApp(email, name);
};

function signOut() {
  localStorage.removeItem(SESSION_KEY);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  location.reload();
}
window.signOut = signOut;

document.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (session) launchApp(session.email, session.name);
  else showLoginScreen();
});

function showLoginScreen() {
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const clientId = window.OAUTH_CLIENT_ID;
  if (!clientId || clientId.length < 10) {
    document.getElementById('login-error').textContent = 'OAuth Client ID が設定されていません。';
    return;
  }
  waitForGIS(() => {
    google.accounts.id.initialize({ client_id: clientId, callback: window.handleCredentialResponse, auto_select: false });
    google.accounts.id.renderButton(document.getElementById('google-signin-btn'),
      { theme:'outline', size:'large', text:'signin_with', locale:'ja', width:240 });
  });
}

function waitForGIS(cb, tries=0) {
  if (window.google?.accounts?.id) { cb(); return; }
  if (tries > 50) { document.getElementById('login-error').textContent = 'サインインの読み込みに失敗しました。'; return; }
  setTimeout(() => waitForGIS(cb, tries+1), 100);
}

function launchApp(email, name) {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-name').textContent = name || email;
  loadMapsApi();
}

function loadMapsApi() {
  const key = window.MAPS_API_KEY;
  if (!key || key.length < 20) { showError('Maps API Key が設定されていません。'); return; }
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&language=ja&region=JP&callback=initMap`;
  s.async = true;
  document.head.appendChild(s);
}
// ─────────────────────────────────────────────────────────────

// ── Budget tracker ────────────────────────────────────────────
const BUDGET = { monthly: 200, costPerSearch: 0.025 };
const UsageTracker = {
  _key: 'capymap_usage',
  _mk() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; },
  _get() { let s=JSON.parse(localStorage.getItem(this._key)||'{}'); if(s.month!==this._mk()) s={month:this._mk(),searches:0,cost:0}; return s; },
  record() { const s=this._get(); s.searches++; s.cost=+(s.searches*BUDGET.costPerSearch).toFixed(3); localStorage.setItem(this._key,JSON.stringify(s)); this.render(); },
  render() {
    const s=this._get(); const used=s.cost||0; const rem=+(BUDGET.monthly-used).toFixed(2);
    const pct=Math.min((used/BUDGET.monthly)*100,100); const el=document.getElementById('usage-bar');
    if (!el) return;
    el.querySelector('.usage-fill').style.width=`${pct}%`;
    el.querySelector('.usage-fill').style.background=pct>=80?'#ea4335':pct>=50?'#fbbc04':'#34a853';
    el.querySelector('.usage-label').textContent=`今月: $${used.toFixed(2)} / 残り $${rem.toFixed(2)}（検索 ${s.searches}回）`;
    el.style.display='block';
  },
};
// ─────────────────────────────────────────────────────────────

// ── Map ───────────────────────────────────────────────────────
let map, originAutocomplete, destAutocomplete;
let routePolylines = [];
let selectedRouteIndex = 0;
let lastOriginCoord = null;
let lastDestCoord = null;
let lastVehicleType = '普通車';
let lastHasEtc = true;

window.initMap = function() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat:36.2, lng:138.0 }, zoom:6,
    mapTypeControl:false, streetViewControl:false, fullscreenControl:false,
    gestureHandling:'greedy',
  });

  const opts = { componentRestrictions:{country:'jp'}, fields:['name','geometry'] };
  originAutocomplete = new google.maps.places.Autocomplete(document.getElementById('origin'), opts);
  destAutocomplete   = new google.maps.places.Autocomplete(document.getElementById('destination'), opts);
  originAutocomplete.bindTo('bounds', map);
  destAutocomplete.bindTo('bounds', map);

  document.getElementById('search-btn').addEventListener('click', searchRoutes);
  document.getElementById('locate-btn').addEventListener('click', useCurrentLocation);
  document.getElementById('has-etc').addEventListener('change', function() {
    document.getElementById('etc-text').textContent = this.checked ? 'あり' : 'なし';
  });
  document.getElementById('avoid-tolls').addEventListener('change', function() {
    document.getElementById('avoid-text').textContent = this.checked ? '回避' : '使用';
  });
  ['origin','destination'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') searchRoutes(); });
  });
  UsageTracker.render();
};

// Decode Google encoded polyline → [{lat,lng}]
function decodePolyline(encoded) {
  const pts = []; let i=0, lat=0, lng=0;
  while (i < encoded.length) {
    let b, shift=0, result=0;
    do { b=encoded.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; } while (b>=0x20);
    lat += (result&1)?~(result>>1):(result>>1);
    shift=result=0;
    do { b=encoded.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; } while (b>=0x20);
    lng += (result&1)?~(result>>1):(result>>1);
    pts.push({ lat:lat/1e5, lng:lng/1e5 });
  }
  return pts;
}

function drawRoutes(routes, selectedIdx) {
  routePolylines.forEach(p => p.setMap(null));
  routePolylines = [];

  const bounds = new google.maps.LatLngBounds();

  routes.forEach((route, i) => {
    const path = decodePolyline(route.polyline.encodedPolyline);
    path.forEach(p => bounds.extend(p));

    const isSelected = i === selectedIdx;
    const polyline = new google.maps.Polyline({
      path,
      strokeColor: isSelected ? ROUTE_COLORS[i] : '#b0bec5',
      strokeWeight: isSelected ? 5 : 3,
      strokeOpacity: isSelected ? 0.9 : 0.5,
      zIndex: isSelected ? 10 : i,
      map,
    });

    polyline.addListener('click', () => selectRoute(i));
    routePolylines.push(polyline);
  });

  map.fitBounds(bounds, { padding:40 });
}

const ROUTE_COLORS = ['#1a73e8','#e53935','#2e7d32','#f57c00'];

function selectRoute(idx) {
  selectedRouteIndex = idx;
  const routes = window._lastRoutes;
  if (!routes) return;
  drawRoutes(routes, idx);
  document.querySelectorAll('.route-card').forEach((card, i) => {
    card.classList.toggle('selected', i === idx);
  });
}
// ─────────────────────────────────────────────────────────────

// ── Search ────────────────────────────────────────────────────
async function searchRoutes() {
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
    const [oCoord, dCoord] = await Promise.all([geocode(originVal), geocode(destVal)]);
    lastOriginCoord = oCoord;
    lastDestCoord = dCoord;
    lastVehicleType = vehicleType;
    lastHasEtc = hasEtc;
    const routes = await fetchRoutes(oCoord, dCoord, vehicleType, hasEtc, avoidTolls);

    if (!routes.length) throw new Error('経路が見つかりません');

    window._lastRoutes = routes;
    selectedRouteIndex = 0;
    drawRoutes(routes, 0);
    renderRouteCards(routes, avoidTolls, hasEtc, vehicleType);
    UsageTracker.record();
  } catch(err) {
    showError(err.message || '経路の取得に失敗しました');
  } finally {
    setLoading(false);
  }
}

async function fetchRoutes(oCoord, dCoord, vehicleType, hasEtc, avoidTolls) {
  const body = {
    origin:      { location: { latLng: { latitude:oCoord.lat(), longitude:oCoord.lng() } } },
    destination: { location: { latLng: { latitude:dCoord.lat(), longitude:dCoord.lng() } } },
    travelMode: 'DRIVE',
    routingPreference: avoidTolls ? 'TRAFFIC_AWARE' : 'TRAFFIC_AWARE',
    computeAlternativeRoutes: !avoidTolls, // alternatives only when tolls are used
    extraComputations: avoidTolls ? [] : ['TOLLS'],
    routeModifiers: {
      avoidTolls,
      vehicleInfo: { emissionType: VEHICLE_EMISSION[vehicleType]||'GASOLINE' },
      ...(hasEtc && !avoidTolls ? { tollPasses:['JP_ETC','JP_ETC2'] } : {}),
    },
  };

  const resp = await fetch(
    `https://routes.googleapis.com/directions/v2:computeRoutes?key=${window.MAPS_API_KEY}`,
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Goog-FieldMask':'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo,routes.description,routes.legs.steps.navigationInstruction.instructions',
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(()=>({}));
    throw new Error(err.error?.message || 'Routes API エラー');
  }
  const data = await resp.json();
  return data.routes || [];
}

function geocode(address) {
  return new Promise((resolve, reject) => {
    new google.maps.Geocoder().geocode({ address, region:'jp' }, (results, status) => {
      if (status==='OK') resolve(results[0].geometry.location);
      else reject(new Error(`「${address}」が見つかりません`));
    });
  });
}
// ─────────────────────────────────────────────────────────────

// ── Toll verification helpers ─────────────────────────────────
const DORA_CAR_TYPE = { '普通車':1, '軽自動車':2, '中型車':3, '大型車':4, '特大車':5 };

function extractHighwayICs(route) {
  const steps = route.legs?.[0]?.steps || [];
  // Match IC / JCT names: Japanese chars + IC or JCT suffix
  const icRe = /([ぁ-鿿\w]{1,12}(?:IC|JCT))/;
  const ics = [];
  for (const step of steps) {
    const instr = step.navigationInstruction?.instructions || '';
    const m = instr.match(icRe);
    if (m && !ics.includes(m[1])) ics.push(m[1]);
  }
  return { entryIC: ics[0] || null, exitIC: ics[ics.length - 1] || null };
}

function buildVerifyUrl(entryIC, exitIC, vehicleType, hasEtc) {
  const carType = DORA_CAR_TYPE[vehicleType] || 1;
  const etcUse  = hasEtc ? 1 : 0;
  // ドラぷら (Drive Plaza) — NEXCO official toll calculator
  if (entryIC && exitIC && entryIC !== exitIC) {
    return `https://www.driveplaza.com/dp/SearchTop?sName=${encodeURIComponent(entryIC)}&dName=${encodeURIComponent(exitIC)}&way=1&car_type=${carType}&etc_use=${etcUse}`;
  }
  // Fallback: Google Maps with coordinates
  if (lastOriginCoord && lastDestCoord) {
    return `https://www.google.com/maps/dir/?api=1&origin=${lastOriginCoord.lat()},${lastOriginCoord.lng()}&destination=${lastDestCoord.lat()},${lastDestCoord.lng()}&travelmode=driving`;
  }
  return 'https://www.driveplaza.com/dp/SearchTop';
}
// ─────────────────────────────────────────────────────────────

// ── Route cards UI ────────────────────────────────────────────
function renderRouteCards(routes, avoidTolls, hasEtc, vehicleType) {
  // Find best CP (lowest toll/km) and fastest
  let cheapestIdx = -1, fastestIdx = 0;
  let lowestTollPerKm = Infinity, shortestDuration = Infinity;

  routes.forEach((r, i) => {
    const km = r.distanceMeters / 1000;
    const sec = parseDuration(r.duration);
    const toll = getTollAmount(r);

    if (sec < shortestDuration) { shortestDuration = sec; fastestIdx = i; }
    if (toll > 0) {
      const perKm = toll / km;
      if (perKm < lowestTollPerKm) { lowestTollPerKm = perKm; cheapestIdx = i; }
    }
  });

  const html = routes.map((route, i) => {
    const km   = (route.distanceMeters / 1000).toFixed(1);
    const sec  = parseDuration(route.duration);
    const toll = getTollAmount(route);
    const tollPerKm = toll > 0 ? Math.round(toll / (route.distanceMeters/1000)) : 0;

    const badges = [];
    if (i === cheapestIdx) badges.push('<span class="badge badge-cheap">最安</span>');
    if (i === fastestIdx)  badges.push('<span class="badge badge-fast">最速</span>');

    const tollText = avoidTolls ? '無料ルート'
      : toll > 0 ? `¥${toll.toLocaleString('ja-JP')}`
      : '料金情報なし';

    const color = ROUTE_COLORS[i] || '#607d8b';

    // IC extraction for verification link
    const { entryIC, exitIC } = extractHighwayICs(route);
    const verifyUrl = !avoidTolls ? buildVerifyUrl(entryIC, exitIC, vehicleType, hasEtc) : null;
    const icLabel = entryIC && exitIC && entryIC !== exitIC
      ? `${entryIC} → ${exitIC}`
      : (entryIC || '');
    const verifyHtml = verifyUrl
      ? `<a class="verify-link" href="${verifyUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔍 ドラぷらで確認${icLabel ? `（${icLabel}）` : ''}</a>`
      : '';

    return `
      <div class="route-card ${i===0?'selected':''}" data-index="${i}" onclick="selectRoute(${i})" style="--route-color:${color}">
        <div class="route-card-header">
          <span class="route-dot" style="background:${color}"></span>
          <span class="route-num">ルート ${i+1}</span>
          <span class="route-badges">${badges.join('')}</span>
        </div>
        <div class="route-stats">
          <div class="route-stat"><span>🛣️</span><span>${km} km</span></div>
          <div class="route-stat"><span>⏱️</span><span>${formatDuration(sec)}</span></div>
          <div class="route-stat toll-stat">
            <span>💴</span>
            <span class="toll-amount">${tollText}</span>
            ${tollPerKm > 0 ? `<span class="toll-per-km">¥${tollPerKm}/km</span>` : ''}
          </div>
        </div>
        ${verifyHtml}
      </div>`;
  }).join('');

  document.getElementById('route-list').innerHTML = html;
  document.getElementById('result-panel').style.display = 'block';
}

function getTollAmount(route) {
  const prices = route.travelAdvisory?.tollInfo?.estimatedPrice;
  if (!prices?.length) return 0;
  return parseInt(prices[0].units || 0);
}

function parseDuration(durationStr) {
  // format: "1234s" or "1234.567s"
  return parseFloat((durationStr || '0').replace('s',''));
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m > 0 ? m+'分' : ''}`;
  return `${m}分`;
}
// ─────────────────────────────────────────────────────────────

// ── Current location ─────────────────────────────────────────
function useCurrentLocation() {
  if (!navigator.geolocation) { showError('位置情報はサポートされていません'); return; }
  const btn = document.getElementById('locate-btn');
  btn.textContent='⌛'; btn.disabled=true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      new google.maps.Geocoder().geocode(
        { location:{ lat:pos.coords.latitude, lng:pos.coords.longitude } },
        (results, status) => {
          btn.textContent='📍'; btn.disabled=false;
          document.getElementById('origin').value =
            status==='OK' && results[0] ? results[0].formatted_address
              : `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        }
      );
    },
    () => { btn.textContent='📍'; btn.disabled=false; showError('現在地の取得に失敗しました'); },
    { timeout:10000 }
  );
}
// ─────────────────────────────────────────────────────────────

// ── UI helpers ───────────────────────────────────────────────
function setLoading(on) {
  document.getElementById('search-btn').disabled = on;
  document.getElementById('btn-text').style.display    = on ? 'none'   : 'inline';
  document.getElementById('btn-loading').style.display = on ? 'inline' : 'none';
}
function showError(msg) { const el=document.getElementById('error-msg'); el.textContent=msg; el.style.display='block'; }
function hideError()    { document.getElementById('error-msg').style.display='none'; }
// ─────────────────────────────────────────────────────────────
