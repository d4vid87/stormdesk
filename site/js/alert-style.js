// HookEcho event colors; Air Quality uses the requested white statement treatment.
const COLORS = {
  'Tornado Warning':'#ff0000', 'Severe Thunderstorm Warning':'#ffa500',
  'Flash Flood Warning':'#00c800', 'Flood Warning':'#00a05a',
  'Snow Squall Warning':'#c71585', 'Tornado Watch':'#ffff00',
  'Severe Thunderstorm Watch':'#db7093', 'Special Weather Statement':'#ffe4b5',
  'Flood Advisory':'#00b478', 'Air Quality Alert':'#ffffff',
};
export function radarAlertColor(event = '') {
  return COLORS[event] || (/warning/i.test(event) ? '#e63c3c'
    : /watch/i.test(event) ? '#c8b43c' : /advisory/i.test(event) ? '#78b4c8' : '#ffffff');
}
