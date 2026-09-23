const $ = id => document.getElementById(id);
const IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const IMAGERY_CREDIT = 'Imagery: Esri, Vantor, Earthstar Geographics, GIS User Community';
const OCHA_CREDIT = '<a href="https://gis.unocha.org/server/rest/services/Hosted/UKR_Simplified_Boundaries/FeatureServer" target="_blank" rel="noopener noreferrer">Boundaries: OCHA</a>';
const EXTERNAL_COUNTRIES = ['RUS', 'BLR', 'POL', 'SVK', 'HUN', 'ROU', 'MDA'];
const EXTERNAL_CREDIT = '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">External regions: geoBoundaries gbOpen</a>';
const NEPTUN_API = 'https://neptun.in.ua/api/v1';
const POLL_INTERVAL_MS = 15000;

let map;
let allBounds;
let regionMeta = [];
let selectedCode = null;
let regionLayers = new Map();
let labelMarkers = new Map();
let alertRaionsByKey = new Map();
let alertOblastsByKey = new Map();
let alertLayer;
let threatLayer;
let countryBorderLayer;
let externalRegionLabels = [];
let mapStyle = 'satellite';
let alertState = 'disconnected';
let activeRaions = [];
let activeOblasts = [];
let activeThreats = [];
let threatState = 'disconnected';
let refreshInFlight = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function provinceStyle(selected = false) {
  if (mapStyle === 'dark') {
    return {
      pane: 'provinces',
      color: selected ? '#f0c78b' : '#708790',
      weight: selected ? 2.3 : 1.15,
      opacity: selected ? 1 : 0.8,
      fillColor: selected ? '#79674d' : '#1c2c39',
      fillOpacity: selected ? 0.6 : 0.83
    };
  }
  return {
    pane: 'provinces',
    color: selected ? '#f1d698' : '#d1ddda',
    weight: selected ? 2.3 : 1.25,
    opacity: selected ? 1 : 0.78,
    fillColor: selected ? '#d6b778' : '#c5d9cc',
    fillOpacity: selected ? 0.2 : 0.035
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
  countryBorderLayer.setStyle({ color: dark ? '#a7bac0' : '#e8eee8' });
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
  for (const { marker } of eligible.sort((a, b) => (a.country === 'RUS') - (b.country === 'RUS'))) {
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
          style: { color: '#66767b', weight: 0.85, opacity: 0.52, fill: false }
        }).addTo(map);
      }
      L.geoJSON(outline, {
        pane: 'externalBorders', interactive: false,
        style: { color: '#b4c4c3', weight: 1.75, opacity: 0.88, fill: false }
      }).addTo(map);
      for (const feature of regions?.features || []) {
        const [lon, lat] = feature.properties.center;
        const icon = L.divIcon({
          className: 'external-label-icon', iconSize: [0, 0],
          html: '<span class="external-label-text">' + escapeHtml(feature.properties.label) + '</span>'
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

function alertStyle(level, oblast = false) {
  const red = level === 'red';
  return {
    pane: 'alerts', color: red ? '#ff837a' : '#f5ce77', weight: oblast ? 2.2 : 2.6,
    opacity: 0.95, fillColor: red ? '#d34347' : '#c99839',
    fillOpacity: oblast ? 0.21 : 0.32
  };
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
      L.geoJSON(feature, { pane: 'alerts', interactive: false,
        style: alertStyle(oblast.level, true) }).addTo(alertLayer);
    }
    const seenRaions = new Set();
    for (const raion of data.raions) {
      const feature = alertRaionsByKey.get(regionKey(raion.key));
      if (!feature || seenRaions.has(raion.key)) continue;
      seenRaions.add(raion.key);
      activeRaions.push(raion);
      L.geoJSON(feature, { pane: 'alerts', interactive: false,
        style: alertStyle(raion.level) }).addTo(alertLayer);
    }
  }
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
    const color = advisory ? '#9ab5c0' : threat.type === 'ballistic' || threat.type === 'missile'
      ? '#fa8180' : '#f1c980';
    const marker = L.circleMarker([Number(threat.lat), Number(threat.lon)], {
      pane: 'threats', radius: advisory ? 5 : 7, color, weight: 2,
      fillColor: color, fillOpacity: advisory ? 0.36 : 0.65,
      dashArray: approximate ? '3 3' : undefined
    }).addTo(threatLayer);
    const quality = approximate ? 'Приблизне місце' : 'Повідомлене місце';
    const uncertainty = Number(threat.uncertaintyKm) > 0
      ? ` · похибка до ${escapeHtml(threat.uncertaintyKm)} км` : '';
    const category = advisory ? 'Спостереження' : 'Загроза';
    marker.bindPopup(`<strong>${escapeHtml(threat.title || category)}</strong><br>${category} · ${quality}${uncertainty}<br>${escapeHtml(threat.region || '')}<br><small>Джерело: NEPTUN · ${escapeHtml(threat.updatedAt || '')}</small>`);
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

async function init() {
  if (!window.L) {
    $('map').textContent = 'Не вдалося завантажити карту.';
    return;
  }
  map = L.map('map', {
    zoomControl: false, attributionControl: false, preferCanvas: false,
    minZoom: 3, maxZoom: 13, zoomSnap: 0.25, zoomDelta: 0.5,
    worldCopyJump: true
  });
  L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
  for (const [name, zIndex] of [['externalRegions', 375], ['externalBorders', 385], ['externalLabels', 390], ['provinces', 410], ['countryBorder', 430], ['alerts', 450], ['threats', 470], ['labels', 650]]) {
    map.createPane(name).style.zIndex = zIndex;
  }
  map.getPane('externalRegions').style.pointerEvents = 'none';
  map.getPane('externalBorders').style.pointerEvents = 'none';
  map.getPane('externalLabels').style.pointerEvents = 'none';
  map.getPane('countryBorder').style.pointerEvents = 'none';
  map.getPane('labels').style.pointerEvents = 'none';
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
      style: { color: '#e8eee8', weight: 2, opacity: 0.9, fill: false }
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
    alertLayer = L.layerGroup().addTo(map);
    threatLayer = L.layerGroup().addTo(map);
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
    map.on('zoomend moveend resize', updateExternalLabels);
    $('mapStyleToggle').onclick = () => setMapStyle(mapStyle === 'dark' ? 'satellite' : 'dark');
    try {
      if (localStorage.getItem('obriy-map-style') === 'dark') setMapStyle('dark');
    } catch {}
    $('zoomIn').onclick = () => map.zoomIn(0.75);
    $('zoomOut').onclick = () => map.zoomOut(0.75);
    $('resetView').onclick = () => {
      selectRegion(null);
      $('regionSearch').value = '';
      fitAll();
    };
    $('regionSearch').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const query = event.currentTarget.value.trim().toLocaleLowerCase('uk');
        const match = regionMeta.find(region =>
          region.name.toLocaleLowerCase('uk').includes(query) ||
          region.label.toLocaleLowerCase('uk').includes(query)
        );
        if (query && match) {
          selectRegion(match.code, true);
          event.currentTarget.blur();
        }
      } else if (event.key === 'Escape') {
        event.currentTarget.value = '';
        selectRegion(null);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') selectRegion(null);
    });
    await refreshLiveData();
    setInterval(refreshLiveData, POLL_INTERVAL_MS);
  } catch (error) {
    $('topStatus').textContent = 'Не вдалося завантажити межі карти';
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
