/* ---------- utilidades ---------- */
const TOL = 10; // minutos de margen antes de contar horas extra
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DOWL = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; // índice 0 = lunes
const MON = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const dayLabel = s => { const d = parseYmd(s); return `${DOW[d.getDay()]}, ${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const dayShort = s => { const d = parseYmd(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()].slice(0,3)}`; };
const fmtMin = m => { m = Math.round(m || 0); const neg = m < 0; m = Math.abs(m); return `${neg ? '−' : ''}${Math.floor(m / 60)} h ${pad(m % 60)} min`; };
const fmtHM = m => { m = Math.round(m || 0); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
const fmtHours = h => (Math.round(h * 100) / 100).toString().replace('.', ',');
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const COLORS = [['#E6E9FC','#3446D4'],['#DCF2E9','#0B7A55'],['#FBF0D9','#96620F'],['#FBE4E1','#B23A30'],['#EEE3FA','#6B3FB8'],['#DDF0F7','#1B6C8A']];
const colorFor = id => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (id, name, size = 40) => { const [bg, fg] = colorFor(id); return `<span class="avatar" style="background:${bg};color:${fg};width:${size}px;height:${size}px">${esc(initials(name))}</span>`; };

/* ---------- conexión con Supabase ---------- */
const CONF = window.TICTAC_CONFIG || {};
const configured = !!(CONF.supabaseUrl && CONF.supabaseAnonKey && !/PEGA_AQUI/.test(CONF.supabaseUrl + CONF.supabaseAnonKey));
let sb = null;

/* ---------- datos en memoria ---------- */
// employees: { id: {name, afil, mode, hours, jornadas, days, holMode, canEdit, active} }
// punches: Map id -> {id, emp, in, out, edits, manual}   (in/out en ISO)
// notes: { id: {empId, kind, entryDate, oldIn, oldOut, newIn, newOut, reason, read, at} }
const S = { company: null, employees: {}, punches: new Map(), notes: {}, pub: null, empCompany: '' };
const loadedMonths = new Set(), loadingMonths = new Map();

const toEmp = r => ({ name: r.name, afil: r.afil || '', mode: r.mode, hours: Number(r.hours), jornadas: r.jornadas, days: r.days || [1, 2, 3, 4, 5],
  holMode: r.hol_mode, canEdit: !!r.can_edit, active: r.active !== false, hasPin: !!r.pin_hash });
const fromEmp = e => ({ name: e.name, afil: e.afil, mode: e.mode, hours: e.hours, jornadas: e.jornadas, days: e.days, hol_mode: e.holMode, can_edit: e.canEdit, active: e.active });
const iso = v => (v ? new Date(v).toISOString() : null);
const toPunch = r => ({ id: r.id, emp: r.employee_id, in: iso(r.time_in), out: iso(r.time_out), edits: r.edits || [], manual: !!r.manual });
const toNote = r => ({ empId: r.employee_id, kind: r.kind, entryDate: r.entry_date, oldIn: r.old_in, oldOut: r.old_out, newIn: r.new_in, newOut: r.new_out, reason: r.reason, read: r.read, at: r.created_at });
const putPunch = r => S.punches.set(r.id, toPunch(r));

const companyName = () => (S.company && S.company.name) || (S.pub && S.pub.company) || S.empCompany || 'Tictac';
const emps = (all = false) => Object.entries(S.employees).filter(([, e]) => all || e.active !== false).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
function entriesOf(empId) {
  const out = [];
  for (const p of S.punches.values()) if (p.emp === empId) out.push(p);
  return out.sort((a, b) => a.in.localeCompare(b.in));
}

async function fetchAll(query) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await query().range(i, i + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
function monthsBetween(from, to) {
  const out = [], end = parseYmd(to);
  for (let d = parseYmd(from), m = new Date(d.getFullYear(), d.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) out.push(`${m.getFullYear()}-${pad(m.getMonth() + 1)}`);
  return out;
}
const monthsReady = (from, to) => monthsBetween(from, to).every(m => loadedMonths.has(m));
function loadMonth(m) {
  if (loadingMonths.has(m)) return loadingMonths.get(m);
  const [y, mo] = m.split('-').map(Number);
  const a = new Date(y, mo - 1, 1).toISOString(), b = new Date(y, mo, 1).toISOString();
  const p = fetchAll(() => sb.from('punches').select('*').gte('time_in', a).lt('time_in', b).order('time_in'))
    .then(rows => {
      for (const [id, x] of S.punches) if (x.in >= a && x.in < b) S.punches.delete(id);
      rows.forEach(putPunch); loadedMonths.add(m);
    })
    .finally(() => loadingMonths.delete(m));
  loadingMonths.set(m, p);
  return p;
}
const ensureMonths = (from, to) => Promise.all(monthsBetween(from, to).filter(m => !loadedMonths.has(m)).map(loadMonth));
function needMonths(from, to) {
  if (monthsReady(from, to)) return true;
  ensureMonths(from, to).then(scheduleRender).catch(e => { console.error(e); toast('No se han podido cargar los fichajes. Comprueba la conexión.'); });
  return false;
}

/* ---------- arranque ---------- */
async function boot() {
  if (!configured || !window.supabase) { UI.mode = window.supabase ? 'noconfig' : 'offline'; render(); return; }
  sb = window.supabase.createClient(CONF.supabaseUrl, CONF.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && await enterGerente()) return;
    if (UI.token && await loadEmployee()) return;
  } catch (e) { console.error(e); }
  await showHome();
}
async function showHome() {
  UI.mode = 'home'; UI.empId = null;
  const { data, error } = await sb.rpc('tt_public_info');
  if (error) { console.error(error); UI.mode = 'offline'; } else S.pub = data;
  render();
}

/* ---------- empleado ---------- */
const EMP_ERR = {
  session: 'Tu sesión ha caducado. Vuelve a entrar con tu PIN.',
  too_soon: 'Acabas de fichar. Espera un minuto antes de volver a pulsar.',
  not_allowed: 'Tu responsable no te ha habilitado para corregir fichajes.',
  reason: 'Explica brevemente el motivo de la corrección.',
  future: 'No se pueden registrar horas en el futuro.',
  order: 'La salida debe ser posterior a la entrada.',
  too_long: 'La jornada supera 20 horas. Revisa las horas.',
  out_required: 'Indica la hora de salida.',
  in_required: 'Indica la hora de entrada.',
  not_found: 'No se encuentra ese fichaje. Recarga la app.',
  no_change: 'No has cambiado ninguna hora.',
  open_exists: 'Ya tienes otra entrada abierta. Corrige primero esa.',
};
function setToken(t, remember) {
  UI.token = t;
  if (t && remember) LS.set('tictac.token', t); else LS.del('tictac.token');
}
async function loadEmployee() {
  const { data, error } = await sb.rpc('tt_emp_data', { p_token: UI.token });
  if (error) throw error;
  if (!data || !data.ok) { setToken(null); return false; }
  const e = data.employee;
  S.employees = { [e.id]: toEmp(e) }; S.empCompany = data.company || '';
  S.punches = new Map(); (data.punches || []).forEach(putPunch);
  UI.empId = e.id; UI.mode = 'emp'; render();
  return true;
}
async function empSessionLost() { setToken(null); toast(EMP_ERR.session); await showHome(); }

/* ---------- gerente ---------- */
async function enterGerente() {
  const { data: ok, error } = await sb.rpc('tt_claim_gerente');
  if (error || !ok) { await sb.auth.signOut(); toast('Esta cuenta no tiene acceso de gerente.'); return false; }
  UI.mode = 'admin'; UI.adminLoaded = false; render();
  await loadAdmin();
  subscribeAdmin();
  return true;
}
async function loadAdmin() {
  const [c, e, n, o] = await Promise.all([
    sb.from('company').select('*').eq('id', 1).maybeSingle(),
    sb.from('employees').select('*').order('name'),
    sb.from('notes').select('*').order('created_at', { ascending: false }).limit(300),
    sb.from('punches').select('*').is('time_out', null),
  ]);
  for (const r of [c, e, n, o]) if (r.error) { console.error(r.error); toast('No se han podido cargar los datos. Comprueba la conexión.'); }
  S.company = c.data || null;
  S.employees = {}; (e.data || []).forEach(r => { S.employees[r.id] = toEmp(r); });
  S.notes = {}; (n.data || []).forEach(r => { S.notes[r.id] = toNote(r); });
  (o.data || []).forEach(putPunch);
  const t = new Date();
  try { await ensureMonths(ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(t)); } catch (err) { console.error(err); }
  UI.adminLoaded = true; render();
}
async function reloadTable(table) {
  if (table === 'employees') {
    const { data } = await sb.from('employees').select('*').order('name');
    if (data) { S.employees = {}; data.forEach(r => { S.employees[r.id] = toEmp(r); }); }
  } else if (table === 'notes') {
    const { data } = await sb.from('notes').select('*').order('created_at', { ascending: false }).limit(300);
    if (data) { S.notes = {}; data.forEach(r => { S.notes[r.id] = toNote(r); }); }
  }
  scheduleRender();
}
let adminChannel = null, adminPoll = null;
function subscribeAdmin() {
  if (adminChannel) return;
  adminChannel = sb.channel('tictac-gerente')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'punches' }, p => {
      if (p.eventType === 'DELETE') S.punches.delete(p.old.id); else putPunch(p.new);
      scheduleRender();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => reloadTable('notes'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => reloadTable('employees'))
    .subscribe();
  // respaldo por si el tiempo real no está disponible
  adminPoll = setInterval(async () => {
    if (UI.mode !== 'admin') return;
    const m = ymd(new Date()).slice(0, 7);
    try { await Promise.all([loadMonth(m), reloadTable('notes')]); scheduleRender(); } catch {}
  }, 60000);
}
async function logoutGerente() {
  if (adminChannel) { sb.removeChannel(adminChannel); adminChannel = null; }
  clearInterval(adminPoll); adminPoll = null;
  await sb.auth.signOut();
  S.company = null; S.employees = {}; S.notes = {}; S.punches = new Map(); loadedMonths.clear();
  await showHome();
}
async function dbCall(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { console.error(error); toast('No se ha podido guardar: ' + (error.message || 'error de conexión')); return null; }
  if (okMsg) toast(okMsg);
  return data ?? true;
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function exportBackup() {
  const out = { app: 'Tictac', exportedAt: new Date().toISOString() };
  out.company = (await sb.from('company').select('*')).data || [];
  out.employees = (await fetchAll(() => sb.from('employees').select('*').order('created_at'))).map(r => { const x = { ...r }; delete x.pin_hash; return x; });
  out.punches = await fetchAll(() => sb.from('punches').select('*').order('time_in'));
  out.notes = await fetchAll(() => sb.from('notes').select('*').order('created_at'));
  downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `Tictac copia ${ymd(new Date())}.json`);
  toast(`Copia descargada: ${out.punches.length} fichajes`);
}

const openEntry = empId => entriesOf(empId).find(e => !e.out) || null;
const workedMin = (e, now = new Date()) => Math.max(0, ((e.out ? new Date(e.out) : now) - new Date(e.in)) / 60000);
function dayWorked(empId, dateStr, includeOpen = true) {
  return entriesOf(empId).filter(e => ymd(new Date(e.in)) === dateStr && (includeOpen || e.out)).reduce((a, e) => a + workedMin(e), 0);
}
function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
const workdays = emp => (emp.days && emp.days.length ? emp.days : [1, 2, 3, 4, 5]);
// Días laborables = días en que PUEDE trabajar. Lo que debe cumplir lo fijan las horas y las jornadas por semana.
const jornadas = emp => Math.max(1, Math.min(7, emp.jornadas || workdays(emp).length));
const jornadaMin = emp => emp.mode === 'day' ? emp.hours * 60 : (emp.hours * 60) / jornadas(emp);
const weeklyHours = emp => emp.mode === 'day' ? emp.hours * jornadas(emp) : emp.hours;
function daysText(emp) {
  const d = workdays(emp).map(x => (x + 6) % 7).sort((a, b) => a - b);
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  return contiguous && d.length > 2 ? `${DOWL[d[0]]}–${DOWL[d[d.length - 1]]}` : d.map(i => DOWL[i]).join(' ');
}
function contractText(emp) {
  return emp.mode === 'day'
    ? `${fmtHours(emp.hours)} h/día × ${jornadas(emp)} jornadas (${fmtHours(weeklyHours(emp))} h/sem) · días posibles ${daysText(emp)}`
    : `${fmtHours(emp.hours)} h/semana en ${jornadas(emp)} jornadas · días posibles ${daysText(emp)}`;
}
function weekWorked(empId, ref = new Date()) {
  const ws = weekStart(ref); const we = new Date(ws); we.setDate(we.getDate() + 7);
  return entriesOf(empId).filter(e => { const d = new Date(e.in); return d >= ws && d < we; }).reduce((a, e) => a + workedMin(e), 0);
}

/* ---------- festivos nacionales (España) ---------- */
function easter(y) { const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1; return new Date(y,mo-1,da); }
function nationalHolidays(y) {
  const list = ['01-01','01-06','05-01','08-15','10-12','11-01','12-06','12-08','12-25'].map(s => `${y}-${s}`);
  const gf = easter(y); gf.setDate(gf.getDate() - 2); list.push(ymd(gf));
  return list;
}

/* ---------- cálculo del informe ---------- */
function computeReport(empId, o) {
  const emp = S.employees[empId];
  const hol = new Set(o.fest ? o.holidays : []);
  const byDay = {}, openDays = new Set();
  for (const e of entriesOf(empId)) {
    const d = ymd(new Date(e.in));
    if (!e.out) { openDays.add(d); continue; }
    (byDay[d] = byDay[d] || []).push(e);
  }
  const days = [];
  for (let d = parseYmd(o.from); d <= parseYmd(o.to); d.setDate(d.getDate() + 1)) {
    const s = ymd(d), dw = d.getDay();
    const ents = byDay[s] || [];
    const isHol = hol.has(s);
    const special = (o.sat && dw === 6) || (o.sun && dw === 0) || isHol;
    const possible = workdays(emp).includes(dw);
    const type = isHol ? 'Festivo' : dw === 6 ? 'Sábado' : dw === 0 ? 'Domingo' : possible ? 'Laborable' : 'No laborable';
    days.push({ date: s, dw, ents, special, isHol, possible, type, expected: 0, worked: ents.reduce((a, e) => a + workedMin(e), 0),
      otL: 0, otF: 0, def: 0, open: openDays.has(s), edits: ents.flatMap(e => (e.edits || []).map(x => ({ ...x }))) });
  }
  const weeks = [];
  for (const day of days) {
    const k = ymd(weekStart(parseYmd(day.date)));
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== k) { w = { key: k, days: [] }; weeks.push(w); }
    w.days.push(day);
  }
  const possN = workdays(emp).length, jm = jornadaMin(emp);
  for (const w of weeks) {
    w.worked = w.days.reduce((a, d) => a + d.worked, 0);
    // jornadas exigidas: proporcional a los días posibles incluidos en el periodo, menos una por festivo en día posible
    const inWeek = w.days.filter(d => d.possible).length;
    const holOff = o.fest && emp.holMode !== 'keep' ?w.days.filter(d => d.possible && d.isHol).length : 0;
    w.reqJ = Math.max(0, jornadas(emp) * inWeek / possN - holOff);
    w.expected = w.reqJ * jm;
    w.otL = 0; w.otF = 0; w.def = 0;
    const workedDays = w.days.filter(d => d.worked > 0);
    w.jornadas = workedDays.length;
    if (emp.mode === 'day') {
      // las jornadas de contrato se cubren primero con días posibles normales; las jornadas de más
      // (preferentemente sábados/domingos/festivos marcados o días no laborables) son extra
      const rank = d => (d.possible && !d.special ? 0 : d.possible ? 1 : 2);
      const ranked = [...workedDays].sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date));
      ranked.forEach((d, i) => {
        d.expected = Math.max(0, Math.min(1, w.reqJ - i)) * jm;
        const x = d.worked - d.expected;
        if (x > TOL) { if (d.special) d.otF = x - TOL; else d.otL = x - TOL; } // solo cuenta lo que pasa del margen
        if (d.expected > d.worked) d.def = d.expected - d.worked;
        w.otL += d.otL; w.otF += d.otF; w.def += d.def;
      });
      w.missing = Math.max(0, w.reqJ - ranked.length) * jm; // jornadas de contrato no trabajadas
      w.def += w.missing;
    } else {
      // contrato semanal: se aceptan TOL minutos de más por cada jornada trabajada en la semana
      const diff = w.worked - w.expected;
      const margin = TOL * Math.max(1, w.jornadas);
      if (diff > margin) {
        const ot = diff - margin; // solo cuenta lo que pasa del margen
        const specialWorked = w.days.filter(d => d.special).reduce((a, d) => a + d.worked, 0);
        w.otF = Math.min(ot, specialWorked); w.otL = ot - w.otF;
        let left = w.otF;
        for (const d of w.days) if (d.special && left > 0) { d.otF = Math.min(d.worked, left); left -= d.otF; }
      } else if (diff < 0) w.def = -diff;
    }
    w.red = w.expected > 0 && w.worked < w.expected;
  }
  const T = { expected: 0, worked: 0, otL: 0, otF: 0, def: 0 };
  for (const w of weeks) { T.expected += w.expected; T.worked += w.worked; T.otL += w.otL; T.otF += w.otF; T.def += w.def; }
  T.ordinary = T.worked - T.otL - T.otF;
  T.redWeeks = weeks.filter(w => w.red).length; T.weeks = weeks.filter(w => w.expected > 0).length;
  if (o.comp) {
    // solo se compensan horas extra laborables: las de festivos se pagan aparte
    const c1 = Math.min(T.def, T.otL);
    T.compensated = c1; T.otLnet = T.otL - c1; T.otFnet = T.otF; T.defNet = T.def - c1;
  }
  return { emp, empId, days, weeks, T };
}

