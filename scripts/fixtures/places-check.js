import '../js/boot.js';
import { settings, saveSettings } from '../js/app.js';
import { renderPlaces } from '../js/places.js';

const $ = id => document.getElementById(id);
const check = (value, message) => { if (!value) throw Error(message); };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const feature = name => ({ properties: { name, city: name, state: 'Test' }, geometry: { coordinates: [-97, 35] } });

try {
  for (const [inputId, buttonId, resultsId] of [
    ['place-q', 'btn-place-search', 'place-results'],
    ['wiz-place', 'btn-wiz-place', 'wiz-place-list'],
  ]) {
    const input = $(inputId), results = $(resultsId);
    const search = query => {
      input.value = query;
      input.dispatchEvent(new Event('input'));
      $(buttonId).click();
      return window.searchRequests.at(-1);
    };
    const old = search(inputId + '-old');
    const latest = search(inputId + '-latest');
    check(results.getAttribute('aria-busy') === 'true', 'Search announces loading');
    latest.resolve([feature('Current town')]); await flush();
    old.resolve([feature('Outdated town')]); await flush();
    check(results.textContent.includes('Current town') && !results.textContent.includes('Outdated'), 'Latest search wins');
    check(results.getAttribute('aria-busy') === 'false', 'Search clears loading state');
    const staleError = search(inputId + '-error');
    const current = search(inputId + '-current');
    current.resolve([feature('Still current')]); await flush();
    staleError.reject(Error('old failure')); await flush();
    check(results.textContent.includes('Still current'), 'Old errors cannot replace new results');
    const edited = search(inputId + '-edited');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    edited.resolve([feature('Cleared result')]); await flush();
    check(results.textContent === '' && results.getAttribute('aria-busy') === 'false', 'Editing invalidates outstanding results');
    $(buttonId).click();
    check(results.textContent.includes('Enter a city or postcode'), 'Empty searches explain what to enter');
    const empty = search(inputId + '-empty');
    empty.resolve([]); await flush();
    check(results.textContent.includes('nearby town or postcode'), 'No matches gives a useful next step');
    const failed = search(inputId + '-failed');
    failed.reject(Error('offline')); await flush();
    check(results.textContent.includes('Try again') && results.getAttribute('aria-busy') === 'false', 'Failures allow retry');
    const literal = search(inputId + '-literal');
    literal.resolve([feature('<img src=x onerror=alert(1)>')]); await flush();
    check(!results.querySelector('img') && results.textContent.includes('<img'), 'Location labels stay plain text');
    const count = window.searchRequests.length;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    check(window.searchRequests.length === count, 'IME Enter does not submit a partial city name');
  }

  $('btn-settings').click();
  document.querySelector('[data-settings-category="everyday"]').click();
  $('place-results').querySelector('button').click();
  check(settings().places.length === 1 && settings().activePlace === settings().places[0].id, 'Choosing a result saves and activates it');
  check(document.activeElement.getAttribute('aria-pressed') === 'true', 'Choosing a result focuses the saved place');
  check(!$('places').querySelector('img'), 'Saved place labels remain plain text');
  const remove = $('places').querySelector('.place-remove');
  check(remove.tagName === 'BUTTON' && remove.getAttribute('aria-label').startsWith('Remove '), 'Removal is a named keyboard button');
  remove.click();
  check(settings().places.length === 0 && settings().activePlace === null, 'Removing the active place returns to the station');
  check(document.activeElement === $('places').querySelector('.place'), 'Removal keeps keyboard focus in the list');

  saveSettings({ places: [{ id: 'a', name: 'Chicago, Illinois', lat: 41.88, lon: -87.63 },
    { id: 'b', name: 'Oklahoma City, Oklahoma', lat: 35.47, lon: -97.52 }], activePlace: 'b' });
  renderPlaces();
  $('places').querySelector('.place').click();
  check(settings().activePlace === null && document.activeElement.getAttribute('aria-pressed') === 'true', 'Switching to the station preserves focus');
  $('places').querySelector('.place-remove').click();
  check(settings().places.length === 1 && settings().places[0].id === 'b', 'Removing another place keeps remaining places');
  check($('places').scrollWidth <= $('places').clientWidth, 'Saved places fit the settings panel');
  check($('place-controls').scrollWidth <= $('place-controls').clientWidth, 'Search controls fit the settings panel');
  check($('places').querySelector('.place-remove').getBoundingClientRect().height >= 44, 'Remove target is touch sized');
  document.body.dataset.placesCheck = 'ok';
} catch (error) {
  document.body.dataset.placesCheck = error.message;
  console.error(error);
}
