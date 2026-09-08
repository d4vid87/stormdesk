import assert from 'node:assert/strict';
import { safeMode } from '../site/js/compat.js';
assert.equal(safeMode('Mozilla/5.0 (Linux; Tizen 6.0; SAMSUNG Family Hub 9.0)', ''), true);
assert.equal(safeMode('Mozilla/5.0 SMART-TV', '?motion=full'), true);
assert.equal(safeMode('Mozilla/5.0 Android SamsungBrowser/25.0', ''), false);
assert.equal(safeMode('Mozilla/5.0 Chrome/130', '?safe=1'), true);
assert.equal(safeMode('Mozilla/5.0 Chrome/130', '?safe=0'), false);
console.log('Browser compatibility checks passed');
