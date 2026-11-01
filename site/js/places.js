// Phase 6 — place search / saved places. Switching a place re-points every
// non-Tempest panel (alerts, AQI, models, nowcast, NWS) via app.js coords().
import * as api from './api.js';
import { settings, saveSettings, coords, refreshAll, notify } from './app.js';

const $ = (id) => document.getElementById(id);
let searchVersion = 0;

export function renderPlaces() {
  const s = settings();
  const places = [{ id: null, name: s.stationName || 'Station' }, ...s.places];
  $('places').replaceChildren(...places.map((p, index) => {
    const group = document.createElement('span');
    group.className = 'saved-place';
    const button = document.createElement('button');
    const active = (s.activePlace || null) === p.id;
    button.className = 'place' + (active ? ' on' : '');
    button.textContent = (index ? '' : '🏠 ') + p.name;
    button.setAttribute('aria-pressed', String(active));
    button.onclick = () => {
      saveSettings({ activePlace: p.id });
      renderPlaces();
      $('places').querySelector('[aria-pressed="true"]').focus();
      refreshAll();
    };
    group.append(button);
    if (index) {
      const remove = document.createElement('button');
      remove.className = 'place-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${p.name}`);
      remove.onclick = () => {
        saveSettings({
          places: settings().places.filter((place) => place.id !== p.id),
          activePlace: settings().activePlace === p.id ? null : settings().activePlace,
        });
        renderPlaces();
        const groups = $('places').children;
        groups[Math.min(index, groups.length - 1)].querySelector('button').focus();
        refreshAll();
      };
      group.append(remove);
    }
    return group;
  }));
  updateHeader();
}

function updateHeader() {
  const c = coords();
  $('station-name').textContent = settings().activePlace ? `${c.name} (away)` : (c.name || '');
}

async function search() {
  const version = ++searchVersion;
  const q = $('place-q').value.trim();
  const results = $('place-results');
  results.textContent = q ? 'Searching…' : 'Enter a city or postcode.';
  results.setAttribute('aria-busy', String(!!q));
  if (!q) return;
  try {
    const j = await api.geocode(q);
    if (version !== searchVersion) return;
    results.replaceChildren(...(j.features || []).map((f) => {
      const button = document.createElement('button');
      button.className = 'place-hit';
      button.textContent = api.placeLabel(f.properties);
      button.onclick = () => {
        const p = f.properties;
        const place = {
          id: String(Date.now()),
          name: [p.city || p.name, p.state].filter(Boolean).join(', '),
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        };
        saveSettings({ places: [...settings().places, place], activePlace: place.id });
        ++searchVersion;
        results.textContent = '';
        $('place-q').value = '';
        renderPlaces();
        $('places').querySelector('[aria-pressed="true"]').focus();
        refreshAll();
      };
      return button;
    }));
    if (!results.children.length) results.textContent = 'No matches. Try a nearby town or postcode.';
    results.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    if (version === searchVersion) results.textContent = `Search failed. ${e.message} Try again.`;
  } finally {
    if (version === searchVersion) results.setAttribute('aria-busy', 'false');
  }
}

export function initPlaces() {
  $('btn-place-search').onclick = search;
  $('place-q').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) search(); };
  $('place-q').oninput = () => {
    ++searchVersion;
    $('place-results').textContent = '';
    $('place-results').setAttribute('aria-busy', 'false');
  };

  // notification category toggles
  $('notif-toggles').querySelectorAll('input[data-cat]').forEach((cb) => {
    cb.checked = settings().notif[cb.dataset.cat] !== false;
    cb.onchange = () => saveSettings({ notif: { ...settings().notif, [cb.dataset.cat]: cb.checked } });
  });

  $('btn-notif-test').onclick = () => {
    const cats = ['severe', 'precip', 'lightning', 'wind', 'winter', 'changes'];
    cats.forEach((c, i) => setTimeout(() => notify({
      id: `test-${c}-${Date.now()}`, category: c,
      title: `Test · ${c}`, body: 'Injected through the live notification pipe.',
    }), i * 400));
  };

  renderPlaces();
}
