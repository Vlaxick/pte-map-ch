const $ = id => document.getElementById(id);
const IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const IMAGERY_CREDIT = 'Imagery: Esri, Vantor, Earthstar Geographics, GIS User Community';
const OCHA_CREDIT = '<a href="https://gis.unocha.org/server/rest/services/Hosted/UKR_Simplified_Boundaries/FeatureServer" target="_blank" rel="noopener noreferrer">Boundaries: OCHA</a>';
const EXTERNAL_COUNTRIES = ['RUS', 'BLR', 'POL', 'SVK', 'HUN', 'ROU', 'MDA'];
const EXTERNAL_CREDIT = '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">External regions: geoBoundaries gbOpen</a>';
const NEPTUN_API = 'https://neptun.in.ua/api/v1';
const NEPTUN_STREAM = 'wss://neptun.in.ua/api/v1/stream';
const POLL_INTERVAL_MS = 15000;
const THREAT_ICON_SIZE = 26; // Roughly 20% smaller than the former 32px markers.
const THREAT_ICONS = {
  shahed: './assets/threat-icons/shahed.png?v=2',
  ballistic: './assets/threat-icons/ballistic.png',
  orion: './assets/threat-icons/orion.png',
  su35: './assets/threat-icons/su35.png',
  kab: './assets/threat-icons/kab.png',
  fpv: './assets/threat-icons/fpv.png',
  cruise: './assets/threat-icons/cruise.png'
};
const GEONAMES_CREDIT = '<a href="https://www.geonames.org/export/" target="_blank" rel="noopener noreferrer">Settlements: GeoNames CC BY</a>';
const ADM1_ALIASES = { UA01:'UA-43', UA44:'UA-09', UA73:'UA-77', UA80:'UA-30', UA85:'UA-40' };
const SETTLEMENT_REGIONS = {
  '01':'Черкаська', '02':'Чернігівська', '03':'Чернівецька', '04':'Дніпропетровська',
  '05':'Донецька', '06':'Івано-Франківська', '07':'Харківська', '08':'Херсонська',
  '09':'Хмельницька', '10':'Кіровоградська', '11':'АР Крим', '12':'Київ',
  '13':'Київська', '14':'Луганська', '15':'Львівська', '16':'Миколаївська',
  '17':'Одеська', '18':'Полтавська', '19':'Рівненська', '20':'Севастополь',
  '21':'Сумська', '22':'Тернопільська', '23':'Вінницька', '24':'Волинська',
  '25':'Закарпатська', '26':'Запорізька', '27':'Житомирська'
};
const CAPITALS = [
  ['UA-30', 'Київ', 50.45466, 30.5238, 0],
  ['UA-63', 'Харків', 49.98177, 36.25475, 1],
  ['UA-46', 'Львів', 49.83826, 24.02324, 1],
  ['UA-51', 'Одеса', 46.48572, 30.74383, 1],
  ['UA-12', 'Дніпро', 48.46664, 35.04066, 1],
  ['UA-14', 'Донецьк', 48.023, 37.80224, 1],
  ['UA-43', 'Сімферополь', 44.95719, 34.11079, 1],
  ['UA-05', 'Вінниця', 49.2322, 28.46871, 2],
  ['UA-07', 'Луцьк', 50.75784, 25.35024, 2],
  ['UA-18', 'Житомир', 50.26235, 28.67913, 2],
  ['UA-21', 'Ужгород', 48.6242, 22.2947, 2],
  ['UA-23', 'Запоріжжя', 47.85167, 35.11714, 2],
  ['UA-26', 'Івано-Франківськ', 48.92312, 24.71248, 2],
  ['UA-35', 'Кропивницький', 48.50834, 32.26618, 2],
  ['UA-09', 'Луганськ', 48.56814, 39.30553, 2],
  ['UA-48', 'Миколаїв', 46.97625, 31.99296, 2],
  ['UA-53', 'Полтава', 49.58925, 34.55367, 2],
  ['UA-56', 'Рівне', 50.62036, 26.23695, 2],
  ['UA-59', 'Суми', 50.91741, 34.79906, 2],
  ['UA-61', 'Тернопіль', 49.55404, 25.59067, 2],
  ['UA-65', 'Херсон', 46.63695, 32.61458, 2],
  ['UA-68', 'Хмельницький', 49.41835, 26.97936, 2],
  ['UA-71', 'Черкаси', 49.44452, 32.05738, 2],
  ['UA-77', 'Чернівці', 48.29045, 25.93241, 2],
  ['UA-74', 'Чернігів', 51.50541, 31.28656, 2],
  ['UA-40', 'Севастополь', 44.60795, 33.52134, 2]
];

let map;
let allBounds;
let regionMeta = [];
let selectedCode = null;
let regionLayers = new Map();
let regionFeatures = new Map();
let districtFeaturesByCode = new Map();
let districtLayersByCode = new Map();
let districtOutlineLayer;
let focusImagery;
let focusTransition = 0;
let labelMarkers = new Map();
let labelLayoutFrame = 0;
let alertRaionsByKey = new Map();
let alertOblastsByKey = new Map();
let alertLayer;
let alertRenderer;
let alertVisuals = [];
let threatLayer;
let threatVisuals = [];
let lastThreatSignature = '';
let lastAlertSignature = '';
let mapMoving = false;
let pendingThreatData;
let pendingAlertData;
let overlayFlushFrame = 0;
const settlementMarkers = new Map();
const imageryImages = new Map();
let realtimeSocket;
let realtimeConnected = false;
let lastStreamMessageMs = 0;
let reconnectTimer;
let reconnectDelayMs = 1000;
let streamThreatsById = new Map();
let countryBorderLayer;
let provinceBorderLayer;
let externalRegionLabels = [];
let mapStyle = 'satellite';
let alertState = 'disconnected';
let activeRaions = [];
let activeOblasts = [];
let activeThreats = [];
let threatState = 'disconnected';
let lastPanelHtml = '';
let civilBulletins = [];
let civilBulletinStatus = null;
let civilBulletinSignature = '';
let bulletinRequestInFlight = false;
let refreshInFlight = false;
let settlementPlaces = [];
let settlementLayer;
let searchMarker;
let currentSearchResults = [];
let highlightedSearchResult = 0;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function provinceStyle(selected = false) {
  if (mapStyle === 'dark') {
    return {
      pane: 'provinces',
      color: selected ? '#8dd6df' : '#657980',
      weight: selected ? (selectedCode ? 3 : 2.3) : 0.7,
      opacity: selected ? 1 : 0.4,
      fillColor: selected ? '#315867' : '#1c2c39',
      fillOpacity: selected ? 0.42 : 0.83
    };
  }
  return {
    pane: 'provinces',
    color: selected ? '#8dd6df' : '#80918e',
    weight: selected ? (selectedCode ? 3 : 2) : 0.7,
    opacity: selected ? 0.95 : 0.4,
    fillColor: selected ? '#478f9e' : '#c5d9cc',
    fillOpacity: selected ? 0.09 : 0.035
  };
}

function provinceOutlineStyle() {
  return {
    pane: 'provinceOutlines', color: mapStyle === 'dark' ? '#829b9b' : '#aabcb1',
    weight: 1.4, opacity: 0.8, fill: false
  };
}

