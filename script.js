const $ = id => document.getElementById(id);
const IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const IMAGERY_CREDIT = 'Imagery: Esri, Vantor, Earthstar Geographics, GIS User Community';
const OCHA_CREDIT = '<a href="https://gis.unocha.org/server/rest/services/Hosted/UKR_Simplified_Boundaries/FeatureServer" target="_blank" rel="noopener noreferrer">Boundaries: OCHA</a>';
const EXTERNAL_COUNTRIES = ['RUS', 'BLR', 'POL', 'SVK', 'HUN', 'ROU', 'MDA'];
const EXTERNAL_CREDIT = '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">External regions: geoBoundaries gbOpen</a>';
const NEPTUN_API = 'https://neptun.in.ua/api/v1';
const POLL_INTERVAL_MS = 15000;
const GEONAMES_CREDIT = '<a href="https://www.geonames.org/export/" target="_blank" rel="noopener noreferrer">Settlements: GeoNames CC BY</a>';
const SETTLEMENT_REGIONS = {
  '01':'Черкаська', '02':'Чернігівська', '03':'Чернівецька', '04':'Дніпропетровська',
  '05':'Донецька', '06':'Івано-Франківська', '07':'Харківська', '08':'Херсонська',
  '09':'Хмельницька', '10':'Кіровоградська', '11':'АР Крим', '12':'Київ',
  '13':'Київська', '14':'Луганська', '15':'Львівська', '16':'Миколаївська',
  '17':'Одеська', '18':'Полтавська', '19':'Рівненська', '20':'Севастополь',
  '21':'Сумська', '22':'Тернопільська', '23':'Вінницька', '24':'Волинська',
  '25':'Закарпатська', '26':'Запорізька', '27':'Житомирська'
};

let map;
let allBounds;
let regionMeta = [];
let selectedCode = null;
let regionLayers = new Map();
let labelMarkers = new Map();
let alertRaionsByKey = new Map();
let alertOblastsByKey = new Map();
let alertLayer;
let alertRenderer;
let threatLayer;
let countryBorderLayer;
let provinceBorderLayer;
let externalRegionLabels = [];
let mapStyle = 'satellite';
let alertState = 'disconnected';
let activeRaions = [];
let activeOblasts = [];
let activeThreats = [];
let threatState = 'disconnected';
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
      color: selected ? '#f0c78b' : '#657980',
      weight: selected ? 2.3 : 0.7,
      opacity: selected ? 1 : 0.4,
      fillColor: selected ? '#79674d' : '#1c2c39',
      fillOpacity: selected ? 0.6 : 0.83
    };
  }
  return {
    pane: 'provinces',
    color: selected ? '#dac995' : '#80918e',
    weight: selected ? 2 : 0.7,
    opacity: selected ? 0.95 : 0.4,
    fillColor: selected ? '#d6b778' : '#c5d9cc',
    fillOpacity: selected ? 0.2 : 0.035
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
  for (const [code, layer] of regionLayers) layer.setStyle(provinceStyle(code === selectedCode));
  provinceBorderLayer.setStyle(provinceOutlineStyle());
  countryBorderLayer.setStyle({ color: dark ? '#b5c7c2' : '#d5e0d8' });
  try { localStorage.setItem('obriy-map-style', mapStyle); } catch {}
}

function regionKey(value) {
  return String(value || '').toLocaleLowerCase('uk').replace(/\s+область$/, '')
    .replace(/^м\.\s*/, '').trim();
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
    ? threatState === 'connected' ? 'Дані оновлюються' : 'Тривоги оновлюються · загрози недоступні'
    : message.toLocaleLowerCase('uk');
}

