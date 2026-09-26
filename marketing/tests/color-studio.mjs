import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../assets/color-studio.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/palettes.css',import.meta.url),'utf8');
assert.equal((css.match(/\{/g)||[]).length,10);
assert.equal((css.match(/\}/g)||[]).length,10);
const palettes=JSON.parse(source.match(/const palettes = (.+);/)[1]);
const storage=new Map();
function setup(url){
 const elements=new Map();
 const element=selector=>{if(!elements.has(selector))elements.set(selector,{value:'',addEventListener(type,fn){this[type]=fn},setAttribute(){}});return elements.get(selector)};
 const document={documentElement:{dataset:{}},querySelector:element,addEventListener(type,fn){if(type==='DOMContentLoaded')fn()}};
 const location={href:url};
 runInNewContext(source,{document,location,URL,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},history:{replaceState(_,__,url){location.href=String(url)}}});
 return {document,element,location};
}
const page=setup('http://localhost/?palette=carbon');
for(const palette of palettes){page.element('#color-choice').value=palette.id;page.element('#color-choice').change();assert.equal(page.document.documentElement.dataset.palette,palette.id);assert.equal(setup('http://localhost/features.html').document.documentElement.dataset.palette,palette.id)}
page.element('[data-color-next]').click();assert.equal(page.document.documentElement.dataset.palette,'cobalt');
page.element('[data-color-prev]').click();assert.equal(page.document.documentElement.dataset.palette,'monochrome');
page.element('[data-color-reset]').click();assert.equal(page.document.documentElement.dataset.palette,'carbon');assert.equal(storage.size,0);
assert.equal(setup('http://localhost/?palette=invalid').document.documentElement.dataset.palette,'carbon');
function luminance(hex){return hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
for(const p of palettes)for(const [a,b] of [['text','bg'],['muted','bg'],['text','panel'],['muted','panel'],['actionInk','action']]){const x=luminance(p.colors[a]),y=luminance(p.colors[b]);assert.ok((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5,`${p.id} ${a}/${b} contrast`)}
console.log('Ten palettes: selection, persistence, cycling, reset, invalid input, and text contrast passed.');
