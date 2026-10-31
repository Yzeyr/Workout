/* Small formatting helpers. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

/** 62.5 → "62.5", 60 → "60". */
export function num(v, dec = 1) {
  if (v == null || !Number.isFinite(+v)) return '—';
  const f = 10 ** dec;
  return String(Math.round(v * f) / f);
}
export const kg = (v) => num(v, 2) + ' kg';

/** "Thu 30 Oct" (and the year when it isn't this year). */
export function dayLabel(isoDate, { year = false } = {}) {
  const d = parse(isoDate);
  const showYear = year || d.getFullYear() !== new Date().getFullYear();
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (showYear ? ' ' + d.getFullYear() : '');
}

export function ago(isoDate, today) {
  const days = Math.round((parse(today) - parse(isoDate)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return days + ' days ago';
  if (days < 60) return Math.round(days / 7) + ' weeks ago';
  return Math.round(days / 30) + ' months ago';
}

/** Accepts "62,5" as well as "62.5". */
export function parseNum(s) {
  const v = parseFloat(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

export function minutes(startIso, endIso = new Date().toISOString()) {
  return Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60000));
}

/** Pace for a cardio entry, in the unit that suits the sport. */
export function pace(type, km, min) {
  if (!(km > 0) || !(min > 0)) return '';
  const mmss = (m) => Math.floor(m) + ':' + String(Math.round((m % 1) * 60)).padStart(2, '0');
  if (type === 'bike') return num(km / (min / 60), 1) + ' km/h';
  if (type === 'row') return mmss(min / (km * 2)) + ' /500 m';
  if (type === 'swim') return mmss(min / (km * 10)) + ' /100 m';
  if (type === 'other') return '';
  return mmss(min / km) + ' /km';
}

/** A tiny line chart as SVG, from numbers. */
export function spark(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => (i / (v.length - 1) * 100).toFixed(1) + ',' + (30 - ((x - lo) / span) * 26 - 2).toFixed(1)).join(' ');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 100 30');
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('class', 'spark');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<polyline points="' + pts + '"/>';
  return s;
}