function setMapStyle(style) {
  mapStyle = style === 'dark' ? 'dark' : 'satellite';
  $('map').classList.toggle('dark-mode', mapStyle === 'dark');
  $('map').setAttribute('aria-label', mapStyle === 'dark' ? 'Темна карта України' : 'Супутникова карта України');
  const button = $('mapStyleToggle');
  const dark = mapStyle === 'dark';
  button.classList.toggle('active', dark);
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Увімкнути супутникову карту' : 'Увімкнути темну карту');
  button.title = dark ? 'Супутникова карта' : 'Темна карта';
  updateProvinceFocus();
  provinceBorderLayer.setStyle(provinceOutlineStyle());
  districtOutlineLayer?.setStyle(districtOutlineStyle());
  countryBorderLayer.setStyle({ color: dark ? '#b5c7c2' : '#d5e0d8' });
  try { localStorage.setItem('obriy-map-style', mapStyle); } catch {}
}

function updateProvinceFocus() {
  for (const [code, layer] of regionLayers) {
    layer.setStyle(provinceStyle(code === selectedCode));
    const element = layer.getElement();
    if (!element) continue;
    const hidden = Boolean(selectedCode && code !== selectedCode);
    element.style.pointerEvents = hidden ? 'none' : '';
    element.setAttribute('tabindex', hidden ? '-1' : '0');
    if (hidden) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
    element.classList.toggle('focused-province', code === selectedCode);
  }
}

function regionKey(value) {
  const key = String(value || '').toLocaleLowerCase('uk').replace(/\s+область$/, '')
    .replace(/^м\.\s*/, '').trim();
  return /^(?:ар крим|автономна республіка крим|кримська)$/.test(key) ? 'крим' : key;
}

function provinceCode(pcode) {
  return ADM1_ALIASES[pcode] || pcode.slice(0, 2) + '-' + pcode.slice(2);
}

function districtOutlineStyle() {
  return { color: mapStyle === 'dark' ? '#c2c6b6' : '#d5dcc9',
    weight: 1, opacity: mapStyle === 'dark' ? 0.62 : 0.7, fill: false };
}

function updateDistrictOutlines() {
  if (districtOutlineLayer) map.removeLayer(districtOutlineLayer);
  districtOutlineLayer = null;
  if (!selectedCode) return;
  if (!districtLayersByCode.has(selectedCode)) {
    const features = districtFeaturesByCode.get(selectedCode) || [];
    districtLayersByCode.set(selectedCode, L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: 'districtOutlines', interactive: false, style: districtOutlineStyle
    }));
  }
  districtOutlineLayer = districtLayersByCode.get(selectedCode).addTo(map);
}

function toggleFocusElement(element, hidden) {
  if (!element) return;
  element.classList.toggle('focus-hidden', hidden);
  if (hidden) element.setAttribute('aria-hidden', 'true');
  else element.removeAttribute('aria-hidden');
  if (element.hasAttribute('tabindex')) element.setAttribute('tabindex', hidden ? '-1' : '0');
}

function updateFocusOverlays() {
  const key = selectedCode ? selectedRegionKey() : '';
  for (const item of alertVisuals) {
    const hidden = Boolean(key && item.key !== key);
    item.layer.eachLayer(path => toggleFocusElement(path.getElement(), hidden));
  }
  for (const item of threatVisuals) {
    toggleFocusElement(item.layer.getElement(), Boolean(key && item.key !== key));
  }
}

function isFresh(value, maxAgeMs) {
  const age = Date.now() - Date.parse(value);
  return Number.isFinite(age) && age >= -60000 && age <= maxAgeMs;
}

function setStatus() {
  const status = $('topStatus');
  status.classList.toggle('connected', alertState === 'connected');
  const message = alertState === 'connected'
    ? `NEPTUN · ${activeRaions.length} РАЙОНІВ · ${activeOblasts.length} ОБЛАСТЕЙ · ${threatState === 'connected' ? activeThreats.length + ' ЗАГРОЗ' : 'ЗАГРОЗИ НЕДОСТУПНІ'}`
    : alertState === 'stale' ? 'ДАНІ ПРО ТРИВОГИ ЗАСТАРІЛИ' : 'ДАНІ ПРО ТРИВОГИ НЕДОСТУПНІ';
  status.innerHTML = '<span class="status-dot"></span> ' +
    message;
  $('sourceStatus').textContent = alertState === 'connected'
    ? threatState === 'connected'
      ? realtimeConnected ? 'Живий потік · дані NEPTUN' : 'Оновлення через резервний запит'
      : 'Тривоги оновлюються · загрози недоступні'
    : message.toLocaleLowerCase('uk');
}

function freshThreatHeading(threat) {
  if (threat.areaOnly || !isFresh(threat.updatedAt, 600000)) return null;
  const raw = threat.heading == null ? NaN : Number(threat.heading);
  return Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : null;
}

// Leaflet owns marker transforms throughout a pan/zoom. Apply only the newest
// received snapshot after navigation; never race its animation with position writes.
function flushMapUpdates() {
  if (mapMoving || overlayFlushFrame) return;
  overlayFlushFrame = requestAnimationFrame(() => {
    overlayFlushFrame = 0;
    if (mapMoving) return;
    if (pendingAlertData !== undefined) {
      const data = pendingAlertData; pendingAlertData = undefined; renderAlerts(data);
    }
    if (pendingThreatData !== undefined) {
      const data = pendingThreatData; pendingThreatData = undefined; renderThreats(data);
    }
    scheduleLabelLayout();
    scheduleSettlements();
    renderSelectedCard();
  });
}

function directionText(heading) {
  const directions = ['північ', 'північний схід', 'схід', 'південний схід',
    'південь', 'південний захід', 'захід', 'північний захід'];
  return `${directions[Math.round(heading / 45) % 8]} · ${Math.round(heading)}°`;
}

function alertLevelLabel(level) {
  return level === 'red' ? 'Червоний рівень' : level === 'yellow' ? 'Жовтий рівень' : 'Тривога';
}

function countForm(count, one, few, many) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

function fitOverview(animate = false) {
  if (!map || !allBounds) return;
  const compact = map.getSize().x < 600;
  const options = {
    paddingTopLeft: compact ? [12, 74] : [80, 105],
    paddingBottomRight: compact ? [12, 36] : [80, 70],
    maxZoom: compact ? 6 : 6.25
  };
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    map.flyToBounds(allBounds, { ...options, duration: 0.75 });
  else map.fitBounds(allBounds, options);
}

function selectedRegionKey() {
  return regionKey(regionMeta.find(region => region.code === selectedCode)?.name);
}

function fitSelectedRegion(animate = true) {
  const layer = regionLayers.get(selectedCode);
  if (!map || !layer) return;
  const size = map.getSize();
  const card = $('regionCard').getBoundingClientRect();
  const desktop = size.x > 900;
  const mapRect = map.getContainer().getBoundingClientRect();
  const right = desktop ? Math.ceil(mapRect.right - card.left + 64) : 24;
  const bottom = desktop ? 72 : Math.ceil(card.height + 32);
  const options = {
    paddingTopLeft: [desktop ? 64 : 24, desktop ? 138 : 128],
    paddingBottomRight: [right, bottom],
    maxZoom: desktop ? 10.25 : 9.5
  };
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    map.flyToBounds(layer.getBounds(), { ...options, duration: 1.15 });
  } else {
    map.fitBounds(layer.getBounds(), options);
  }
}

