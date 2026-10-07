export const timelineSettings = (s) => ({
  precip: 30,
  freezeC: 0,
  heatC: 35,
  gustMs: 13.4112,
  aqi: 101,
  categories: ['precip', 'storm', 'winter', 'freeze', 'heat', 'wind', 'aqi', 'change', 'sun', 'alert'],
  ...(s.timeline || {}),
});
