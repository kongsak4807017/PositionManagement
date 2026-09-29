(() => {
  'use strict';

  const STORAGE_KEY = 'chro_hr1_preview_v2_state';
  const UI_KEY = 'chro_hr1_preview_v2_ui';
  const seed = window.CHRO_V2_SEED;
  if (!seed) {
    document.body.innerHTML = '<div style="padding:2rem;font-family:sans-serif">CHRO HR1 seed data failed to load.</div>';
    return;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  const POSITION_LEVELS = ['ปฏิบัติงาน','ชำนาญงาน','อาวุโส','ปฏิบัติการ','ชำนาญการ','ชำนาญการพิเศษ','เชี่ยวชาญ','ทรงคุณวุฒิ'];

  function isRetirementReason(reason) {
    return reason === 'เกษียณ' || reason === 'เกษียณอายุราชการ';
  }

  function splitLegacyPositionName(name, currentLevel = '') {
    if (currentLevel) return {name: String(name || '').trim(), level: currentLevel};
    const source = String(name || '').trim();
    const levels = [...POSITION_LEVELS].sort((a,b) => b.length - a.length);
    const level = levels.find(x => source.endsWith(' ' + x));
    return level ? {name: source.slice(0, -level.length).trim(), level} : {name: source, level: ''};
  }

  function migrateState(input) {
    const next = clone(input);
    next.meta = next.meta || {};
    next.meta.version = '2.1.0';
    next.governance_notes = next.governance_notes || [];
    next.history = next.history || [];
    next.positions = (next.positions || []).map(p => {
      const split = splitLegacyPositionName(p.position_name_th, p.position_level);
      return {
        ...p,
        position_name_th: split.name,
        position_level: split.level,
        vacant_reason: isRetirementReason(p.vacant_reason) ? 'เกษียณอายุราชการ' : p.vacant_reason,
        retirement_use_approved: Boolean(p.retirement_use_approved),
        retirement_approval_doc_no: p.retirement_approval_doc_no || '',
        retirement_use_from_date: p.retirement_use_from_date || ''
      };
    });
    return next;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.meta && Array.isArray(saved.positions)) return migrateState(saved);
    } catch (_) {}
    return migrateState(seed);
  }

  function loadUI() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY));
      if (saved) return saved;
    } catch (_) {}
    return {
      tab: 'overview',
      role: 'hosp_operator',
      scope: 'U5701',
      filters: {province:'', cadre:'', milestone:'', sla:'', q:''}
    };
  }

  let state = loadState();
  let ui = loadUI();
  let modalMode = null;
  let selectedPositionId = null;

  function persist() {
    state.meta.last_local_update = nowISO();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  }

  function byId(id) { return document.getElementById(id); }
  function unit(id) { return state.units.find(x => x.unit_id === id); }
  function province(code) { return state.provinces.find(x => x.province_code === code); }
  function milestone(code) { return state.milestones.find(x => x.milestone_code === code); }
  function bottleneck(id) { return state.bottlenecks.find(x => Number(x.tag_id) === Number(id)); }

  function daysBetween(start, end = new Date()) {
    const a = new Date(String(start).slice(0,10) + 'T00:00:00');
    const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

  function enrich(raw) {
    const u = unit(raw.unit_id) || {};
    const pr = province(u.province_code) || {};
    const ms = milestone(raw.current_milestone) || {};
    const bn = bottleneck(raw.bottleneck_tag_id) || {};
    const days = daysBetween(raw.milestone_entry_date);
    const sla = Number(raw.sla_days || ms.default_sla_days || 0);
    const left = sla - days;
    const status = left < 0 ? 'BREACHED' : left <= 5 ? 'WARNING' : 'NORMAL';
    return {
      ...raw,
      unit_name: u.unit_name || '-',
      unit_type_label: u.unit_type_label || '-',
      province_code: u.province_code || '',
      province_name_th: pr.province_name_th || '-',
      milestone_name_th: ms.milestone_name_th || raw.current_milestone,
      bottleneck_name: bn.tag_name || '-',
      bottleneck_category: bn.tag_category || '',
      bottleneck_severity: bn.severity_level || '',
      days_in_stage: days,
      days_left: left,
      sla_status: status
    };
  }

  function scopedPositions() {
    const rows = state.positions.map(enrich);
    if (ui.role === 'prov_gatekeeper') return rows.filter(p => p.province_code === ui.scope);
    if (ui.role === 'hosp_operator') return rows.filter(p => p.unit_id === ui.scope);
    return rows;
  }

  function canEdit(p) {
    if (ui.role === 'reg_admin') return true;
    if (ui.role === 'executive') return false;
    if (ui.role === 'prov_gatekeeper') return p.province_code === ui.scope;
    if (ui.role === 'hosp_operator') return p.unit_id === ui.scope;
    return false;
  }

  function canCreate() { return ui.role !== 'executive'; }
  function canDelete() { return ui.role === 'reg_admin'; }

  function roleName(role) {
    return {
      executive:'ผู้บริหารเขต / นพ.สสจ.',
      reg_admin:'ผู้ดูแลระบบ เขตสุขภาพที่ 1',
      prov_gatekeeper:'HR สสจ. / Provincial Gatekeeper',
      hosp_operator:'HR โรงพยาบาล / Facility Operator'
    }[role] || role;
  }

  function scopeOptions() {
    if (ui.role === 'prov_gatekeeper') {
      return state.provinces.map(p => '<option value="'+esc(p.province_code)+'">'+esc(p.province_name_th)+'</option>').join('');
    }
    if (ui.role === 'hosp_operator') {
      return state.units.map(u => '<option value="'+esc(u.unit_id)+'">'+esc(u.unit_name)+' ('+esc(u.unit_type_label)+')</option>').join('');
    }
    return '<option value="ALL">ทุกจังหวัด / ทุกหน่วยงาน</option>';
  }

  function normalizeScope() {
    if (ui.role === 'prov_gatekeeper' && !state.provinces.some(p => p.province_code === ui.scope)) ui.scope = state.provinces[0].province_code;
    if (ui.role === 'hosp_operator' && !state.units.some(u => u.unit_id === ui.scope)) ui.scope = state.units[0].unit_id;
    if (ui.role === 'executive' || ui.role === 'reg_admin') ui.scope = 'ALL';
  }

  function badge(status) {
    if (status === 'BREACHED') return '<span class="inline-flex rounded-full bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs font-semibold">🔴 เกิน SLA</span>';
    if (status === 'WARNING') return '<span class="inline-flex rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-semibold">🟡 ใกล้ครบ</span>';
    return '<span class="inline-flex rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-semibold">🟢 ปกติ</span>';
  }

  function layout() {
    document.body.innerHTML = [
      '<div id="toast" class="fixed right-4 top-4 z-[100] hidden rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"></div>',
      '<div class="min-h-screen bg-slate-50 text-slate-800">',
      '  <div class="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-900">',
      '    🧪 <b>CHRO HR1 Full Interactive Preview v2</b> • Static GitHub Pages prototype • ข้อมูลที่แก้ไขบันทึกเฉพาะใน browser นี้',
      '  </div>',
      '  <header class="sticky top-0 z-40 bg-gradient-to-r from-emerald-900 via-teal-900 to-cyan-950 text-white shadow-lg">',
      '    <div class="mx-auto max-w-[1500px] px-4 py-3">',
      '      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">',
      '        <div class="flex items-center gap-3">',
      '          <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 font-black text-emerald-200">HR1</div>',
      '          <div><div class="font-bold">ระบบติดตามการบริหารตำแหน่ง เขตสุขภาพที่ 1</div><div class="text-xs text-emerald-200">Position Lifecycle • SLA • Governance • Audit Trail</div></div>',
      '        </div>',
      '        <div class="flex flex-wrap items-center gap-2">',
      '          <select id="roleSelector" class="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white outline-none">',
      '            <option class="text-slate-900" value="executive">ผู้บริหารเขต / นพ.สสจ.</option>',
      '            <option class="text-slate-900" value="reg_admin">Regional Admin</option>',
      '            <option class="text-slate-900" value="prov_gatekeeper">HR สสจ.</option>',
      '            <option class="text-slate-900" value="hosp_operator">HR โรงพยาบาล</option>',
      '          </select>',
      '          <select id="scopeSelector" class="max-w-[320px] rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white outline-none"></select>',
      '          <span id="rolePermission" class="rounded-lg bg-emerald-400/15 px-3 py-2 text-xs text-emerald-100"></span>',
      '        </div>',
      '      </div>',
      '      <nav class="mt-3 flex gap-1 overflow-x-auto border-t border-white/10 pt-2 text-sm">',
      navButton('overview','📊','ภาพรวม'),
      navButton('positions','📋','ตำแหน่ง'),
      navButton('analytics','🔍','Analytics'),
      navButton('governance','🏛️','Governance'),
      navButton('admin','⚙️','Admin & Data'),
      '      </nav>',
      '    </div>',
      '  </header>',
      '  <main class="mx-auto max-w-[1500px] p-4 sm:p-6">',
      '    <section id="view-overview"></section>',
      '    <section id="view-positions" class="hidden"></section>',
      '    <section id="view-analytics" class="hidden"></section>',
      '    <section id="view-governance" class="hidden"></section>',
      '    <section id="view-admin" class="hidden"></section>',
      '  </main>',
      '  <footer class="border-t border-slate-200 bg-white px-4 py-5 text-center text-xs text-slate-500">CHRO HR1 Preview v2 • Prototype for workflow validation, not a production HROPS replacement.</footer>',
      '</div>',
      '<div id="modalRoot"></div>',
      '<input id="importJsonInput" type="file" accept=".json,application/json" class="hidden">'
    ].join('');
  }

  function navButton(id, icon, label) {
    return '<button data-tab="'+id+'" class="tab-btn whitespace-nowrap rounded-t-lg px-4 py-2 font-medium text-emerald-100 hover:bg-white/10">'+icon+' '+label+'</button>';
  }

  function toast(msg) {
    const el = byId('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function setTab(tab) {
    ui.tab = tab;
    persist();
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const active = byId('view-'+tab);
    if (active) active.classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('bg-white/10', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('border-b-2', on);
      btn.classList.toggle('border-emerald-300', on);
    });
    renderCurrent();
  }

  function renderCurrent() {
    if (ui.tab === 'overview') renderOverview();
    else if (ui.tab === 'positions') renderPositions();
    else if (ui.tab === 'analytics') renderAnalytics();
    else if (ui.tab === 'governance') renderGovernance();
    else renderAdmin();
  }

  function summary(rows = scopedPositions()) {
    const active = rows.filter(p => p.current_milestone !== 'M6');
    return {
      total: rows.length,
      active: active.length,
      completed: rows.filter(p => p.current_milestone === 'M6').length,
      breached: active.filter(p => p.sla_status === 'BREACHED').length,
      warning: active.filter(p => p.sla_status === 'WARNING').length,
      normal: active.filter(p => p.sla_status === 'NORMAL').length
    };
  }

  function metricCard(label, value, sub, tone) {
    return '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">'
      +'<div class="text-xs font-semibold uppercase tracking-wide text-slate-500">'+esc(label)+'</div>'
      +'<div class="mt-1 text-3xl font-black '+tone+'">'+esc(value)+'</div>'
      +'<div class="mt-1 text-xs text-slate-500">'+esc(sub)+'</div></div>';
  }

  function renderOverview() {
    const rows = scopedPositions();
    const s = summary(rows);
    const byM = Object.fromEntries(state.milestones.map(m => [m.milestone_code, rows.filter(p => p.current_milestone === m.milestone_code).length]));
    const maxM = Math.max(1, ...Object.values(byM));
    const provinceRows = state.provinces.map(pr => {
      const r = rows.filter(p => p.province_code === pr.province_code);
      return {pr, total:r.length, breached:r.filter(p=>p.current_milestone!=='M6'&&p.sla_status==='BREACHED').length, completed:r.filter(p=>p.current_milestone==='M6').length};
    }).filter(x=>x.total>0);
    const escalations = rows.filter(p=>p.current_milestone!=='M6'&&p.sla_status==='BREACHED').sort((a,b)=>a.days_left-b.days_left).slice(0,8);
    const pct = s.total ? Math.round(s.completed/s.total*1000)/10 : 0;

    byId('view-overview').innerHTML = [
      '<div class="mb-5 flex flex-wrap items-end justify-between gap-3">',
      ' <div><h1 class="text-xl font-black text-slate-900">Executive Overview</h1><p class="text-sm text-slate-500">ภาพรวม WIP, SLA และรายการที่ต้องเร่งรัดภายใต้ scope ปัจจุบัน</p></div>',
      ' <div class="text-right text-xs text-slate-500">Role: <b>'+esc(roleName(ui.role))+'</b><br>Local data updated: '+esc((state.meta.last_local_update||state.meta.snapshot_date).slice(0,19))+'</div>',
      '</div>',
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">',
      metricCard('ตำแหน่งทั้งหมด',s.total,'รายการใน scope ปัจจุบัน','text-slate-900'),
      metricCard('อยู่ระหว่างบริหาร',s.active,'WIP ที่ยังไม่ปิด M6','text-indigo-600'),
      metricCard('สำเร็จ / M6',s.completed,pct+'% ของทั้งหมด','text-emerald-600'),
      metricCard('เกิน SLA',s.breached,'ต้องจัดการ / escalate','text-rose-600'),
      '</div>',
      '<div class="mt-5 grid gap-5 xl:grid-cols-12">',
      ' <div class="xl:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">',
      '  <div class="mb-4"><h2 class="font-bold">Regional Funnel M1–M6</h2><p class="text-xs text-slate-500">สถานะปัจจุบันของแต่ละตำแหน่ง</p></div>',
      state.milestones.map(m => {
        const n = byM[m.milestone_code]||0;
        const w = Math.round(n/maxM*100);
        return '<div class="mb-3"><div class="mb-1 flex justify-between text-xs"><span><b>'+esc(m.milestone_code)+'</b> '+esc(m.milestone_name_th)+'</span><span>'+n+' ตำแหน่ง</span></div><div class="h-3 rounded-full bg-slate-100"><div class="h-3 rounded-full bg-indigo-500" style="width:'+w+'%"></div></div></div>';
      }).join(''),
      ' </div>',
      ' <div class="xl:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">',
      '  <div class="mb-4"><h2 class="font-bold">8 จังหวัด / Scope Progress</h2><p class="text-xs text-slate-500">จำนวนงานและ SLA breach</p></div>',
      provinceRows.map(x => '<button class="province-jump mb-2 flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-indigo-200" data-province="'+esc(x.pr.province_code)+'"><span><b>'+esc(x.pr.province_name_th)+'</b><span class="block text-xs text-slate-500">ทั้งหมด '+x.total+' • สำเร็จ '+x.completed+'</span></span><span class="text-xs font-semibold '+(x.breached?'text-rose-600':'text-emerald-600')+'">'+x.breached+' เกิน SLA</span></button>').join(''),
      ' </div>',
      '</div>',
      '<div class="mt-5 rounded-2xl border border-rose-200 bg-white shadow-sm">',
      ' <div class="flex items-center justify-between border-b border-rose-100 p-5"><div><h2 class="font-bold text-rose-700">🚨 Priority Escalations</h2><p class="text-xs text-slate-500">เรียงตามจำนวนวันที่เกิน SLA มากที่สุด</p></div><button data-tab="governance" class="go-governance text-xs font-semibold text-rose-700 underline">เปิด Governance Queue →</button></div>',
      tableEscalations(escalations),
      '</div>'
    ].join('');

    document.querySelectorAll('.province-jump').forEach(btn => btn.onclick = () => {
      ui.filters.province = btn.dataset.province;
      setTab('positions');
    });
    document.querySelectorAll('.go-governance').forEach(btn => btn.onclick = () => setTab('governance'));
    bindPositionButtons();
  }

  function tableEscalations(rows) {
    if (!rows.length) return '<div class="p-6 text-center text-sm text-slate-400">ไม่มีรายการเกิน SLA ใน scope นี้</div>';
    return '<div class="overflow-x-auto"><table class="min-w-full text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-3">เลขตำแหน่ง</th><th class="p-3">จังหวัด</th><th class="p-3">หน่วยงาน</th><th class="p-3">ตำแหน่ง</th><th class="p-3">Stage</th><th class="p-3">Aging</th><th class="p-3">Bottleneck</th><th class="p-3"></th></tr></thead><tbody>'
      + rows.map(p => '<tr class="border-t border-slate-100"><td class="p-3 font-mono font-bold">'+esc(p.position_id)+'</td><td class="p-3">'+esc(p.province_name_th)+'</td><td class="p-3">'+esc(p.unit_name)+'</td><td class="p-3">'+esc(p.position_name_th)+'</td><td class="p-3"><b>'+esc(p.current_milestone)+'</b></td><td class="p-3 font-semibold text-rose-600">'+p.days_in_stage+' วัน / เกิน '+Math.abs(p.days_left)+' วัน</td><td class="p-3">'+esc(p.bottleneck_name)+'</td><td class="p-3"><button class="open-pos rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50" data-id="'+esc(p.position_id)+'">เปิด</button></td></tr>').join('')
      + '</tbody></table></div>';
  }

  function filteredPositions() {
    let rows = scopedPositions();
    const f = ui.filters;
    if (f.province) rows = rows.filter(p => p.province_code === f.province);
    if (f.cadre) rows = rows.filter(p => p.cadre_group === f.cadre);
    if (f.milestone) rows = rows.filter(p => p.current_milestone === f.milestone);
    if (f.sla) rows = rows.filter(p => p.sla_status === f.sla);
    if (f.q) {
      const q = f.q.toLowerCase();
      rows = rows.filter(p => [p.position_id,p.position_name_th,p.position_level,p.specialist_name,p.unit_name,p.province_name_th,p.vacant_reason,p.remarks].join(' ').toLowerCase().includes(q));
    }
    return rows.sort((a,b) => a.position_id.localeCompare(b.position_id,'th'));
  }

  function renderPositions() {
    const rows = filteredPositions();
    const cadres = [...new Set(state.positions.map(p=>p.cadre_group))].sort();
    byId('view-positions').innerHTML = [
      '<div class="mb-4 flex flex-wrap items-end justify-between gap-3">',
      ' <div><h1 class="text-xl font-black">Position Management</h1><p class="text-sm text-slate-500">ค้นหา แก้ไข milestone ดู timeline และ export ข้อมูล</p></div>',
      ' <div class="flex gap-2">',
      '  <button id="exportCsvBtn" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50">⬇ CSV</button>',
      canCreate()?'<button id="createPositionBtn" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">＋ เพิ่มตำแหน่ง</button>':'',
      ' </div>',
      '</div>',
      '<div class="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">',
      ' <div class="grid gap-2 md:grid-cols-6">',
      selectField('filterProvince','จังหวัด','<option value="">ทั้งหมด</option>'+state.provinces.map(p=>'<option value="'+esc(p.province_code)+'">'+esc(p.province_name_th)+'</option>').join(''),ui.filters.province),
      selectField('filterCadre','สายงาน','<option value="">ทั้งหมด</option>'+cadres.map(x=>'<option>'+esc(x)+'</option>').join(''),ui.filters.cadre),
      selectField('filterMilestone','Milestone','<option value="">ทั้งหมด</option>'+state.milestones.map(m=>'<option>'+esc(m.milestone_code)+'</option>').join(''),ui.filters.milestone),
      selectField('filterSla','SLA','<option value="">ทั้งหมด</option><option value="NORMAL">ปกติ</option><option value="WARNING">ใกล้ครบ</option><option value="BREACHED">เกิน SLA</option>',ui.filters.sla),
      '  <label class="md:col-span-2 text-xs text-slate-500">ค้นหา<input id="filterQ" value="'+esc(ui.filters.q)+'" placeholder="เลขตำแหน่ง / หน่วยงาน / ชื่อตำแหน่ง..." class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"></label>',
      ' </div>',
      '</div>',
      '<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">',
      ' <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-xs text-slate-500"><span>พบ <b class="text-slate-800">'+rows.length+'</b> รายการ</span><span>'+esc(roleName(ui.role))+'</span></div>',
      positionTable(rows),
      '</div>'
    ].join('');

    bindFilters();
    if (byId('createPositionBtn')) byId('createPositionBtn').onclick = () => openPositionModal();
    byId('exportCsvBtn').onclick = () => exportCsv(rows);
    bindPositionButtons();
  }

  function selectField(id,label,options,value) {
    return '<label class="text-xs text-slate-500">'+label+'<select id="'+id+'" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500">'+options+'</select></label>';
  }

  function retirementStatus(p) {
    if (!isRetirementReason(p.vacant_reason)) return '<span class="text-slate-600">'+esc(p.vacant_reason || '-')+'</span>';
    if (p.retirement_use_approved) {
      return '<span class="font-semibold text-emerald-700">☑ บค.สป. อนุมัติแล้ว</span>'
        +'<span class="block text-[10px] text-slate-500">หนังสือ '+esc(p.retirement_approval_doc_no || '-')+'</span>'
        +'<span class="block text-[10px] text-slate-500">ใช้ได้ตั้งแต่ '+esc(p.retirement_use_from_date || '-')+'</span>';
    }
    return '<span class="font-semibold text-amber-700">☐ รอ บค.สป. อนุมัติ</span><span class="block text-[10px] text-slate-500">ตำแหน่งเกษียณอายุราชการ</span>';
  }

  function positionTable(rows) {
    if (!rows.length) return '<div class="p-8 text-center text-sm text-slate-400">ไม่พบข้อมูลตามเงื่อนไข</div>';
    return '<div class="overflow-x-auto"><table class="min-w-[1500px] w-full text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr>'
      +'<th class="p-3">เลขตำแหน่ง</th><th class="p-3">จังหวัด / หน่วยงาน</th><th class="p-3">ชื่อตำแหน่ง</th><th class="p-3">ระดับตำแหน่ง</th><th class="p-3">ประเภท</th><th class="p-3">เหตุที่ว่าง / สิทธิ์ใช้</th><th class="p-3">Stage</th><th class="p-3">Aging</th><th class="p-3">SLA</th><th class="p-3">Bottleneck</th><th class="p-3">HROPS</th><th class="p-3 text-right">Action</th></tr></thead><tbody>'
      + rows.map(p => {
        const editable = canEdit(p);
        return '<tr class="border-t border-slate-100 hover:bg-slate-50/80">'
          +'<td class="p-3 font-mono font-bold">'+esc(p.position_id)+'</td>'
          +'<td class="p-3"><b>'+esc(p.province_name_th)+'</b><span class="block text-slate-500">'+esc(p.unit_name)+' • '+esc(p.unit_type_label)+'</span></td>'
          +'<td class="p-3"><b>'+esc(p.position_name_th)+'</b><span class="block text-slate-500">'+esc(p.specialist_name||'ทั่วไป')+'</span></td>'
          +'<td class="p-3 font-semibold text-slate-700">'+esc(p.position_level || '-')+'</td>'
          +'<td class="p-3">'+esc(p.cadre_group)+'<span class="block text-slate-500">'+esc(p.employment_type)+'</span></td>'
          +'<td class="p-3 min-w-[190px]">'+retirementStatus(p)+'</td>'
          +'<td class="p-3"><span class="rounded-full bg-indigo-100 px-2 py-1 font-bold text-indigo-700">'+esc(p.current_milestone)+'</span></td>'
          +'<td class="p-3">'+p.days_in_stage+' วัน</td>'
          +'<td class="p-3">'+badge(p.sla_status)+'<span class="mt-1 block text-[10px] text-slate-400">'+(p.days_left<0?'เกิน '+Math.abs(p.days_left):'เหลือ '+p.days_left)+' วัน</span></td>'
          +'<td class="max-w-[230px] p-3"><span title="'+esc(p.remarks||'')+'">'+esc(p.bottleneck_name)+'</span></td>'
          +'<td class="p-3">'+(Number(p.hrops_synced)?'<span class="font-semibold text-emerald-600">✓ ปรับแล้ว</span>':'<span class="text-slate-400">ยังไม่ปรับ</span>')+'</td>'
          +'<td class="p-3 text-right"><div class="flex justify-end gap-1"><button data-id="'+esc(p.position_id)+'" class="timeline-pos rounded-lg border border-slate-200 px-2 py-1 hover:bg-white">Timeline</button><button data-id="'+esc(p.position_id)+'" class="open-pos rounded-lg '+(editable?'bg-emerald-600 text-white':'border border-slate-200 text-slate-600')+' px-2 py-1">'+(editable?'จัดการ':'ดู')+'</button></div></td>'
          +'</tr>';
      }).join('')
      +'</tbody></table></div>';
  }

  function bindFilters() {
    const map = [
      ['filterProvince','province'],['filterCadre','cadre'],['filterMilestone','milestone'],['filterSla','sla']
    ];
    map.forEach(([id,key]) => {
      const el = byId(id); if (!el) return; el.value = ui.filters[key] || '';
      el.onchange = () => { ui.filters[key] = el.value; persist(); renderPositions(); };
    });
    const q = byId('filterQ');
    if (q) q.oninput = () => { ui.filters.q = q.value; persist(); clearTimeout(q.timer); q.timer=setTimeout(renderPositions,120); };
  }

  function bindPositionButtons() {
    document.querySelectorAll('.open-pos').forEach(btn => btn.onclick = () => openPositionModal(btn.dataset.id));
    document.querySelectorAll('.timeline-pos').forEach(btn => btn.onclick = () => openTimeline(btn.dataset.id));
  }

  function renderAnalytics() {
    const rows = scopedPositions();
    const active = rows.filter(p=>p.current_milestone!=='M6');
    const aging = [
      {label:'0–30 วัน', count:active.filter(p=>p.days_in_stage<=30).length},
      {label:'31–60 วัน', count:active.filter(p=>p.days_in_stage>=31&&p.days_in_stage<=60).length},
      {label:'>60 วัน', count:active.filter(p=>p.days_in_stage>60).length}
    ];
    const bns = state.bottlenecks.map(b => ({...b,count:active.filter(p=>Number(p.bottleneck_tag_id)===Number(b.tag_id)).length})).sort((a,b)=>b.count-a.count);
    const provinces = state.provinces.map(pr => {
      const r=active.filter(p=>p.province_code===pr.province_code);
      return {name:pr.province_name_th,total:r.length,breached:r.filter(p=>p.sla_status==='BREACHED').length,warning:r.filter(p=>p.sla_status==='WARNING').length};
    }).filter(x=>x.total);
    const maxBn = Math.max(1,...bns.map(x=>x.count));

    byId('view-analytics').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black">Analytics & Bottleneck Intelligence</h1><p class="text-sm text-slate-500">คำนวณจาก dataset ใน browser โดยตรง จึงใช้งานได้บน GitHub Pages</p></div>',
      '<div class="grid gap-4 md:grid-cols-3">',
      aging.map((a,i)=>metricCard('Aging '+a.label,a.count,'ตำแหน่งที่ยังไม่ปิด M6',i===2?'text-rose-600':'text-slate-900')).join(''),
      '</div>',
      '<div class="mt-5 grid gap-5 xl:grid-cols-2">',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">Bottleneck Ranking</h2>'
        +bns.map(b=>'<div class="mb-3"><div class="mb-1 flex justify-between text-xs"><span>'+esc(b.tag_name)+' <span class="text-slate-400">('+esc(b.severity_level)+')</span></span><b>'+b.count+'</b></div><div class="h-2.5 rounded-full bg-slate-100"><div class="h-2.5 rounded-full bg-indigo-600" style="width:'+Math.round(b.count/maxBn*100)+'%"></div></div></div>').join('')
        +'</div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">SLA by Province</h2>'
        +provinces.map(p=>'<div class="mb-3 rounded-xl border border-slate-100 p-3"><div class="flex justify-between text-xs"><b>'+esc(p.name)+'</b><span>WIP '+p.total+'</span></div><div class="mt-2 flex gap-2 text-[11px]"><span class="rounded-full bg-rose-100 px-2 py-1 text-rose-700">เกิน '+p.breached+'</span><span class="rounded-full bg-amber-100 px-2 py-1 text-amber-700">ใกล้ครบ '+p.warning+'</span><span class="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">ปกติ '+Math.max(0,p.total-p.breached-p.warning)+'</span></div></div>').join('')
        +'</div>',
      '</div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">Milestone × SLA Matrix</h2>'
        +'<div class="overflow-x-auto"><table class="min-w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Milestone</th><th class="p-3">ทั้งหมด</th><th class="p-3">ปกติ</th><th class="p-3">ใกล้ครบ</th><th class="p-3">เกิน SLA</th></tr></thead><tbody>'
        +state.milestones.map(m=>{const r=rows.filter(p=>p.current_milestone===m.milestone_code);return '<tr class="border-t border-slate-100"><td class="p-3"><b>'+esc(m.milestone_code)+'</b> '+esc(m.milestone_name_th)+'</td><td class="p-3 text-center">'+r.length+'</td><td class="p-3 text-center text-emerald-600">'+r.filter(p=>p.sla_status==='NORMAL').length+'</td><td class="p-3 text-center text-amber-600">'+r.filter(p=>p.sla_status==='WARNING').length+'</td><td class="p-3 text-center text-rose-600">'+r.filter(p=>p.sla_status==='BREACHED').length+'</td></tr>'}).join('')
        +'</tbody></table></div></div>'
    ].join('');
  }

  function escalationLevel(p) {
    if (p.bottleneck_severity === 'HIGH' || ['ส่วนกลาง','นโยบายเขต'].includes(p.bottleneck_category)) return 'จังหวัด → เขต 1';
    return 'CHRO จังหวัด';
  }

  function latestGovNote(positionId) {
    return [...(state.governance_notes||[])].filter(n=>n.position_id===positionId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
  }

  function renderGovernance() {
    const queue = scopedPositions().filter(p=>p.current_milestone!=='M6'&&p.sla_status==='BREACHED').sort((a,b)=>a.days_left-b.days_left);
    byId('view-governance').innerHTML = [
      '<div class="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-xl font-black">Governance & Escalation Queue</h1><p class="text-sm text-slate-500">เตรียม agenda สำหรับ CHRO จังหวัด/เขตจากรายการเกิน SLA</p></div><div class="rounded-xl bg-indigo-50 px-4 py-2 text-xs text-indigo-700">Monthly governance cycle: <b>วันที่ 25</b></div></div>',
      '<div class="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800"><b>Preview classification rule:</b> ทุก breach เข้า CHRO จังหวัด; รายการ bottleneck ระดับ HIGH / ส่วนกลาง / นโยบายเขต ถูก flag ต่อไปยังเขต 1 เพื่อทดลอง workflow — ไม่ใช่เกณฑ์นโยบายที่ประกาศใช้จริง</div>',
      '<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">',
      '<div class="border-b border-slate-100 px-5 py-4"><b>'+queue.length+' รายการต้องติดตาม</b></div>',
      queue.length?'<div class="overflow-x-auto"><table class="min-w-[1250px] w-full text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-3 text-left">ตำแหน่ง</th><th class="p-3 text-left">จังหวัด/หน่วยงาน</th><th class="p-3 text-left">SLA</th><th class="p-3 text-left">เหตุขัดข้อง</th><th class="p-3 text-left">Escalation</th><th class="p-3 text-left">Action ล่าสุด</th><th class="p-3 text-right">จัดการ</th></tr></thead><tbody>'
        +queue.map(p=>{const n=latestGovNote(p.position_id);return '<tr class="border-t border-slate-100"><td class="p-3"><b>'+esc(p.position_id)+'</b><span class="block">'+esc(p.position_name_th)+'</span></td><td class="p-3"><b>'+esc(p.province_name_th)+'</b><span class="block text-slate-500">'+esc(p.unit_name)+'</span></td><td class="p-3 text-rose-600"><b>เกิน '+Math.abs(p.days_left)+' วัน</b><span class="block text-slate-500">อยู่ขั้นนี้ '+p.days_in_stage+' วัน</span></td><td class="p-3">'+esc(p.bottleneck_name)+'<span class="block text-slate-500">'+esc(p.remarks||'')+'</span></td><td class="p-3"><span class="rounded-full bg-indigo-100 px-2 py-1 font-semibold text-indigo-700">'+esc(escalationLevel(p))+'</span></td><td class="p-3">'+(n?'<b>'+esc(n.status)+'</b><span class="block text-slate-500">'+esc(n.note)+'</span>':'<span class="text-slate-400">ยังไม่มี action note</span>')+'</td><td class="p-3 text-right">'+(ui.role==='executive'?'<span class="text-slate-400">View only</span>':'<button data-id="'+esc(p.position_id)+'" class="gov-action rounded-lg bg-indigo-600 px-2 py-1 text-white">Action note</button>')+'</td></tr>'}).join('')
        +'</tbody></table></div>'
        :'<div class="p-8 text-center text-slate-400">ไม่มีรายการเกิน SLA</div>',
      '</div>'
    ].join('');
    document.querySelectorAll('.gov-action').forEach(btn=>btn.onclick=()=>openGovernanceModal(btn.dataset.id));
  }

  function renderAdmin() {
    const s = summary(scopedPositions());
    const localBytes = new Blob([JSON.stringify(state)]).size;
    byId('view-admin').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black">Admin, Role Simulation & Data Status</h1><p class="text-sm text-slate-500">ตรวจสอบ source, permission และ lifecycle ของ preview dataset</p></div>',
      '<div class="grid gap-5 xl:grid-cols-3">',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Data status</h2><div class="mt-4 space-y-3 text-sm">'
        +statusLine('Preview version',state.meta.version||'2.0.0','ok')
        +statusLine('Seed snapshot',state.meta.snapshot_date,'ok')
        +statusLine('Browser local persistence',localStorage.getItem(STORAGE_KEY)?'Active':'Seed only','ok')
        +statusLine('Google Sheets live sync','Not connected','warn')
        +statusLine('HROPS integration','Not connected','warn')
        +statusLine('Production authentication','Not enabled','warn')
        +'</div></div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Dataset</h2><div class="mt-4 grid grid-cols-2 gap-3">'
        +metricMini('Positions',state.positions.length)+metricMini('History events',state.history.length)+metricMini('Units',state.units.length)+metricMini('Governance notes',(state.governance_notes||[]).length)
        +'</div><div class="mt-4 text-xs text-slate-500">Local payload ~'+Math.round(localBytes/1024)+' KB • WIP '+s.active+' • SLA breached '+s.breached+'</div></div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Role capability</h2><div class="mt-4 text-sm"><b>'+esc(roleName(ui.role))+'</b><p class="mt-2 text-xs text-slate-500">'+esc(permissionText())+'</p></div></div>',
      '</div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Preview data controls</h2><p class="mt-1 text-xs text-slate-500">Export JSON เก็บ state ทั้งหมดรวม audit/governance notes; Import เพื่อ restore ใน browser เครื่องนี้</p><div class="mt-4 flex flex-wrap gap-2">'
        +'<button id="adminExportJson" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">⬇ Export JSON backup</button>'
        +(ui.role==='reg_admin'?'<button id="adminImportJson" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">⬆ Import JSON</button>':'')
        +'<button id="adminExportCsv" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">⬇ Export current CSV</button>'
        +(ui.role==='reg_admin'?'<button id="adminReset" class="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white">Reset to seed</button>':'')
        +'</div></div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Master data summary</h2><div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">'
        +state.milestones.map(m=>'<div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"><b>'+esc(m.milestone_code)+' • SLA '+m.default_sla_days+' วัน</b><p class="mt-1 text-slate-500">'+esc(m.milestone_name_th)+'</p></div>').join('')
        +'</div></div>'
    ].join('');

    byId('adminExportJson').onclick = exportJson;
    if (byId('adminImportJson')) byId('adminImportJson').onclick = () => byId('importJsonInput').click();
    byId('adminExportCsv').onclick = () => exportCsv(filteredPositions());
    if (byId('adminReset')) byId('adminReset').onclick = resetData;
  }

  function statusLine(label,value,tone) {
    return '<div class="flex items-center justify-between gap-3"><span class="text-slate-500">'+esc(label)+'</span><span class="font-semibold '+(tone==='warn'?'text-amber-600':'text-emerald-600')+'">'+esc(value)+'</span></div>';
  }
  function metricMini(label,value){return '<div class="rounded-xl bg-slate-50 p-3"><div class="text-2xl font-black">'+esc(value)+'</div><div class="text-xs text-slate-500">'+esc(label)+'</div></div>';}

  function permissionText() {
    if (ui.role==='executive') return 'ดูข้อมูลและ analytics ได้ทั้งหมด แต่ไม่สามารถแก้ไข';
    if (ui.role==='reg_admin') return 'ดู/เพิ่ม/แก้ไข/ลบทุกตำแหน่ง และ reset/import ข้อมูล preview';
    if (ui.role==='prov_gatekeeper') return 'แก้ไขและเพิ่มข้อมูลได้เฉพาะจังหวัดที่เลือก';
    return 'แก้ไขและเพิ่มข้อมูลได้เฉพาะหน่วยงานที่เลือก';
  }

  function openPositionModal(id) {
    selectedPositionId = id || null;
    const existing = id ? enrich(state.positions.find(p=>p.position_id===id)) : null;
    const editable = existing ? canEdit(existing) : canCreate();
    modalMode = id ? 'position-edit' : 'position-create';
    const defaultUnit = ui.role==='hosp_operator' ? ui.scope : (ui.role==='prov_gatekeeper' ? (state.units.find(u=>u.province_code===ui.scope)||state.units[0]).unit_id : state.units[0].unit_id);
    const p = existing || {
      position_id:'', unit_id:defaultUnit, position_name_th:'', position_level:'', cadre_group:'แพทย์', specialist_name:'',
      employment_type:'ข้าราชการ', vacant_date:todayISO(), vacant_reason:'ลาออก', management_channel:'รับย้าย',
      current_milestone:'M1', milestone_entry_date:todayISO(), sla_days:15, bottleneck_tag_id:8, hrops_synced:0, remarks:'',
      retirement_use_approved:false, retirement_approval_doc_no:'', retirement_use_from_date:''
    };
    const allowedUnits = state.units.filter(u=>{
      if (ui.role==='prov_gatekeeper') return u.province_code===ui.scope;
      if (ui.role==='hosp_operator') return u.unit_id===ui.scope;
      return true;
    });
    byId('modalRoot').innerHTML = modalShell(
      id ? 'รายละเอียด / อัปเดตตำแหน่ง '+esc(id) : 'เพิ่มตำแหน่งเข้าสู่ Pipeline',
      '<form id="positionForm" class="grid gap-3 md:grid-cols-2">'
      +inputText('fPositionId','เลขตำแหน่ง',p.position_id,id?'readonly':'required')
      +selectHtml('fUnit','หน่วยงาน',allowedUnits.map(u=>'<option value="'+esc(u.unit_id)+'">'+esc(u.unit_name)+' • '+esc(u.unit_type_label)+'</option>').join(''),p.unit_id)
      +inputText('fPositionName','ชื่อตำแหน่ง (HROPS)',p.position_name_th,'required')
      +'<label class="text-xs text-slate-500">ระดับตำแหน่ง (HROPS)<input id="fPositionLevel" list="positionLevelList" value="'+esc(p.position_level||'')+'" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"><datalist id="positionLevelList">'+POSITION_LEVELS.map(x=>'<option value="'+esc(x)+'"></option>').join('')+'</datalist></label>'
      +inputText('fSpecialist','สาขา/ความเชี่ยวชาญ',p.specialist_name||'','')
      +selectHtml('fCadre','กลุ่มสายงาน',['แพทย์','พยาบาล','เภสัชกร','ทันตแพทย์','นักวิชาการสาธารณสุข','สายสนับสนุน'].map(x=>'<option>'+x+'</option>').join(''),p.cadre_group)
      +selectHtml('fEmployment','ประเภทบุคลากร',['ข้าราชการ','พกส.','พรก.'].map(x=>'<option>'+x+'</option>').join(''),p.employment_type)
      +inputText('fVacantDate','วันที่ตำแหน่งว่าง',p.vacant_date,'type="date"')
      +selectHtml('fVacantReason','เหตุที่ว่าง',['เกษียณอายุราชการ','ลาออก','ย้าย','เสียชีวิต','ตำแหน่งใหม่'].map(x=>'<option>'+x+'</option>').join(''),p.vacant_reason)
      +'<div id="retirementApprovalBlock" class="hidden rounded-xl border border-amber-200 bg-amber-50 p-3 md:col-span-2">'
      +' <label class="flex items-center gap-2 text-sm font-semibold text-amber-900"><input id="fRetirementApproved" type="checkbox" class="h-4 w-4" '+(p.retirement_use_approved?'checked':'')+'> บค.สป. อนุมัติให้ใช้ตำแหน่งเกษียณอายุราชการแล้ว</label>'
      +' <p class="mt-1 text-xs text-amber-700">ก่อนอนุมัติให้ถือว่ายังรอสิทธิ์ใช้ตำแหน่ง เมื่อได้รับหนังสือให้บันทึกเลขหนังสือและวันที่เริ่มใช้ได้</p>'
      +' <div id="retirementApprovalDetails" class="mt-3 grid gap-3 md:grid-cols-2">'
      +inputText('fRetirementDoc','เลขหนังสืออนุมัติ บค.สป.',p.retirement_approval_doc_no||'','')
      +inputText('fRetirementUseFrom','ใช้ตำแหน่งได้ตั้งแต่วันที่',p.retirement_use_from_date||'','type="date"')
      +' </div></div>'
      +selectHtml('fChannel','ช่องทางการบริหาร',['รับย้าย','เลื่อนระดับ','เรียกบัญชี สป.','สอบคัดเลือก','รับโอน'].map(x=>'<option>'+x+'</option>').join(''),p.management_channel)
      +selectHtml('fMilestone','Milestone',state.milestones.map(m=>'<option value="'+esc(m.milestone_code)+'">'+esc(m.milestone_code)+' • '+esc(m.milestone_name_th)+'</option>').join(''),p.current_milestone)
      +inputText('fStageDate','วันที่เข้าสู่ milestone',p.milestone_entry_date,'type="date"')
      +selectHtml('fBottleneck','Bottleneck',state.bottlenecks.map(b=>'<option value="'+b.tag_id+'">'+esc(b.tag_name)+'</option>').join(''),String(p.bottleneck_tag_id||8))
      +'<label class="md:col-span-2 text-xs text-slate-500">หมายเหตุ<textarea id="fRemarks" class="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-2 text-sm">'+esc(p.remarks||'')+'</textarea></label>'
      +'<label class="text-xs text-slate-500">เลขหนังสือ/เอกสารอ้างอิงกระบวนการ<input id="fRefDoc" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></label>'
      +'<label class="flex items-end gap-2 pb-2 text-xs text-slate-600"><input id="fHrops" type="checkbox" '+(Number(p.hrops_synced)?'checked':'')+'> ปรับปรุง HROPS แล้ว</label>'
      +'</form>',
      '<div class="flex flex-wrap justify-between gap-2"><div class="flex gap-2">'+(id?'<button id="timelineModalBtn" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Timeline</button>':'')+(id&&canDelete()?'<button id="deletePositionBtn" class="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-600">ลบ</button>':'')+'</div><div class="flex gap-2"><button class="modal-close rounded-lg border border-slate-300 px-3 py-2 text-xs">ปิด</button>'+(editable?'<button id="savePositionBtn" class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">บันทึก</button>':'')+'</div></div>'
    );
    setValue('fUnit',p.unit_id); setValue('fCadre',p.cadre_group); setValue('fEmployment',p.employment_type); setValue('fVacantReason',p.vacant_reason); setValue('fChannel',p.management_channel); setValue('fMilestone',p.current_milestone); setValue('fBottleneck',String(p.bottleneck_tag_id||8));
    syncRetirementFields();
    byId('fVacantReason').onchange = syncRetirementFields;
    byId('fRetirementApproved').onchange = syncRetirementFields;
    bindModalClose();
    if (byId('savePositionBtn')) byId('savePositionBtn').onclick = savePosition;
    if (byId('timelineModalBtn')) byId('timelineModalBtn').onclick = () => openTimeline(id);
    if (byId('deletePositionBtn')) byId('deletePositionBtn').onclick = () => deletePosition(id);
  }

  function syncRetirementFields() {
    const reason = byId('fVacantReason')?.value;
    const block = byId('retirementApprovalBlock');
    const details = byId('retirementApprovalDetails');
    const approved = byId('fRetirementApproved');
    if (!block || !details || !approved) return;
    const show = isRetirementReason(reason);
    block.classList.toggle('hidden', !show);
    details.classList.toggle('hidden', !show || !approved.checked);
  }

  function inputText(id,label,value,attrs='') {
    return '<label class="text-xs text-slate-500">'+label+'<input id="'+id+'" value="'+esc(value)+'" '+attrs+' class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"></label>';
  }

  function selectHtml(id,label,options,value) {
    return '<label class="text-xs text-slate-500">'+label+'<select id="'+id+'" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">'+options+'</select></label>';
  }

  function setValue(id,value){const el=byId(id); if(el) el.value=String(value??'');}

  function modalShell(title,body,footer) {
    return '<div class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-3"><div class="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div class="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4"><h2 class="font-black">'+title+'</h2><button class="modal-close text-xl text-slate-400">×</button></div><div class="p-5">'+body+'</div><div class="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">'+footer+'</div></div></div>';
  }

  function bindModalClose(){document.querySelectorAll('.modal-close').forEach(x=>x.onclick=closeModal);}
  function closeModal(){byId('modalRoot').innerHTML=''; modalMode=null; selectedPositionId=null;}

  function savePosition() {
    const id = byId('fPositionId').value.trim();
    if (!id) return toast('กรุณาระบุเลขตำแหน่ง');
    const unitId = byId('fUnit').value;
    const old = state.positions.find(p=>p.position_id===id);
    if (modalMode === 'position-create' && old) return toast('เลขตำแหน่งซ้ำ');
    if (modalMode === 'position-edit' && !old) return toast('ไม่พบตำแหน่งที่กำลังแก้ไข');
    const msCode = byId('fMilestone').value;
    const ms = milestone(msCode);
    const vacantReason = byId('fVacantReason').value;
    const isRetirement = isRetirementReason(vacantReason);
    const retirementApproved = isRetirement && byId('fRetirementApproved').checked;
    const retirementDoc = isRetirement ? byId('fRetirementDoc').value.trim() : '';
    const retirementUseFrom = isRetirement ? byId('fRetirementUseFrom').value : '';
    if (retirementApproved && !retirementDoc) return toast('กรุณาระบุเลขหนังสืออนุมัติ บค.สป.');
    if (retirementApproved && !retirementUseFrom) return toast('กรุณาระบุวันที่เริ่มใช้ตำแหน่งได้');
    const data = {
      position_id:id,
      unit_id:unitId,
      position_name_th:byId('fPositionName').value.trim(),
      position_level:byId('fPositionLevel').value.trim(),
      cadre_group:byId('fCadre').value,
      specialist_name:byId('fSpecialist').value.trim(),
      employment_type:byId('fEmployment').value,
      vacant_date:byId('fVacantDate').value,
      vacant_reason:vacantReason,
      retirement_use_approved:retirementApproved,
      retirement_approval_doc_no:retirementApproved ? retirementDoc : '',
      retirement_use_from_date:retirementApproved ? retirementUseFrom : '',
      management_channel:byId('fChannel').value,
      current_milestone:msCode,
      milestone_entry_date:byId('fStageDate').value,
      sla_days:Number(ms?.default_sla_days||30),
      bottleneck_tag_id:Number(byId('fBottleneck').value),
      hrops_synced:byId('fHrops').checked?1:0,
      remarks:byId('fRemarks').value.trim(),
      created_at:old?.created_at||nowISO(),
      updated_at:nowISO()
    };
    const actor = roleName(ui.role);
    const changedStage = Boolean(old && old.current_milestone!==data.current_milestone);
    const retirementChanged = Boolean(old && (
      Boolean(old.retirement_use_approved)!==Boolean(data.retirement_use_approved)
      || (old.retirement_approval_doc_no||'')!==data.retirement_approval_doc_no
      || (old.retirement_use_from_date||'')!==data.retirement_use_from_date
    ));
    if (old) {
      const idx=state.positions.findIndex(p=>p.position_id===id);
      state.positions[idx]=data;
      const approvalNote = retirementChanged
        ? (data.retirement_use_approved
            ? 'บค.สป. อนุมัติให้ใช้ตำแหน่งแล้ว • หนังสือ '+data.retirement_approval_doc_no+' • ใช้ได้ตั้งแต่ '+data.retirement_use_from_date
            : 'ปรับสถานะตำแหน่งเกษียณเป็นรอ บค.สป. อนุมัติ')
        : '';
      state.history.push({
        event_id:Date.now(),position_id:id,from_milestone:old.current_milestone,to_milestone:data.current_milestone,
        transition_date:data.milestone_entry_date+' 09:00:00',updated_by_user:actor,
        reference_doc_no:retirementChanged && data.retirement_use_approved ? data.retirement_approval_doc_no : (byId('fRefDoc').value.trim()||null),
        bottleneck_tag_id:data.bottleneck_tag_id,
        notes:approvalNote || data.remarks || (changedStage?'Milestone updated':'Position details updated'),
        event_type:retirementChanged?'retirement_approval':(changedStage?'transition':'update')
      });
    } else {
      state.positions.push(data);
      state.history.push({
        event_id:Date.now(),position_id:id,from_milestone:null,to_milestone:data.current_milestone,
        transition_date:data.milestone_entry_date+' 09:00:00',updated_by_user:actor,
        reference_doc_no:data.retirement_use_approved ? data.retirement_approval_doc_no : (byId('fRefDoc').value.trim()||null),
        bottleneck_tag_id:data.bottleneck_tag_id,
        notes:data.retirement_use_approved
          ? 'สร้างตำแหน่งพร้อมสถานะ บค.สป. อนุมัติ • ใช้ได้ตั้งแต่ '+data.retirement_use_from_date
          : (data.remarks||'Position created in preview'),
        event_type:'create'
      });
    }
    persist(); closeModal(); renderCurrent(); toast(old?'บันทึกการเปลี่ยนแปลงแล้ว':'เพิ่มตำแหน่งแล้ว');
  }

  function deletePosition(id) {
    if (ui.role!=='reg_admin') return;
    if (!confirm('ลบตำแหน่ง '+id+' ออกจาก preview หรือไม่?')) return;
    state.positions = state.positions.filter(p=>p.position_id!==id);
    state.history.push({event_id:Date.now(),position_id:id,from_milestone:null,to_milestone:null,transition_date:nowISO(),updated_by_user:roleName(ui.role),reference_doc_no:null,bottleneck_tag_id:null,notes:'Position deleted from preview',event_type:'delete'});
    persist(); closeModal(); renderCurrent(); toast('ลบตำแหน่งแล้ว');
  }

  function openTimeline(id) {
    const p = state.positions.find(x=>x.position_id===id);
    const events = state.history.filter(h=>h.position_id===id).sort((a,b)=>String(b.transition_date).localeCompare(String(a.transition_date)));
    byId('modalRoot').innerHTML = modalShell(
      'Audit Timeline • '+esc(id),
      '<div class="mb-4 rounded-xl bg-slate-50 p-3 text-sm"><b>'+esc(p?.position_name_th||'ตำแหน่งที่ถูกลบ')+'</b><span class="ml-2 text-slate-500">'+esc(p?.position_level||'')+'</span><span class="block text-xs text-slate-500">'+esc(p?enrich(p).unit_name:'')+'</span></div>'
      +(events.length?'<div class="space-y-3">'+events.map(h=>'<div class="relative rounded-xl border border-slate-200 p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><span class="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700">'+esc(h.event_type||'event')+'</span> <b class="ml-2">'+esc(h.from_milestone||'START')+' → '+esc(h.to_milestone||'-')+'</b></div><span class="text-xs text-slate-400">'+esc(h.transition_date)+'</span></div><div class="mt-2 text-sm text-slate-700">'+esc(h.notes||'-')+'</div><div class="mt-2 text-xs text-slate-500">โดย '+esc(h.updated_by_user||'-')+(h.reference_doc_no?' • เอกสาร '+esc(h.reference_doc_no):'')+'</div></div>').join('')+'</div>':'<div class="text-sm text-slate-400">ยังไม่มีประวัติ</div>'),
      '<div class="flex justify-end"><button class="modal-close rounded-lg border border-slate-300 px-3 py-2 text-xs">ปิด</button></div>'
    );
    bindModalClose();
  }

  function openGovernanceModal(id) {
    const p = enrich(state.positions.find(x=>x.position_id===id));
    const latest = latestGovNote(id);
    byId('modalRoot').innerHTML = modalShell(
      'Governance action • '+esc(id),
      '<div class="rounded-xl bg-slate-50 p-4 text-sm"><b>'+esc(p.position_name_th)+'</b><span class="block text-xs text-slate-500">'+esc(p.province_name_th)+' • '+esc(p.unit_name)+' • เกิน SLA '+Math.abs(p.days_left)+' วัน</span></div>'
      +'<div class="mt-4 grid gap-3 md:grid-cols-2">'+selectHtml('govStatus','สถานะ action','<option>Open</option><option>In progress</option><option>Waiting external</option><option>Resolved</option>',latest?.status||'Open')+inputText('govOwner','ผู้รับผิดชอบ',latest?.owner||roleName(ui.role),'')+'</div>'
      +'<label class="mt-3 block text-xs text-slate-500">Action / มติ / next step<textarea id="govNote" class="mt-1 min-h-28 w-full rounded-lg border border-slate-300 p-3 text-sm">'+esc(latest?.note||'')+'</textarea></label>',
      '<div class="flex justify-end gap-2"><button class="modal-close rounded-lg border border-slate-300 px-3 py-2 text-xs">ปิด</button><button id="saveGovBtn" class="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">บันทึก action</button></div>'
    );
    setValue('govStatus',latest?.status||'Open'); bindModalClose();
    byId('saveGovBtn').onclick=()=>{
      state.governance_notes.push({id:Date.now(),position_id:id,status:byId('govStatus').value,owner:byId('govOwner').value.trim(),note:byId('govNote').value.trim(),created_at:nowISO(),created_by:roleName(ui.role)});
      persist(); closeModal(); renderGovernance(); toast('บันทึก Governance action แล้ว');
    };
  }

  function exportCsv(rows) {
    const headers = ['เลขตำแหน่ง','จังหวัด','หน่วยงาน','ประเภทหน่วยงาน','กลุ่มสายงาน','ชื่อตำแหน่ง','ระดับตำแหน่ง','สาขา','ประเภทบุคลากร','เหตุที่ว่าง','บค.สป.อนุมัติให้ใช้','เลขหนังสืออนุมัติ บค.สป.','ใช้ได้ตั้งแต่วันที่','Milestone','วันที่เข้าสู่สถานะ','วันในสถานะ','SLA Status','Bottleneck','HROPS','หมายเหตุ'];
    const quote = (v) => '"'+String(v??'').replace(/"/g,'""')+'"';
    const lines = [headers.map(quote).join(',')].concat(rows.map(p=>[
      p.position_id,p.province_name_th,p.unit_name,p.unit_type_label,p.cadre_group,p.position_name_th,p.position_level,p.specialist_name,p.employment_type,p.vacant_reason,
      isRetirementReason(p.vacant_reason)?(p.retirement_use_approved?'YES':'NO'):'N/A',
      p.retirement_approval_doc_no,p.retirement_use_from_date,
      p.current_milestone,p.milestone_entry_date,p.days_in_stage,p.sla_status,p.bottleneck_name,p.hrops_synced?'YES':'NO',p.remarks
    ].map(quote).join(',')));
    downloadBlob('\uFEFF'+lines.join('\n'),'CHRO_HR1_preview_v2_'+todayISO()+'.csv','text/csv;charset=utf-8');
  }

  function exportJson() {
    downloadBlob(JSON.stringify(state,null,2),'CHRO_HR1_preview_v2_backup_'+todayISO()+'.json','application/json');
  }

  function downloadBlob(content,name,type) {
    const blob = new Blob([content],{type});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.positions) || !Array.isArray(parsed.units) || !Array.isArray(parsed.milestones)) throw new Error('invalid');
        parsed.meta = parsed.meta || {}; parsed.meta.last_local_update=nowISO();
        state = migrateState(parsed); persist(); normalizeScope(); renderHeaderState(); renderCurrent(); toast('Import JSON สำเร็จ');
      } catch (_) { alert('ไฟล์ JSON ไม่ใช่ CHRO HR1 preview backup ที่ถูกต้อง'); }
      byId('importJsonInput').value='';
    };
    reader.readAsText(file);
  }

  function resetData() {
    if (!confirm('Reset preview กลับเป็น seed 22 ตำแหน่ง และลบ local changes ทั้งหมดหรือไม่?')) return;
    state=migrateState(seed); persist(); normalizeScope(); renderHeaderState(); renderCurrent(); toast('Reset กลับ seed แล้ว');
  }

  function renderHeaderState() {
    normalizeScope();
    byId('roleSelector').value=ui.role;
    byId('scopeSelector').innerHTML=scopeOptions();
    byId('scopeSelector').value=ui.scope;
    byId('scopeSelector').disabled=['executive','reg_admin'].includes(ui.role);
    byId('rolePermission').textContent=permissionText();
  }

  function bindGlobal() {
    document.querySelectorAll('.tab-btn').forEach(btn=>btn.onclick=()=>setTab(btn.dataset.tab));
    byId('roleSelector').onchange=()=>{
      ui.role=byId('roleSelector').value;
      if(ui.role==='prov_gatekeeper') ui.scope='57';
      else if(ui.role==='hosp_operator') ui.scope='U5701';
      else ui.scope='ALL';
      ui.filters={province:'',cadre:'',milestone:'',sla:'',q:''};
      persist(); renderHeaderState(); renderCurrent();
    };
    byId('scopeSelector').onchange=()=>{ui.scope=byId('scopeSelector').value; ui.filters={province:'',cadre:'',milestone:'',sla:'',q:''}; persist(); renderCurrent();};
    byId('importJsonInput').onchange=(e)=>{const f=e.target.files?.[0]; if(f) importJson(f);};
  }

  layout();
  normalizeScope();
  renderHeaderState();
  bindGlobal();
  setTab(ui.tab || 'overview');
})();