import assert from 'node:assert/strict';
import { radarAlertColor } from '../site/js/alert-style.js';
for (const [event, color] of Object.entries({
  'Air Quality Alert':'#ffffff', 'Tornado Warning':'#ff0000',
  'Severe Thunderstorm Warning':'#ffa500', 'Flash Flood Warning':'#00c800',
  'Tornado Watch':'#ffff00', 'Severe Thunderstorm Watch':'#db7093',
  'Snow Squall Warning':'#c71585', 'Flood Advisory':'#00b478',
  'Special Weather Statement':'#ffe4b5',
})) assert.equal(radarAlertColor(event), color, event);
assert.equal(radarAlertColor('Other Warning'), '#e63c3c');
assert.equal(radarAlertColor(), '#ffffff');
assert.equal(radarAlertColor('<script>example</script>'), '#ffffff');
console.log('Alert event colors: HookEcho palette, white air quality, safe fallbacks passed.');
