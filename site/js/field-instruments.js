// Decorative faces for the eight live readouts. No simulated readings or thresholds.
const finite = Number.isFinite;
const clamp = x => finite(x) ? Math.max(0, Math.min(1, x)) : 0;
export function fieldInstrument(id, spec, metric = false) {
  const value = spec.value;
  const available = spec.available ?? finite(value);
  const fTemp = metric && finite(value) ? value * 1.8 + 32 : value;
  const face = body => `<svg class="field-instrument" data-instrument="${id}" viewBox="0 0 120 108" aria-hidden="true">${body}</svg>`;
  const tube = (fraction, therm = false) => {
    const height = 66 * clamp(fraction);
    return `<rect x="47" y="12" width="26" height="80" rx="${therm ? 13 : 4}" class="fi-outline"/>`
      + (available ? `<rect x="52" y="${87-height}" width="16" height="${height}" rx="3" class="fi-fill"/>${therm ? '<circle cx="60" cy="89" r="11" class="fi-fill"/>' : ''}` : '')
      + [0,1,2,3,4].map(i => `<path d="M80 ${20+i*16}H88" class="fi-tick"/>`).join('');
  };
  switch (id) {
    case 'g-rain': return face(tube(value / (metric ? 25.4 : 1)));
    case 'g-wbgt': return face(tube((fTemp - 50) / 60, true));
    case 'g-ltg': return face(`<circle cx="60" cy="54" r="42" class="fi-track thin"/><circle cx="60" cy="54" r="28" class="fi-track thin"/><circle cx="60" cy="54" r="14" class="fi-track thin"/><path d="M60 12V96M18 54H102" class="fi-tick"/>${available ? `<path d="M64 35L50 56H60L55 74L72 50H61Z" class="fi-fill" opacity="${spec.count > 0 ? 1 : .45}"/>` : ''}`);
    case 'g-wind': {
      const direction = finite(spec.deg) ? (spec.deg % 360 + 360) % 360 : null;
      return face(`<circle cx="60" cy="54" r="38" class="fi-track thin"/><circle cx="60" cy="54" r="24" class="fi-track thin"/><text x="60" y="11">N</text><text x="107" y="57">E</text><text x="60" y="106">S</text><text x="13" y="57">W</text>${available && direction != null ? `<g transform="rotate(${direction} 60 54)"><path d="M60 23L67 63L60 57L53 63Z" class="fi-fill"/><path d="M60 58V79" class="fi-tick"/></g>` : ''}`);
    }
    case 'g-uv': return face(Array.from({length:12}, (_,i) => `<rect x="${i*8+12}" y="${86-i*4}" width="5" height="${i*4+10}" rx="1" class="${available && i < Math.round(value) ? 'fi-fill' : 'fi-empty'}"/>`).join(''));
    case 'g-press': {
      const pressure = metric ? value / 33.8639 : value;
      const angle = Math.PI + clamp((pressure - 28.5) / 3) * Math.PI;
      return face(`<path d="M15 72A45 45 0 0 1 105 72" class="fi-track thin"/>${available ? `<path d="M60 72L${60+Math.cos(angle)*37} ${72+Math.sin(angle)*37}" class="fi-needle"/><circle cx="60" cy="72" r="4" class="fi-fill"/>` : ''}<text x="15" y="93">L</text><text x="105" y="93">H</text>`);
    }
    case 'g-hum': {
      const fraction = clamp(value / 100);
      return face(`<circle cx="60" cy="54" r="39" class="fi-track"/>${available && fraction > 0 ? `<circle cx="60" cy="54" r="39" class="fi-arc" pathLength="100" stroke-dasharray="${fraction*100} 100" transform="rotate(-90 60 54)"/>` : ''}<text x="60" y="61" class="fi-symbol">%</text>`);
    }
    case 'g-dew': return face(`<path d="M60 8C45 32 30 48 30 66A30 30 0 0 0 90 66C90 48 75 32 60 8Z" class="fi-outline"/>${available ? '<path d="M41 70Q60 57 79 70" class="fi-needle"/>' : ''}<text x="60" y="52" class="fi-symbol">°</text>`);
    default: return '';
  }
}
