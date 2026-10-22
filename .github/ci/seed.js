// Runs before any module: settings are read once at module eval, so this is the only place a CI
// run can look like a configured install rather than a first-run wizard.
// Invalid/duplicate saved entries are ignored without losing any readings.
localStorage.setItem('wd.gaugeOrder', JSON.stringify(['g-rain', 'g-rain', 'not-a-gauge']));
localStorage.setItem('wd.settings', JSON.stringify({
  units: 'imperial', stationName: 'CI Station', theme: 'dark', palette: 'oled', accent: '',
  stationSource: 'ecowitt', lat: 32.75, lon: -97.33, deskRadar: false, nightDim: false, kioskCycleSec: 0, eco: 'off',
}));