function updateRegionImagery() {
  if (focusImagery) {
    map.removeLayer(focusImagery);
    focusImagery = null;
  }
  const feature = regionFeatures.get(selectedCode);
  if (feature) focusImagery = addUkraineImagery(feature.geometry, 'regionImagery');
}

function revealFocusAfterTiles(transition) {
  const imagery = focusImagery;
  const reveal = () => {
    if (transition !== focusTransition || !selectedCode || focusImagery !== imagery) return;
    if (imagery.isLoading()) {
      imagery.once('load', reveal);
      return;
    }
    document.querySelector('.app').classList.add('region-focus-ready');
  };
  map.once('moveend', reveal);
}

function closeRegionPanel() {
  if (!selectedCode) return;
  selectRegion(null);
  fitOverview(true);
}

async function loadCivilBulletins() {
  if (bulletinRequestInFlight || document.hidden) return;
  bulletinRequestInFlight = true;
  try {
    const response = await fetch('/api/review/bulletins', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Bulletins unavailable');
    const data = await response.json();
    civilBulletins = data.bulletins;
    civilBulletinStatus = data.status;
  } catch {
    civilBulletinStatus = null;
    civilBulletins = [];
  } finally {
    bulletinRequestInFlight = false;
    const signature = JSON.stringify([civilBulletins, civilBulletinStatus?.sources]);
    if (signature !== civilBulletinSignature) {
      civilBulletinSignature = signature;
      if (!mapMoving) renderSelectedCard();
    }
  }
}

function civilBulletinContent(key) {
  if (!civilBulletinStatus) return '<p class="panel-empty">Зведення каналів недоступне. Перевірте локальний сервер.</p>';
  const reports = civilBulletins.filter(item => item.regions.some(region => regionKey(region) === key)).slice(0, 5);
  const unavailable = civilBulletinStatus.sources.filter(source => source.error || !isFresh(source.last_success, civilBulletinStatus.pollIntervalSeconds * 3000)).length;
  return `<p class="panel-empty">Автоматичні повідомлення за 6 годин${unavailable ? ` · недоступних джерел: ${unavailable}` : ''}. Це історія дописів, не поточний офіційний стан.</p>` +
    (reports.length ? `<ul class="panel-list">${reports.map(item => {
      const time = new Date(item.published_at).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
      return `<li class="civil-bulletin"><div><strong>${item.category === 'clear' ? 'Повідомлення про відбій' : 'Повідомлення про тривогу'}</strong><span>${time} · ${item.routing === 'automatic' ? 'автоматично' : 'перевірено'}</span></div><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(item.channel)} ↗</a></li>`;
    }).join('')}</ul>` : '<p class="panel-empty">Свіжих однозначних повідомлень для цієї області немає.</p>') +
    '<a class="bulletin-journal" href="./review.html">Журнал і стан джерел ↗</a>';
}

function renderSelectedCard() {
  const card = $('regionCard');
  const region = regionMeta.find(item => item.code === selectedCode);
  if (!region) {
    card.hidden = true;
    lastPanelHtml = '';
    document.querySelector('.app').classList.remove('has-region-panel');
    return;
  }
  const key = regionKey(region.name);
  const raions = activeRaions
    .filter(raion => regionKey(raion.oblast) === key)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'uk'));
  const oblastAlert = activeOblasts.find(oblast => regionKey(oblast.oblast || oblast.name) === key);
  const threats = activeThreats.filter(threat => regionKey(threat.region) === key)
    .sort((a, b) => Number(Boolean(a.advisory)) - Number(Boolean(b.advisory)));
  const regionKind = selectedCode === 'UA-43' ? 'АР КРИМ' :
    selectedCode === 'UA-30' || selectedCode === 'UA-40' ? 'МІСТО' : 'ОБЛАСТЬ';
  const scrollTop = card.querySelector('.region-panel-body')?.scrollTop || 0;
  const districtContent = alertState !== 'connected'
    ? '<p class="panel-empty">Дані про тривоги зараз недоступні.</p>'
    : raions.length
      ? `<ul class="panel-list">${raions.map(raion => `<li class="district-item"><span class="district-dot ${raion.level === 'red' ? 'red' : 'yellow'}"></span><span class="district-name">${escapeHtml(raion.name)}</span><span class="district-level">${escapeHtml(alertLevelLabel(raion.level))}</span></li>`).join('')}</ul>`
      : `<p class="panel-empty">${oblastAlert ? 'Тривога оголошена для всієї області; районів окремо не вказано.' : 'Активних районних тривог немає.'}</p>`;
  const threatContent = threatState !== 'connected'
    ? '<p class="panel-empty">Дані про об’єкти зараз недоступні.</p>'
    : threats.length
      ? `<ul class="panel-list threat-list">${threats.map(threat => {
        const heading = freshThreatHeading(threat);
        const kind = threatIconKind(threat);
        const icon = kind === 'su35-kab' ? 'su35' : kind;
        const place = threat.areaOnly ? 'Місце в області не уточнене' :
          [threat.district, threat.locality].filter(Boolean).join(' · ') || 'Місце не уточнене';
        return `<li class="panel-threat"><span class="panel-threat-symbol" aria-hidden="true">${icon ? `<img src="${THREAT_ICONS[icon]}" alt="">` : '●'}</span><div class="panel-threat-details"><strong>${escapeHtml(threat.title || 'Об’єкт загрози')}</strong><span>${escapeHtml(place)}</span><span class="panel-course">${heading == null ? 'Напрямок не вказано' : `Напрямок: ${escapeHtml(directionText(heading))}`}</span></div>${threat.advisory ? '<span class="panel-advisory">Спостереження</span>' : ''}</li>`;
      }).join('')}</ul>`
      : '<p class="panel-empty">Об’єктів загроз у цій області зараз немає.</p>';
  const panelHtml = `<div class="card-head"><span>${regionKind} / ${escapeHtml(selectedCode)}</span><a href="https://neptun.in.ua/" target="_blank" rel="noopener noreferrer">ДАНІ: NEPTUN ↗</a><button type="button" aria-label="Закрити панель регіону">×</button></div>
    <div class="region-panel-body"><h2 id="regionPanelTitle">${escapeHtml(region.name)}</h2>
      <div class="panel-totals"><div><strong>${alertState === 'connected' ? raions.length : '—'}</strong><span>${alertState === 'connected' ? countForm(raions.length, 'район', 'райони', 'районів') : 'райони'} з тривогою</span></div><div><strong>${threatState === 'connected' ? threats.length : '—'}</strong><span>${threatState === 'connected' ? countForm(threats.length, 'об’єкт', 'об’єкти', 'об’єктів') : 'об’єкти'} загроз</span></div></div>
      ${oblastAlert && alertState === 'connected' ? `<div class="oblast-alert"><span class="district-dot ${oblastAlert.level === 'red' ? 'red' : 'yellow'}"></span><span>Тривога в усій області</span><small>${escapeHtml(alertLevelLabel(oblastAlert.level))}</small></div>` : ''}
      <section class="panel-section"><div class="panel-section-head"><h3>Райони з тривогою</h3><span>${alertState === 'connected' ? raions.length : '—'}</span></div>${districtContent}</section>
      <section class="panel-section"><div class="panel-section-head"><h3>Об’єкти загроз</h3><span>${threatState === 'connected' ? threats.length : '—'}</span></div>${threatContent}</section>
      <section class="panel-section"><div class="panel-section-head"><h3>Повідомлення каналів</h3></div>${civilBulletinContent(key)}</section>
      <p class="panel-caveat">Значки показують останню отриману позицію. Час і приблизність місця доступні при натисканні. Перевіряйте офіційні сигнали тривоги. <a href="https://neptun.in.ua/" target="_blank" rel="noopener noreferrer">Дані: NEPTUN ↗</a></p>
    </div>`;
  if (panelHtml !== lastPanelHtml) {
    card.innerHTML = panelHtml;
    lastPanelHtml = panelHtml;
    card.querySelector('.region-panel-body').scrollTop = scrollTop;
    card.querySelector('.card-head button').onclick = closeRegionPanel;
  }
  card.hidden = false;
  document.querySelector('.app').classList.add('has-region-panel');
}

