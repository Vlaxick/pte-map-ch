const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function harness() {
  const frames = [];
  const group = () => ({ items: new Set(), removeLayer(layer) { this.items.delete(layer); } });
  const counters = { markers: 0, positions: 0, icons: 0, polygons: 0, styles: 0 };
  function layer(point) {
    let popup;
    return {
      point, addTo(parent) { parent.items.add(this); return this; },
      getLatLng() { return { lat: this.point[0], lng: this.point[1] }; },
      setLatLng(p) { counters.positions++; this.point = p; return this; },
      setIcon() { counters.icons++; return this; },
      getElement() { return null; }, getPopup() { return popup; },
      bindPopup(p) { popup = p; return this; }, setPopupContent(p) { popup = p; return this; },
      eachLayer(fn) { fn(this); }, setStyle() { counters.styles++; return this; }, setRadius() { return this; }
    };
  }
  const context = vm.createContext({
    console, Date, Map, Set, JSON, Number, String, Math,
    document: { addEventListener() {} },
    requestAnimationFrame: fn => (frames.push(fn), frames.length),
    L: { divIcon: x => x,
      marker: p => { counters.markers++; return layer(p); },
      circleMarker: p => { counters.markers++; return layer(p); },
      geoJSON: () => { counters.polygons++; return layer([0, 0]); } }
  });
  const run = code => vm.runInContext(code, context);
  run(readFileSync(require.resolve('../script.js'), 'utf8'));
  context.threatGroup = group(); context.alertGroup = group(); context.settlementGroup = group();
  run(`threatLayer = threatGroup; alertLayer = alertGroup; settlementLayer = settlementGroup;
    setStatus = () => {}; renderSelectedCard = () => {}; addFlagFill = () => {};
    scheduleLabelLayout = () => {}; scheduleSettlements = () => {};`);
  return { run, context, counters, frames };
}
const record = id => ({ id, type: 'uav', title: 'Test', status: 'active', lat: 10, lon: 20,
  updatedAt: new Date().toISOString(), region: 'Test region', heading: 90 });
function snapshot(h, threats) { h.context.input = { serverTime: new Date().toISOString(), threats }; h.run('renderThreats(input)'); }

test('a source update preserves existing marker identity and its open popup', () => {
  const h = harness(); const a = record('a'), b = record('b');
  snapshot(h, [a, b]);
  const original = h.run('threatVisuals[0].layer');
  snapshot(h, [{ ...a, title: 'Updated', lon: 21 }, b]);
  assert.equal(h.run('threatVisuals[0].layer'), original);
  assert.equal(h.counters.markers, 2);
  assert.equal(h.counters.positions, 1);
  assert.equal(h.counters.icons, 0);
  snapshot(h, [b]);
  assert.equal(h.context.threatGroup.items.size, 1);
  snapshot(h, [{ ...b, areaOnly: true }]);
  assert.equal(h.context.threatGroup.items.size, 0);
});

test('navigation coalesces snapshots and never writes marker positions mid-zoom', () => {
  const h = harness(); const a = record('a'); snapshot(h, [a]);
  h.run('mapMoving = true');
  snapshot(h, [{ ...a, lon: 21 }]); snapshot(h, [{ ...a, lon: 22 }]);
  assert.equal(h.counters.positions, 0);
  h.run('mapMoving = false; flushMapUpdates()');
  while (h.frames.length) h.frames.shift()();
  assert.equal(h.counters.positions, 1);
  assert.equal(h.run('threatVisuals[0].layer.getLatLng().lng'), 22);
  snapshot(h, [{ ...a, updatedAt: '2000-01-01T00:00:00Z' }]);
  assert.equal(h.context.threatGroup.items.size, 0);
});

test('unchanged alert geometry is retained when its level or neighboring alert changes', () => {
  const h = harness();
  h.run(`alertRaionsByKey.set('one', {}); alertRaionsByKey.set('two', {});`);
  h.context.alerts = { updatedAt: new Date().toISOString(), oblasts: [], raions: [{ key: 'one', oblast: 'Test', level: 'yellow' }] };
  h.run('renderAlerts(alerts)'); const first = h.run('alertVisuals[0].layer');
  h.context.alerts.raions[0].level = 'red';
  h.context.alerts.raions.push({ key: 'two', oblast: 'Test', level: 'yellow' });
  h.run('renderAlerts(alerts)');
  assert.equal(h.run('alertVisuals[0].layer'), first);
  assert.equal(h.counters.polygons, 2);
  assert.equal(h.counters.styles, 1);
  h.run('renderAlerts(null)');
  assert.equal(h.context.alertGroup.items.size, 0);
});

test('settlement labels survive a pan when the same places remain visible', () => {
  const h = harness();
  h.context.fakeMap = { getZoom: () => 8, getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getSize: () => ({ x: 1000, y: 600 }), latLngToContainerPoint: p => ({ x: p[1], y: p[0] }) };
  h.run(`map = fakeMap; settlementPlaces = [['One',100,100,100000,'01'],['Two',200,200,40000,'02']]; updateSettlements()`);
  const first = h.run('[...settlementMarkers.values()][0]');
  h.run('updateSettlements()');
  assert.equal(h.run('[...settlementMarkers.values()][0]'), first);
  assert.equal(h.counters.markers, 2);
  h.context.fakeMap.getZoom = () => 6;
  h.run('updateSettlements()');
  assert.equal(h.context.settlementGroup.items.size, 0);
});
