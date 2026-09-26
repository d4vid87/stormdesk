import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../site/js/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/themes.css',import.meta.url),'utf8');
const settingsCode=app.slice(app.indexOf('const DEFAULTS'),app.indexOf('// Callers re-store')).replace(/^export /gm,'');
for(const [saved,expected] of [[null,'graphite'],[{palette:'oled'},'oled'],[{palette:'spruce'},'spruce'],[{palette:'',theme:'light'},''],[{theme:'light'},'']]){
 const context=vm.createContext({structuredClone,localStorage:{getItem:()=>saved===null?null:JSON.stringify(saved)}});
 vm.runInContext(settingsCode,context);
 assert.equal(vm.runInContext('settings().palette',context),expected);
 if(saved?.theme)assert.equal(vm.runInContext('settings().theme',context),saved.theme);
}
const palettes=['graphite','violet','carbon','abyss','spruce','oxblood','copper','indigo','petrol','espresso'];
for(const id of palettes){
 assert.match(html,new RegExp('<option value="'+id+'">'));
 const block=css.split('html[data-theme][data-palette="'+id+'"]:is(:root) {')[1]?.split('}')[0];
 assert.ok(block,'Missing '+id+' palette');
 for(const token of ['bg','panel','panel2','line','text','muted','accent','good','warn','bad'])assert.ok(block.includes('--'+token+':'),id+' missing '+token);
 assert.ok(block.includes('color-scheme:dark'));
}
assert.match(html,/<option value="graphite">Graphite Silver \(default\)<\/option>/);
for(const id of ['oled','blue','light','contrast','ember','auto','solarized','solarized-light','contrast-light','eink'])assert.ok(html.includes('value="'+id+'"'));
console.log('PASS: Graphite default, saved preferences preserved, all ten complete dark palettes, classic themes retained.');