function selectRegion(code) {
  if (code && !regionLayers.has(code)) return;
  if (code && code === selectedCode) { fitSelectedRegion(); return; }
  if (code && searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
  const transition = ++focusTransition;
  selectedCode = code;
  const app = document.querySelector('.app');
  app.classList.toggle('region-focus', Boolean(code));
  app.classList.remove('region-focus-ready');
  updateRegionImagery();
  updateProvinceFocus();
  updateDistrictOutlines();
  updateFocusOverlays();
  for (const [regionCode, marker] of labelMarkers) {
    marker.getElement()?.classList.toggle('selected', regionCode === code);
  }
  renderSelectedCard();
  if (code) {
    revealFocusAfterTiles(transition);
    fitSelectedRegion();
  }
  layoutLabels();
  scheduleSettlements();
}

function labelBox(marker, external = false) {
  const element = marker.getElement();
  if (!element) return null;
  const point = map.latLngToContainerPoint(marker.getLatLng());
  // Labels use a fixed monospace face; calculate bounds without forcing DOM layout.
  const fontSize = external || window.innerWidth < 600 ? 8 : 9;
  const width = element.textContent.length * fontSize * 0.63 + 5;
  const left = point.x + (external ? -width / 2 : 5);
  return { left, right: left + width, top: point.y - 7, bottom: point.y + 7 };
}

function labelFits(box, occupied, viewport) {
  return box && box.right >= 0 && box.left <= viewport.x && box.bottom >= 0 && box.top <= viewport.y &&
    !occupied.some(other => box.left < other.right + 6 && box.right > other.left - 6 &&
      box.top < other.bottom + 4 && box.bottom > other.top - 4);
}

function layoutLabels() {
  if (!map || !labelMarkers.size || mapMoving) return;
  const zoom = map.getZoom();
  const settlementNamesVisible = zoom >= 7 && settlementPlaces.length > 0;
  const occupied = [];
  const viewport = map.getSize();
  const ordered = [...CAPITALS].sort((a, b) =>
    (a[0] === selectedCode ? -1 : a[4]) - (b[0] === selectedCode ? -1 : b[4]));
  for (const [code, , , , rank] of ordered) {
    const marker = labelMarkers.get(code);
    const icon = marker?.getElement();
    if (!icon) continue;
    const hiddenByScale = (selectedCode && code !== selectedCode) || settlementNamesVisible ||
      (zoom < 5.25 && rank > 0) || (zoom < 5.85 && rank > 1);
    const box = hiddenByScale ? null : labelBox(marker);
    const show = !hiddenByScale && labelFits(box, occupied, viewport);
    icon.classList.toggle('hidden', !show);
    if (show) occupied.push(box);
  }
  updateExternalLabels(occupied);
}

function scheduleLabelLayout() {
  if (labelLayoutFrame) return;
  labelLayoutFrame = requestAnimationFrame(() => {
    labelLayoutFrame = 0;
    if (!mapMoving) layoutLabels();
  });
}

function loadImageryImage(url) {
  if (imageryImages.has(url)) return imageryImages.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => { imageryImages.delete(url); reject(new Error('Satellite tile unavailable')); };
    image.src = url;
  });
  imageryImages.set(url, promise);
  // 96 decoded 256px tiles use roughly 24 MiB; bound memory for long sessions.
  if (imageryImages.size > 96) imageryImages.delete(imageryImages.keys().next().value);
  return promise;
}