function renderSelectedCard() {
  const card = $('regionCard');
  const region = regionMeta.find(item => item.code === selectedCode);
  if (!region) {
    card.hidden = true;
    return;
  }
  const key = regionKey(region.name);
  const activeNames = activeRaions
    .filter(raion => regionKey(raion.oblast) === key)
    .map(raion => raion.name);
  const oblastAlert = activeOblasts.find(oblast => regionKey(oblast.oblast || oblast.name) === key);
  const threatCount = activeThreats.filter(threat => regionKey(threat.region) === key).length;
  const message = alertState !== 'connected'
    ? 'Свіжі дані про тривоги зараз недоступні.'
    : [oblastAlert ? `Тривога в області (${oblastAlert.level === 'red' ? 'червоний' : 'жовтий'} рівень).` : '',
      activeNames.length ? `Райони з тривогою: ${activeNames.join(', ')}.` : '',
      threatState === 'connected' && threatCount ? `Повідомлень про загрози в регіоні: ${threatCount}.` : '']
      .filter(Boolean).join(' ') || 'Активних тривог за даними Neptun немає.';
  card.innerHTML = `<div class="card-head"><span>РЕГІОН / ${escapeHtml(selectedCode)}</span><button aria-label="Закрити">×</button></div>
    <h2>${escapeHtml(region.name)}</h2>
    <p>${escapeHtml(message)}</p>`;
  card.querySelector('button').onclick = () => selectRegion(null);
  card.hidden = false;
}

function selectRegion(code, focus = false) {
  if (selectedCode && regionLayers.has(selectedCode)) {
    regionLayers.get(selectedCode).setStyle(provinceStyle(false));
  }
  selectedCode = code;
  if (code && regionLayers.has(code)) {
    const layer = regionLayers.get(code);
    layer.setStyle(provinceStyle(true));
    if (focus) map.flyToBounds(layer.getBounds(), { padding: [95, 95], maxZoom: 7, duration: 0.55 });
  }
  for (const [regionCode, marker] of labelMarkers) {
    marker.getElement()?.classList.toggle('selected', regionCode === code);
  }
  renderSelectedCard();
  layoutLabels();
}

function layoutLabels() {
  if (!map || !labelMarkers.size) return;
  const zoom = map.getZoom();
  const strength = Math.max(0, Math.min(1, (zoom - 5.05) / 0.75));
  const labelSize = 8 + Math.max(0, Math.min(1, (zoom - 5.1) / 1.6)) * 1.5;
  for (const region of regionMeta) {
    const icon = labelMarkers.get(region.code)?.getElement();
    const text = icon?.querySelector('.oblast-label-text');
    if (!icon || !text) continue;
    if (icon) icon.classList.remove('hidden');
    if (icon) icon.style.opacity = region.code === 'UA-30' ? '0.78' : String(strength * 0.62);
    text.style.fontSize = (region.code === 'UA-30' ? Math.max(8.5, labelSize) : labelSize).toFixed(1) + 'px';
    if (zoom <= 5.05 && region.code !== 'UA-30') {
      icon.classList.add('hidden');
      continue;
    }
    if (zoom >= 8.4 && region.code !== selectedCode) {
      icon.classList.add('hidden');
      continue;
    }
    if (window.innerWidth < 600 && zoom < 6.15 && !region.priority && region.code !== selectedCode && region.code !== 'UA-30') {
      icon.classList.add('hidden');
      continue;
    }
  }
}

function addUkraineImagery(geometry) {
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
  const UkraineTiles = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const scale = 2 ** coords.z;
      const tileX = ((coords.x % scale) + scale) % scale;
      const tileBounds = [tileX * 256 / scale, coords.y * 256 / scale,
        (tileX + 1) * 256 / scale, (coords.y + 1) * 256 / scale];
      const nearby = shapes.filter(({ bounds }) =>
        bounds[0] <= tileBounds[2] && bounds[2] >= tileBounds[0] &&
        bounds[1] <= tileBounds[3] && bounds[3] >= tileBounds[1]);
      if (!nearby.length || coords.y < 0 || coords.y >= scale) {
        requestAnimationFrame(() => done(null, canvas));
        return canvas;
      }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const context = canvas.getContext('2d');
        context.beginPath();
        for (const { rings } of nearby) {
          for (const ring of rings) {
            ring.forEach(([x, y], index) => {
              const px = x * scale - tileX * 256;
              const py = y * scale - coords.y * 256;
              if (index === 0) context.moveTo(px, py);
              else context.lineTo(px, py);
            });
            context.closePath();
          }
        }
        context.clip('evenodd');
        context.drawImage(image, 0, 0, 256, 256);
        done(null, canvas);
      };
      image.onerror = () => done(new Error('Satellite tile unavailable'), canvas);
      image.src = IMAGERY.replace('{z}', coords.z).replace('{y}', coords.y).replace('{x}', tileX);
      return canvas;
    }
  });
  new UkraineTiles({ tileSize: 256, maxZoom: 19, attribution: IMAGERY_CREDIT }).addTo(map);
}