/* ---------- estado de interfaz ---------- */
const UI = { mode: 'loading', token: LS.get('tictac.token'), empId: null, adminLoaded: false, tab: 'panel', showRead: false, logEmp: null, logMonth: ymd(new Date()).slice(0, 7) };
function defaultReport() {
  const t = new Date(), f = new Date(t.getFullYear(), t.getMonth() - 1, 1), l = new Date(t.getFullYear(), t.getMonth(), 0);
  return { from: ymd(f), to: ymd(l), sat: false, sun: true, fest: true, holidays: [], holReduce: true, comp: false, sel: null };
}
const R = Object.assign(defaultReport(), LS.get('fichaje.report') || {});
const saveR = () => LS.set('fichaje.report', { ...R, sel: null });

/* ---------- render ---------- */
let rq = false, pendingRender = false;
function scheduleRender() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(); }); }
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });
function render() {
  const a = document.activeElement;
  if (a && $('#view').contains(a) && a.matches('input:not([type=checkbox]):not([type=radio]),textarea,select')) { pendingRender = true; return; }
  const v = $('#view');
  if (UI.mode === 'loading') { v.innerHTML = '<div class="loading">Cargando…</div>'; return; }
  if (UI.mode === 'noconfig') { v.innerHTML = viewNotice('Falta conectar Tictac con la base de datos', 'Abre el archivo config.js, pega la Project URL y la clave anon de Supabase y vuelve a subirlo a GitHub.'); return; }
  if (UI.mode === 'offline') { v.innerHTML = viewNotice('No hay conexión con el servidor', 'Comprueba que tienes internet y vuelve a intentarlo.', true); return; }
  if (UI.mode === 'emp' && UI.empId && S.employees[UI.empId]) v.innerHTML = viewEmployee(UI.empId);
  else if (UI.mode === 'admin') {
    if (!UI.adminLoaded) { v.innerHTML = '<div class="loading">Cargando datos…</div>'; return; }
    if (!S.company) { if (!v.querySelector('.setup')) v.innerHTML = viewSetup(); return; }
    v.innerHTML = viewAdmin();
  }
  else v.innerHTML = viewHome();
  tick();
}
function viewNotice(title, text, retry) {
  return `<div class="setup"><span class="mark lg">${logo()}</span><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>${retry ? '<div><button class="btn primary" data-act="retry">Reintentar</button></div>' : ''}</div>`;
}
// Logo: asterisco en Nunito Black
const logo = () => '<span class="ast" aria-hidden="true">*</span>';
function topBar(right) {
  return `<header class="top"><div class="brand"><div><b>${esc(companyName())}</b><small>Tictac · control horario</small></div></div><div class="row">${right || ''}</div></header>`;
}