function addUkraineImagery(geometry, pane = 'tilePane') {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const project = ([lon, lat]) => {
    const sin = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)));
    return [(lon + 180) / 360 * 256, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256];
  };
  const shapes = polygons.map(polygon => {
    const rings = polygon.map(ring => ring.map(project));
    const xs = rings[0].map(point => point[0]);
    const ys = rings[0].map(point => point[1]);
    return { rings, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const clip = new Path2D();
  for (const { rings } of shapes) for (const ring of rings) {
    ring.forEach(([x, y], i) => i ? clip.lineTo(x, y) : clip.moveTo(x, y));
    clip.closePath();
  }
  const UkraineTiles = L.GridLayer.extend({
    createTile(coords, done) {
      const scale = 2 ** coords.z;
      const tileX = ((coords.x % scale) + scale) % scale;
      const tileBounds = [tileX * 256 / scale, coords.y * 256 / scale,
        (tileX + 1) * 256 / scale, (coords.y + 1) * 256 / scale];
      const nearby = shapes.filter(({ bounds }) =>
        bounds[0] <= tileBounds[2] && bounds[2] >= tileBounds[0] &&
        bounds[1] <= tileBounds[3] && bounds[3] >= tileBounds[1]);
      if (!nearby.length || coords.y < 0 || coords.y >= scale) {
        const empty = document.createElement('div');
        requestAnimationFrame(() => done(null, empty));
        return empty;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const url = IMAGERY.replace('{z}', coords.z).replace('{y}', coords.y).replace('{x}', tileX);
      loadImageryImage(url).then(image => {
        const context = canvas.getContext('2d');
        context.setTransform(scale, 0, 0, scale, -tileX * 256, -coords.y * 256);
        context.clip(clip, 'evenodd');
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(image, 0, 0, 256, 256);
        done(null, canvas);
      }, error => done(error, canvas));
      return canvas;
    }
  });
  return new UkraineTiles({ pane, tileSize: 256, maxZoom: 19,
    updateWhenZooming: false, keepBuffer: 2,
    attribution: IMAGERY_CREDIT }).addTo(map);
}

function updateExternalLabels(occupied = []) {
  if (mapMoving) return;
  const zoom = map.getZoom();
  const compact = window.innerWidth < 600;
  const viewport = map.getSize();
  const ordered = [...externalRegionLabels].sort((a, b) =>
    (a.country === 'MDA' ? -1 : a.country === 'RUS' ? 1 : 0) -
    (b.country === 'MDA' ? -1 : b.country === 'RUS' ? 1 : 0));
  for (const { marker, country, priority } of ordered) {
    const eligible = !selectedCode && (country === 'RUS'
      ? zoom >= (compact ? 7.25 : 6.75) || (priority && zoom >= 4.65) : zoom >= 4.65);
    const box = eligible ? labelBox(marker, true) : null;
    const show = eligible && labelFits(box, occupied, viewport);
    marker.getElement()?.classList.toggle('hidden', !show);
    if (show) occupied.push(box);
  }
}

async function addExternalRegions() {
  try {
    const collections = await Promise.all(EXTERNAL_COUNTRIES.map(async country => {
      const paths = [`./data/external-admin0/${country}.geojson`];
      if (country !== 'MDA') paths.push(`./data/external-admin1/${country}.geojson`);
      const responses = await Promise.all(paths.map(path => fetch(path)));
      if (responses.some(response => !response.ok)) throw new Error(`External boundaries unavailable: ${country}`);
      return Promise.all(responses.map(response => response.json()));
    }));
    const regionRenderer = L.canvas({ pane: 'externalRegions', padding: 0.3 });
    const borderRenderer = L.canvas({ pane: 'externalBorders', padding: 0.3 });
    for (const [index, [outline, regions]] of collections.entries()) {
      const country = EXTERNAL_COUNTRIES[index];
      if (regions) {
        L.geoJSON(regions, {
          pane: 'externalRegions', renderer: regionRenderer, interactive: false, smoothFactor: 1.5,
          style: { color: '#60777b', weight: 0.8, opacity: 0.5, fill: false }
        }).addTo(map);
      }
      L.geoJSON(outline, {
        pane: 'externalBorders', renderer: borderRenderer, interactive: false, smoothFactor: 1.5,
        style: { color: '#91a6a3', weight: 1.45, opacity: 0.8, fill: false }
      }).addTo(map);
      const labelFeatures = country === 'MDA' ? outline.features : regions?.features || [];
      for (const feature of labelFeatures) {
        if (feature.properties.showLabel === false) continue;
        const [lon, lat] = feature.properties.center;
        const icon = L.divIcon({
          className: 'external-label-icon', iconSize: [0, 0],
          html: `<span class="external-label-text${country === 'MDA' ? ' country-label-text' : ''}">${escapeHtml(feature.properties.label)}</span>`
        });
        const marker = L.marker([lat, lon], {
          icon, pane: 'externalLabels', interactive: false, keyboard: false
        }).addTo(map);
        externalRegionLabels.push({ marker, country, priority: feature.properties.priorityLabel });
      }
    }
    map.attributionControl.addAttribution(EXTERNAL_CREDIT);
    updateExternalLabels();
  } catch (error) {
    console.warn('External regions could not be displayed', error);
  }
}

function alertStyle(level, oblast = false, name = '') {
  const red = level === 'red';
  const key = regionKey(name);
  const flagFill = red && (/луган/.test(key) || /крим/.test(key));
  return {
    pane: 'alerts', color: red ? '#c7837d' : '#c4a465', weight: flagFill ? 2 : oblast ? 1.45 : 1.25,
    opacity: 0.8, fillColor: flagFill ? 'url(#ukraine-alert-flag)' : (red ? '#913f45' : '#9a7127'),
    fillOpacity: oblast ? 0.62 : 0.67
  };
}

function addFlagFill() {
  const svg = map.getPane('alerts').querySelector('svg');
  if (!svg || svg.querySelector('#ukraine-alert-flag')) return;
  const namespace = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(namespace, 'defs');
  const gradient = document.createElementNS(namespace, 'linearGradient');
  gradient.setAttribute('id', 'ukraine-alert-flag');
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '0');
  gradient.setAttribute('y2', '1');
  for (const [offset, color] of [['0%', '#347bc5'], ['50%', '#347bc5'],
    ['50%', '#d4ad3c'], ['100%', '#d4ad3c']]) {
    const stop = document.createElementNS(namespace, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  svg.insertBefore(defs, svg.firstChild);
}

function renderAlerts(data) {
  if (mapMoving) { pendingAlertData = data; return; }
  // updatedAt is the last state change, not the freshness of this snapshot.
  alertState = data && Array.isArray(data.raions) && Array.isArray(data.oblasts) &&
    Number.isFinite(Date.parse(data.updatedAt)) ? 'connected' : 'disconnected';
  activeRaions = []; activeOblasts = [];
  const wanted = new Map();
  if (alertState === 'connected') {
    for (const [kind, records, features, active] of [
      ['oblast', data.oblasts, alertOblastsByKey, activeOblasts],
      ['raion', data.raions, alertRaionsByKey, activeRaions]
    ]) {
      for (const record of records) {
        const feature = features.get(regionKey(record.key));
        const id = kind + ':' + regionKey(record.key);
        if (!feature || wanted.has(id)) continue;
        active.push(record);
        wanted.set(id, { feature, record, oblast: kind === 'oblast',
          key: regionKey(record.oblast || (kind === 'oblast' ? record.name || record.key : '')) });
      }
    }
  }
  const signature = JSON.stringify([alertState, activeOblasts, activeRaions]);
  if (signature === lastAlertSignature) return;
  lastAlertSignature = signature;
  const previous = new Map(alertVisuals.map(item => [item.id, item]));
  const next = [];
  for (const [id, item] of wanted) {
    const style = alertStyle(item.record.level, item.oblast, item.key);
    const styleSignature = JSON.stringify(style);
    let visual = previous.get(id);
    if (visual) {
      previous.delete(id);
      if (visual.styleSignature !== styleSignature) visual.layer.setStyle(style);
    } else {
      visual = { id, layer: L.geoJSON(item.feature, { pane: 'alerts', renderer: alertRenderer,
        interactive: false, style }).addTo(alertLayer) };
    }
    Object.assign(visual, { key: item.key, styleSignature });
    next.push(visual);
  }
  for (const item of previous.values()) alertLayer.removeLayer(item.layer);
  alertVisuals = next;
  addFlagFill();
  updateFocusOverlays();
  setStatus();
  renderSelectedCard();
}

function threatIconKind(threat) {
  const type = String(threat.type || '').toLocaleLowerCase('uk');
  const title = String(threat.title || '').toLocaleLowerCase('uk');
  const su35 = /(?:су|su)[-\s‑–]?35/.test(title);
  const kab = type === 'kab' || /каб|\bkab\b|керован[а-яіїєґ]* авіабомб/.test(title);
  if (su35 && kab) return 'su35-kab';
  if (su35) return 'su35';
  if (type === 'fpv' || /\bfpv\b|фпв/.test(title)) return 'fpv';
  if (type === 'recon' || /оріон|orion/.test(title)) return 'orion';
  if (type === 'ballistic' || /балістич|баллистич|ballistic/.test(title)) return 'ballistic';
  if (kab) return 'kab';
  if (type === 'missile' || /крилат[а-яіїєґ]* ракет|cruise missile/.test(title)) return 'cruise';
  if (type === 'uav' || /шахед|shahed|герань|geran/.test(title)) return 'shahed';
  return null;
}

function threatIconHtml(kind, heading, advisory) {
  const mainKind = kind === 'su35-kab' ? 'su35' : kind;
  const payload = kind === 'su35-kab'
    ? `<img class="threat-payload" src="${THREAT_ICONS.kab}" alt="">` : '';
  return `<span class="threat-icon threat-icon-${mainKind}${advisory ? ' advisory' : ''}" style="--heading:${heading == null ? 0 : heading.toFixed(1)}deg"><img class="threat-art" src="${THREAT_ICONS[mainKind]}" alt="">${payload}</span>`;
}

function renderThreats(data) {
  if (mapMoving) { pendingThreatData = data; return; }
  const nextState = data && Array.isArray(data.threats) && isFresh(data.serverTime, 120000)
    ? 'connected' : data ? 'stale' : 'disconnected';
  const nextThreats = nextState === 'connected'
    ? data.threats.filter(threat => threat.status === 'active' && isFresh(threat.updatedAt, 1800000)) : [];
  const signature = JSON.stringify([nextState, nextThreats]);
  if (signature === lastThreatSignature) return;
  lastThreatSignature = signature;
  threatState = nextState;
  activeThreats = nextThreats;
  const previous = new Map(threatVisuals.map(item => [item.id, item]));
  const next = [];
  const seen = new Set();
  for (const threat of activeThreats) {
    if (threat.areaOnly || threat.lat == null || threat.lon == null ||
        !Number.isFinite(Number(threat.lat)) || !Number.isFinite(Number(threat.lon))) continue;
    const id = threat.id != null ? String(threat.id) :
      JSON.stringify([threat.type, threat.title, threat.lat, threat.lon]);
    if (seen.has(id)) continue;
    seen.add(id);
    const approximate = threat.positionQuality !== 'precise' || Number(threat.uncertaintyKm) > 0;
    const advisory = threat.advisory === true;
    const heading = freshThreatHeading(threat);
    const color = advisory ? '#9ab5c0' : threat.type === 'ballistic' || threat.type === 'missile' ? '#fa8180' : '#f1c980';
    const kind = threatIconKind(threat);
    const iconSignature = JSON.stringify([kind, heading, advisory, approximate, color]);
    const title = `${threat.title || 'Загроза'}${heading == null ? '' : ` · орієнтовний курс ${Math.round(heading)}°`}`;
    const icon = () => L.divIcon({ className: 'threat-marker',
      iconSize: [THREAT_ICON_SIZE, THREAT_ICON_SIZE], iconAnchor: [THREAT_ICON_SIZE / 2, THREAT_ICON_SIZE / 2],
      html: threatIconHtml(kind, heading, advisory) });
    const point = [Number(threat.lat), Number(threat.lon)];
    let item = previous.get(id);
    previous.delete(id);
    if (item && item.kind !== kind) { threatLayer.removeLayer(item.layer); item = null; }
    if (!item) {
      const layer = kind ? L.marker(point, { pane: 'threats', title, icon: icon() })
        : L.circleMarker(point, { pane: 'threats', radius: advisory ? 4 : 5.5, color,
          weight: 2, fillColor: color, fillOpacity: advisory ? 0.36 : 0.65, dashArray: approximate ? '3 3' : null });
      item = { id, kind, layer: layer.addTo(threatLayer) };
    } else {
      const old = item.layer.getLatLng();
      if (old.lat !== point[0] || old.lng !== point[1]) item.layer.setLatLng(point);
      if (item.iconSignature !== iconSignature) {
        if (kind) item.layer.setIcon(icon());
        else item.layer.setStyle({ color, fillColor: color, fillOpacity: advisory ? 0.36 : 0.65,
          dashArray: approximate ? '3 3' : null }).setRadius(advisory ? 4 : 5.5);
      }
    }
    if (item.layer.getElement()) item.layer.getElement().title = title;
    const quality = approximate ? 'Приблизне місце' : 'Повідомлене місце';
    const uncertainty = Number(threat.uncertaintyKm) > 0 ? ` · похибка до ${escapeHtml(threat.uncertaintyKm)} км` : '';
    const category = advisory ? 'Спостереження' : 'Загроза';
    const course = heading == null ? '' : `<br><small>Орієнтовний курс: ${Math.round(heading)}° від півночі</small>`;
    const popup = `<strong>${escapeHtml(threat.title || category)}</strong><br>${category} · ${quality}${uncertainty}${course}<br>${escapeHtml(threat.region || '')}<br><small>Джерело: NEPTUN · ${escapeHtml(threat.updatedAt || '')}</small>`;
    if (item.popup !== popup) {
      if (item.layer.getPopup()) item.layer.setPopupContent(popup);
      else item.layer.bindPopup(popup);
    }
    Object.assign(item, { key: regionKey(threat.region), threat, iconSignature, popup });
    next.push(item);
  }
  for (const item of previous.values()) threatLayer.removeLayer(item.layer);
  threatVisuals = next;
  updateFocusOverlays();
  setStatus();
  renderSelectedCard();
}

async function getNeptun(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${NEPTUN_API}/${path}`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Neptun ${path}: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshLiveData() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const [alerts, threats] = await Promise.allSettled([getNeptun('alerts'), getNeptun('threats')]);
    if (realtimeConnected) return;
    renderAlerts(alerts.status === 'fulfilled' ? alerts.value : null);
    const threatSnapshot = threats.status === 'fulfilled' ? threats.value : null;
    renderThreats(threatSnapshot);
    if (threatSnapshot && Array.isArray(threatSnapshot.threats)) {
      streamThreatsById = new Map(threatSnapshot.threats.filter(threat => threat.id)
        .map(threat => [threat.id, threat]));
    }
    if (alerts.status === 'rejected') console.warn('Neptun alerts unavailable', alerts.reason);
    if (threats.status === 'rejected') console.warn('Neptun threats unavailable', threats.reason);
  } finally {
    refreshInFlight = false;
  }
}

function renderStreamThreats(timestamp) {
  renderThreats({ serverTime: timestamp, threats: [...streamThreatsById.values()] });
}

function handleStreamMessage(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return; }
  if (!envelope || typeof envelope.type !== 'string') return;
  lastStreamMessageMs = Date.now();
  const data = envelope.data;
  const timestamp = Number.isFinite(Date.parse(envelope.ts))
    ? envelope.ts : new Date().toISOString();
  if (envelope.type === 'snapshot' && data && Array.isArray(data.threats)) {
    streamThreatsById = new Map(data.threats.filter(threat => threat.id)
      .map(threat => [threat.id, threat]));
    renderStreamThreats(timestamp);
  } else if (envelope.type === 'upsert' && data?.id) {
    streamThreatsById.set(data.id, data);
    renderStreamThreats(timestamp);
  } else if (envelope.type === 'remove' && data?.id) {
    streamThreatsById.delete(data.id);
    renderStreamThreats(timestamp);
  } else if (envelope.type === 'alerts' && data &&
      Array.isArray(data.raions) && Array.isArray(data.oblasts)) {
    renderAlerts({ ...data, updatedAt: data.updatedAt || timestamp });
  }
}

function connectRealtimeStream() {
  if (!window.WebSocket || realtimeSocket) return;
  const socket = new WebSocket(NEPTUN_STREAM);
  realtimeSocket = socket;
  socket.onopen = () => {
    realtimeConnected = true;
    lastStreamMessageMs = Date.now();
    reconnectDelayMs = 1000;
    setStatus();
  };
  socket.onmessage = event => handleStreamMessage(event.data);
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (realtimeSocket !== socket) return;
    realtimeSocket = null;
    realtimeConnected = false;
    setStatus();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectRealtimeStream, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
  };
}

function addLabels() {
  for (const [code, name, lat, lon] of CAPITALS) {
    const icon = L.divIcon({
      className: 'capital-label-icon',
      iconSize: [0, 0],
      html: '<span class="capital-label-text">' + escapeHtml(name) + '</span>'
    });
    const marker = L.marker([lat, lon], {
      icon, pane: 'labels', interactive: false, keyboard: false
    }).addTo(map);
    labelMarkers.set(code, marker);
  }
  map.on('moveend resize', scheduleLabelLayout);
  document.fonts.ready.then(layoutLabels);
  requestAnimationFrame(layoutLabels);
}

function normalizeSearch(value) {
  return String(value || '').toLocaleLowerCase('uk').replace(/[ʼ’'`\-]/g, '').trim();
}

function updateSettlements() {
  if (!settlementLayer || !settlementPlaces.length) return;
  const wanted = new Set();
  const zoom = map.getZoom();
  if (zoom < 7) {
    for (const marker of settlementMarkers.values()) settlementLayer.removeLayer(marker);
    settlementMarkers.clear();
    return;
  }
  const minimumPopulation = zoom < 8 ? 20000 : zoom < 9 ? 5000 :
    zoom < 10 ? 1000 : zoom < 11 ? 250 : zoom < 12 ? 50 : 0;
  const bounds = map.getBounds().pad(0.04);
  const viewport = map.getSize();
  const occupied = [];
  let shown = 0;
  const focusKey = selectedCode ? selectedRegionKey() : '';
  // The index is ordered by population: prominent settlements get priority when labels collide.
  for (const place of settlementPlaces) {
    if (place[3] < minimumPopulation || shown >= 220) break;
    if (focusKey && regionKey(SETTLEMENT_REGIONS[place[4]]) !== focusKey) continue;
    if (!bounds.contains([place[1], place[2]])) continue;
    const point = map.latLngToContainerPoint([place[1], place[2]]);
    if (point.x < 0 || point.y < 0 || point.x > viewport.x || point.y > viewport.y) continue;
    const width = Math.min(175, place[0].length * (place[3] >= 100000 ? 6.4 : 5.7) + 11);
    const box = { left: point.x + 5, right: point.x + width, top: point.y - 7, bottom: point.y + 8 };
    if (occupied.some(other => box.left < other.right + 7 && box.right > other.left - 7 &&
        box.top < other.bottom + 5 && box.bottom > other.top - 5)) continue;
    occupied.push(box);
    wanted.add(place);
    if (!settlementMarkers.has(place)) {
      const icon = L.divIcon({ className: `settlement-label-icon${place[3] >= 100000 ? ' major' : ''}`,
        iconSize: [0, 0], html: `<span class="settlement-label-text">${escapeHtml(place[0])}</span>` });
      const marker = L.marker([place[1], place[2]], { icon, pane: 'settlements', interactive: false, keyboard: false }).addTo(settlementLayer);
      settlementMarkers.set(place, marker);
    }
    shown++;
  }
  for (const [place, marker] of settlementMarkers) {
    if (wanted.has(place)) continue;
    settlementLayer.removeLayer(marker);
    settlementMarkers.delete(place);
  }
}

let settlementUpdateFrame = 0;
function scheduleSettlements() {
  if (settlementUpdateFrame) return;
  settlementUpdateFrame = requestAnimationFrame(() => {
    settlementUpdateFrame = 0;
    if (!mapMoving) updateSettlements();
  });
}

async function loadSettlements() {
  try {
    const response = await fetch('./data/settlements.json');
    if (!response.ok) throw new Error(`Settlements HTTP ${response.status}`);
    const data = await response.json();
    settlementPlaces = data.places;
    map.attributionControl.addAttribution(GEONAMES_CREDIT);
    updateSettlements();
    layoutLabels();
  } catch (error) {
    console.warn('Settlement names unavailable', error);
  }
}

function searchMatches(query) {
  const term = normalizeSearch(query);
  if (!term) return [];
  const regions = regionMeta.filter(region => normalizeSearch(region.name).includes(term) ||
    normalizeSearch(region.label).includes(term)).slice(0, 3).map(region => ({ type: 'region', region }));
  if (term.length < 2) return regions;
  const exact = [];
  const prefix = [];
  const partial = [];
  // The index is already population-ranked, so the first matches are useful search suggestions.
  for (const place of settlementPlaces) {
    const name = normalizeSearch(place[0]);
    const alternate = normalizeSearch(place[5]);
    if (name === term || alternate === term) {
      if (exact.length < 7) exact.push({ type: 'place', place });
    } else if (name.startsWith(term) || alternate.startsWith(term)) {
      if (prefix.length < 7) prefix.push({ type: 'place', place });
    } else if (name.includes(term) || alternate.includes(term)) {
      if (partial.length < 7) partial.push({ type: 'place', place });
    }
  }
  return [...regions, ...exact, ...prefix, ...partial].slice(0, 8);
}

function hideSearchResults() {
  $('searchResults').hidden = true;
  $('regionSearch').setAttribute('aria-expanded', 'false');
}

function showSearchResults() {
  const results = $('searchResults');
  currentSearchResults = searchMatches($('regionSearch').value);
  highlightedSearchResult = 0;
  const query = $('regionSearch').value.trim();
  if (!query) { hideSearchResults(); return; }
  results.innerHTML = currentSearchResults.length ? currentSearchResults.map((item, index) => {
    const name = item.type === 'region' ? item.region.name : item.place[0];
    const meta = item.type === 'region' ? 'Область' :
      `${item.place[6] ? item.place[6] + ' · ' : ''}${SETTLEMENT_REGIONS[item.place[4]] || 'Україна'}`;
    return `<button type="button" class="search-item${index === 0 ? ' active' : ''}" role="option" data-index="${index}" aria-selected="${index === 0}"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></button>`;
  }).join('') : '<div class="search-empty">Нічого не знайдено</div>';
  results.hidden = false;
  $('regionSearch').setAttribute('aria-expanded', 'true');
}

function chooseSearchResult(index) {
  const item = currentSearchResults[index];
  if (!item) return;
  hideSearchResults();
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
  if (item.type === 'region') {
    $('regionSearch').value = item.region.name;
    selectRegion(item.region.code);
  } else {
    const place = item.place;
    $('regionSearch').value = place[0];
    selectRegion(null);
    const icon = L.divIcon({ className: 'search-pin', iconSize: [16, 16], iconAnchor: [8, 8],
      html: '<span class="search-pin-dot"></span>' });
    searchMarker = L.marker([place[1], place[2]], { icon, pane: 'searchPins', title: place[0] }).addTo(map);
    const location = [place[6], SETTLEMENT_REGIONS[place[4]] || 'Україна'].filter(Boolean).join(' · ');
    searchMarker.bindPopup(`<strong>${escapeHtml(place[0])}</strong><br><small>${escapeHtml(location)} · GeoNames</small>`);
    map.flyTo([place[1], place[2]], place[3] >= 100000 ? 11 : 13, { duration: 0.65 });
    map.once('moveend', () => searchMarker?.openPopup());
  }
  $('regionSearch').blur();
}

function setupSearch() {
  const input = $('regionSearch');
  input.addEventListener('input', showSearchResults);
  input.addEventListener('focus', showSearchResults);
  $('searchResults').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    if (button) chooseSearchResult(Number(button.dataset.index));
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideSearchResults(); input.value = ''; return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!currentSearchResults.length) return;
      highlightedSearchResult = (highlightedSearchResult + (event.key === 'ArrowDown' ? 1 : -1) +
        currentSearchResults.length) % currentSearchResults.length;
      for (const option of $('searchResults').querySelectorAll('.search-item')) {
        const active = Number(option.dataset.index) === highlightedSearchResult;
        option.classList.toggle('active', active);
        option.setAttribute('aria-selected', String(active));
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseSearchResult(highlightedSearchResult);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.search-wrap')) hideSearchResults();
  });
}

