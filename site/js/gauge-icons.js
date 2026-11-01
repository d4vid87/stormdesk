  const styles = [
    {id:'chrome',name:'Liquid Chrome',tag:'Sculpted · polished',description:'Silver weather symbols with a slow liquid sheen and soft blue highlights.'},
    {id:'neon',name:'Neon Trace',tag:'Electric · crisp',description:'Fine luminous strokes, falling rain and flowing wind. Sharp at small sizes.'},
    {id:'dial',name:'Precision Dial',tag:'Instrument · restrained',description:'Machined rings, fine tick marks and a gently moving needle around each symbol.'},
    {id:'orbit',name:'Orbit Glass',tag:'Atmospheric · dimensional',description:'Weather symbols suspended in tinted glass, with a slow orbit of light.'},
    {id:'pixel',name:'Pixel Pulse',tag:'Retro · technical',description:'Custom pixel weather symbols with stepped motion and a subtle scanning highlight.'}
  ];
  const names=['Rain','Lightning','Wind','WBGT','UV index','Pressure','Humidity','Dew point'];
  const colors=['#87d4fb','#f3cf75','#9fdfd9','#f5ab83','#edce7f','#9cbce3','#81cddc','#acdebe'];
  const shapes=[
    '<path class="solid" d="M14 29a7 7 0 1 1 2-14 9 9 0 0 1 17-1 7.5 7.5 0 1 1 1 15Z"/><g class="rain"><path d="m16 33-2 5m11-5-2 5m11-5-2 5"/></g>',
    '<path class="solid bolt" d="m27 5-16 22h11l-2 16 17-24H25Z"/>',
    '<g class="wind"><path d="M7 18h23c9 0 9-12 2-12-4 0-6 3-5 6M5 25h31c8 0 8 12 1 12-4 0-5-2-5-5M10 32h11"/></g>',
    '<path class="solid" d="M17 8a4 4 0 0 1 8 0v20a8 8 0 1 1-8 0Z"/><path class="heat" d="M21 17v17"/><circle cx="21" cy="34" r="3"/><g class="sun"><circle cx="36" cy="14" r="4"/><path d="M36 5v2m0 14v2m-9-9h2m14 0h2m-15-6 2 2m8 8 2 2m0-12-2 2"/></g>',
    '<g class="sun"><circle class="solid" cx="24" cy="24" r="9"/><path d="M24 4v5m0 30v5M4 24h5m30 0h5M10 10l4 4m20 20 4 4m0-28-4 4M14 34l-4 4"/></g>',
    '<path d="M9 36a19 19 0 1 1 30 0M12 29l3-1m-1-13 3 2m7-8v4m10 2-3 2m6 12-3-1"/><g class="needle"><path d="m24 28 8-12"/></g><circle class="solid" cx="24" cy="28" r="3"/><path d="M16 39h16"/>',
    '<path class="solid" d="M24 5S10 22 10 30a14 14 0 0 0 28 0C38 22 24 5 24 5Z"/><g class="water"><path d="m19 34 10-13"/><circle cx="19" cy="24" r="2"/><circle cx="29" cy="32" r="2"/></g>',
    '<path class="solid" d="M9 35C7 18 23 13 39 14c0 18-12 28-26 24M13 38l18-16"/><path class="dew" d="M18 5s-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9Z"/>'
  ];
  const pixels=[
    ['0011100','0111110','1111111','1111111','0000000','0101010','0101010'],
    ['0001100','0011000','0111000','1111110','0001100','0011000','0110000'],
    ['0000110','0000001','1111110','0000000','1111111','0000001','0000110'],
    ['0010000','0101010','0101000','0111010','0111000','1111100','0111000'],
    ['1001001','0100010','0011100','1011101','0011100','0100010','1001001'],
    ['0011100','0100010','1000101','1001001','1010001','0100010','0011100'],
    ['0001000','0011100','0011100','0111110','1111111','1111111','0111110'],
    ['0000011','0001111','0011111','0111010','0110100','0101000','1010000']
  ];
  function icon(name,style,unavailable=false){
    const i=names.indexOf(name);if(i<0||!styles.some(s=>s.id===style))return '';
    let shape=shapes[i];
    if(style==='pixel')shape=pixels[i].map((row,y)=>[...row].map((on,x)=>on==='1'?`<rect x="${7+x*5}" y="${7+y*5}" width="4" height="4"/>`:'').join('')).join('');
    const dial=style==='dial'?'<circle class="dial-track" cx="24" cy="24" r="22"/><circle class="dial-ticks" cx="24" cy="24" r="19.5"/><g class="sweep"><path d="M24 2v5"/><circle cx="24" cy="24" r="1"/></g>':'';
    return `<span class="wx-icon wx-${style}${unavailable?' wx-unavailable':''}" style="--wx:${colors[i]}" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${dial}<g class="weather-shape">${shape}</g></svg></span>`;
  }
export { styles, names, icon };
const labels = {'g-rain':'Rain','g-ltg':'Lightning','g-wind':'Wind','g-wbgt':'WBGT','g-uv':'UV index','g-press':'Pressure','g-hum':'Humidity','g-dew':'Dew point'};
export const gaugeStyle = value => styles.some(style => style.id === value) ? value : 'orbit';
export const gaugeIcon = (id, style, unavailable) => icon(labels[id], gaugeStyle(style), unavailable);

