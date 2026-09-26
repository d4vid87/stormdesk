// Reuse the live form controls: moving nodes preserves values, handlers and save behavior.
export const SETTINGS_CATEGORIES = [
  ['everyday', 'Everyday', 'Location, units & clock', '◷'],
  ['appearance', 'Appearance', 'Theme, text & motion', '◐'],
  ['alerts', 'Alerts & sound', 'Warnings, voice & quiet hours', '△'],
  ['station', 'My station', 'Connection & device health', '⌁'],
  ['radar', 'Radar', 'HookEcho display & radar site', '◎'],
  ['tools', 'More tools', 'Household, data & connections', '⋯'],
];

export function organizeSettings() {
  const $ = id => document.getElementById(id), drawer = $('drawer');
  if ($('settings-home')) return;
  const title = drawer.querySelector(':scope > h2'), actions = $('drawer-actions');
  const existing = [...drawer.children].filter(el => el !== title && el !== actions);
  const close = document.createElement('button');
  close.className = 'settings-close'; close.type = 'button'; close.textContent = '×';
  close.setAttribute('aria-label', 'Close settings'); close.onclick = () => $('btn-close').click();
  title.append(close);
  const shell = document.createElement('div');
  shell.innerHTML = `<div class="settings-heading"><div><span class="settings-eyebrow">MAKE STORMDESK YOURS</span><h3 id="settings-page-title" tabindex="-1">A little more you.</h3><p id="settings-description">Your weather, your screen, your way.</p></div><label class="settings-search">Find a setting<input id="settings-search" type="search" placeholder="Theme, radar, backup…" autocomplete="off"></label></div>
    <button id="settings-back" type="button" hidden>← Settings home</button>
    <div id="settings-home"><div id="settings-status" class="settings-status"></div><div class="settings-cards">${SETTINGS_CATEGORIES.map(([id,name,description,icon]) => `<button type="button" class="settings-card" data-settings-category="${id}"><span class="settings-card-icon" aria-hidden="true">${icon}</span><span class="settings-card-arrow" aria-hidden="true">↗</span><strong>${name}</strong><span>${description}</span><small id="settings-summary-${id}"></small></button>`).join('')}</div><p id="settings-empty" role="status" hidden>No settings found. Try “radar”, “theme”, or “backup”.</p></div>`;
  title.after(shell);
  const panels = Object.fromEntries(SETTINGS_CATEGORIES.map(([id,name]) => {
    const panel = document.createElement('section'); panel.id = `settings-${id}`;
    panel.className = 'settings-panel'; panel.hidden = true; panel.setAttribute('aria-label',name);
    shell.append(panel); return [id,panel];
  }));
  const group = (category, name, collapsed = false) => {
    const el = document.createElement(collapsed ? 'details' : 'fieldset');
    el.className = 'settings-group';
    const heading = document.createElement(collapsed ? 'summary' : 'legend'); heading.textContent = name;
    el.append(heading); panels[category].append(el); return el;
  };
  const sections = {
    'Another brand of station':['station','Station connection',false],
    Appearance:['appearance','Display',false], Kiosk:['appearance','Wall display',true],
    'This computer':['tools','Server & weather network reporting',true],
    Timeline:['alerts','Timeline thresholds',true], Places:['everyday','Weather location',false],
    Notifications:['alerts','Notification categories',true], 'Alert rules':['alerts','Custom alert rules',true],
    'Quiet hours':['alerts','Quiet hours',true], 'Push notifications':['alerts','Push delivery',true],
    'Home Assistant':['tools','Home Assistant & MQTT',true], 'Household access':['tools','Household access',true],
    Help:['tools','Help & station setup',true],
  };
  let destination = group('station','Tempest connection');
  destination.id = 'settings-tempest';
  for (const el of existing) {
    if (el.tagName === 'H2' && sections[el.textContent.trim()]) {
      destination = group(...sections[el.textContent.trim()]); el.remove();
    } else destination.append(el);
  }
  // A field is its label, control, and immediately following explanatory paragraphs.
  // Container IDs move intact so brand-specific visibility and button listeners survive.
  const move = (id, target) => {
    const control = $(id); if (!control) return;
    let field = control.closest('label') || control;
    if (field.parentElement?.classList.contains('row') && field.parentElement.id !== 'drawer-actions') field = field.parentElement;
    const label = field.previousElementSibling;
    const notes = []; let next = field.nextElementSibling;
    while (next?.tagName === 'P' && !next.id) { notes.push(next); next = next.nextElementSibling; }
    if (label?.tagName === 'LABEL' && !label.querySelector('input,select')) target.append(label);
    target.append(field, ...notes);
  };
  panels.station.prepend(panels.station.children[1]);
  const units = group('everyday','Region & units');
  ['region-presets','set-units','set-clock'].forEach(id => move(id,units));
  move('set-wind-unit',group('everyday','Individual units',true));
  const sound = group('alerts','Warnings & voice');
  ['set-storm-auto','set-speak','btn-voice-test','voice-engine','voice-status','set-brief-time','set-web-notif','set-gust'].forEach(id => move(id,sound));
  panels.alerts.prepend(sound);
  const radar = group('radar','HookEcho radar');
  ['set-radar-site','set-desk-radar'].forEach(id => move(id,radar));
  const display = panels.appearance.querySelector('fieldset');
  move('set-motion',display);
  const accessibility = group('appearance','Display & accessibility',true);
  ['set-accent','set-density','set-hero-summary','set-big-numbers','set-eco'].forEach(id => move(id,accessibility));
  const calibration = group('station','Calibration & reporting',true);
  ['set-elev','set-refresh','set-nearby-radius','set-ingest-key','ingest-diag','btn-station-save','station-list'].forEach(id => move(id,calibration));
  move('health-center',group('station','Device health & diagnostics',true));
  const backups = group('tools','Data & backups',true);
  ['set-retention','btn-export','import-file','restore-file'].forEach(id => move(id,backups));
  const troubleshooting = group('tools','Troubleshooting',true);
  ['set-render','btn-diag'].forEach(id => move(id,troubleshooting));
  const layoutGroup = group('appearance','Panel layout',true);
  move('layout-controls',layoutGroup); layoutGroup.hidden = $('layout-controls').hidden;
  // Keep the hidden layout editor hidden; remove empty group shells left by moved controls.
  drawer.querySelectorAll('.settings-group').forEach(el => { if(el.children.length === 1) el.remove(); });
  drawer.querySelectorAll('label').forEach(label => {
    const control = label.nextElementSibling;
    if (!label.querySelector('input,select') && control?.matches('input[id],select[id],textarea[id]')) label.htmlFor = control.id;
  });
  $('place-q').setAttribute('aria-label','Search for a city or postcode');
  const search = $('settings-search');
  function show(id = '', focus = true) {
    const entry = SETTINGS_CATEGORIES.find(c => c[0] === id);
    Object.entries(panels).forEach(([key,panel]) => panel.hidden = key !== id);
    $('settings-home').hidden = !!entry; $('settings-back').hidden = !entry;
    $('settings-page-title').textContent = entry?.[1] || 'A little more you.';
    $('settings-description').textContent = entry?.[2] || 'Your weather, your screen, your way.';
    drawer.scrollTop = 0;
    if(focus) $('settings-page-title').focus();
  }
  drawer.addEventListener('click', e => { const card = e.target.closest('[data-settings-category]'); if(card) show(card.dataset.settingsCategory); });
  $('settings-back').onclick = () => { search.value = ''; filter(); show(); };
  function filter() {
    const query = search.value.trim().toLowerCase(); let hits = 0;
    for(const [id,name,description] of SETTINGS_CATEGORIES) {
      const words = `${name} ${description} ${panels[id].textContent}`.toLowerCase();
      const card = drawer.querySelector(`[data-settings-category="${id}"]`);
      card.hidden = !!query && !words.includes(query); if(!card.hidden) hits++;
    }
    $('settings-empty').hidden = hits > 0;
  }
  search.oninput = () => { show('',false); filter(); };
  drawer.addEventListener('settings:home', () => { search.value = ''; filter(); show('',false); });
  const note = document.createElement('p'); note.className = 'settings-save-note';
  note.textContent = 'Use Save changes to apply your choices. Location, voice, and action buttons apply immediately.';
  actions.prepend(note); drawer.append(actions);
}

export function updateSettingsHome(s, source) {
  const $ = id => document.getElementById(id);
  const option = id => $(id).selectedOptions?.[0]?.textContent || '';
  $('settings-status').replaceChildren();
  const heading = document.createElement('strong'), detail = document.createElement('small');
  heading.textContent = s.stationName || (source ? 'Your weather station' : 'Weather for your location');
  detail.textContent = source ? 'Station configured · connection details and health in My station' : 'Forecast only · add a weather station whenever you’re ready';
  $('settings-status').append(heading,detail);
  const summaries = { everyday:`${option('set-units')} · ${option('set-clock')}`, appearance:option('set-palette'),
    alerts:`Voice ${s.speakAlerts?'on':'off'} · ${s.quietStart && s.quietEnd?'quiet hours set':'no quiet hours'}`,
    station:source?'Station configured':'Forecast only', radar:`${s.deskRadar?'On':'Off'} · HookEcho`,tools:'Only when you need them' };
  for(const [id,text] of Object.entries(summaries)) $(`settings-summary-${id}`).textContent = text;
  $('drawer').dispatchEvent(new Event('settings:home'));
}
