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
let lastOriginText = '';
let lastDestText = '';

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
    document.getElementById('avoid-text').textContent = this.checked ? 'ON' : 'OFF';
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

  const avoidTolls  = !document.getElementById('avoid-tolls').checked; // ON=使用有料道路, OFF=回避
  const hasEtc      = document.getElementById('has-etc').checked;
  const vehicleType = document.getElementById('vehicle-type').value;

  try {
    const [oCoord, dCoord] = await Promise.all([geocode(originVal), geocode(destVal)]);
    lastOriginCoord = oCoord;
    lastDestCoord = dCoord;
    lastOriginText = originVal;
    lastDestText = destVal;
    lastVehicleType = vehicleType;
    lastHasEtc = hasEtc;
    const routes = await fetchRoutes(oCoord, dCoord, vehicleType, hasEtc, avoidTolls);

    if (!routes.length) throw new Error('経路が見つかりません');

    window._lastRoutes = routes;
    selectedRouteIndex = 0;
    drawRoutes(routes, 0);
    // First-pass render so user sees the route immediately; ic labels filled by enrichment.
    renderRouteCards(routes, avoidTolls, hasEtc, vehicleType);
    UsageTracker.record();
    // Async enrich IC names via Places when text extraction couldn't get a real IC.
    if (!avoidTolls) {
      Promise.all(routes.map(r => enrichRouteICs(r))).then(() => {
        renderRouteCards(routes, avoidTolls, hasEtc, vehicleType);
      });
    }
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
        'X-Goog-FieldMask':'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo,routes.description,routes.legs.steps.navigationInstruction,routes.legs.steps.startLocation,routes.legs.steps.endLocation',
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

  // Strip false-positive patterns first. "○○入口（交差点）" is a street intersection name,
  // not a highway IC. Drop the entire "入口/出口（...交差点...）" segment so the IC regex
  // doesn't see "グランパル入口" as an interchange.
  const cleanTxt = (t) => (t || '')
    .replace(/(?:入口|出口)?[（(][^)）]*?交差点[)）]/g, '');

  // Non-greedy on prefix so "厚木IC出口" matches as {厚木, IC} and the regex resumes after IC,
  // instead of greedily eating "厚木IC" + "出口" and producing a bogus "厚木ICIC".
  const icRe = /([一-龯ァ-ヶーA-Za-z0-9々ぁ-ん]{1,10}?)(IC|JCT|ランプ|本線料金所|出口|入口)/g;
  const NOISE = ['方面', '本線', '高速', '方向', '右側', '左側', '右折', '左折', '直進', '車線'];
  const SPLIT_RE = /方面の|方面|右側の|左側の|本線|の(?=ランプ)|の(?=出口)|の(?=入口)/;

  function extractFromStep(step) {
    // Strip whitespace so "横浜新道 出口" → "横浜新道出口" matches the prefix+suffix regex.
    const txt = cleanTxt(step?.navigationInstruction?.instructions).replace(/[\s　]+/g, '');
    const segments = txt.split(SPLIT_RE);
    const out = [];
    for (const seg of segments) {
      let m;
      icRe.lastIndex = 0;
      while ((m = icRe.exec(seg)) !== null) {
        let prefix = m[1];
        const suffix = m[2];
        if (NOISE.some(n => prefix.includes(n))) continue;
        // Reject greedy over-matches: prefix already ending in a suffix token means
        // the regex swallowed e.g. "厚木IC" as prefix to match "厚木IC出口".
        if (/(IC|JCT|ランプ|本線料金所|出口|入口)$/.test(prefix)) continue;
        // Trim trailing particles from prefix
        prefix = prefix.replace(/[のをにへがでと]$/, '');
        if (!prefix) continue;
        if (/^[ぁ-ん]$/.test(prefix)) continue;
        const dispSuffix = (suffix === '出口' || suffix === '入口') ? 'IC' : suffix;
        if ((suffix === '出口' || suffix === '入口') && prefix.length < 2) continue;
        out.push({ name: prefix + dispSuffix, raw: prefix });
      }
    }
    return out;
  }

  // Detect entry: first step with MERGE or RAMP_* maneuver (Google uses RAMP_LEFT/RAMP_RIGHT, not ON_RAMP_*)
  const entryRampIdx = steps.findIndex(s => /^(MERGE|RAMP|ON_RAMP)/.test(s.navigationInstruction?.maneuver || ''));

  // Detect exit: last step whose instruction contains "出口" (cleaned)
  let exitTextIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (/出口/.test(cleanTxt(steps[i].navigationInstruction?.instructions))) {
      exitTextIdx = i;
      break;
    }
  }

  const collect = (idx, before, after) => {
    if (idx < 0) return [];
    const out = [];
    for (let i = Math.max(0, idx - before); i <= Math.min(steps.length - 1, idx + after); i++) {
      out.push(...extractFromStep(steps[i]));
    }
    return out;
  };

  let entryCands = collect(entryRampIdx, 1, 2);
  let exitCands  = collect(exitTextIdx,  0, 0);

  // Fallback: scan whole route. Use ordered position (not suffix preference) so we
  // don't pick the exit IC as the entry simply because it has "IC" suffix.
  const preferFirst = arr => arr.find(m => /(IC|ランプ|本線料金所)$/.test(m.name)) || arr[0] || null;
  const preferLast  = arr => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (/(IC|ランプ|本線料金所)$/.test(arr[i].name)) return arr[i];
    }
    return arr[arr.length - 1] || null;
  };

  let entry = entryCands.length ? preferFirst(entryCands) : null;
  let exit  = exitCands.length  ? preferLast(exitCands)   : null;

  if (!entry || !exit) {
    const all = [];
    steps.forEach(s => all.push(...extractFromStep(s)));
    if (!entry && all.length) entry = all[0];
    if (!exit  && all.length) exit  = all[all.length - 1];
  }
  return {
    entryIC:  entry?.name || null,
    exitIC:   exit?.name  || null,
    entryRaw: entry?.raw  || null,
    exitRaw:  exit?.raw   || null,
  };
}

