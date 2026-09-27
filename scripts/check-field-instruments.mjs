import assert from 'node:assert/strict';
import { fieldInstrument } from '../site/js/field-instruments.js';
const ids=['g-rain','g-ltg','g-wind','g-wbgt','g-uv','g-press','g-hum','g-dew'];
for(const id of ids){
 const face=fieldInstrument(id,{value:12,deg:225,count:3});
 assert(face.includes(`data-instrument="${id}"`));
 assert(!/NaN|Infinity|undefined/.test(face));
 const missing=fieldInstrument(id,{value:null,deg:undefined});
 assert(!/class="fi-fill"|class="fi-needle"|class="fi-arc"/.test(missing),`${id}: missing data must not draw an active indicator`);
}
assert(fieldInstrument('g-ltg',{value:null,count:0,available:true}).includes('opacity="0.45"'));
assert(!fieldInstrument('g-wind',{value:5}).includes('transform="rotate'));
assert(fieldInstrument('g-wind',{value:5,deg:360}).includes('rotate(0 60 54)'));
assert(!fieldInstrument('g-hum',{value:0}).includes('fi-arc'));
assert(fieldInstrument('g-hum',{value:140}).includes('stroke-dasharray="100 100"'));
assert(!fieldInstrument('g-uv',{value:0}).includes('fi-fill'));
assert.equal((fieldInstrument('g-uv',{value:17}).match(/class="fi-fill"/g)||[]).length,12);
const fillHeight=s=>Number(s.match(/width="16" height="([\d.]+)"/)[1]);
assert(Math.abs(fillHeight(fieldInstrument('g-rain',{value:.5}))-fillHeight(fieldInstrument('g-rain',{value:12.7},true)))<1e-8);
assert(Math.abs(fillHeight(fieldInstrument('g-wbgt',{value:86}))-fillHeight(fieldInstrument('g-wbgt',{value:30},true)))<1e-8);
assert.equal(fieldInstrument('g-press',{value:30}),fieldInstrument('g-press',{value:30*33.8639},true));
assert.equal(fieldInstrument('g-wet',{value:60}),'');
console.log('Field instruments: eight faces, live values, missing/zero states, bounded scales, compass direction and unit equivalence passed.');
