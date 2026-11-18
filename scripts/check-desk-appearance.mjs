import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../site/js/desk-appearance.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const options = [...html.match(/<select id="set-palette">([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(([, value, textContent]) => ({value,textContent,parentElement:{label:'Themes'}}));
let current = {theme:'dark',palette:'graphite',accent:'#ffeeaa',gaugeStyle:'pixel',motion:'lite',fontScale:1.2,stationId:'unchanged'};
let applyCount = 0, saveCount = 0;
const listeners = [];
globalThis.window = {addEventListener(type, fn){assert.equal(type,'wd:settings');listeners.push(fn);}};
globalThis.document = {documentElement:{dataset:{}},getElementById(id){assert.equal(id,'set-palette');return {options};}};
globalThis.appearanceTest = {
 settings:()=>current,
 saveSettings(patch){current={...current,...patch};saveCount++;for(const listener of listeners)listener({detail:patch});return current;},
 applyTheme(){applyCount++;},
};
const mod = await import('data:text/javascript;base64,' + Buffer.from(source.replace(/^import[^\n]+\n/, 'const {settings,saveSettings,applyTheme}=globalThis.appearanceTest;\n')).toString('base64'));
assert.equal(mod.availableThemes().length,20);
assert.equal(mod.DESK_STYLES.length,5);
mod.initDeskAppearance();mod.initDeskAppearance();
assert.equal(listeners.length,1);
assert.equal(document.documentElement.dataset.deskStyle,'observatory');
assert.equal(current.gaugeStyle,'pixel');
assert.equal(saveCount,0);
for (const theme of mod.availableThemes()) {
 assert.equal(mod.applyDeskTheme(theme.id),true);
 assert.equal(mod.currentTheme(),theme.id);
 assert.equal(current.accent,'');
 assert.equal(current.stationId,'unchanged');
 assert.equal(current.motion,'lite');
 assert.equal(current.fontScale,1.2);
}
assert.equal(applyCount,20);
const before = JSON.stringify(current), savesBefore = saveCount;
assert.equal(mod.applyDeskTheme('__proto__'),false);
assert.equal(mod.applyDeskStyle('unknown'),false);
assert.equal(JSON.stringify(current),before);
assert.equal(saveCount,savesBefore);
for(const style of mod.DESK_STYLES) {
 assert.equal(mod.applyDeskStyle(style.id,{matchGauges:true}),true);
 assert.equal(current.gaugeStyle,style.gaugeStyle);
 assert.equal(current.deskMatchGauges,true);
 assert.equal(document.documentElement.dataset.deskStyle,style.id);
 assert.equal(current.palette,'eink');
 assert.equal(current.motion,'lite');
}
appearanceTest.saveSettings({gaugeStyle:'pixel'});
assert.equal(current.deskMatchGauges,false);
mod.applyDeskStyle('mission');
assert.equal(current.gaugeStyle,'pixel');
assert.equal(current.deskMatchGauges,false);
mod.applyDeskMatchGauges(true);
assert.equal(current.gaugeStyle,'dial');
assert.equal(current.deskMatchGauges,true);
mod.applyDeskMatchGauges(false);
mod.applyDeskStyle('skyline');
assert.equal(current.gaugeStyle,'dial');
assert.equal(current.deskMatchGauges,false);
appearanceTest.saveSettings({deskStyle:'not-valid'});
assert.equal(document.documentElement.dataset.deskStyle,'observatory');
assert.equal(current.stationId,'unchanged');
assert.equal(applyCount,20);
console.log('PASS: 20 theme round-trips, five look/gauge mappings, preserved station/motion/scale/theme, manual override + re-enable, invalid inputs, idempotent initialization.');
