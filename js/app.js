/* global google */

let map, directionsRenderer, originAutocomplete, destAutocomplete;

// ── API Usage Tracker ──────────────────────────────────────────
// Google Maps Platform free credit: $200/month
// Cost per route search (approximate):
//   Directions API:  $0.005
//   Routes API:      $0.005
//   Geocoding x2:    $0.010
//   Total per search: ~$0.020
const BUDGET = {
  monthly: 200,
  costPerSearch: 0.020,
  warnAt: 0.80, // warn at 80% usage
};

const UsageTracker = {
  _key: 'capymap_usage',

  _getStore() {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let store = JSON.parse(localStorage.getItem(this._key) || '{}');
    if (store.month !== monthKey) {
      store = { month: monthKey, searches: 0, estimatedCost: 0 };
    }
    return store;
  },

  _save(store) {
    localStorage.setItem(this._key, JSON.stringify(store));
  },

  record() {
    const store = this._getStore();
    store.searches += 1;
    store.estimatedCost = +(store.searches * BUDGET.costPerSearch).toFixed(3);
    this._save(store);
    this.render();
  },

  render() {
    const store = this._getStore();
    const used = store.estimatedCost;
    const remaining = +(BUDGET.monthly - used).toFixed(2);
    const pct = Math.min((used / BUDGET.monthly) * 100, 100);

    const el = document.getElementById('usage-bar');
    if (!el) return;

    const fill = el.querySelector('.usage-fill');
    const label = el.querySelector('.usage-label');

    fill.style.width = `${pct}%`;
    fill.style.background = pct >= 80 ? '#ea4335' : pct >= 50 ? '#fbbc04' : '#34a853';

    label.textContent = `今月: $${used.toFixed(2)} 使用 / 残り $${remaining.toFixed(2)} (検索 ${store.searches}回)`;
    el.style.display = 'block';

    if (pct >= 80) {
      showError(`⚠️ 月次予算の ${Math.round(pct)}% を使用しました（残り $${remaining}）`);
    }
  },
};
// ──────────────────────────────────────────────────────────────

// Vehicle type to Routes API emission type mapping
const VEHICLE_EMISSION_MAP = {
  '普通車': 'GASOLINE',
  '軽自動車': 'GASOLINE',
  '中型車': 'GASOLINE',
  '大型車': 'DIESEL',
  '特大車': 'DIESEL',
};

// ETC toll pass codes for Japan
const ETC_PASSES = ['JP_ETC', 'JP_ETC2'];

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 35.6762, lng: 139.6503 }, // Tokyo
    zoom: 10,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_BOTTOM,
    },
    gestureHandling: 'greedy',
    styles: [
      { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    ],
  });

  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: '#1a73e8',
      strokeWeight: 5,
    },
  });

  const autocompleteOptions = {
    componentRestrictions: { country: 'jp' },
    fields: ['name', 'geometry', 'formatted_address'],
  };

  originAutocomplete = new google.maps.places.Autocomplete(
    document.getElementById('origin'),
    autocompleteOptions
  );

  destAutocomplete = new google.maps.places.Autocomplete(
    document.getElementById('destination'),
    autocompleteOptions
  );

  originAutocomplete.bindTo('bounds', map);
  destAutocomplete.bindTo('bounds', map);

  document.getElementById('search-btn').addEventListener('click', searchRoute);
  document.getElementById('locate-btn').addEventListener('click', useCurrentLocation);

  document.getElementById('has-etc').addEventListener('change', function () {
    document.getElementById('etc-text').textContent = this.checked ? 'あり' : 'なし';
  });

  document.getElementById('avoid-tolls').addEventListener('change', function () {
    document.getElementById('avoid-text').textContent = this.checked ? '回避' : '使用';
  });

  // Allow Enter key to trigger search
  ['origin', 'destination'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') searchRoute();
    });
  });

  UsageTracker.render();
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showError('位置情報はサポートされていません');
    return;
  }
  const btn = document.getElementById('locate-btn');
  btn.textContent = '⌛';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    pos => {
      const latlng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: latlng, language: 'ja' }, (results, status) => {
        btn.textContent = '📍';
        btn.disabled = false;
        if (status === 'OK' && results[0]) {
          document.getElementById('origin').value = results[0].formatted_address;
        } else {
          document.getElementById('origin').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        }
      });
    },
    () => {
      btn.textContent = '📍';
      btn.disabled = false;
      showError('現在地の取得に失敗しました');
    },
    { timeout: 10000 }
  );
}

