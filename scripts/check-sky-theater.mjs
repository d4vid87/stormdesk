import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/icons.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const icons = vm.createContext({ location: { search: '' } });
vm.runInContext(source, icons);
const cases = {
  'clear-day':'sunny', 'clear-night':'sunny', cloudy:'cloudy', foggy:'fog', windy:'wind',
  'partly-cloudy-day':'partly', 'partly-cloudy-night':'partly',
  'possibly-rainy-day':'showers', 'possibly-rainy-night':'showers', rainy:'rain',
  'possibly-thunderstorm-day':'storm', 'possibly-thunderstorm-night':'storm', thunderstorm:'storm',
  'possibly-snow-day':'snow', 'possibly-snow-night':'snow', snow:'snow',
  'possibly-sleet-day':'sleet', 'possibly-sleet-night':'sleet', sleet:'sleet',
};
for (const [key, type] of Object.entries(cases)) {
  assert.equal(icons.forecastSceneType(key), type, `${key} uses the correct precipitation/sky artwork`);
  const scene = icons.forecastScene(key);
  assert.ok(scene.includes(`class="sf-scene ${type}${key.endsWith('-night') ? ' night' : ''}"`));
  assert.ok(scene.includes('aria-hidden="true"'), 'Artwork stays decorative; the day button supplies the accessible forecast');
}
for (const key of [undefined, null, '', 'new-provider-code', 'clear-day"><img src=x onerror=alert(1)>', 'constructor', {}, 0]) {
  assert.equal(icons.forecastSceneType(key), 'unknown', 'Unknown or malformed conditions cannot imply clear weather');
  assert.ok(icons.forecastScene(key).includes('class="sf-scene unknown"'));
  assert.ok(!icons.forecastScene(key).includes('<img'), 'Provider keys are never interpolated as markup');
}
console.log('Sky Theater: provider conditions, night variants and unavailable artwork passed');
