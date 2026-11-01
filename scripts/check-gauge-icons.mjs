import assert from 'node:assert/strict';
import {styles, names, icon, gaugeStyle, gaugeIcon} from '../site/js/gauge-icons.js';
assert.equal(styles.length, 5);
assert.equal(gaugeStyle(undefined), 'orbit');
assert.equal(gaugeStyle('bad'), 'orbit');
assert.equal(gaugeStyle('neon'), 'neon');
for (const style of styles) {
  for (const name of names) {
    const svg = icon(name, style.id);
    assert.ok(svg.includes('aria-hidden="true"'));
    assert.ok(svg.includes('<svg'));
    assert.ok(!svg.includes('undefined'));
    assert.ok(icon(name, style.id, true).includes('wx-unavailable'));
  }
}
assert.equal(icon('bad', 'orbit'), '');
assert.equal(icon('Rain', '<script>'), '');
assert.ok(gaugeIcon('g-rain', undefined, false).includes('wx-orbit'));
assert.equal(gaugeIcon('unknown', 'orbit', false), '');
console.log('All five gauge styles, eight readings, missing values and default fallback passed.');