function updateExternalLabels() {
  const zoom = map.getZoom();
  const compact = window.innerWidth < 600;
  const eligible = [];
  for (const item of externalRegionLabels) {
    const { marker, country, priority } = item;
    const show = country === 'RUS'
      ? zoom >= (compact ? 7.25 : 6.75) || (priority && zoom >= 4.65)
      : zoom >= 4.65;
    marker.getElement()?.classList.toggle('hidden', !show);
    if (show) eligible.push(item);
  }
  const occupied = [];
  const viewport = map.getContainer().getBoundingClientRect();
  // Keep labels legible when several small border regions meet on screen.
  for (const { marker } of eligible.sort((a, b) =>
    (a.country === 'MDA' ? -1 : a.country === 'RUS' ? 1 : 0) -
    (b.country === 'MDA' ? -1 : b.country === 'RUS' ? 1 : 0))) {
    const element = marker.getElement();
    const rect = element?.querySelector('.external-label-text')?.getBoundingClientRect();
    if (!rect || rect.right < viewport.left || rect.left > viewport.right ||
        rect.bottom < viewport.top || rect.top > viewport.bottom) continue;
    const overlaps = occupied.some(other => rect.left < other.right + 5 &&
      rect.right > other.left - 5 && rect.top < other.bottom + 3 && rect.bottom > other.top - 3);
    if (overlaps) element.classList.add('hidden');
    else occupied.push(rect);
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
    for (const [index, [outline, regions]] of collections.entries()) {
      const country = EXTERNAL_COUNTRIES[index];
      if (regions) {
        L.geoJSON(regions, {
          pane: 'externalRegions', interactive: false,
          style: { color: '#60777b', weight: 0.8, opacity: 0.5, fill: false }
        }).addTo(map);
      }
      L.geoJSON(outline, {
        pane: 'externalBorders', interactive: false,
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
  alertLayer.clearLayers();
  // updatedAt marks the last alert change, so an unchanged live snapshot can be older than a polling cycle.
  alertState = data && Array.isArray(data.raions) && Array.isArray(data.oblasts) &&
    Number.isFinite(Date.parse(data.updatedAt)) ? 'connected' : 'disconnected';
  activeRaions = [];
  activeOblasts = [];
  if (alertState === 'connected') {
    const seenOblasts = new Set();
    for (const oblast of data.oblasts) {
      const feature = alertOblastsByKey.get(regionKey(oblast.key));
      if (!feature || seenOblasts.has(oblast.key)) continue;
      seenOblasts.add(oblast.key);
      activeOblasts.push(oblast);
      L.geoJSON(feature, { pane: 'alerts', renderer: alertRenderer, interactive: false,
        style: alertStyle(oblast.level, true, oblast.oblast || oblast.name || oblast.key) }).addTo(alertLayer);
    }
    const seenRaions = new Set();
    for (const raion of data.raions) {
      const feature = alertRaionsByKey.get(regionKey(raion.key));
      if (!feature || seenRaions.has(raion.key)) continue;
      seenRaions.add(raion.key);
      activeRaions.push(raion);
      L.geoJSON(feature, { pane: 'alerts', renderer: alertRenderer, interactive: false,
        style: alertStyle(raion.level, false, raion.oblast || raion.key) }).addTo(alertLayer);
    }
  }
  addFlagFill();
  setStatus();
  renderSelectedCard();
}

function renderThreats(data) {
  threatLayer.clearLayers();
  threatState = data && Array.isArray(data.threats) && isFresh(data.serverTime, 120000)
    ? 'connected' : data ? 'stale' : 'disconnected';
  activeThreats = threatState === 'connected'
    ? data.threats.filter(threat => threat.status === 'active' && isFresh(threat.updatedAt, 1800000))
    : [];
  for (const threat of activeThreats) {
    // Area-only coordinates are an oblast centroid, never a verified object position.
    if (threat.areaOnly || threat.lat == null || threat.lon == null ||
        !Number.isFinite(Number(threat.lat)) || !Number.isFinite(Number(threat.lon))) continue;
    const approximate = threat.positionQuality !== 'precise' || Number(threat.uncertaintyKm) > 0;
    const advisory = threat.advisory === true;
    const rawHeading = threat.heading == null ? NaN : Number(threat.heading);
    const heading = Number.isFinite(rawHeading) && isFresh(threat.updatedAt, 600000)
      ? ((rawHeading % 360) + 360) % 360 : null;
    const color = advisory ? '#9ab5c0' : threat.type === 'ballistic' || threat.type === 'missile'
      ? '#fa8180' : '#f1c980';
    const marker = threat.type === 'uav'
      ? L.marker([Number(threat.lat), Number(threat.lon)], {
        pane: 'threats', title: `${threat.title || 'БпЛА'}${heading == null ? '' : ` · орієнтовний курс ${Math.round(heading)}°`}`,
        icon: L.divIcon({
          className: 'uav-threat-marker', iconSize: [32, 32], iconAnchor: [16, 16],
          html: `<span class="uav-threat-icon${advisory ? ' advisory' : ''}${heading == null ? '' : ' has-heading'}" style="--heading:${heading == null ? 0 : heading.toFixed(1)}deg"><img src="./assets/shahed.png?v=2" alt="" /></span>`
        })
      }).addTo(threatLayer)
      : L.circleMarker([Number(threat.lat), Number(threat.lon)], {
        pane: 'threats', radius: advisory ? 5 : 7, color, weight: 2,
        fillColor: color, fillOpacity: advisory ? 0.36 : 0.65,
        dashArray: approximate ? '3 3' : undefined
      }).addTo(threatLayer);
    const quality = approximate ? 'Приблизне місце' : 'Повідомлене місце';
    const uncertainty = Number(threat.uncertaintyKm) > 0
      ? ` · похибка до ${escapeHtml(threat.uncertaintyKm)} км` : '';
    const category = advisory ? 'Спостереження' : 'Загроза';
    const course = heading == null ? '' : `<br><small>Орієнтовний курс: ${Math.round(heading)}° від півночі</small>`;
    marker.bindPopup(`<strong>${escapeHtml(threat.title || category)}</strong><br>${category} · ${quality}${uncertainty}${course}<br>${escapeHtml(threat.region || '')}<br><small>Джерело: NEPTUN · ${escapeHtml(threat.updatedAt || '')}</small>`);
  }
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
    renderAlerts(alerts.status === 'fulfilled' ? alerts.value : null);
    renderThreats(threats.status === 'fulfilled' ? threats.value : null);
    if (alerts.status === 'rejected') console.warn('Neptun alerts unavailable', alerts.reason);
    if (threats.status === 'rejected') console.warn('Neptun threats unavailable', threats.reason);
  } finally {
    refreshInFlight = false;
  }
}

function addLabels() {
  for (const region of regionMeta) {
    const city = ['UA-30', 'UA-40'].includes(region.code);
    const icon = L.divIcon({
      className: 'oblast-label-icon' + (city ? ' city' : ''),
      iconSize: [0, 0],
      html: '<span class="oblast-label-text">' + escapeHtml(region.label) + '</span>'
    });
    const marker = L.marker([region.lat, region.lon], {
      icon, pane: 'labels', interactive: false, keyboard: false
    }).addTo(map);
    labelMarkers.set(region.code, marker);
  }
  map.on('moveend zoomend zoom resize', () => requestAnimationFrame(layoutLabels));
  document.fonts.ready.then(layoutLabels);
  requestAnimationFrame(layoutLabels);
}

function normalizeSearch(value) {
  return String(value || '').toLocaleLowerCase('uk').replace(/[ʼ’'`\-]/g, '').trim();
}

function updateSettlements() {
  if (!settlementLayer || !settlementPlaces.length) return;
  settlementLayer.clearLayers();
  const zoom = map.getZoom();
  if (zoom < 7) return;
  const minimumPopulation = zoom < 8 ? 100000 : zoom < 9 ? 12000 :
    zoom < 10 ? 2500 : zoom < 11 ? 500 : zoom < 12 ? 50 : 0;
  const bounds = map.getBounds().pad(0.04);
  const viewport = map.getSize();
  const occupied = [];
  let shown = 0;
  // The index is ordered by population: prominent settlements get priority when labels collide.
  for (const place of settlementPlaces) {
    if (place[3] < minimumPopulation || shown >= 220) break;
    if (!bounds.contains([place[1], place[2]])) continue;
    const point = map.latLngToContainerPoint([place[1], place[2]]);
    if (point.x < 0 || point.y < 0 || point.x > viewport.x || point.y > viewport.y) continue;
    const width = Math.min(175, place[0].length * (place[3] >= 100000 ? 6.4 : 5.7) + 11);
    const box = { left: point.x + 5, right: point.x + width, top: point.y - 7, bottom: point.y + 8 };
    if (occupied.some(other => box.left < other.right + 7 && box.right > other.left - 7 &&
        box.top < other.bottom + 5 && box.bottom > other.top - 5)) continue;
    occupied.push(box);
    const icon = L.divIcon({ className: `settlement-label-icon${place[3] >= 100000 ? ' major' : ''}`,
      iconSize: [0, 0], html: `<span class="settlement-label-text">${escapeHtml(place[0])}</span>` });
    L.marker([place[1], place[2]], { icon, pane: 'settlements', interactive: false, keyboard: false }).addTo(settlementLayer);
    shown++;
  }
}

async function loadSettlements() {
  try {
    const response = await fetch('./data/settlements.json');
    if (!response.ok) throw new Error(`Settlements HTTP ${response.status}`);
    const data = await response.json();
    settlementPlaces = data.places;
    map.attributionControl.addAttribution(GEONAMES_CREDIT);
    updateSettlements();
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
    selectRegion(item.region.code, true);
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
  for (const [name, zIndex] of [['externalRegions', 375], ['externalBorders', 385], ['externalLabels', 390], ['provinces', 410], ['alerts', 450], ['provinceOutlines', 460], ['countryBorder', 465], ['settlements', 630], ['labels', 650], ['threats', 670], ['searchPins', 710]]) {
    map.createPane(name).style.zIndex = zIndex;
  }
  map.getPane('externalRegions').style.pointerEvents = 'none';
  map.getPane('externalBorders').style.pointerEvents = 'none';
  map.getPane('externalLabels').style.pointerEvents = 'none';
  map.getPane('provinceOutlines').style.pointerEvents = 'none';
  map.getPane('countryBorder').style.pointerEvents = 'none';
  map.getPane('labels').style.pointerEvents = 'none';
  map.getPane('settlements').style.pointerEvents = 'none';
  map.attributionControl.addAttribution(OCHA_CREDIT);
  try {
    const urls = [
      './data/ocha-adm0.geojson', './data/ocha-adm1.geojson',
      './data/map-regions.json', './data/neptun-raions.geojson',
      './data/neptun-oblasts.geojson'
    ];
    const responses = await Promise.all(urls.map(url => fetch(url)));
    if (responses.some(response => !response.ok)) throw new Error('Boundary data unavailable');
    const [country, provinces, metadata, raions, oblasts] = await Promise.all(responses.map(response => response.json()));
    regionMeta = metadata;
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
        const aliases = { UA01:'UA-43', UA44:'UA-09', UA73:'UA-77', UA80:'UA-30', UA85:'UA-40' };
        const code = aliases[pcode] || pcode.slice(0, 2) + '-' + pcode.slice(2);
        regionLayers.set(code, layer);
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
    const fitAll = () => {
      const compact = map.getSize().x < 600;
      map.fitBounds(allBounds, {
        paddingTopLeft: compact ? [12, 74] : [80, 105],
        paddingBottomRight: compact ? [12, 36] : [80, 70],
        maxZoom: compact ? 6 : 6.25
      });
    };
    fitAll();
    window.addEventListener('resize', () => {
      map.invalidateSize();
      if (!selectedCode) fitAll();
    });
    addLabels();
    addExternalRegions();
    loadSettlements();
    map.on('zoomend moveend resize', updateExternalLabels);
    map.on('zoomend moveend resize', updateSettlements);
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
      fitAll();
    };
    setupSearch();
    setupHelp();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') selectRegion(null);
    });
    await refreshLiveData();
    setInterval(refreshLiveData, POLL_INTERVAL_MS);
  } catch (error) {
    $('topStatus').textContent = 'Не вдалося завантажити межі карти';
    $('sourceStatus').textContent = 'Перевірте локальний сервер і файли геоданих';
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