/* ---------- configuración inicial (primera vez que entra el gerente) ---------- */
function viewSetup() {
  return `<div class="setup">
    <div><span class="mark lg" style="margin-bottom:22px">${logo()}</span><h1>Pon en marcha Tictac</h1>
    <p class="muted" style="margin-top:8px">Estos datos aparecen en la cabecera de los informes. Podrás cambiarlos en Ajustes.</p></div>
    <form id="setupForm" class="panel" style="display:grid;gap:14px">
      <div class="field"><label for="su-co">Nombre de la empresa</label><input class="input" id="su-co" required autocomplete="organization"></div>
      <div class="grid2">
        <div class="field"><label for="su-cif">CIF</label><input class="input" id="su-cif"></div>
        <div class="field"><label for="su-ct">Centro de trabajo</label><input class="input" id="su-ct"></div>
      </div>
      <p class="err" id="su-err" hidden></p>
      <button class="btn primary" type="submit">Empezar</button>
    </form></div>`;
}
document.addEventListener('submit', async e => {
  if (e.target.id === 'loginForm') return gerenteLogin(e);
  if (e.target.id !== 'setupForm') return;
  e.preventDefault();
  const name = $('#su-co').value.trim();
  if (!name) { $('#su-err').textContent = 'Escribe el nombre de la empresa.'; $('#su-err').hidden = false; return; }
  const row = await dbCall(sb.from('company').upsert({ id: 1, name, cif: $('#su-cif').value.trim(), center: $('#su-ct').value.trim() }).select().single());
  if (!row) return;
  S.company = row; UI.tab = 'emps';
  $('#view').innerHTML = ''; render();
});

/* ---------- inicio (elegir empleado) ---------- */
function viewHome() {
  const now = new Date();
  const list = (S.pub && S.pub.employees) || [];
  return `${topBar()}
  <section class="home-hero"><span class="mark lg" style="margin-bottom:22px">${logo()}</span><p class="eyebrow">${esc(dayLabel(ymd(now)))}</p><div class="clock-big" data-live="clock-big">${hm(now)}</div></section>
  <h2 style="margin-bottom:12px">¿Quién ficha?</h2>
  ${list.length ? `<div class="people">${list.map(e => `
    <button class="person" data-act="pick" data-id="${e.id}" data-name="${esc(e.name)}">${avatar(e.id, e.name)}
      <span><span class="nm">${esc(e.name)}</span><br><span class="st ${e.since ? 'on' : ''}">${e.since ? `En jornada desde ${hm(new Date(e.since))}` : 'Fuera de jornada'}</span></span></button>`).join('')}</div>`
    : `<div class="panel empty">Todavía no hay empleados. El gerente puede darlos de alta desde su acceso.</div>`}
  <div class="home-foot"><span class="hint">Cada empleado entra con su PIN de 4 cifras.</span><button class="btn" data-act="adminLogin">Acceso gerente</button></div>`;
}

/* ---------- PIN ---------- */
function pinModal(title, subtitle, check, extra = '') {
  let val = '';
  openModal(`<div class="modal-h"><div><h2>${esc(title)}</h2><p class="hint">${esc(subtitle)}</p></div><button class="btn ghost sm" data-act="close" aria-label="Cerrar">✕</button></div>
    <div class="pin-dots" id="pd"><i></i><i></i><i></i><i></i></div>
    <p class="err" id="pinErr" style="text-align:center" hidden>PIN incorrecto</p>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<span></span><button data-k="0">0</button><button class="fn" data-k="del">Borrar</button></div>${extra}`);
  const upd = () => $$('#pd i').forEach((i, k) => i.classList.toggle('f', k < val.length));
  const press = async k => {
    if (k === 'del') val = val.slice(0, -1); else if (val.length < 4) val += k;
    upd();
    if (val.length === 4) {
      const ok = await check(val);
      if (ok !== true) { $('#pinErr').textContent = typeof ok === 'string' ? ok : 'PIN incorrecto'; $('#pinErr').hidden = false; const pd = $('#pd'); pd.classList.add('bad'); setTimeout(() => { pd.classList.remove('bad'); val = ''; upd(); }, 400); }
    }
  };
  $('#modal .pad').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  UI.keyHandler = e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').innerHTML) closeModal();
  else if (UI.keyHandler && $('#modal').innerHTML && !e.target.matches('input,textarea')) UI.keyHandler(e);
});

/* ---------- vista empleado ---------- */
function viewEmployee(id) {
  const e = S.employees[id], now = new Date(), today = ymd(now);
  const o = openEntry(id);
  const jm = jornadaMin(e);
  const all = entriesOf(id);
  const last = [...all].reverse().find(x => x.out);
  const staleOpen = o && ymd(new Date(o.in)) !== today;
  const recent = all.filter(x => (now - new Date(x.in)) < 21 * 864e5).reverse();
  const byDay = {};
  recent.forEach(x => { const d = ymd(new Date(x.in)); (byDay[d] = byDay[d] || []).push(x); });
  const wk = weeklyHours(e) * 60;
  return `${topBar(`<button class="btn ghost sm" data-act="logout">Cambiar de usuario</button>`)}
  <div class="emp">
    <div class="emp-head"><div><p class="eyebrow">${esc(dayLabel(today))}</p><h1>Hola, ${esc(e.name.split(' ')[0])}</h1></div></div>
    ${staleOpen ? `<div class="banner" style="background:var(--stop-soft)"><span>Tienes una entrada abierta desde el <b>${esc(dayShort(ymd(new Date(o.in))))} a las ${hm(new Date(o.in))}</b>. ${e.canEdit ? 'Corrige la hora de salida real.' : 'Pide a tu responsable que la corrija.'}</span>${e.canEdit ? `<button class="btn sm" data-act="editEntry" data-id="${o.id}">Corregir</button>` : ''}</div>` : ''}
    <div class="punch-wrap">
      <button class="punch ${o ? 'is-on' : ''}" data-act="punch" id="punchBtn">
        <svg viewBox="0 0 220 220" aria-hidden="true"><circle class="trk" cx="110" cy="110" r="104" fill="none" stroke-width="6"/><circle class="prg" id="ring" cx="110" cy="110" r="104" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="653.5" stroke-dashoffset="653.5"/></svg>
        <span class="punch-in"><span class="punch-label">${o ? 'Fichar salida' : 'Fichar entrada'}</span><span class="punch-time" data-live="clock">${hm(now)}</span></span>
      </button>
      <p class="punch-status">${o ? `En jornada desde ${hm(new Date(o.in))} · <b data-live="session">—</b>` : last ? `Fuera de jornada · última salida ${esc(dayShort(ymd(new Date(last.out))))}, ${hm(new Date(last.out))}` : 'Aún no has fichado nunca. Pulsa para empezar tu jornada.'}</p>
    </div>
    <div class="stats">
      <div class="stat"><span class="eyebrow">Hoy</span><span class="v" data-live="today">—</span><span class="s">${e.mode === 'day' ? `jornada de ${fmtHM(jm)}` : `jornada media ${fmtHM(jm)}`}</span></div>
      <div class="stat"><span class="eyebrow">Esta semana</span><span class="v" data-live="week">—</span><div class="bar" data-live="weekbar"><i style="width:0"></i></div><span class="s">de ${fmtHM(wk)} de contrato</span></div>
      <div class="stat"><span class="eyebrow">Contrato</span><span style="font-weight:600;font-size:14px">${esc(contractText(e))}</span></div>
    </div>
    <div class="sec-h"><h2>Tus fichajes</h2>${e.canEdit ? `<button class="btn sm" data-act="addEntry" data-emp="${id}">Añadir fichaje olvidado</button>` : ''}</div>
    ${e.canEdit ? `<p class="hint" style="margin-top:4px">Si te equivocaste al fichar, corrige la hora e indica el motivo. Tu responsable recibirá un aviso.</p>` : ''}
    ${Object.keys(byDay).length ? `<div class="list">${Object.entries(byDay).map(([d, xs]) => xs.map((x, i) => `
      <div class="li"><span class="d">${i === 0 ? esc(dayShort(d)) : ''}</span>
        <span class="t">${hm(new Date(x.in))} → ${x.out ? hm(new Date(x.out)) : '<span class="pill go"><span class="dot"></span>ahora</span>'}</span>
        ${x.edits && x.edits.length ? '<span class="pill warn">Modificado</span>' : ''}
        <span class="h">${x.out ? fmtHM(workedMin(x)) : ''}</span>
        ${e.canEdit ? `<button class="btn ghost sm" data-act="editEntry" data-id="${x.id}">Corregir</button>` : ''}</div>`).join('')).join('')}</div>`
      : `<div class="list"><div class="empty">Aquí verás tus fichajes de las últimas tres semanas.</div></div>`}
  </div>`;
}

let punchBusy = false;
async function doPunch() {
  if (UI.mode !== 'emp' || punchBusy) return;
  punchBusy = true; const btn = $('#punchBtn'); if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('tt_emp_punch', { p_token: UI.token });
    if (error) toast('No se ha podido fichar. Comprueba la conexión e inténtalo de nuevo.');
    else if (!data.ok) { if (data.error === 'session') return empSessionLost(); toast(EMP_ERR[data.error] || 'No se ha podido fichar.'); }
    else {
      const at = new Date(data.at);
      toast(data.action === 'in' ? `Entrada registrada a las ${hm(at)}` : `Salida registrada a las ${hm(at)} · ${fmtMin((at - new Date(data.since)) / 60000)}`);
      await loadEmployee();
    }
  } catch (e) { console.error(e); toast('No se ha podido fichar. Comprueba la conexión.'); }
  finally { setTimeout(() => { punchBusy = false; const b = $('#punchBtn'); if (b) b.disabled = false; }, 1500); }
}