async function searchRoute() {
  const originVal = document.getElementById('origin').value.trim();
  const destVal = document.getElementById('destination').value.trim();

  if (!originVal || !destVal) {
    showError('出発地と目的地を入力してください');
    return;
  }

  setLoading(true);
  hideError();
  document.getElementById('result-panel').style.display = 'none';

  const avoidTolls = document.getElementById('avoid-tolls').checked;
  const hasEtc = document.getElementById('has-etc').checked;
  const vehicleType = document.getElementById('vehicle-type').value;

  try {
    // Step 1: Use Directions API to draw the route on map
    const directionsResult = await getDirections(originVal, destVal, avoidTolls);

    // Step 2: Use Routes API v2 to get accurate toll cost
    let tollInfo = null;
    if (!avoidTolls) {
      tollInfo = await getTollInfo(originVal, destVal, vehicleType, hasEtc);
    }

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
    const service = new google.maps.DirectionsService();
    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
        region: 'jp',
        avoidTolls,
        provideRouteAlternatives: false,
        drivingOptions: {
          departureTime: new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS,
        },
      },
      (result, status) => {
        if (status === 'OK') {
          directionsRenderer.setDirections(result);
          resolve(result);
        } else {
          const msgs = {
            NOT_FOUND: '出発地または目的地が見つかりません',
            ZERO_RESULTS: '経路が見つかりません',
            MAX_WAYPOINTS_EXCEEDED: '経由地が多すぎます',
            INVALID_REQUEST: '入力が正しくありません',
            REQUEST_DENIED: 'API Key が無効です',
          };
          reject(new Error(msgs[status] || `経路取得エラー: ${status}`));
        }
      }
    );
  });
}

async function getTollInfo(origin, destination, vehicleType, hasEtc) {
  const apiKey = window.MAPS_API_KEY;

  // Geocode origin and destination to lat/lng for Routes API
  const [originLatLng, destLatLng] = await Promise.all([
    geocodeAddress(origin),
    geocodeAddress(destination),
  ]);

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: originLatLng.lat(),
          longitude: originLatLng.lng(),
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destLatLng.lat(),
          longitude: destLatLng.lng(),
        },
      },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    extraComputations: ['TOLLS'],
    routeModifiers: {
      vehicleInfo: {
        emissionType: VEHICLE_EMISSION_MAP[vehicleType] || 'GASOLINE',
      },
      ...(hasEtc ? { tollPasses: ETC_PASSES } : {}),
    },
  };

  const resp = await fetch(
    `https://routes.googleapis.com/directions/v2:computeRoutes?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.travelAdvisory.tollInfo',
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    console.warn('Routes API error:', errBody);
    return null; // Toll info unavailable, but don't fail the whole request
  }

  const data = await resp.json();
  const route = data.routes && data.routes[0];
  if (!route) return null;

  return route.travelAdvisory && route.travelAdvisory.tollInfo
    ? route.travelAdvisory.tollInfo
    : null;
}

function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address, region: 'jp', language: 'ja' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        resolve(results[0].geometry.location);
      } else {
        reject(new Error(`ジオコード失敗: ${address}`));
      }
    });
  });
}

function showResults(directionsResult, tollInfo, avoidTolls) {
  const leg = directionsResult.routes[0].legs[0];
  const distance = leg.distance.text;
  const duration = leg.duration_in_traffic
    ? leg.duration_in_traffic.text
    : leg.duration.text;

  document.getElementById('result-distance').textContent = distance;
  document.getElementById('result-duration').textContent = duration;

  const tollCard = document.getElementById('toll-card');
  const tollValue = document.getElementById('result-toll');
  const tollDetail = document.getElementById('toll-detail');

  if (avoidTolls) {
    tollCard.classList.remove('highlight');
    tollValue.textContent = '無料ルート';
    tollDetail.style.display = 'none';
  } else if (tollInfo && tollInfo.estimatedPrice && tollInfo.estimatedPrice.length > 0) {
    tollCard.classList.add('highlight');
    const price = tollInfo.estimatedPrice[0];
    const amount = parseInt(price.units || 0);
    const currency = price.currencyCode || 'JPY';
    tollValue.textContent = formatCurrency(amount, currency);

    // Show detail if multiple prices (e.g., ETC discount vs regular)
    if (tollInfo.estimatedPrice.length > 1) {
      renderTollDetail(tollInfo.estimatedPrice);
      tollDetail.style.display = 'block';
    } else {
      tollDetail.style.display = 'none';
    }
  } else {
    tollCard.classList.remove('highlight');
    tollValue.textContent = '情報なし';
    tollDetail.style.display = 'none';
  }

  document.getElementById('result-panel').style.display = 'block';
}

function renderTollDetail(prices) {
  const labels = ['ETC割引', 'ETC2.0割引', '通常料金'];
  const content = prices.map((price, i) => {
    const amount = parseInt(price.units || 0);
    return `<div class="toll-detail-item">
      <span>${labels[i] || `料金 ${i + 1}`}</span>
      <span>${formatCurrency(amount, price.currencyCode)}</span>
    </div>`;
  }).join('');
  document.getElementById('toll-detail-content').innerHTML = content;
}

function formatCurrency(amount, currency) {
  if (currency === 'JPY' || !currency) {
    return `¥${amount.toLocaleString('ja-JP')}`;
  }
  return `${amount.toLocaleString()} ${currency}`;
}

function setLoading(loading) {
  const btn = document.getElementById('search-btn');
  const btnText = document.getElementById('btn-text');
  const btnLoading = document.getElementById('btn-loading');
  btn.disabled = loading;
  btnText.style.display = loading ? 'none' : 'inline';
  btnLoading.style.display = loading ? 'inline' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('error-msg').style.display = 'none';
}