function setupHelp() {
  const panel = $('helpPanel');
  const toggle = $('helpToggle');
  const setOpen = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.onclick = () => setOpen(panel.hidden);
  $('helpClose').onclick = () => setOpen(false);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setOpen(false);
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !event.target.closest('#helpPanel, #helpToggle')) setOpen(false);
  });
}

async function init() {
  if (location.protocol === 'file:') {
    document.querySelector('.app').classList.add('startup-error');
    $('topStatus').textContent = 'КАРТУ ПОТРІБНО ЗАПУСТИТИ';
    $('sourceStatus').textContent = 'Карта не запущена';
    $('map').innerHTML = `<div class="startup-message" role="alert">
      <strong>Карта відкрита як файл</strong>
      <p>Браузер не може завантажити межі з локальних файлів. У папці проєкту двічі натисніть <b>«Запустити Обрій.command»</b> — карта відкриється в новій вкладці.</p>
      <small>Залиште вікно запуску відкритим, поки користуєтеся картою.</small>
    </div>`;
    return;
  }
  if (!window.L) {
    $('map').textContent = 'Не вдалося завантажити карту.';
    return;
  }
  map = L.map('map', {
    zoomControl: false, attributionControl: false, preferCanvas: false,
    minZoom: 3, maxZoom: 18, zoomSnap: 0.25, zoomDelta: 0.5,
    worldCopyJump: true
  });
  L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
  for (const [name, zIndex] of [['externalRegions', 375], ['externalBorders', 385], ['externalLabels', 390], ['regionImagery', 405], ['provinces', 410], ['alerts', 450], ['districtOutlines', 455], ['provinceOutlines', 460], ['countryBorder', 465], ['settlements', 630], ['labels', 650], ['threats', 670], ['searchPins', 710]]) {
    map.createPane(name).style.zIndex = zIndex;
  }
  map.getPane('externalRegions').style.pointerEvents = 'none';
  map.getPane('externalBorders').style.pointerEvents = 'none';
  map.getPane('externalLabels').style.pointerEvents = 'none';
  map.getPane('regionImagery').style.pointerEvents = 'none';
  map.getPane('districtOutlines').style.pointerEvents = 'none';
  map.getPane('provinceOutlines').style.pointerEvents = 'none';
  map.getPane('countryBorder').style.pointerEvents = 'none';
  map.getPane('labels').style.pointerEvents = 'none';
  map.getPane('settlements').style.pointerEvents = 'none';
  map.attributionControl.addAttribution(OCHA_CREDIT);
  try {
    const urls = [
      './data/ocha-adm0.geojson', './data/ocha-adm1.geojson',
      './data/map-regions.json', './data/neptun-raions.geojson',
      './data/neptun-oblasts.geojson', './data/ocha-adm2.geojson'
    ];
    const responses = await Promise.all(urls.map(url => fetch(url)));
    if (responses.some(response => !response.ok)) throw new Error('Boundary data unavailable');
    const [country, provinces, metadata, raions, oblasts, districts] = await Promise.all(responses.map(response => response.json()));
    regionMeta = metadata;
    for (const feature of districts.features) {
      const code = provinceCode(feature.properties.adm1_pcode);
      if (!districtFeaturesByCode.has(code)) districtFeaturesByCode.set(code, []);
      districtFeaturesByCode.get(code).push(feature);
    }
    for (const feature of raions.features) alertRaionsByKey.set(regionKey(feature.properties.key), feature);
    for (const feature of oblasts.features) alertOblastsByKey.set(regionKey(feature.properties.key), feature);
    addUkraineImagery(country.features[0].geometry);
    countryBorderLayer = L.geoJSON(country, {
      pane: 'countryBorder', interactive: false,
      style: { color: '#d5e0d8', weight: 2, opacity: 0.9, fill: false }
    }).addTo(map);
    L.geoJSON(provinces, {
      pane: 'provinces',
      style: () => provinceStyle(false),
      onEachFeature: (feature, layer) => {
        const pcode = feature.properties.adm1_pcode;
        const code = provinceCode(pcode);
        regionLayers.set(code, layer);
        regionFeatures.set(code, feature);
        layer.on('click', () => selectRegion(code));
        layer.on('add', () => {
          const element = layer.getElement();
          if (element) {
            element.setAttribute('aria-label', feature.properties.adm1_name1);
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.addEventListener('keydown', event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectRegion(code);
              }
            });
          }
        });
      }
    }).addTo(map);
    provinceBorderLayer = L.geoJSON(provinces, {
      pane: 'provinceOutlines', interactive: false,
      style: provinceOutlineStyle
    }).addTo(map);
    alertRenderer = L.svg({ pane: 'alerts' }).addTo(map);
    alertLayer = L.layerGroup().addTo(map);
    threatLayer = L.layerGroup().addTo(map);
    settlementLayer = L.layerGroup().addTo(map);
    allBounds = L.geoJSON(country).getBounds();
    fitOverview();
    window.addEventListener('resize', () => {
      map.invalidateSize();
      if (selectedCode) fitSelectedRegion(false);
      else fitOverview();
    });
    addLabels();
    addExternalRegions();
    loadSettlements();
    map.on('movestart zoomstart', () => { mapMoving = true; });
    map.on('moveend', () => { mapMoving = false; flushMapUpdates(); });
    map.on('resize', flushMapUpdates);
    $('mapStyleToggle').onclick = () => setMapStyle(mapStyle === 'dark' ? 'satellite' : 'dark');
    try {
      if (localStorage.getItem('obriy-map-style') === 'dark') setMapStyle('dark');
    } catch {}
    $('zoomIn').onclick = () => map.zoomIn(0.75);
    $('zoomOut').onclick = () => map.zoomOut(0.75);
    $('resetView').onclick = () => {
      selectRegion(null);
      $('regionSearch').value = '';
      hideSearchResults();
      if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
      fitOverview();
    };
    setupSearch();
    setupHelp();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeRegionPanel();
    });
    await refreshLiveData();
    connectRealtimeStream();
    loadCivilBulletins();
    setInterval(loadCivilBulletins, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadCivilBulletins(); });
    setInterval(() => {
      if (!realtimeConnected || Date.now() - lastStreamMessageMs > 45000) {
        if (realtimeSocket && Date.now() - lastStreamMessageMs > 45000) realtimeSocket.close();
        refreshLiveData();
      }
    }, POLL_INTERVAL_MS);
  } catch (error) {
    $('topStatus').textContent = 'Не вдалося завантажити межі карти';
    $('sourceStatus').textContent = 'Перевірте локальний сервер і файли геоданих';
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