/* ---------- editar / añadir fichajes ---------- */
function combine(dateStr, time) { const [h, m] = time.split(':').map(Number); const d = parseYmd(dateStr); d.setHours(h, m, 0, 0); return d; }
function entryModal({ entry, empId, asAdmin }) {
  const e = S.employees[empId];
  const isNew = !entry;
  const inD = entry ? new Date(entry.in) : null, outD = entry && entry.out ? new Date(entry.out) : null;
  const date = inD ? ymd(inD) : ymd(new Date());
  openModal(`<div class="modal-h"><div><p class="eyebrow">${esc(e.name)}</p><h2>${isNew ? 'Añadir fichaje' : 'Corregir fichaje'}</h2></div><button class="btn ghost sm" data-act="close" aria-label="Cerrar">✕</button></div>
    ${isNew ? `<div class="field"><label for="em-date">Día</label><input class="input" type="date" id="em-date" value="${date}" max="${ymd(new Date())}"></div>` : `<p><b>${esc(dayLabel(date))}</b><br><span class="hint mono">Registrado: ${hm(inD)} → ${outD ? hm(outD) : 'sin salida'}</span></p>`}
    <div class="grid2">
      <div class="field"><label for="em-in">Hora de entrada</label><input class="input mono" type="time" id="em-in" value="${inD ? hm(inD) : ''}" required></div>
      <div class="field"><label for="em-out">Hora de salida</label><input class="input mono" type="time" id="em-out" value="${outD ? hm(outD) : ''}"></div>
    </div>
    <p class="hint">Si la salida es anterior a la entrada, se entiende que salió al día siguiente.${asAdmin ? '' : ' Deja la salida vacía solo si sigues trabajando.'}</p>
    <div class="field"><label for="em-why">Motivo ${asAdmin ? '(opcional)' : '(obligatorio)'}</label><textarea class="input" id="em-why" placeholder="${asAdmin ? 'Ej.: corrección acordada con el empleado' : 'Ej.: olvidé fichar la salida al cerrar la tienda'}"></textarea></div>
    <p class="err" id="em-err" hidden></p>
    <div class="modal-f">${asAdmin && !isNew ? `<button class="btn danger" data-act="delEntry" data-id="${entry.id}" style="margin-right:auto">Eliminar</button>` : ''}<button class="btn" data-act="close">Cancelar</button><button class="btn primary" id="em-save">${isNew ? 'Añadir' : 'Guardar corrección'}</button></div>`);
  $('#em-save').onclick = async () => {
    const err = $('#em-err'); const fail = m => { err.textContent = m; err.hidden = false; };
    const d = isNew ? $('#em-date').value : date, tin = $('#em-in').value, tout = $('#em-out').value, why = $('#em-why').value.trim();
    if (!d) return fail('Elige el día.');
    if (!tin) return fail('Indica la hora de entrada.');
    if (!asAdmin && why.length < 4) return fail('Explica brevemente el motivo de la corrección.');
    const nIn = combine(d, tin); let nOut = null;
    if (tout) { nOut = combine(d, tout); if (nOut <= nIn) nOut.setDate(nOut.getDate() + 1); }
    const now = new Date();
    if (nIn > now || (nOut && nOut > now)) return fail('No se pueden registrar horas en el futuro.');
    if (!nOut && isNew) return fail('Indica la hora de salida.');
    if (nOut && (nOut - nIn) > 20 * 3600e3) return fail('La jornada supera 20 horas. Revisa las horas.');
    const newIn = nIn.toISOString(), newOut = nOut ? nOut.toISOString() : null;
    if (!isNew && newIn === entry.in && newOut === entry.out) return fail('No has cambiado ninguna hora.');
    const btn = $('#em-save'); btn.disabled = true;
    try {
      if (asAdmin) {
        const edit = { at: now.toISOString(), by: 'admin', oldIn: entry ? entry.in : null, oldOut: entry ? entry.out : null, newIn, newOut, reason: why };
        const q = isNew
          ? sb.from('punches').insert({ employee_id: empId, time_in: newIn, time_out: newOut, manual: true, edits: [edit] }).select().single()
          : sb.from('punches').update({ time_in: newIn, time_out: newOut, edits: [...(entry.edits || []), edit] }).eq('id', entry.id).select().single();
        const { data, error } = await q;
        if (error) return fail(/punches_one_open/.test(error.message) ? 'Este empleado ya tiene otra entrada abierta.' : 'No se ha podido guardar: ' + error.message);
        putPunch(data); render();
      } else {
        const { data, error } = await sb.rpc('tt_emp_edit', { p_token: UI.token, p_punch: entry ? entry.id : null, p_in: newIn, p_out: newOut, p_reason: why, p_date: d });
        if (error) return fail('No se ha podido guardar. Comprueba la conexión.');
        if (!data.ok) { if (data.error === 'session') { closeModal(); return empSessionLost(); } return fail(EMP_ERR[data.error] || 'No se ha podido guardar.'); }
        await loadEmployee();
      }
    } finally { btn.disabled = false; }
    closeModal(); toast(asAdmin ? 'Fichaje guardado' : 'Corrección guardada. Tu responsable ha recibido un aviso.');
  };
}
function findEntry(_, id) { const e = S.punches.get(id); return e ? { ...e } : null; }