function buildGoogleMapsUrl() {
  if (!lastOriginCoord || !lastDestCoord) return null;
  const o = `${lastOriginCoord.lat()},${lastOriginCoord.lng()}`;
  const d = `${lastDestCoord.lat()},${lastDestCoord.lng()}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`;
}

// carType: 1=普通車 2=軽 3=中型 4=大型 5=特大
const DORAPLA_CAR = { '普通車':1, '軽自動車':2, '中型車':3, '大型車':4, '特大車':5 };

// ドラぷら won't accept JCT or 本線料金所 as start/end. Only IC and ランプ work as endpoints.
function isDoraplaSearchable(name) {
  return /(IC|ランプ)$/.test(name || '');
}

// Locate the entry/exit coordinate from a route so we can geocode the IC name when
// Google's text instructions don't include it (typical for 首都高 entrances).
// The FIRST RAMP / ON_RAMP / MERGE step is where the route first enters the highway.
// Later MERGE steps happen when re-joining a different toll road mid-route — those are
// not the route's entry IC.
function getEntryCoord(route) {
  const steps = route.legs?.[0]?.steps || [];
  const idx = steps.findIndex(s => /^(MERGE|RAMP|ON_RAMP)/.test(s.navigationInstruction?.maneuver || ''));
  if (idx < 0) return null;
  const mv = steps[idx].navigationInstruction?.maneuver;
  // For RAMP/ON_RAMP, endLocation is where the ramp meets the highway (the IC).
  // For MERGE, startLocation already sits at the highway junction.
  const useEnd = /^(RAMP|ON_RAMP)/.test(mv);
  const ll = (useEnd ? steps[idx].endLocation : steps[idx].startLocation)?.latLng;
  return ll ? { lat: ll.latitude, lng: ll.longitude } : null;
}
// Exit coord: the LAST step containing "出口" — its startLocation is on the highway
// right before leaving it, which is where the exit IC sits.
function getExitCoord(route) {
  const steps = route.legs?.[0]?.steps || [];
  let idx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (/出口/.test(steps[i].navigationInstruction?.instructions || '')) { idx = i; break; }
  }
  if (idx < 0) {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (/^(RAMP|OFF_RAMP)/.test(steps[i].navigationInstruction?.maneuver || '')) { idx = i; break; }
    }
  }
  if (idx < 0) return null;
  const ll = steps[idx].startLocation?.latLng;
  return ll ? { lat: ll.latitude, lng: ll.longitude } : null;
}

// Strip "首都高速○○号X線" / "首都高速" prefix and IC-style suffix to get the bare
// place name (e.g. "首都高速銀座入口" → "銀座"). This is what ドラぷら expects.
function parseRampName(placeName) {
  // Only strip the highway-line prefix when it actually ends in 線, so "首都高速銀座入口"
  // doesn't get its place name eaten by a greedy kanji match.
  const stripHwy = (s, hwy) => s
    .replace(new RegExp('^' + hwy + '[\\d０-９]+号(?:[一-龯ぁ-んァ-ヶー]+線)?'), '')
    .replace(new RegExp('^' + hwy + '[一-龯ぁ-んァ-ヶー]+線'), '')
    .replace(new RegExp('^' + hwy), '');
  let raw = placeName;
  raw = stripHwy(raw, '首都高速');
  raw = stripHwy(raw, '阪神高速');
  raw = stripHwy(raw, '名古屋高速');
  let suffix = 'IC';
  if (/ランプ$/.test(placeName)) suffix = 'ランプ';
  else if (/JCT$/.test(placeName)) suffix = 'JCT';
  raw = raw.replace(/(入口|出口|IC|ランプ|JCT|入出口|出入口)$/, '');
  raw = raw.trim();
  if (!raw) return null;
  // Real Japanese highway IC names are single tokens — reject anything with whitespace.
  if (/[\s　]/.test(raw)) return null;
  return { name: raw + suffix, raw };
}