/* ---------- vista gerente ---------- */
function viewAdmin() {
  const unread = Object.values(S.notes).filter(n => !n.read).length;
  const tabs = [['panel', 'Panel'], ['emps', 'Empleados'], ['log', 'Fichajes'], ['report', 'Informe'], ['settings', 'Ajustes']];
  const body = { panel: adminPanel, emps: adminEmps, log: adminLog, report: adminReport, settings: adminSettings }[UI.tab]();
  return `${topBar(`<span class="pill off">Gerente</span><button class="btn ghost sm" data-act="logout">Salir</button>`)}
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${UI.tab === k}" data-act="tab" data-tab="${k}">${l}${k === 'panel' && unread ? `<span class="badge">${unread}</span>` : ''}</button>`).join('')}</nav>
    ${body}`;
}
function adminPanel() {
  const list = emps(), now = new Date(), today = ymd(now);
  const working = list.filter(([id]) => openEntry(id));
  const todayTotal = list.reduce((a, [id]) => a + dayWorked(id, today), 0);
  const notes = Object.entries(S.notes).filter(([, n]) => UI.showRead || !n.read).sort((a, b) => b[1].at.localeCompare(a[1].at));
  const unread = Object.values(S.notes).filter(n => !n.read).length;
  return `<div class="kpis">
      <div class="kpi"><span class="eyebrow">Trabajando ahora</span><div class="v">${working.length}<span class="muted" style="font-size:16px"> / ${list.length}</span></div></div>
      <div class="kpi"><span class="eyebrow">Horas hoy (equipo)</span><div class="v" data-live="teamToday">${fmtHM(todayTotal)}</div></div>
      <div class="kpi"><span class="eyebrow">Avisos sin leer</span><div class="v" style="color:${unread ? 'var(--stop)' : 'inherit'}">${unread}</div></div>
    </div>
    <div class="cols">
      <section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>Equipo</h2><span class="hint">Semana en curso</span></div>
        ${list.length ? list.map(([id, e]) => { const o = openEntry(id); const w = weekWorked(id), c = weeklyHours(e) * 60, pct = c ? Math.min(100, w / c * 100) : 0; return `
          <div class="team-row">${avatar(id, e.name)}
            <div class="meta"><span class="nm">${esc(e.name)}</span>
              <span>${o ? `<span class="pill go"><span class="dot"></span>En jornada desde ${hm(new Date(o.in))}</span>` : `<span class="pill off">Fuera</span>`}</span>
              <div class="bar ${w >= c ? 'ok' : ''}" title="${fmtHM(w)} de ${fmtHM(c)}"><i style="width:${pct}%"></i></div></div>
            <div class="hrs">Hoy ${fmtHM(dayWorked(id, today))}<br>Sem. ${fmtHM(w)} / ${fmtHM(c)}</div></div>`; }).join('')
          : `<div class="empty">Da de alta a tu primer empleado en la pestaña Empleados.</div>`}
      </section>
      <section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>Avisos de modificación</h2><button class="btn ghost sm" data-act="toggleRead">${UI.showRead ? 'Ocultar leídos' : 'Ver leídos'}</button></div>
        ${notes.length ? notes.map(([nid, n]) => { const e = S.employees[n.empId]; const t = x => x ? hm(new Date(x)) : '—'; return `
          <div class="note" style="${n.read ? 'opacity:.6' : ''}">
            <div class="row" style="justify-content:space-between"><b>${esc(e ? e.name : 'Empleado eliminado')} ${n.kind === 'add' ? 'añadió un fichaje olvidado' : 'modificó su fichaje'}</b><span class="hint">${esc(dayShort(ymd(new Date(n.at))))}, ${hm(new Date(n.at))}</span></div>
            <span class="chg">${esc(dayLabel(n.entryDate))}: ${n.kind === 'add' ? '' : `${t(n.oldIn)}–${t(n.oldOut)} → `}${t(n.newIn)}–${t(n.newOut)}</span>
            <div class="why">«${esc(n.reason)}»</div>
            ${n.read ? '' : `<div><button class="btn sm" data-act="readNote" data-id="${nid}">Marcar como leído</button></div>`}</div>`; }).join('')
          : `<div class="empty">${UI.showRead ? 'No hay avisos.' : 'Sin avisos pendientes. Aquí aparecerá cada corrección que haga un empleado, con su motivo.'}</div>`}
      </section>
    </div>`;
}
function adminEmps() {
  const list = emps(true);
  return `<div class="sec-h" style="margin-top:0;margin-bottom:12px"><h2>Empleados</h2><button class="btn primary" data-act="empForm">Nuevo empleado</button></div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Empleado</th><th>Contrato</th><th>Horas/semana</th><th>Puede corregir</th><th>Estado</th><th></th></tr></thead><tbody>
    ${list.map(([id, e]) => `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(id, e.name, 32)}<span><b>${esc(e.name)}</b>${e.afil ? `<br><span class="hint mono">${esc(e.afil)}</span>` : ''}</span></div></td>
      <td>${esc(contractText(e))}</td><td class="n">${fmtHours(weeklyHours(e))} h</td>
      <td>${e.canEdit ? '<span class="pill go">Sí</span>' : '<span class="pill off">No</span>'}</td>
      <td>${e.active === false ? '<span class="pill off">De baja</span>' : '<span class="pill go">Activo</span>'}</td>
      <td><button class="btn sm" data-act="empForm" data-id="${id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="panel empty">Aún no hay empleados.</div>`}`;
}
function empFormModal(id) {
  const e = id ? S.employees[id] : { name: '', afil: '', mode: 'week', hours: 40, jornadas: 5, days: [1, 2, 3, 4, 5, 6], canEdit: false, active: true };
  const st = { mode: e.mode, days: [...workdays(e)] };
  const jor = jornadas(e);
  st.holMode = e.holMode === 'keep' ? 'keep' : 'reduce';
  openModal(`<div class="modal-h"><h2>${id ? 'Editar empleado' : 'Nuevo empleado'}</h2><button class="btn ghost sm" data-act="close" aria-label="Cerrar">✕</button></div>
    <div class="field"><label for="ef-name">Nombre</label><input class="input" id="ef-name" value="${esc(e.name)}"></div>
    <div class="grid2">
      <div class="field"><label for="ef-afil">Nº afiliación (opcional)</label><input class="input mono" id="ef-afil" value="${esc(e.afil || '')}"></div>
      <div class="field"><label for="ef-pin">PIN (4 cifras)</label><input class="input mono" id="ef-pin" inputmode="numeric" maxlength="4" placeholder="${id ? 'Sin cambios' : ''}"></div>
    </div>
    <div class="fs"><span class="lbl">Horas de contrato</span>
      <div class="row"><div class="seg" id="ef-mode"><button type="button" data-m="day">Horas por día</button><button type="button" data-m="week">Horas por semana</button></div>
      <input class="input mono" id="ef-hours" type="number" min="0.5" max="80" step="0.25" value="${e.hours}" style="width:110px"><span id="ef-unit" class="hint"></span></div>
      <div class="row"><label for="ef-jor" class="lbl">Jornadas por semana</label><input class="input mono" id="ef-jor" type="number" min="1" max="7" step="1" value="${jor}" style="width:80px"></div>
      <span class="lbl" style="margin-top:4px">Días laborables posibles</span>
      <div class="chips" id="ef-days">${[1,2,3,4,5,6,0].map(d => `<button type="button" class="chip" data-d="${d}">${DOWL[(d + 6) % 7]}</button>`).join('')}</div>
      <span class="hint">Días en los que puede trabajar según su contrato. No tiene que trabajarlos todos: lo que debe cumplir lo marcan las horas y las jornadas de arriba.</span>
      <span class="hint" id="ef-sum" style="color:var(--ink-2)"></span></div>
    <div class="fs"><span class="lbl">Si hay un festivo en un día laborable posible</span>
      <label class="opt"><input type="radio" name="ef-hol" value="reduce" ${st.holMode === 'reduce' ? 'checked' : ''}><div><b>Descontar una jornada del contrato</b><span>Esa semana debe hacer una jornada menos.</span></div></label>
      <label class="opt"><input type="radio" name="ef-hol" value="keep" ${st.holMode === 'keep' ? 'checked' : ''}><div><b>Mantener las horas de contrato</b><span>Hace sus horas igualmente en los otros días posibles de la semana.</span></div></label></div>
    <label class="switch"><input type="checkbox" id="ef-edit" ${e.canEdit ? 'checked' : ''}><span><b>Puede corregir sus fichajes</b><br><span class="hint">Siempre indicando el motivo. Recibirás un aviso en tu panel.</span></span></label>
    ${id ? `<label class="switch"><input type="checkbox" id="ef-active" ${e.active !== false ? 'checked' : ''}><span><b>Activo</b><br><span class="hint">Si lo desactivas, deja de aparecer para fichar pero conservas su historial.</span></span></label>` : ''}
    <p class="err" id="ef-err" hidden></p>
    <div class="modal-f">${id ? `<button class="btn danger" id="ef-del" style="margin-right:auto">Eliminar</button>` : ''}<button class="btn" data-act="close">Cancelar</button><button class="btn primary" id="ef-save">Guardar</button></div>`, null, true);
  const sync = () => {
    $$('#ef-mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === st.mode));
    $$('#ef-days .chip').forEach(b => b.setAttribute('aria-pressed', st.days.includes(+b.dataset.d)));
    const h = parseFloat($('#ef-hours').value) || 0;
    const j = parseInt($('#ef-jor').value, 10) || 0;
    $('#ef-unit').textContent = st.mode === 'day' ? 'horas por jornada' : 'horas a la semana';
    $('#ef-sum').textContent = !st.days.length ? 'Elige al menos un día posible.'
      : j > st.days.length ? `Hay ${j} jornadas pero solo ${st.days.length} días posibles.`
      : j ? `Debe cumplir ${fmtHours(st.mode === 'day' ? h * j : h)} h/semana en ${j} jornadas${st.mode === 'week' ? ` (media ${fmtHours(h / j)} h/jornada)` : ''}, repartidas entre ${st.days.length} días posibles.` : '';
  };
  $('#ef-mode').onclick = ev => { const b = ev.target.closest('[data-m]'); if (b) { st.mode = b.dataset.m; sync(); } };
  $('#ef-days').onclick = ev => { const b = ev.target.closest('[data-d]'); if (!b) return; const d = +b.dataset.d; st.days = st.days.includes(d) ? st.days.filter(x => x !== d) : [...st.days, d]; sync(); };
  $('#ef-hours').oninput = sync; $('#ef-jor').oninput = sync; sync();
  $('#ef-save').onclick = async () => {
    const err = $('#ef-err'); const fail = m => { err.textContent = m; err.hidden = false; };
    const name = $('#ef-name').value.trim(), pin = $('#ef-pin').value.trim(), hours = parseFloat($('#ef-hours').value);
    if (!name) return fail('Escribe el nombre.');
    if ((!id || pin) && !/^\d{4}$/.test(pin)) return fail('El PIN debe tener 4 cifras.');
    if (!(hours > 0)) return fail('Indica las horas de contrato.');
    const jn = parseInt($('#ef-jor').value, 10);
    if (!(jn >= 1 && jn <= 7)) return fail('Indica entre 1 y 7 jornadas por semana.');
    if (!st.days.length) return fail('Elige al menos un día laborable posible.');
    if (jn > st.days.length) return fail('Marca al menos tantos días posibles como jornadas por semana.');
    const d = { name, afil: $('#ef-afil').value.trim(), mode: st.mode, hours, jornadas: jn, holMode: ($('input[name=ef-hol]:checked') || {}).value === 'keep' ? 'keep' : 'reduce', days: st.days.sort(), canEdit: $('#ef-edit').checked, active: id ? $('#ef-active').checked : true };
    const btn = $('#ef-save'); btn.disabled = true;
    const q = id ? sb.from('employees').update(fromEmp(d)).eq('id', id).select().single() : sb.from('employees').insert(fromEmp(d)).select().single();
    const { data: row, error } = await q;
    if (error) { btn.disabled = false; return fail('No se ha podido guardar: ' + error.message); }
    if (pin) {
      const r = await sb.rpc('tt_set_pin', { p_emp: row.id, p_pin: pin });
      if (r.error) { btn.disabled = false; return fail('Se ha guardado la ficha, pero no el PIN: ' + r.error.message); }
      row.pin_hash = 'x';
    }
    S.employees[row.id] = toEmp(row);
    closeModal(); render(); toast(id ? 'Cambios guardados' : `${name} ya puede fichar con su PIN`);
  };
  if (id) $('#ef-del').onclick = () => {
    const f = $('#modal .modal-f');
    f.innerHTML = `<span class="err" style="margin-right:auto">Se borrarán ${esc(e.name)} y todos sus fichajes. No se puede deshacer. Si solo deja la empresa, mejor desactívalo y conserva su historial.</span><button class="btn" data-act="close">Cancelar</button><button class="btn danger" id="ef-del2">Eliminar definitivamente</button>`;
    $('#ef-del2').onclick = async () => { if (await deleteEmployee(id)) { closeModal(); toast('Empleado eliminado'); } };
  };
}
async function deleteEmployee(id) {
  const ok = await dbCall(sb.from('employees').delete().eq('id', id));
  if (!ok) return false;
  delete S.employees[id];
  for (const [pid, p] of S.punches) if (p.emp === id) S.punches.delete(pid);
  for (const [nid, n] of Object.entries(S.notes)) if (n.empId === id) delete S.notes[nid];
  render(); return true;
}
function adminLog() {
  const list = emps(true);
  if (!list.length) return `<div class="panel empty">Aún no hay empleados.</div>`;
  if (!UI.logEmp || !S.employees[UI.logEmp]) UI.logEmp = list[0][0];
  const id = UI.logEmp, [y, m] = UI.logMonth.split('-').map(Number);
  const ready = needMonths(`${UI.logMonth}-01`, `${UI.logMonth}-01`);
  const ents = entriesOf(id).filter(e => ymd(new Date(e.in)).startsWith(UI.logMonth));
  const byDay = {}; ents.forEach(x => { const d = ymd(new Date(x.in)); (byDay[d] = byDay[d] || []).push(x); });
  const total = ents.filter(e => e.out).reduce((a, e) => a + workedMin(e), 0);
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="row"><select class="input" id="log-emp" style="width:auto">${list.map(([k, e]) => `<option value="${k}" ${k === id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <input class="input" type="month" id="log-month" value="${UI.logMonth}" style="width:auto"></div>
      <div class="row"><span class="hint">Total ${MON[m - 1]} ${y}: <b class="mono" style="color:var(--ink)">${fmtMin(total)}</b></span><button class="btn primary" data-act="addEntryAdmin" data-emp="${id}">Añadir fichaje</button></div></div>
    ${!ready ? `<div class="panel empty">Cargando fichajes…</div>` : ents.length ? `<div class="tbl-wrap"><table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th class="n">Horas</th><th>Notas</th><th></th></tr></thead><tbody>
      ${Object.entries(byDay).map(([d, xs]) => xs.map((x, i) => { const ed = x.edits || []; const lastEd = ed[ed.length - 1]; return `<tr>
        <td>${i === 0 ? `<b>${esc(dayShort(d))}</b>` : ''}</td><td class="mono">${hm(new Date(x.in))}</td><td class="mono">${x.out ? hm(new Date(x.out)) + (ymd(new Date(x.out)) !== d ? ' <span class="hint">(+1)</span>' : '') : '<span class="pill go"><span class="dot"></span>abierto</span>'}</td>
        <td class="n">${x.out ? fmtHM(workedMin(x)) : ''}</td>
        <td style="white-space:normal;min-width:180px">${lastEd ? `<span class="pill warn">${lastEd.by === 'admin' ? 'Corregido por ti' : 'Corregido por el empleado'}</span> <span class="hint">${esc(lastEd.reason || '')}</span>` : ''}</td>
        <td><button class="btn ghost sm" data-act="editEntryAdmin" data-id="${x.id}">Editar</button></td></tr>`; }).join('')).join('')}
    </tbody></table></div>` : `<div class="panel empty">Sin fichajes en ${MON[m - 1]} de ${y}.</div>`}`;
}

/* ---------- informe ---------- */
function reportOpts() {
  const list = emps(true);
  const sel = R.sel || list.filter(([, e]) => e.active !== false).map(([id]) => id);
  return { ...R, sel: sel.filter(id => S.employees[id]), holidays: [...R.holidays].sort() };
}
function adminReport() {
  const list = emps(true), o = reportOpts();
  const valid = o.from && o.to && o.from <= o.to;
  const ready = valid && needMonths(o.from, o.to);
  const res = ready ? o.sel.map(id => computeReport(id, o)) : [];
  const presets = [['thisMonth', 'Este mes'], ['lastMonth', 'Mes anterior'], ['last4', 'Últimas 4 semanas'], ['year', 'Este año']];
  return `<div class="rep">
    <div class="stack">
      <section class="panel fs"><h3>Periodo</h3>
        <div class="grid2"><div class="field"><label for="r-from">Desde</label><input class="input" type="date" id="r-from" value="${o.from}"></div>
        <div class="field"><label for="r-to">Hasta</label><input class="input" type="date" id="r-to" value="${o.to}"></div></div>
        <div class="chips">${presets.map(([k, l]) => `<button class="chip" data-act="preset" data-p="${k}">${l}</button>`).join('')}</div>
        ${valid ? '' : '<p class="err">La fecha «Desde» debe ser anterior a «Hasta».</p>'}
      </section>
      <section class="panel fs"><h3>Empleados</h3>
        <div class="chips">${list.map(([id, e]) => `<button class="chip" data-act="selEmp" data-id="${id}" aria-pressed="${o.sel.includes(id)}">${esc(e.name)}</button>`).join('')}</div>
        <p class="hint">Cada empleado tendrá su propia pestaña en el Excel, más una pestaña de resumen.</p>
      </section>
      <section class="panel fs"><h3>Horas extra festivos</h3>
        <p class="hint">Las horas extra hechas en los días que marques se separan como <b>horas extra festivos</b>. El resto son <b>horas extra laborables</b>.</p>
        <div class="chips">
          <button class="chip" data-act="crit" data-k="sat" aria-pressed="${o.sat}">Sábados</button>
          <button class="chip" data-act="crit" data-k="sun" aria-pressed="${o.sun}">Domingos</button>
          <button class="chip" data-act="crit" data-k="fest" aria-pressed="${o.fest}">Festivos</button>
        </div>
        ${o.fest ? `<div class="fs" style="gap:8px;border-top:1px solid var(--line);padding-top:12px">
          <span class="lbl">Días festivos del periodo</span>
          <div class="row" style="gap:8px"><input class="input" type="date" id="r-hol" min="${o.from}" max="${o.to}" style="width:auto"><button class="btn sm" data-act="addHol">Añadir</button><button class="btn ghost sm" data-act="natHol">Añadir festivos nacionales</button></div>
          <div class="chips">${o.holidays.filter(h => h >= o.from && h <= o.to).map(h => `<span class="chip">${esc(dayShort(h))}<button class="x" data-act="delHol" data-d="${h}" aria-label="Quitar ${h}">×</button></span>`).join('') || '<span class="hint">Ningún festivo marcado todavía. Añade también los autonómicos y locales.</span>'}</div>
          <p class="hint">Si un festivo cae en un día laborable posible, cada empleado lo trata según su ficha: se descuenta una jornada de su contrato semanal o mantiene sus horas y las recupera otros días.</p>
        </div>` : ''}
      </section>
      <section class="panel fs"><h3>Horas no trabajadas</h3>
        <label class="opt"><input type="radio" name="r-comp" value="sep" ${!o.comp ? 'checked' : ''}><div><b>Mostrar por separado</b><span>Horas trabajadas, horas extra y horas no trabajadas aparecen cada una por su lado.</span></div></label>
        <label class="opt"><input type="radio" name="r-comp" value="comp" ${o.comp ? 'checked' : ''}><div><b>Compensar</b><span>Las horas no trabajadas del periodo se restan solo de las horas extra laborables. Las horas extra festivos no se tocan.</span></div></label>
      </section>
    </div>
    <div class="stack">
      <section class="panel fs"><div class="row" style="justify-content:space-between"><h3>Vista previa</h3><button class="btn primary" data-act="export" ${ready && o.sel.length ? '' : 'disabled'}>Generar Excel</button></div>
        <p class="hint">Se aceptan ${TOL} minutos de más por jornada y solo cuenta como extra lo que pasa de ese margen. Contrato por día: margen de ${TOL} min en cada jornada. Contrato por semana: margen de ${TOL} min × jornadas trabajadas en la semana. Las extra son laborables salvo las hechas en los días marcados arriba. Las semanas en rojo no llegan a las horas de contrato.</p>
        ${res.length ? `<div class="tbl-wrap"><table><thead><tr><th>Empleado</th><th class="n">Trabajadas</th><th class="n">Contrato</th><th class="n">Extra lab.</th><th class="n">Extra fest.</th><th class="n">${o.comp ? 'Pendientes' : 'No trabajadas'}</th><th class="n">Sem. en rojo</th></tr></thead><tbody>
          ${res.map(r => { const T = r.T; return `<tr class="${T.redWeeks ? '' : ''}"><td><b>${esc(r.emp.name)}</b></td><td class="n">${fmtHM(T.worked)}</td><td class="n">${fmtHM(T.expected)}</td>
            <td class="n">${fmtHM(o.comp ? T.otLnet : T.otL)}</td><td class="n">${fmtHM(o.comp ? T.otFnet : T.otF)}</td><td class="n">${fmtHM(o.comp ? T.defNet : T.def)}</td>
            <td class="n">${T.redWeeks ? `<span class="pill stop">${T.redWeeks} de ${T.weeks}</span>` : `<span class="pill go">0</span>`}</td></tr>`; }).join('')}
        </tbody></table></div>` : valid && !ready ? '<div class="empty">Cargando fichajes del periodo…</div>' : '<div class="empty">Elige al menos un empleado.</div>'}
      </section>
      ${res.map(r => `<section class="panel fs"><div class="row" style="justify-content:space-between"><h3>${esc(r.emp.name)}</h3><span class="hint">${esc(contractText(r.emp))}</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>Semana</th><th class="n">Trabajadas</th><th class="n">Contrato</th><th class="n">Extra lab.</th><th class="n">Extra fest.</th></tr></thead><tbody>
        ${r.weeks.map(w => `<tr class="${w.red ? 'red' : ''}"><td>${esc(dayShort(w.days[0].date))} – ${esc(dayShort(w.days[w.days.length - 1].date))}</td><td class="n">${fmtHM(w.worked)}</td><td class="n">${fmtHM(w.expected)}</td><td class="n">${w.otL ? fmtHM(w.otL) : ''}</td><td class="n">${w.otF ? fmtHM(w.otF) : ''}</td></tr>`).join('')}
        </tbody></table></div></section>`).join('')}
    </div></div>`;
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'r-from' || t.id === 'r-to') { R[t.id === 'r-from' ? 'from' : 'to'] = t.value; saveR(); t.blur(); render(); }
  else if (t.name === 'r-comp') { R.comp = t.value === 'comp'; saveR(); render(); }
  else if (t.id === 'log-emp') { UI.logEmp = t.value; t.blur(); render(); }
  else if (t.id === 'log-month') { if (t.value) UI.logMonth = t.value; t.blur(); render(); }
});

async function exportExcel() {
  if (typeof ExcelJS === 'undefined') { toast('No se ha podido cargar el generador de Excel. Recarga la página.'); return; }
  const o = reportOpts(), co = S.company || {};
  const c = { company: co.name, cif: co.cif, center: co.center };
  await ensureMonths(o.from, o.to);
  const res = o.sel.map(id => computeReport(id, o));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Tictac'; wb.created = new Date();
  const K = { ink: 'FF151A2D', head: 'FF2B3280', red: 'FFF9DCD8', redInk: 'FF9E2B22', amber: 'FFFCEFD2', grey: 'FFEFF1F6', week: 'FFE4E7F1', line: 'FFD5D9E3', white: 'FFFFFFFF', muted: 'FF6B7185' };
  const fill = a => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: a } });
  const thin = { style: 'thin', color: { argb: K.line } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const H = '[h]:mm', t = m => (m ? m / 1440 : null);
  const crit = [o.sat && 'Sábados', o.sun && 'Domingos', o.fest && `Festivos (${o.holidays.filter(h => h >= o.from && h <= o.to).length})`].filter(Boolean).join(', ') || 'Ninguno';
  const interval = `${o.from.split('-').reverse().join('/')} - ${o.to.split('-').reverse().join('/')}`;
  const treat = o.comp ? 'Compensar horas no trabajadas con horas extra' : 'Horas trabajadas, extra y no trabajadas por separado';
  const usedNames = new Set();
  const sheetName = n => { let b = (n || 'Empleado').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 28).trim() || 'Empleado', s = b, i = 2; while (usedNames.has(s.toLowerCase())) s = `${b} ${i++}`; usedNames.add(s.toLowerCase()); return s; };
  usedNames.add('resumen');

  // Resumen
  const rs = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  rs.columns = [{ width: 26 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  rs.mergeCells('A1:J1'); rs.getCell('A1').value = 'RESUMEN DE HORAS';
  rs.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: K.white } }; rs.getCell('A1').fill = fill(K.ink); rs.getCell('A1').alignment = { vertical: 'middle', indent: 1 }; rs.getRow(1).height = 34;
  [['Empresa', c.company], ['CIF', c.cif], ['Centro de trabajo', c.center], ['Intervalo', interval], ['Horas extra festivos', crit], ['Tratamiento', treat]].forEach(([k, v], i) => {
    const r = rs.getRow(3 + i); r.getCell(1).value = k; r.getCell(1).font = { bold: true, color: { argb: K.muted } }; r.getCell(2).value = v || '';
  });
  const sh = ['Empleado', 'Contrato', 'Horas contrato', 'Horas trabajadas', 'Horas ordinarias', 'Extra laborables', 'Extra festivos', o.comp ? 'Compensadas' : 'No trabajadas', o.comp ? 'Pendientes' : 'Semanas en rojo', o.comp ? 'Semanas en rojo' : ''].filter(Boolean);
  const hr = rs.getRow(10); sh.forEach((h, i) => { const cl = hr.getCell(i + 1); cl.value = h; cl.font = { bold: true, color: { argb: K.white } }; cl.fill = fill(K.head); cl.border = box; cl.alignment = { vertical: 'middle', horizontal: i > 1 ? 'center' : 'left', wrapText: true }; });
  hr.height = 30;
  res.forEach((r, i) => {
    const T = r.T, row = rs.getRow(11 + i);
    const vals = [r.emp.name, contractText(r.emp), t(T.expected), t(T.worked), t(T.ordinary), t(o.comp ? T.otLnet : T.otL), t(o.comp ? T.otFnet : T.otF)];
    if (o.comp) vals.push(t(T.compensated), t(T.defNet), `${T.redWeeks} de ${T.weeks}`); else vals.push(t(T.def), `${T.redWeeks} de ${T.weeks}`);
    vals.forEach((v, k) => { const cl = row.getCell(k + 1); cl.value = v; cl.border = box; if (k >= 2 && typeof v !== 'string') { cl.numFmt = H; cl.alignment = { horizontal: 'center' }; } if (typeof v === 'string' && k > 1) cl.alignment = { horizontal: 'center' }; });
    if (T.redWeeks) row.getCell(vals.length).fill = fill(K.red);
  });
  const nr = 11 + res.length + 1;
  rs.getCell(`A${nr}`).value = `Horas en formato h:mm. Se aceptan ${TOL} minutos de más por jornada; solo cuenta como extra lo que pasa de ese margen.${o.comp ? ' Las horas no trabajadas solo se compensan con horas extra laborables.' : ''}`;
  rs.getCell(`A${nr}`).font = { italic: true, size: 9, color: { argb: K.muted } };

  // Una pestaña por empleado
  for (const r of res) {
    const e = r.emp, T = r.T;
    const ws = wb.addWorksheet(sheetName(e.name), { views: [{ state: 'frozen', ySplit: 9, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 24 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 52 }];
    ws.mergeCells('A1:I1'); const tc = ws.getCell('A1'); tc.value = 'HORAS TRABAJADAS';
    tc.font = { size: 16, bold: true, color: { argb: K.white } }; tc.fill = fill(K.ink); tc.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 34;
    const info = [[['Empresa', c.company], ['Empleado', e.name]], [['CIF', c.cif], ['Nº Afiliación', e.afil]], [['Centro de trabajo', c.center], ['Intervalo', interval]], [['Contrato', contractText(e)], ['Horas extra festivos', crit]]];
    info.forEach((pair, i) => {
      const row = ws.getRow(2 + i);
      row.getCell(1).value = pair[0][0]; row.getCell(1).font = { bold: true, color: { argb: K.muted } };
      ws.mergeCells(2 + i, 2, 2 + i, 4); row.getCell(2).value = pair[0][1] || '';
      row.getCell(5).value = pair[1][0]; row.getCell(5).font = { bold: true, color: { argb: K.muted } };
      ws.mergeCells(2 + i, 6, 2 + i, 8); row.getCell(6).value = pair[1][1] || '';
    });
    const lg = ws.getRow(7);
    [['Laborable', K.white], ['Sáb./Dom./Festivo (criterio)', K.amber], ['Semana sin cumplir contrato', K.red], ['Total semanal', K.week]].forEach(([l, col], i) => {
      const cl = lg.getCell(1 + i * 2); cl.value = l; cl.fill = fill(col); cl.border = box; cl.font = { size: 9 }; cl.alignment = { horizontal: 'center' };
      if (i < 3) ws.mergeCells(7, 1 + i * 2, 7, 2 + i * 2);
    });
    lg.getCell(7).value = 'Total semanal'; lg.getCell(7).fill = fill(K.week); lg.getCell(7).border = box; lg.getCell(7).font = { size: 9 }; lg.getCell(7).alignment = { horizontal: 'center' };
    const head = ['Fecha', 'Tipo de día', 'Hora inicio', 'Hora fin', 'Horas trabajadas', 'Horas previstas', 'Extra laborables', 'Extra festivos', 'Observaciones'];
    const hrow = ws.getRow(9); head.forEach((h, i) => { const cl = hrow.getCell(i + 1); cl.value = h; cl.font = { bold: true, color: { argb: K.white } }; cl.fill = fill(K.head); cl.border = box; cl.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', wrapText: true }; });
    hrow.height = 30;
    let rn = 10;
    for (const w of r.weeks) {
      for (const d of w.days) {
        const first = d.ents[0], last = d.ents[d.ents.length - 1];
        const obs = [];
        if (d.ents.length > 1) obs.push(`${d.ents.length} tramos: ${d.ents.map(x => `${hm(new Date(x.in))}–${hm(new Date(x.out))}`).join(', ')}`);
        d.edits.forEach(x => obs.push(`${x.by === 'admin' ? 'Corregido por la empresa' : 'Modificado por el empleado'}${x.oldIn ? ` (antes ${hm(new Date(x.oldIn))}–${x.oldOut ? hm(new Date(x.oldOut)) : 'sin salida'})` : ' (añadido)'}${x.reason ? `: ${x.reason}` : ''}`));
        if (d.open) obs.push('Fichaje de entrada sin salida');
        const row = ws.getRow(rn++);
        const vals = [dayLabel(d.date), d.type, first ? hm(new Date(first.in)) : '---', last ? hm(new Date(last.out)) : '---', t(d.worked), t(d.expected), t(d.otL), t(d.otF), obs.join(' · ')];
        vals.forEach((v, k) => {
          const cl = row.getCell(k + 1); cl.value = v; cl.border = box;
          if (k >= 4 && k <= 7) cl.numFmt = H;
          cl.alignment = { horizontal: k === 0 || k === 8 ? 'left' : 'center', vertical: 'top', wrapText: k === 8 };
          if (w.red) cl.fill = fill(K.red); else if (d.special) cl.fill = fill(K.amber);
        });
        if (w.red && d.special) row.getCell(2).fill = fill(K.amber);
        if (d.edits.length) row.getCell(9).font = { italic: true, color: { argb: K.redInk } };
      }
      const row = ws.getRow(rn++);
      const lbl = `Semana ${w.days[0].date.slice(8)}/${w.days[0].date.slice(5, 7)} – ${w.days[w.days.length - 1].date.slice(8)}/${w.days[w.days.length - 1].date.slice(5, 7)}`;
      const vals = [lbl, '', '', '', t(w.worked) || 0, t(w.expected) || 0, t(w.otL), t(w.otF), w.red ? `No cumple contrato: faltan ${fmtMin(w.expected - w.worked)}` : (w.expected ? 'Contrato cumplido' : '')];
      vals.forEach((v, k) => {
        const cl = row.getCell(k + 1); cl.value = v; cl.border = box; cl.font = { bold: true, color: { argb: w.red && k === 8 ? K.redInk : K.ink } };
        cl.fill = fill(w.red ? K.red : K.week); if (k >= 4 && k <= 7) { cl.numFmt = H; cl.alignment = { horizontal: 'center' }; }
      });
    }
    rn++;
    const sumTitle = ws.getRow(rn++); ws.mergeCells(rn - 1, 1, rn - 1, 5); sumTitle.getCell(1).value = 'TOTAL DEL PERIODO'; sumTitle.getCell(1).font = { bold: true, color: { argb: K.white } }; sumTitle.getCell(1).fill = fill(K.ink);
    const lines = [['Horas de contrato en el periodo', T.expected], ['Horas trabajadas', T.worked], ['Horas ordinarias (trabajadas − extra)', T.ordinary], ['Horas extra laborables', T.otL], ['Horas extra festivos', T.otF], ['Horas no trabajadas', T.def]];
    if (o.comp) lines.push(['Horas compensadas (con extra laborables)', T.compensated], ['Horas extra laborables netas', T.otLnet], ['Horas extra festivos (no compensables)', T.otFnet], ['Horas no trabajadas pendientes', T.defNet]);
    for (const [k, v] of lines) {
      const row = ws.getRow(rn++); ws.mergeCells(rn - 1, 1, rn - 1, 4);
      row.getCell(1).value = k; row.getCell(1).border = box; row.getCell(5).value = (v || 0) / 1440; row.getCell(5).numFmt = H; row.getCell(5).border = box; row.getCell(5).alignment = { horizontal: 'center' };
      if (/netas|pendientes/.test(k)) { row.getCell(1).font = { bold: true }; row.getCell(5).font = { bold: true }; }
    }
    const row = ws.getRow(rn++); ws.mergeCells(rn - 1, 1, rn - 1, 4);
    row.getCell(1).value = 'Semanas sin cumplir contrato'; row.getCell(1).border = box; row.getCell(5).value = `${T.redWeeks} de ${T.weeks}`; row.getCell(5).border = box; row.getCell(5).alignment = { horizontal: 'center' };
    if (T.redWeeks) row.getCell(5).fill = fill(K.red);
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `Horas ${c.company || ''} ${o.from} a ${o.to}.xlsx`.replace(/\s+/g, ' ');
  downloadBlob(blob, filename); toast('Informe generado');
}

/* ---------- ajustes ---------- */
function adminSettings() {
  const c = S.company || {};
  return `<div class="stack" style="max-width:620px">
    <section class="panel fs"><h3>Datos de la empresa</h3>
      <div class="field"><label for="st-co">Nombre</label><input class="input" id="st-co" value="${esc(c.name)}"></div>
      <div class="grid2"><div class="field"><label for="st-cif">CIF</label><input class="input" id="st-cif" value="${esc(c.cif)}"></div>
      <div class="field"><label for="st-ct">Centro de trabajo</label><input class="input" id="st-ct" value="${esc(c.center)}"></div></div>
      <div><button class="btn primary" data-act="saveCompany">Guardar</button></div></section>
    <section class="panel fs"><h3>Copia de seguridad</h3>
      <p class="hint">Descarga todos los datos (empresa, empleados, fichajes y avisos) en un archivo. El registro de jornada debe conservarse 4 años: guarda una copia cada mes en un lugar seguro.</p>
      <div><button class="btn" data-act="backup">Descargar copia completa</button></div></section>
    <section class="panel fs"><h3>Contraseña del gerente</h3>
      <div class="grid2"><div class="field"><label for="st-pw">Nueva contraseña</label><input class="input" type="password" id="st-pw" autocomplete="new-password"></div>
      <div class="field"><label for="st-pw2">Repítela</label><input class="input" type="password" id="st-pw2" autocomplete="new-password"></div></div>
      <p class="err" id="st-err" hidden></p><div><button class="btn" data-act="savePass">Cambiar contraseña</button></div></section>
    <section class="panel fs"><h3>Reglas de cálculo</h3>
      <p class="hint">Margen aceptado: <b>${TOL} minutos por jornada</b>. Contrato por día: una jornada genera horas extra si supera lo previsto en más de ${TOL} minutos. Contrato por semana: la semana genera horas extra si supera el contrato en más de ${TOL} minutos por cada jornada trabajada (5 jornadas = 50 min). En ambos casos solo cuenta como extra lo que pasa del margen (ej.: 5 jornadas y 42 h con contrato de 40 h → 1 h 10 min extra).</p>
      <p class="hint">Las horas extra son <b>laborables</b> por defecto. Solo se separan como <b>festivos</b> si en el informe marcas sábados, domingos o festivos y las horas se hicieron en esos días. Al compensar, las horas no trabajadas solo se restan de las extra laborables.</p>
      <p class="hint">Las semanas van de lunes a domingo. Los días laborables posibles no obligan a trabajar: el contrato se mide por horas y jornadas por semana. En contrato por día, cada jornada trabajada se compara con sus horas; si trabaja más jornadas de las de contrato, las de más cuentan como extra, descontando el margen (se eligen primero sábados, domingos o festivos marcados) y si trabaja menos, las jornadas que faltan cuentan como horas no trabajadas. Si el periodo empieza o acaba a mitad de semana, el contrato de esa semana se ajusta a los días posibles incluidos.</p></section>
  </div>`;
}

/* ---------- acciones ---------- */
const ACT = {
  pick: t => { const id = t.dataset.id;
    pinModal(t.dataset.name, 'Introduce tu PIN', async v => {
      const remember = $('#rem') ? $('#rem').checked : false;
      const { data, error } = await sb.rpc('tt_emp_login', { p_emp: id, p_pin: v, p_remember: remember });
      if (error) return 'Sin conexión. Inténtalo de nuevo.';
      if (!data.ok) return data.error === 'locked' ? `Demasiados intentos. Prueba de nuevo a las ${hm(new Date(data.until))}.` : data.error === 'not_found' ? 'Este empleado ya no está activo.' : false;
      setToken(data.token, remember); closeModal();
      try { if (!await loadEmployee()) await showHome(); } catch { toast('Sin conexión. Inténtalo de nuevo.'); }
      return true;
    }, `<label class="switch" style="justify-content:center"><input type="checkbox" id="rem"><span class="hint" style="margin-top:2px">Recordarme en este móvil</span></label>`); },
  adminLogin: () => {
    openModal(`<div class="modal-h"><div><h2>Acceso gerente</h2><p class="hint">Entra con el email y la contraseña de tu cuenta de gerente.</p></div><button class="btn ghost sm" data-act="close" aria-label="Cerrar">✕</button></div>
      <form id="loginForm" style="display:grid;gap:14px">
        <div class="field"><label for="lg-mail">Email</label><input class="input" type="email" id="lg-mail" autocomplete="username" required></div>
        <div class="field"><label for="lg-pw">Contraseña</label><input class="input" type="password" id="lg-pw" autocomplete="current-password" required></div>
        <p class="err" id="lg-err" hidden></p>
        <div class="modal-f"><button class="btn" type="button" data-act="close">Cancelar</button><button class="btn primary" type="submit" id="lg-go">Entrar</button></div>
      </form>`);
  },
  logout: async () => {
    if (UI.mode === 'admin') return logoutGerente();
    if (UI.token) sb.rpc('tt_emp_logout', { p_token: UI.token }).then(() => {}, () => {});
    setToken(null); await showHome();
  },
  retry: () => { UI.mode = 'loading'; render(); boot(); },
  punch: () => doPunch(),
  close: () => closeModal(),
  editEntry: t => { const e = findEntry(null, t.dataset.id); if (e) entryModal({ entry: e, empId: UI.empId, asAdmin: false }); },
  addEntry: t => entryModal({ entry: null, empId: t.dataset.emp, asAdmin: false }),
  editEntryAdmin: t => { const e = findEntry(null, t.dataset.id); if (e) entryModal({ entry: e, empId: e.emp, asAdmin: true }); },
  addEntryAdmin: t => entryModal({ entry: null, empId: t.dataset.emp, asAdmin: true }),
  delEntry: t => {
    const f = $('#modal .modal-f');
    f.innerHTML = `<span class="err" style="margin-right:auto">¿Eliminar este fichaje?</span><button class="btn" data-act="close">Cancelar</button><button class="btn danger" id="de2">Eliminar</button>`;
    $('#de2').onclick = async () => { if (await dbCall(sb.from('punches').delete().eq('id', t.dataset.id))) { S.punches.delete(t.dataset.id); closeModal(); render(); toast('Fichaje eliminado'); } };
  },
  tab: t => { UI.tab = t.dataset.tab; render(); window.scrollTo(0, 0); },
  toggleRead: () => { UI.showRead = !UI.showRead; render(); },
  readNote: async t => { if (await dbCall(sb.from('notes').update({ read: true }).eq('id', t.dataset.id))) { S.notes[t.dataset.id] = { ...S.notes[t.dataset.id], read: true }; render(); } },
  empForm: t => empFormModal(t.dataset.id),
  preset: t => { const n = new Date(); let f, l;
    if (t.dataset.p === 'thisMonth') { f = new Date(n.getFullYear(), n.getMonth(), 1); l = n; }
    if (t.dataset.p === 'lastMonth') { f = new Date(n.getFullYear(), n.getMonth() - 1, 1); l = new Date(n.getFullYear(), n.getMonth(), 0); }
    if (t.dataset.p === 'last4') { l = new Date(weekStart(n)); l.setDate(l.getDate() - 1); f = new Date(l); f.setDate(f.getDate() - 27); }
    if (t.dataset.p === 'year') { f = new Date(n.getFullYear(), 0, 1); l = n; }
    R.from = ymd(f); R.to = ymd(l); saveR(); render(); },
  selEmp: t => { const o = reportOpts(); const id = t.dataset.id; R.sel = o.sel.includes(id) ? o.sel.filter(x => x !== id) : [...o.sel, id]; render(); },
  crit: t => { R[t.dataset.k] = !R[t.dataset.k]; saveR(); render(); },
  addHol: () => { const v = $('#r-hol').value; if (!v) { toast('Elige una fecha'); return; } if (!R.holidays.includes(v)) R.holidays.push(v); saveR(); render(); },
  natHol: () => { const y1 = +R.from.slice(0, 4), y2 = +R.to.slice(0, 4); let n = 0;
    for (let y = y1; y <= y2; y++) for (const h of nationalHolidays(y)) if (h >= R.from && h <= R.to && !R.holidays.includes(h)) { R.holidays.push(h); n++; }
    saveR(); render(); toast(n ? `${n} festivo${n > 1 ? 's' : ''} nacional${n > 1 ? 'es' : ''} añadido${n > 1 ? 's' : ''}` : 'No hay festivos nacionales en este periodo'); },
  delHol: t => { R.holidays = R.holidays.filter(h => h !== t.dataset.d); saveR(); render(); },
  export: async t => { t.disabled = true; t.textContent = 'Generando…'; try { await exportExcel(); } catch (e) { console.error(e); toast('No se ha podido generar el informe.'); } render(); },
  saveCompany: async () => {
    const row = await dbCall(sb.from('company').upsert({ id: 1, name: $('#st-co').value.trim() || S.company.name, cif: $('#st-cif').value.trim(), center: $('#st-ct').value.trim(), updated_at: new Date().toISOString() }).select().single(), 'Datos guardados');
    if (row) { S.company = row; render(); } },
  savePass: async () => { const a = $('#st-pw').value, b = $('#st-pw2').value, err = $('#st-err');
    if (a.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'Las dos contraseñas no coinciden.'; err.hidden = false; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { err.textContent = 'No se ha podido cambiar: ' + error.message; err.hidden = false; return; }
    $('#st-pw').value = ''; $('#st-pw2').value = ''; err.hidden = true; toast('Contraseña cambiada'); },
  backup: async t => { t.disabled = true; t.textContent = 'Preparando copia…'; try { await exportBackup(); } catch (e) { console.error(e); toast('No se ha podido descargar la copia.'); } t.disabled = false; t.textContent = 'Descargar copia completa'; },
};
async function gerenteLogin(e) {
  e.preventDefault();
  const err = $('#lg-err'), btn = $('#lg-go');
  btn.disabled = true; err.hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('#lg-mail').value.trim(), password: $('#lg-pw').value });
  btn.disabled = false;
  if (error) { err.textContent = /invalid/i.test(error.message) ? 'Email o contraseña incorrectos.' : 'No se ha podido entrar: ' + error.message; err.hidden = false; return; }
  closeModal();
  if (!await enterGerente()) await showHome();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACT[t.dataset.act]) { e.preventDefault(); ACT[t.dataset.act](t, e); return; }
  if (e.target.classList.contains('scrim')) closeModal();
});

/* ---------- modal y aviso ---------- */
function openModal(html, _, wide) {
  $('#modal').innerHTML = `<div class="scrim"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const f = $('#modal input:not([type=checkbox]),#modal textarea'); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() { $('#modal').innerHTML = ''; UI.keyHandler = null; if (pendingRender) { pendingRender = false; render(); } }
let toastT;
function toast(msg) {
  let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3600);
}

/* ---------- reloj en vivo ---------- */
function tick() {
  const now = new Date();
  $$('[data-live="clock"],[data-live="clock-big"]').forEach(el => { el.textContent = hm(now); });
  const s = UI.mode === 'emp' ? { id: UI.empId } : null;
  if (s && S.employees[s.id]) {
    const e = S.employees[s.id], o = openEntry(s.id), today = ymd(now);
    const tw = dayWorked(s.id, today), exp = jornadaMin(e), ww = weekWorked(s.id), wk = weeklyHours(e) * 60;
    const set = (k, v) => { const el = $(`[data-live="${k}"]`); if (el) el.textContent = v; };
    if (o) { const m = workedMin(o); set('session', `${Math.floor(m / 60)} h ${pad(Math.floor(m % 60))} min ${pad(Math.floor((m * 60) % 60))} s`); }
    set('today', fmtHM(tw)); set('week', fmtHM(ww));
    const wb = $('[data-live="weekbar"]'); if (wb) { wb.classList.toggle('ok', ww >= wk); wb.firstElementChild.style.width = `${wk ? Math.min(100, ww / wk * 100) : 0}%`; }
    const ring = $('#ring'); if (ring) { const pct = exp ? Math.min(1, tw / exp) : (tw ? 1 : 0); ring.style.strokeDashoffset = String(653.5 * (1 - pct)); }
  }
}
setInterval(tick, 1000);
setInterval(async () => {
  if ($('#modal').innerHTML) return;
  try {
    if (UI.mode === 'home') { const { data } = await sb.rpc('tt_public_info'); if (data) S.pub = data; }
    else if (UI.mode === 'emp') await loadEmployee();
  } catch {}
  scheduleRender();
}, 60000);
// al volver a la app (p. ej. desde otra app del móvil), refrescar
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !sb || $('#modal').innerHTML) return;
  if (UI.mode === 'emp') loadEmployee().catch(() => {});
  else if (UI.mode === 'home') sb.rpc('tt_public_info').then(({ data }) => { if (data) { S.pub = data; scheduleRender(); } });
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
boot();