let _placesService = null;
function getPlacesService() {
  if (_placesService) return _placesService;
  if (!map) return null;
  _placesService = new google.maps.places.PlacesService(map);
  return _placesService;
}

// Result must look like an actual highway entrance/exit, not a parking lot / shop / office
// that happens to end in "IC" or contain "出口".
function isLikelyHighwayRamp(name) {
  if (/(駐車場|パーキング|ガレージ|駐輪|ホテル|レストラン|カフェ|店舗|店$|タワー|ビル$|マンション|アパート|ガソリン|スタンド|医院|クリニック|病院|薬局|郵便|銀行|駅$|㈱|（株）|\(株\)|株式会社|有限会社|分室|出張所|事務所|建設局|庁$|区役所|市役所|学校|大学|高校|中学|小学|寺$|神社|公園|博物館|美術館|会館|桟橋|船着|運動場|広場|車寄せ|車庫)/.test(name)) return false;
  if (/^(首都高速|阪神高速|名古屋高速|広島高速|福岡高速|本州四国連絡高速)/.test(name)) return true;
  if (/[一-龯ぁ-んァ-ヶー](IC|JCT)$/.test(name)) return true;
  if (/[一-龯ぁ-んァ-ヶー](ランプ|入口|出口|入出口|出入口|料金所)$/.test(name)) return true;
  return false;
}

// Find the nearest highway ramp/IC by name around coord. We use rankBy DISTANCE because
// radius-based search returns offices and shops named with "高速" etc. ahead of actual
// 入口/出口 places. The first highway-pattern hit in distance order is the IC we want.
function findRampNameAt(coord, isEntry) {
  const ps = getPlacesService();
  if (!ps || !coord) return Promise.resolve(null);
  const tryKeyword = (kw) => new Promise(resolve => {
    ps.nearbySearch({
      location: coord,
      rankBy: google.maps.places.RankBy.DISTANCE,
      keyword: kw,
    }, (results, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !results) return resolve(null);
      for (const r of results) {
        if (isLikelyHighwayRamp(r.name)) {
          const parsed = parseRampName(r.name);
          if (parsed?.raw) return resolve(parsed);
        }
      }
      resolve(null);
    });
  });
  // Search for 入口/出口 first (proper highway access points), fall back to IC/ランプ.
  const primary = isEntry ? '入口' : '出口';
  return tryKeyword(primary)
    .then(r => r || tryKeyword('IC'))
    .then(r => r || tryKeyword('ランプ'));
}

async function enrichRouteICs(route) {
  const ics = extractHighwayICs(route);
  // If entry isn't usable in ドラぷら, geocode the entry coord
  if (!isDoraplaSearchable(ics.entryIC)) {
    const ec = getEntryCoord(route);
    if (ec) {
      const found = await findRampNameAt(ec, true);
      if (found) { ics.entryIC = found.name; ics.entryRaw = found.raw; }
    }
  }
  if (!isDoraplaSearchable(ics.exitIC)) {
    const xc = getExitCoord(route);
    if (xc) {
      const found = await findRampNameAt(xc, false);
      if (found) { ics.exitIC = found.name; ics.exitRaw = found.raw; }
    }
  }
  route._ics = ics;
  return ics;
}

// Only return a URL when we can deep-link to a real result page. Never link to a form
// the user would need to fill in — that violates the project's "no manual input" rule.
function buildDoraplaUrl(entryRaw, exitRaw, entryName, exitName, vehicleType) {
  if (!entryRaw || !exitRaw) return null;
  if (!isDoraplaSearchable(entryName) || !isDoraplaSearchable(exitName)) return null;
  const carType = DORAPLA_CAR[vehicleType] || 1;
  const q = new URLSearchParams({
    startPlaceKana:  entryRaw,
    arrivePlaceKana: exitRaw,
    carType: String(carType),
    priority: '3',
    kind: '1',
  });
  return `https://www.driveplaza.com/dp/SearchQuick?${q.toString()}`;
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

    // IC extraction for third-party toll verification reference
    const { entryIC, exitIC, entryRaw, exitRaw } = route._ics || extractHighwayICs(route);
    const icLabel = entryIC && exitIC
      ? `${entryIC} → ${exitIC}`
      : (entryIC || exitIC || '');
    const gmapsUrl = buildGoogleMapsUrl();
    const doraUrl  = !avoidTolls ? buildDoraplaUrl(entryRaw, exitRaw, entryIC, exitIC, vehicleType) : null;
    const verifyHtml = (gmapsUrl || doraUrl)
      ? `<div class="verify-row" onclick="event.stopPropagation()">
           ${icLabel ? `<span class="ic-label">📍 ${icLabel}</span>` : ''}
           <div class="verify-links">
             ${gmapsUrl ? `<a class="verify-link" href="${gmapsUrl}" target="_blank" rel="noopener">🗺️ Googleマップ</a>` : ''}
             ${doraUrl ? `<a class="verify-link" href="${doraUrl}" target="_blank" rel="noopener">💴 ドラぷら料金</a>` : ''}
           </div>
         </div>`
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
