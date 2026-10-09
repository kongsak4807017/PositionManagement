(() => {
  'use strict';

  const STORAGE_KEY = 'chro_hr1_unified_j18_workflow_v1';
  const UI_KEY = 'chro_hr1_unified_j18_workflow_ui_v1';
  const seed = window.CHRO_V2_SEED;
  const j18Compact = window.CHRO_J18_BASELINE_COMPACT || null;
  const baselineFilters = {province:'', employment:'', q:''};
  let baselinePage = 1;
  let positionPage = 1;

  function inflateJ18(compact) {
    if (!compact || !Array.isArray(compact.fields) || !Array.isArray(compact.rows)) return null;
    const fields = compact.fields;
    return {
      meta: compact.meta || {},
      province_summary: compact.province_summary || [],
      vacancies: compact.rows.map(row => Object.fromEntries(fields.map((key, i) => [key, row[i] ?? null])))
    };
  }
  const j18Baseline = inflateJ18(j18Compact);
  const baselineByNo = new Map((j18Baseline?.vacancies || []).map(r => [String(r.hrops_position_no || ''), r]));
  const baselineUnitMap = new Map();
  (j18Baseline?.vacancies || []).forEach(r => {
    const id = String(r.unit_id || '');
    if (!id || baselineUnitMap.has(id)) return;
    baselineUnitMap.set(id, {
      unit_id:id,
      unit_name:(String(r.unit_prefix || '') + String(r.unit_name || '')).trim() || id,
      unit_type_label:r.unit_type || r.unit_prefix || 'HROPS',
      province_code:r.province_code || '',
      province_name_th:r.province_name || '',
      amphur_name:r.amphur_name || ''
    });
  });

  function baselineRow(positionId) {
    return baselineByNo.get(String(positionId || '')) || null;
  }

  function baselineUnits() {
    return [...baselineUnitMap.values()].sort((a,b) =>
      String(a.province_code).localeCompare(String(b.province_code),'th') ||
      String(a.unit_name).localeCompare(String(b.unit_name),'th')
    );
  }

  function scopedBaselineVacancies() {
    const rows = j18Baseline?.vacancies || [];
    if (ui?.role === 'prov_gatekeeper') return rows.filter(r => r.province_code === ui.scope);
    if (ui?.role === 'hosp_operator') return rows.filter(r => String(r.unit_id) === String(ui.scope));
    return rows;
  }

  function employmentSummary(rows = scopedBaselineVacancies()) {
    const preferred = ['ข้าราชการ','พนักงานกระทรวง','ลูกจ้างชั่วคราว','พนักงานราชการ','ลูกจ้างประจำ'];
    const counts = Object.fromEntries(preferred.map(k => [k,0]));
    rows.forEach(r => {
      const key = String(r.employment_type || 'ไม่ระบุ');
      counts[key] = (counts[key] || 0) + 1;
    });
    return preferred.map(label => ({label, count:counts[label] || 0}));
  }

  function workflowMap() {
    return new Map((state?.positions || [])
      .filter(p => baselineByNo.has(String(p.position_id)))
      .map(p => [String(p.position_id), p]));
  }

  function masterRows() {
    const ops = workflowMap();
    return scopedBaselineVacancies().map(r => {
      const op = ops.get(String(r.hrops_position_no)) || null;
      return {
        ...r,
        position_id:String(r.hrops_position_no || ''),
        workflow_started:Boolean(op),
        workflow:op ? enrich(op) : null
      };
    });
  }
  if (!seed) {
    document.body.innerHTML = '<div style="padding:2rem;font-family:sans-serif">CHRO HR1 seed data failed to load.</div>';
    return;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  const POSITION_LEVELS = ['ปฏิบัติงาน','ชำนาญงาน','อาวุโส','ปฏิบัติการ','ชำนาญการ','ชำนาญการพิเศษ','เชี่ยวชาญ','ทรงคุณวุฒิ'];
  const PROCESS_LEVELS = [
    {code:'PROVINCE', label:'ระดับจังหวัด'},
    {code:'REGION', label:'ระดับเขต'},
    {code:'MOPH', label:'ระดับ สป.'},
    {code:'DONE', label:'เสร็จสิ้น'}
  ];
  const PROCESS_STATUSES = [
    {level:'PROVINCE', value:'บค.สสจ. ตรวจสอบ'},
    {level:'PROVINCE', value:'CHRO จังหวัด พิจารณา'},
    {level:'REGION', value:'CHRO เขต พิจารณา'},
    {level:'MOPH', value:'อนุมัติ บรรจุผู้สอบแข่งขัน'},
    {level:'MOPH', value:'อนุมัติ บรรจุผู้ได้รับคัดเลือก'},
    {level:'MOPH', value:'อนุมัติ ปรับปรุง'},
    {level:'MOPH', value:'อนุมัติ ยุบกำหนดตำแหน่งสูงขึ้น'},
    {level:'MOPH', value:'อนุมัติ รับย้าย (ระบุชื่อ)'},
    {level:'MOPH', value:'อนุมัติ รับโอน (ระบุชื่อ)'},
    {level:'MOPH', value:'อนุมัติ รับย้าย/รับโอน'},
    {level:'MOPH', value:'อนุมัติ เลื่อน'},
    {level:'MOPH', value:'อนุมัติ เกลี่ย'},
    {level:'MOPH', value:'อนุมัติ เปลี่ยนตำแหน่ง'},
    {level:'MOPH', value:'อนุมัติ เปลี่ยนประเภทการจ้าง'},
    {level:'MOPH', value:'อนุมัติ จ้างทดแทน'},
    {level:'MOPH', value:'อื่นๆ'},
    {level:'DONE', value:'ดำเนินการเสร็จสิ้น'}
  ];

  function inferProcessLevel(p) {
    if (p.current_milestone === 'M6') return 'DONE';
    if (p.current_milestone === 'M1') return 'PROVINCE';
    if (p.current_milestone === 'M2') return 'REGION';
    return 'MOPH';
  }

  function inferProcessStatus(p) {
    const level = inferProcessLevel(p);
    if (level === 'DONE') return 'ดำเนินการเสร็จสิ้น';
    if (level === 'PROVINCE') return 'บค.สสจ. ตรวจสอบ';
    if (level === 'REGION') return 'CHRO เขต พิจารณา';
    const channel = String(p.management_channel || '');
    if (channel.includes('รับย้าย')) return 'อนุมัติ รับย้าย (ระบุชื่อ)';
    if (channel.includes('รับโอน')) return 'อนุมัติ รับโอน (ระบุชื่อ)';
    if (channel.includes('เลื่อน')) return 'อนุมัติ เลื่อน';
    if (channel.includes('สอบคัดเลือก')) return 'อนุมัติ บรรจุผู้ได้รับคัดเลือก';
    if (channel.includes('บัญชี')) return 'อนุมัติ บรรจุผู้สอบแข่งขัน';
    return 'อื่นๆ';
  }

  function processLevelLabel(code) {
    return PROCESS_LEVELS.find(x => x.code === code)?.label || code || '-';
  }

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
    next.meta.version = '3.0.0';
    next.governance_notes = next.governance_notes || [];
    next.history = next.history || [];

    if (!next.meta.unified_j18_workflow) {
      // Previous GitHub Pages releases used a demo workflow dataset. Under the
      // unified model, operational cases are created only from real J.18 vacancies.
      next.positions = [];
      next.history = [];
      next.governance_notes = [];
      next.meta.unified_j18_workflow = true;
    }

    next.positions = (next.positions || [])
      .filter(p => baselineByNo.has(String(p.position_id || '')))
      .map(p => {
        const split = splitLegacyPositionName(p.position_name_th, p.position_level);
        const base = baselineRow(p.position_id);
        return {
          ...p,
          unit_id:base?.unit_id || p.unit_id,
          position_name_th:base?.position_name || split.name,
          position_level:base?.position_level || split.level,
          specialist_name:base?.specialist_name || p.specialist_name || '',
          employment_type:base?.employment_type || p.employment_type,
          vacant_date:base?.vacancy_date || p.vacant_date,
          vacant_reason:base?.vacancy_reason || p.vacant_reason,
          cadre_group:base?.position_type || p.cadre_group || 'ไม่ระบุ',
          retirement_use_approved:Boolean(p.retirement_use_approved),
          retirement_approval_doc_no:p.retirement_approval_doc_no || '',
          retirement_use_from_date:p.retirement_use_from_date || '',
          process_level:p.process_level || inferProcessLevel(p),
          process_status:p.process_status || inferProcessStatus(p),
          process_detail:p.process_detail || '',
          process_updated_at:p.process_updated_at || p.updated_at || nowISO()
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
      tab: 'baseline',
      role: 'hosp_operator',
      scope: 'U5701',
      filters: {province:'', employment:'', workflow:'', milestone:'', sla:'', process_level:'', process_status:'', q:''}
    };
  }

  let state = loadState();
  let ui = loadUI();
  ui.filters = {province:'',employment:'',workflow:'',milestone:'',sla:'',process_level:'',process_status:'',q:'',...(ui.filters||{})};
  let modalMode = null;
  let selectedPositionId = null;

  function persist() {
    state.meta.last_local_update = nowISO();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  }

  function byId(id) { return document.getElementById(id); }
  function unit(id) { return state.units.find(x => x.unit_id === id) || baselineUnitMap.get(String(id || '')); }
  function province(code) { return state.provinces.find(x => x.province_code === code); }
  function milestone(code) { return state.milestones.find(x => x.milestone_code === code); }
  function bottleneck(id) { return state.bottlenecks.find(x => Number(x.tag_id) === Number(id)); }

  function daysBetween(start, end = new Date()) {
    const a = new Date(String(start).slice(0,10) + 'T00:00:00');
    const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

  function enrich(raw) {
    const base = baselineRow(raw.position_id);
    const u = unit(raw.unit_id) || {};
    const pr = province(base?.province_code || u.province_code) || {};
    const ms = milestone(raw.current_milestone) || {};
    const bn = bottleneck(raw.bottleneck_tag_id) || {};
    const days = daysBetween(raw.milestone_entry_date);
    const sla = Number(raw.sla_days || ms.default_sla_days || 0);
    const left = sla - days;
    const status = left < 0 ? 'BREACHED' : left <= 5 ? 'WARNING' : 'NORMAL';
    return {
      ...raw,
      position_name_th:base?.position_name || raw.position_name_th,
      position_level:base?.position_level || raw.position_level,
      specialist_name:base?.specialist_name || raw.specialist_name,
      employment_type:base?.employment_type || raw.employment_type,
      vacant_date:base?.vacancy_date || raw.vacant_date,
      vacant_reason:base?.vacancy_reason || raw.vacant_reason,
      cadre_group:base?.position_type || raw.cadre_group,
      unit_name:base ? ((base.unit_prefix || '') + (base.unit_name || '')) : (u.unit_name || '-'),
      unit_type_label:base?.unit_type || u.unit_type_label || '-',
      province_code:base?.province_code || u.province_code || '',
      province_name_th:base?.province_name || pr.province_name_th || '-',
      milestone_name_th:ms.milestone_name_th || raw.current_milestone,
      bottleneck_name:bn.tag_name || '-',
      bottleneck_category:bn.tag_category || '',
      bottleneck_severity:bn.severity_level || '',
      days_in_stage:days,
      days_left:left,
      sla_status:status
    };
  }

  function scopedPositions() {
    const rows = (state.positions || [])
      .filter(p => baselineByNo.has(String(p.position_id)))
      .map(enrich);
    if (ui.role === 'prov_gatekeeper') return rows.filter(p => p.province_code === ui.scope);
    if (ui.role === 'hosp_operator') return rows.filter(p => String(p.unit_id) === String(ui.scope));
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
      return baselineUnits().map(u => '<option value="'+esc(u.unit_id)+'">'+esc(u.unit_name)+' ('+esc(u.unit_type_label)+')</option>').join('');
    }
    return '<option value="ALL">ทุกจังหวัด / ทุกหน่วยงาน</option>';
  }

  function normalizeScope() {
    if (ui.role === 'prov_gatekeeper' && !state.provinces.some(p => p.province_code === ui.scope)) {
      ui.scope = state.provinces[0]?.province_code || '57';
    }
    if (ui.role === 'hosp_operator' && !baselineUnitMap.has(String(ui.scope || ''))) {
      ui.scope = baselineUnits()[0]?.unit_id || 'ALL';
    }
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
      '    <b>CHRO HR1</b> • ฐานข้อมูล จ.18 ณ 1 ก.ย. 2569: 39,607 ตำแหน่ง • ว่าง 3,580 ตำแหน่ง • Workflow ผูกกับเลขตำแหน่ง จ.18 และบันทึกเฉพาะใน browser นี้',
      '  </div>',
      '  <header class="sticky top-0 z-40 bg-gradient-to-r from-emerald-900 via-teal-900 to-cyan-950 text-white shadow-lg">',
      '    <div class="mx-auto max-w-[1720px] px-4 py-3">',
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
      navButton('baseline','🗂️','จ.18 Baseline'),
      navButton('overview','📊','Workflow'),
      navButton('positions','📋','ตำแหน่ง'),
      navButton('analytics','🔍','Analytics'),
      navButton('governance','🏛️','Governance'),
      navButton('admin','⚙️','Admin & Data'),
      '      </nav>',
      '    </div>',
      '  </header>',
      '  <main class="mx-auto max-w-[1720px] p-4 sm:p-6">',
      '    <section id="view-baseline"></section>',
      '    <section id="view-overview" class="hidden"></section>',
      '    <section id="view-positions" class="hidden"></section>',
      '    <section id="view-analytics" class="hidden"></section>',
      '    <section id="view-governance" class="hidden"></section>',
      '    <section id="view-admin" class="hidden"></section>',
      '  </main>',
      '  <footer class="border-t border-slate-200 bg-white px-4 py-5 text-center text-xs text-slate-500">CHRO HR1 • จ.18 Baseline 1 ก.ย. 2569 + Operational Workflow Preview</footer>',
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
    if (ui.tab === 'baseline') renderBaseline();
    else if (ui.tab === 'overview') renderOverview();
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


  function renderBaseline() {
    const root = byId('view-baseline');
    if (!j18Baseline) {
      root.innerHTML = '<div class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">ไม่พบไฟล์ baseline จ.18 ในชุด deploy นี้</div>';
      return;
    }
    const meta = j18Baseline.meta || {};
    const all = scopedBaselineVacancies();
    let rows = all.slice();
    const q = baselineFilters.q.trim().toLowerCase();
    if (baselineFilters.province) rows = rows.filter(r => r.province_code === baselineFilters.province);
    if (baselineFilters.employment) rows = rows.filter(r => r.employment_type === baselineFilters.employment);
    if (q) rows = rows.filter(r => [
      r.hrops_position_no, r.province_name, r.amphur_name, r.unit_name,
      r.position_name, r.position_level, r.specialist_name, r.vacancy_reason
    ].some(v => String(v || '').toLowerCase().includes(q)));

    const pageSize = 100;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    baselinePage = Math.min(Math.max(1, baselinePage), pages);
    const pageRows = rows.slice((baselinePage - 1) * pageSize, baselinePage * pageSize);
    const vacancyRate = Number(meta.source_rows || 0) ? (Number(meta.vacant || 0) / Number(meta.source_rows) * 100).toFixed(1) : '0.0';
    const empTypes = [...new Set(all.map(r => r.employment_type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
    const empSummary = employmentSummary(all);
    const empCards = empSummary.map(x =>
      '<button type="button" class="j18-employment rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300" data-employment="'+esc(x.label)+'">'
      +'<div class="text-xs text-slate-500">'+esc(x.label)+'</div><div class="mt-1 text-2xl font-black text-slate-900">'+x.count.toLocaleString('th-TH')+'</div>'
      +'<div class="text-xs text-slate-400">ตำแหน่งว่าง</div></button>'
    ).join('');

    const provinceCards = (j18Baseline.province_summary || []).map(p =>
      '<button type="button" class="j18-province rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-300" data-code="'+esc(p.province_code)+'">'
      +'<div class="text-xs text-slate-500">'+esc(p.province_name)+'</div><div class="mt-1 text-2xl font-black text-slate-900">'+Number(p.vacant||0).toLocaleString('th-TH')+'</div>'
      +'<div class="text-xs text-slate-400">ตำแหน่งว่าง</div></button>'
    ).join('');

    const optionsProvince = '<option value="">ทุกจังหวัด</option>' + (j18Baseline.province_summary || []).map(p =>
      '<option value="'+esc(p.province_code)+'">'+esc(p.province_name)+' ('+Number(p.vacant||0).toLocaleString('th-TH')+')</option>'
    ).join('');
    const optionsEmp = '<option value="">ทุกประเภทบุคลากร</option>' + empTypes.map(x => '<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');

    root.innerHTML = [
      '<div class="mb-5 flex flex-wrap items-end justify-between gap-3">',
      ' <div><h1 class="text-xl font-black text-slate-900">ฐานข้อมูล จ.18 เขตสุขภาพที่ 1</h1><p class="text-sm text-slate-500">ข้อมูล ณ วันที่ 1 กันยายน 2569 • แสดงเฉพาะข้อมูลระดับตำแหน่ง ไม่แสดงข้อมูลระบุตัวบุคคล</p></div>',
      ' <div class="text-right text-xs text-slate-500">Source: '+esc(meta.source_file||'จ18 1 กย 69')+'<br>'+Number(meta.source_rows||0).toLocaleString('th-TH')+' records</div>',
      '</div>',
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">',
      metricCard('ตำแหน่งทั้งหมด',Number(meta.source_rows||0).toLocaleString('th-TH'),'จากไฟล์ จ.18','text-slate-900'),
      metricCard('มีคนครอง',Number(meta.occupied||0).toLocaleString('th-TH'),'สถานะ 1.มีคนครอง','text-emerald-600'),
      metricCard('ตำแหน่งว่าง',Number(meta.vacant||0).toLocaleString('th-TH'),'สถานะ 2.ตำแหน่งว่าง','text-rose-600'),
      metricCard('Vacancy rate',vacancyRate+'%','ว่าง / ตำแหน่งทั้งหมด','text-indigo-600'),
      '</div>',
      '<div class="mt-5"><div class="mb-2 text-sm font-bold text-slate-700">ตำแหน่งว่าง แยกตามประเภทบุคลากร</div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">'+empCards+'</div></div>',
      '<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">'+provinceCards+'</div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">',
      ' <div class="grid gap-3 lg:grid-cols-[220px_240px_1fr_auto_auto]">',
      '  <select id="j18Province" class="rounded-lg border border-slate-300 px-3 py-2 text-sm">'+optionsProvince+'</select>',
      '  <select id="j18Employment" class="rounded-lg border border-slate-300 px-3 py-2 text-sm">'+optionsEmp+'</select>',
      '  <input id="j18Search" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="ค้นหาเลขตำแหน่ง หน่วยงาน ตำแหน่ง หรือเหตุว่าง" value="'+esc(baselineFilters.q)+'">',
      '  <button id="j18Clear" class="rounded-lg border border-slate-300 px-4 py-2 text-sm">ล้าง</button>',
      '  <button id="j18Export" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">CSV</button>',
      ' </div>',
      ' <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>พบ '+rows.length.toLocaleString('th-TH')+' ตำแหน่ง • แสดง '+pageRows.length.toLocaleString('th-TH')+' รายการในหน้านี้</span><span>หน้า '+baselinePage.toLocaleString('th-TH')+' / '+pages.toLocaleString('th-TH')+'</span></div>',
      '</div>',
      '<div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">',
      ' <div class="overflow-x-auto"><table class="min-w-[1250px] w-full text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr>',
      '  <th class="p-3">เลขตำแหน่ง</th><th class="p-3">จังหวัด</th><th class="p-3">หน่วยงาน</th><th class="p-3">ตำแหน่ง</th><th class="p-3">ระดับ</th><th class="p-3">ประเภทบุคลากร</th><th class="p-3">วันที่ว่าง</th><th class="p-3">เหตุว่าง</th>',
      ' </tr></thead><tbody>',
      pageRows.map(r => '<tr class="border-t border-slate-100 align-top"><td class="p-3 font-mono font-bold">'+esc(r.hrops_position_no||'-')+'</td><td class="p-3">'+esc(r.province_name||'-')+'</td><td class="p-3"><b>'+esc(r.unit_prefix||'')+esc(r.unit_name||'-')+'</b><span class="block text-[11px] text-slate-400">'+esc(r.amphur_name||'')+(r.service_plan?' • '+esc(r.service_plan):'')+'</span></td><td class="p-3"><b>'+esc(r.position_name||'-')+'</b><span class="block text-[11px] text-slate-400">'+esc(r.specialist_name||'')+'</span></td><td class="p-3">'+esc(r.position_level||'-')+'</td><td class="p-3">'+esc(r.employment_type||'-')+'</td><td class="p-3 whitespace-nowrap">'+esc(r.vacancy_date||'-')+'</td><td class="p-3 max-w-[360px]">'+esc(r.vacancy_reason||'-')+'</td></tr>').join(''),
      ' </tbody></table></div>',
      ' <div class="flex items-center justify-between border-t border-slate-200 p-3"><button id="j18Prev" class="rounded-lg border border-slate-300 px-3 py-2 text-xs '+(baselinePage<=1?'opacity-40':'')+'">← ก่อนหน้า</button><span class="text-xs text-slate-500">ข้อมูล จ.18 ระบุให้ตรวจสอบรายละเอียดรายตำแหน่งก่อนนำไปใช้เชิงปฏิบัติการ</span><button id="j18Next" class="rounded-lg border border-slate-300 px-3 py-2 text-xs '+(baselinePage>=pages?'opacity-40':'')+'">ถัดไป →</button></div>',
      '</div>'
    ].join('');

    byId('j18Province').value = baselineFilters.province;
    byId('j18Employment').value = baselineFilters.employment;
    byId('j18Province').onchange = () => { baselineFilters.province = byId('j18Province').value; baselinePage = 1; renderBaseline(); };
    byId('j18Employment').onchange = () => { baselineFilters.employment = byId('j18Employment').value; baselinePage = 1; renderBaseline(); };
    byId('j18Search').onchange = () => { baselineFilters.q = byId('j18Search').value; baselinePage = 1; renderBaseline(); };
    byId('j18Search').onkeydown = (e) => { if (e.key === 'Enter') { baselineFilters.q = byId('j18Search').value; baselinePage = 1; renderBaseline(); } };
    byId('j18Clear').onclick = () => { baselineFilters.province=''; baselineFilters.employment=''; baselineFilters.q=''; baselinePage=1; renderBaseline(); };
    byId('j18Prev').onclick = () => { if (baselinePage>1) { baselinePage--; renderBaseline(); } };
    byId('j18Next').onclick = () => { if (baselinePage<pages) { baselinePage++; renderBaseline(); } };
    document.querySelectorAll('.j18-province').forEach(btn => btn.onclick = () => { baselineFilters.province=btn.dataset.code; baselinePage=1; renderBaseline(); });
    document.querySelectorAll('.j18-employment').forEach(btn => btn.onclick = () => { baselineFilters.employment=btn.dataset.employment; baselinePage=1; renderBaseline(); });
    byId('j18Export').onclick = () => exportJ18Csv(rows);
  }

  function exportJ18Csv(rows) {
    const headers=['เลขตำแหน่ง','จังหวัด','อำเภอ','หน่วยงาน','ประเภทหน่วยงาน','Service plan','ตำแหน่ง','ประเภทตำแหน่ง','ระดับตำแหน่ง','สาขา','ประเภทบุคลากร','วันที่ว่าง','เหตุว่าง'];
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const lines=[headers.map(quote).join(',')].concat(rows.map(r=>[
      r.hrops_position_no,r.province_name,r.amphur_name,(r.unit_prefix||'')+(r.unit_name||''),r.unit_type,r.service_plan,
      r.position_name,r.position_type,r.position_level,r.specialist_name,r.employment_type,r.vacancy_date,r.vacancy_reason
    ].map(quote).join(',')));
    downloadBlob('\uFEFF'+lines.join('\n'),'CHRO_HR1_J18_2569-09-01.csv','text/csv;charset=utf-8');
  }

  function renderOverview() {
    const baselineRows = scopedBaselineVacancies();
    const rows = scopedPositions();
    const s = summary(rows);
    const trackedIds = new Set(rows.map(p => String(p.position_id)));
    const untracked = baselineRows.filter(r => !trackedIds.has(String(r.hrops_position_no))).length;
    const emp = employmentSummary(baselineRows);
    const byM = Object.fromEntries(state.milestones.map(m => [m.milestone_code, rows.filter(p => p.current_milestone === m.milestone_code).length]));
    const maxM = Math.max(1, ...Object.values(byM));
    const provinceRows = state.provinces.map(pr => {
      const base = baselineRows.filter(r => r.province_code === pr.province_code);
      const ops = rows.filter(p => p.province_code === pr.province_code);
      const tracked = new Set(ops.map(p => String(p.position_id)));
      return {
        pr,
        vacant:base.length,
        workflow:ops.length,
        untracked:base.filter(r => !tracked.has(String(r.hrops_position_no))).length,
        breached:ops.filter(p => p.current_milestone!=='M6' && p.sla_status==='BREACHED').length
      };
    }).filter(x => x.vacant > 0);
    const escalations = rows.filter(p => p.current_milestone!=='M6' && p.sla_status==='BREACHED').sort((a,b)=>a.days_left-b.days_left).slice(0,8);

    byId('view-overview').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black text-slate-900">Workflow ตำแหน่งว่าง</h1><p class="text-sm text-slate-500">ทุก Workflow ผูกกับตำแหน่งจริงใน จ.18 ณ 1 ก.ย. 2569</p></div>',
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">',
      metricCard('ตำแหน่งว่าง',baselineRows.length.toLocaleString('th-TH'),'Position Master จาก จ.18','text-rose-600'),
      metricCard('เข้าสู่ Workflow',rows.length.toLocaleString('th-TH'),'มีการเริ่มติดตามแล้ว','text-indigo-600'),
      metricCard('ยังไม่เริ่มติดตาม',untracked.toLocaleString('th-TH'),'ตำแหน่งว่างที่ยังไม่มี Workflow','text-amber-600'),
      metricCard('เกิน SLA',s.breached.toLocaleString('th-TH'),'เฉพาะรายการที่เริ่ม Workflow','text-rose-600'),
      '</div>',
      '<div class="mt-5"><div class="mb-2 text-sm font-bold text-slate-700">ตำแหน่งว่าง แยกตามประเภทบุคลากร</div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">'
        +emp.map(x=>'<button class="overview-emp rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300" data-employment="'+esc(x.label)+'"><div class="text-xs text-slate-500">'+esc(x.label)+'</div><div class="mt-1 text-2xl font-black">'+x.count.toLocaleString('th-TH')+'</div></button>').join('')
        +'</div></div>',
      '<div class="mt-5 grid gap-5 xl:grid-cols-12">',
      '<div class="xl:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div class="mb-4"><h2 class="font-bold">Workflow M1–M6</h2><p class="text-xs text-slate-500">นับเฉพาะตำแหน่งจริงที่เริ่ม Workflow แล้ว</p></div>'
        +state.milestones.map(m => {const n=byM[m.milestone_code]||0; const w=Math.round(n/maxM*100); return '<div class="mb-3"><div class="mb-1 flex justify-between text-xs"><span><b>'+esc(m.milestone_code)+'</b> '+esc(m.milestone_name_th)+'</span><span>'+n.toLocaleString('th-TH')+' ตำแหน่ง</span></div><div class="h-3 rounded-full bg-slate-100"><div class="h-3 rounded-full bg-indigo-500" style="width:'+w+'%"></div></div></div>';}).join('')
        +'</div>',
      '<div class="xl:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">สถานะรายจังหวัด</h2>'
        +provinceRows.map(x=>'<button class="province-master-jump mb-2 grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-indigo-200" data-province="'+esc(x.pr.province_code)+'"><span><b>'+esc(x.pr.province_name_th)+'</b><span class="block text-xs text-slate-500">ว่าง '+x.vacant.toLocaleString('th-TH')+' • Workflow '+x.workflow.toLocaleString('th-TH')+'</span></span><span class="text-right text-xs"><b class="text-amber-600">ยังไม่ติดตาม '+x.untracked.toLocaleString('th-TH')+'</b><span class="block text-rose-600">เกิน SLA '+x.breached.toLocaleString('th-TH')+'</span></span></button>').join('')
        +'</div>',
      '</div>',
      '<div class="mt-5 rounded-2xl border border-rose-200 bg-white shadow-sm"><div class="flex items-center justify-between border-b border-rose-100 p-5"><div><h2 class="font-bold text-rose-700">รายการเกิน SLA</h2><p class="text-xs text-slate-500">จาก Workflow ที่ผูกกับตำแหน่ง จ.18 เท่านั้น</p></div><button data-tab="governance" class="go-governance text-xs font-semibold text-rose-700 underline">เปิด Governance →</button></div>'+tableEscalations(escalations)+'</div>'
    ].join('');

    document.querySelectorAll('.overview-emp').forEach(btn => btn.onclick = () => {
      ui.filters.employment = btn.dataset.employment;
      ui.filters.workflow = '';
      positionPage = 1;
      setTab('positions');
    });
    document.querySelectorAll('.province-master-jump').forEach(btn => btn.onclick = () => {
      ui.filters.province = btn.dataset.province;
      positionPage = 1;
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
    let rows = masterRows();
    const f = ui.filters || {};
    if (f.province) rows = rows.filter(p => p.province_code === f.province);
    if (f.employment) rows = rows.filter(p => p.employment_type === f.employment);
    if (f.workflow === 'STARTED') rows = rows.filter(p => p.workflow_started);
    if (f.workflow === 'NOT_STARTED') rows = rows.filter(p => !p.workflow_started);
    if (f.milestone) rows = rows.filter(p => p.workflow?.current_milestone === f.milestone);
    if (f.sla) rows = rows.filter(p => p.workflow?.sla_status === f.sla);
    if (f.process_level) rows = rows.filter(p => p.workflow?.process_level === f.process_level);
    if (f.process_status) rows = rows.filter(p => p.workflow?.process_status === f.process_status);
    if (f.q) {
      const q = f.q.toLowerCase();
      rows = rows.filter(p => [
        p.hrops_position_no,p.position_name,p.position_level,p.specialist_name,
        p.unit_name,p.unit_prefix,p.province_name,p.vacancy_reason,p.employment_type,p.workflow?.process_status,p.workflow?.process_detail
      ].join(' ').toLowerCase().includes(q));
    }
    return rows.sort((a,b) => String(a.hrops_position_no).localeCompare(String(b.hrops_position_no),'th'));
  }

  function renderPositions() {
    const rows = filteredPositions();
    const pageSize = 100;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    positionPage = Math.min(Math.max(1, positionPage), pages);
    const pageRows = rows.slice((positionPage-1)*pageSize, positionPage*pageSize);
    const empTypes = employmentSummary(scopedBaselineVacancies()).map(x=>x.label);

    byId('view-positions').innerHTML = [
      '<div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-xl font-black">ตำแหน่งว่าง</h1><p class="text-sm text-slate-500">Position Master จาก จ.18 + สถานะ Workflow ของตำแหน่งเดียวกัน</p></div><button id="exportCsvBtn" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">⬇ CSV</button></div>',
      '<div class="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="grid gap-2 md:grid-cols-4 xl:grid-cols-8">',
      selectField('filterProvince','จังหวัด','<option value="">ทั้งหมด</option>'+state.provinces.map(p=>'<option value="'+esc(p.province_code)+'">'+esc(p.province_name_th)+'</option>').join(''),ui.filters.province),
      selectField('filterEmployment','ประเภทบุคลากร','<option value="">ทั้งหมด</option>'+empTypes.map(x=>'<option>'+esc(x)+'</option>').join(''),ui.filters.employment),
      selectField('filterWorkflow','Workflow','<option value="">ทั้งหมด</option><option value="STARTED">เริ่มติดตามแล้ว</option><option value="NOT_STARTED">ยังไม่เริ่มติดตาม</option>',ui.filters.workflow),
      selectField('filterMilestone','Milestone','<option value="">ทั้งหมด</option>'+state.milestones.map(m=>'<option>'+esc(m.milestone_code)+'</option>').join(''),ui.filters.milestone),
      selectField('filterProcessLevel','ระดับดำเนินการ','<option value="">ทั้งหมด</option>'+PROCESS_LEVELS.map(x=>'<option value="'+x.code+'">'+esc(x.label)+'</option>').join(''),ui.filters.process_level),
      selectField('filterProcessStatus','สถานะปัจจุบัน','<option value="">ทั้งหมด</option>'+PROCESS_STATUSES.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.value)+'</option>').join(''),ui.filters.process_status),
      selectField('filterSla','SLA','<option value="">ทั้งหมด</option><option value="NORMAL">ปกติ</option><option value="WARNING">ใกล้ครบ</option><option value="BREACHED">เกิน SLA</option>',ui.filters.sla),
      '<label class="text-xs text-slate-500">ค้นหา<input id="filterQ" value="'+esc(ui.filters.q||'')+'" placeholder="เลขตำแหน่ง / หน่วยงาน / ชื่อตำแหน่ง" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></label>',
      '</div></div>',
      '<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-xs text-slate-500"><span>พบ <b class="text-slate-800">'+rows.length.toLocaleString('th-TH')+'</b> ตำแหน่ง</span><span>หน้า '+positionPage.toLocaleString('th-TH')+' / '+pages.toLocaleString('th-TH')+'</span></div>',
      positionTable(pageRows),
      '<div class="flex items-center justify-between border-t border-slate-200 p-3"><button id="positionPrev" class="rounded-lg border border-slate-300 px-3 py-2 text-xs '+(positionPage<=1?'opacity-40':'')+'">← ก่อนหน้า</button><span class="text-xs text-slate-500">ตำแหน่งมาจาก จ.18 และไม่สามารถสร้างเลขตำแหน่งใหม่จากหน้านี้</span><button id="positionNext" class="rounded-lg border border-slate-300 px-3 py-2 text-xs '+(positionPage>=pages?'opacity-40':'')+'">ถัดไป →</button></div>',
      '</div>'
    ].join('');

    bindFilters();
    byId('exportCsvBtn').onclick = () => exportMasterCsv(rows);
    byId('positionPrev').onclick = () => { if(positionPage>1){positionPage--;renderPositions();} };
    byId('positionNext').onclick = () => { if(positionPage<pages){positionPage++;renderPositions();} };
    bindPositionButtons();
  }

  function selectField(id,label,options,value) {
    return '<label class="text-xs text-slate-500">'+label+'<select id="'+id+'" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500">'+options+'</select></label>';
  }

  function retirementStatus(p) {
    const reason = p?.vacancy_reason || p?.vacant_reason || '';
    const op = p?.workflow || p;
    if (!isRetirementReason(reason)) return '<span class="text-slate-600">'+esc(reason || '-')+'</span>';
    if (op?.retirement_use_approved) {
      return '<span class="font-semibold text-emerald-700">☑ บค.สป. อนุมัติแล้ว</span>'
        +'<span class="block text-[10px] text-slate-500">หนังสือ '+esc(op.retirement_approval_doc_no || '-')+'</span>'
        +'<span class="block text-[10px] text-slate-500">ใช้ได้ตั้งแต่ '+esc(op.retirement_use_from_date || '-')+'</span>';
    }
    return '<span class="font-semibold text-amber-700">☐ รอ บค.สป. อนุมัติ</span>';
  }

  function positionTable(rows) {
    if (!rows.length) return '<div class="p-8 text-center text-sm text-slate-400">ไม่พบข้อมูลตามเงื่อนไข</div>';
    return '<div class="w-full overflow-x-auto"><table class="w-full min-w-[1320px] table-fixed text-left text-[11px] xl:text-xs leading-5"><thead class="bg-slate-50 text-slate-500"><tr>'
      +'<th class="w-[85px] p-2.5">เลขตำแหน่ง</th><th class="w-[190px] p-2.5">จังหวัด / หน่วยงาน</th><th class="w-[170px] p-2.5">ชื่อตำแหน่ง</th><th class="w-[115px] p-2.5">ระดับ</th><th class="w-[130px] p-2.5">ประเภทบุคลากร</th><th class="w-[180px] p-2.5">เหตุว่าง / สิทธิ์ใช้</th><th class="w-[210px] p-2.5">ระดับ / สถานะปัจจุบัน</th><th class="w-[105px] p-2.5">Workflow</th><th class="w-[90px] p-2.5">SLA</th><th class="w-[150px] p-2.5">Bottleneck</th><th class="w-[100px] p-2.5 text-right">Action</th></tr></thead><tbody>'
      +rows.map(p => {
        const op = p.workflow;
        const editable = !op || canEdit(op);
        return '<tr class="border-t border-slate-100 hover:bg-slate-50/80">'
          +'<td class="p-2.5 align-top font-mono font-bold">'+esc(p.hrops_position_no||'-')+'</td>'
          +'<td class="p-2.5 align-top"><b>'+esc(p.province_name||'-')+'</b><span class="block text-slate-500">'+esc((p.unit_prefix||'')+(p.unit_name||'-'))+'</span></td>'
          +'<td class="p-2.5 align-top"><b>'+esc(p.position_name||'-')+'</b><span class="block text-slate-500">'+esc(p.specialist_name||'')+'</span></td>'
          +'<td class="p-2.5 align-top font-semibold">'+esc(p.position_level||'-')+'</td>'
          +'<td class="p-2.5 align-top">'+esc(p.employment_type||'-')+'</td>'
          +'<td class="p-2.5 align-top">'+retirementStatus(p)+'</td>'
          +'<td class="p-2.5 align-top">'+(op?'<span class="rounded-full bg-cyan-100 px-2 py-1 font-bold text-cyan-800">'+esc(processLevelLabel(op.process_level))+'</span><span class="mt-1 block font-semibold text-slate-700">'+esc(op.process_status||'-')+'</span>'+(op.process_detail?'<span class="block text-[10px] text-slate-500">'+esc(op.process_detail)+'</span>':''):'<span class="text-slate-400">–</span>')+'</td>'
          +'<td class="p-2.5 align-top">'+(op?'<span class="rounded-full bg-indigo-100 px-2 py-1 font-bold text-indigo-700">'+esc(op.current_milestone)+'</span><span class="mt-1 block text-[10px] text-slate-500">ติดตามแล้ว</span>':'<span class="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-500">ยังไม่เริ่ม</span>')+'</td>'
          +'<td class="p-2.5 align-top">'+(op?badge(op.sla_status):'<span class="text-slate-400">–</span>')+'</td>'
          +'<td class="p-2.5 align-top">'+(op?esc(op.bottleneck_name):'<span class="text-slate-400">–</span>')+'</td>'
          +'<td class="p-2.5 align-top text-right"><button data-id="'+esc(p.hrops_position_no)+'" class="open-pos rounded-lg '+(editable?'bg-emerald-600 text-white':'border border-slate-200 text-slate-600')+' px-2 py-1 whitespace-nowrap">'+(op?(editable?'จัดการ':'ดู'):(editable?'เริ่มติดตาม':'ดู'))+'</button>'+(op?'<button data-id="'+esc(p.hrops_position_no)+'" class="timeline-pos mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1">Timeline</button>':'')+'</td>'
          +'</tr>';
      }).join('')+'</tbody></table></div>';
  }

  function bindFilters() {
    const map = [
      ['filterProvince','province'],['filterEmployment','employment'],['filterWorkflow','workflow'],
      ['filterMilestone','milestone'],['filterProcessLevel','process_level'],['filterProcessStatus','process_status'],['filterSla','sla']
    ];
    map.forEach(([id,key]) => {
      const el = byId(id); if (!el) return; el.value = ui.filters[key] || '';
      el.onchange = () => { ui.filters[key] = el.value; positionPage=1; persist(); renderPositions(); };
    });
    const q = byId('filterQ');
    if (q) q.oninput = () => { ui.filters.q=q.value; positionPage=1; persist(); clearTimeout(q.timer); q.timer=setTimeout(renderPositions,120); };
  }

  function bindPositionButtons() {
    document.querySelectorAll('.open-pos').forEach(btn => btn.onclick = () => openPositionModal(btn.dataset.id));
    document.querySelectorAll('.timeline-pos').forEach(btn => btn.onclick = () => openTimeline(btn.dataset.id));
  }

  function renderAnalytics() {
    const base = scopedBaselineVacancies();
    const rows = scopedPositions();
    const active = rows.filter(p=>p.current_milestone!=='M6');
    const emp = employmentSummary(base);
    const trackedIds = new Set(rows.map(p=>String(p.position_id)));
    const untracked = base.filter(r=>!trackedIds.has(String(r.hrops_position_no))).length;
    const aging = [
      {label:'0–30 วัน', count:active.filter(p=>p.days_in_stage<=30).length},
      {label:'31–60 วัน', count:active.filter(p=>p.days_in_stage>=31&&p.days_in_stage<=60).length},
      {label:'>60 วัน', count:active.filter(p=>p.days_in_stage>60).length}
    ];
    const bns = state.bottlenecks.map(b => ({...b,count:active.filter(p=>Number(p.bottleneck_tag_id)===Number(b.tag_id)).length})).sort((a,b)=>b.count-a.count);
    const maxBn = Math.max(1,...bns.map(x=>x.count));
    const provinces = state.provinces.map(pr=>{
      const b=base.filter(r=>r.province_code===pr.province_code);
      const o=rows.filter(r=>r.province_code===pr.province_code);
      const ids=new Set(o.map(x=>String(x.position_id)));
      return {name:pr.province_name_th,vacant:b.length,workflow:o.length,untracked:b.filter(x=>!ids.has(String(x.hrops_position_no))).length,breached:o.filter(x=>x.current_milestone!=='M6'&&x.sla_status==='BREACHED').length};
    }).filter(x=>x.vacant);

    byId('view-analytics').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black">Analytics</h1><p class="text-sm text-slate-500">วิเคราะห์จาก จ.18 Position Master และ Workflow ที่ผูกกับตำแหน่งเดียวกัน</p></div>',
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">'+metricCard('ตำแหน่งว่าง',base.length.toLocaleString('th-TH'),'จ.18','text-rose-600')+metricCard('เข้าสู่ Workflow',rows.length.toLocaleString('th-TH'),'เริ่มติดตามแล้ว','text-indigo-600')+metricCard('ยังไม่เริ่มติดตาม',untracked.toLocaleString('th-TH'),'ต้องกำหนดผู้รับผิดชอบ','text-amber-600')+metricCard('เกิน SLA',active.filter(p=>p.sla_status==='BREACHED').length.toLocaleString('th-TH'),'Workflow ที่ต้องเร่งรัด','text-rose-600')+'</div>',
      '<div class="mt-5 rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm"><div class="mb-4"><h2 class="font-bold">สถานะเลขตำแหน่ง: จังหวัด → เขต → สป.</h2><p class="text-xs text-slate-500">Feedback สสจ.: แสดงว่าแต่ละเลขตำแหน่งอยู่ที่ระดับใด และกำลังดำเนินการเรื่องอะไร</p></div><div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">'
        +PROCESS_LEVELS.map(l=>{const n=rows.filter(p=>p.process_level===l.code).length;return '<button class="process-level-jump rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-cyan-400" data-level="'+l.code+'"><div class="text-xs text-slate-500">'+esc(l.label)+'</div><div class="mt-1 text-2xl font-black text-cyan-800">'+n.toLocaleString('th-TH')+'</div><div class="text-[11px] text-slate-400">ตำแหน่ง</div></button>';}).join('')
        +'</div><div class="mt-4 overflow-x-auto"><table class="min-w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-3 text-left">ระดับ</th><th class="p-3 text-left">สถานะ</th><th class="p-3 text-center">จำนวน</th><th class="p-3 text-right">ดูเลขตำแหน่ง</th></tr></thead><tbody>'
        +PROCESS_STATUSES.map(s=>{const n=rows.filter(p=>p.process_level===s.level&&p.process_status===s.value).length;if(!n)return '';return '<tr class="border-t border-slate-100"><td class="p-3 font-semibold">'+esc(processLevelLabel(s.level))+'</td><td class="p-3">'+esc(s.value)+'</td><td class="p-3 text-center font-bold">'+n.toLocaleString('th-TH')+'</td><td class="p-3 text-right"><button class="process-status-jump rounded-lg border border-cyan-200 px-2 py-1 font-semibold text-cyan-800" data-level="'+s.level+'" data-status="'+esc(s.value)+'">ดูรายการ</button></td></tr>';}).join('')
        +'</tbody></table></div></div>',
      '<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">'+emp.map(x=>metricCard(x.label,x.count.toLocaleString('th-TH'),'ตำแหน่งว่าง','text-slate-900')).join('')+'</div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">จังหวัด: Baseline → Workflow → Governance</h2><div class="overflow-x-auto"><table class="min-w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-3 text-left">จังหวัด</th><th class="p-3">ว่าง</th><th class="p-3">เข้า Workflow</th><th class="p-3">ยังไม่ติดตาม</th><th class="p-3">เกิน SLA</th></tr></thead><tbody>'
        +provinces.map(p=>'<tr class="border-t border-slate-100"><td class="p-3 font-bold">'+esc(p.name)+'</td><td class="p-3 text-center">'+p.vacant.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-indigo-600">'+p.workflow.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-amber-600">'+p.untracked.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-rose-600">'+p.breached.toLocaleString('th-TH')+'</td></tr>').join('')
        +'</tbody></table></div></div>',
      '<div class="mt-5 grid gap-5 xl:grid-cols-2"><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">Workflow Aging</h2>'+aging.map(a=>'<div class="mb-3 flex justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>'+a.label+'</span><b>'+a.count.toLocaleString('th-TH')+'</b></div>').join('')+'</div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">Bottleneck</h2>'+bns.map(b=>'<div class="mb-3"><div class="mb-1 flex justify-between text-xs"><span>'+esc(b.tag_name)+'</span><b>'+b.count+'</b></div><div class="h-2.5 rounded-full bg-slate-100"><div class="h-2.5 rounded-full bg-indigo-600" style="width:'+Math.round(b.count/maxBn*100)+'%"></div></div></div>').join('')+'</div></div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">Milestone × SLA</h2><div class="overflow-x-auto"><table class="min-w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Milestone</th><th class="p-3">ทั้งหมด</th><th class="p-3">ปกติ</th><th class="p-3">ใกล้ครบ</th><th class="p-3">เกิน SLA</th></tr></thead><tbody>'
        +state.milestones.map(m=>{const r=rows.filter(p=>p.current_milestone===m.milestone_code);return '<tr class="border-t border-slate-100"><td class="p-3"><b>'+esc(m.milestone_code)+'</b> '+esc(m.milestone_name_th)+'</td><td class="p-3 text-center">'+r.length+'</td><td class="p-3 text-center text-emerald-600">'+r.filter(p=>p.sla_status==='NORMAL').length+'</td><td class="p-3 text-center text-amber-600">'+r.filter(p=>p.sla_status==='WARNING').length+'</td><td class="p-3 text-center text-rose-600">'+r.filter(p=>p.sla_status==='BREACHED').length+'</td></tr>'}).join('')
        +'</tbody></table></div></div>'
    ].join('');
    document.querySelectorAll('.process-level-jump').forEach(btn=>btn.onclick=()=>{ui.filters.process_level=btn.dataset.level;ui.filters.process_status='';positionPage=1;setTab('positions');});
    document.querySelectorAll('.process-status-jump').forEach(btn=>btn.onclick=()=>{ui.filters.process_level=btn.dataset.level;ui.filters.process_status=btn.dataset.status;positionPage=1;setTab('positions');});
  }

  function escalationLevel(p) {
    if (p.bottleneck_severity === 'HIGH' || ['ส่วนกลาง','นโยบายเขต'].includes(p.bottleneck_category)) return 'จังหวัด → เขต 1';
    return 'CHRO จังหวัด';
  }

  function latestGovNote(positionId) {
    return [...(state.governance_notes||[])].filter(n=>n.position_id===positionId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
  }

  function renderGovernance() {
    const base = scopedBaselineVacancies();
    const ops = scopedPositions();
    const queue = ops.filter(p=>p.current_milestone!=='M6'&&p.sla_status==='BREACHED').sort((a,b)=>a.days_left-b.days_left);
    const provinceRows = state.provinces.map(pr=>{
      const b=base.filter(r=>r.province_code===pr.province_code);
      const o=ops.filter(r=>r.province_code===pr.province_code);
      const ids=new Set(o.map(x=>String(x.position_id)));
      return {name:pr.province_name_th,vacant:b.length,workflow:o.length,untracked:b.filter(x=>!ids.has(String(x.hrops_position_no))).length,breached:o.filter(x=>x.current_milestone!=='M6'&&x.sla_status==='BREACHED').length};
    }).filter(x=>x.vacant);

    byId('view-governance').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black">Governance</h1><p class="text-sm text-slate-500">เห็นทั้งตำแหน่งที่ยังไม่มีผู้รับผิดชอบ Workflow และรายการที่ติดค้างเกิน SLA</p></div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="mb-4 font-bold">ภาพรวมการกำกับติดตามรายจังหวัด</h2><div class="overflow-x-auto"><table class="min-w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-3 text-left">จังหวัด</th><th class="p-3">ตำแหน่งว่าง</th><th class="p-3">เข้า Workflow</th><th class="p-3">ยังไม่ติดตาม</th><th class="p-3">เกิน SLA</th></tr></thead><tbody>'
        +provinceRows.map(p=>'<tr class="border-t border-slate-100"><td class="p-3 font-bold">'+esc(p.name)+'</td><td class="p-3 text-center">'+p.vacant.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-indigo-600">'+p.workflow.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-amber-600">'+p.untracked.toLocaleString('th-TH')+'</td><td class="p-3 text-center text-rose-600">'+p.breached.toLocaleString('th-TH')+'</td></tr>').join('')
        +'<tr class="border-t-2 border-slate-300 bg-slate-50 font-bold"><td class="p-3">รวม</td><td class="p-3 text-center">'+base.length.toLocaleString('th-TH')+'</td><td class="p-3 text-center">'+ops.length.toLocaleString('th-TH')+'</td><td class="p-3 text-center">'+(base.length-ops.length).toLocaleString('th-TH')+'</td><td class="p-3 text-center">'+queue.length.toLocaleString('th-TH')+'</td></tr></tbody></table></div></div>',
      '<div class="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="border-b border-slate-100 px-5 py-4"><b>'+queue.length.toLocaleString('th-TH')+' รายการเกิน SLA</b></div>',
      queue.length?'<div class="overflow-x-auto"><table class="min-w-[1250px] w-full text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-3 text-left">ตำแหน่ง</th><th class="p-3 text-left">จังหวัด/หน่วยงาน</th><th class="p-3 text-left">SLA</th><th class="p-3 text-left">เหตุขัดข้อง</th><th class="p-3 text-left">Escalation</th><th class="p-3 text-left">Action ล่าสุด</th><th class="p-3 text-right">จัดการ</th></tr></thead><tbody>'
        +queue.map(p=>{const n=latestGovNote(p.position_id);return '<tr class="border-t border-slate-100"><td class="p-3"><b>'+esc(p.position_id)+'</b><span class="block">'+esc(p.position_name_th)+'</span></td><td class="p-3"><b>'+esc(p.province_name_th)+'</b><span class="block text-slate-500">'+esc(p.unit_name)+'</span></td><td class="p-3 text-rose-600"><b>เกิน '+Math.abs(p.days_left)+' วัน</b></td><td class="p-3">'+esc(p.bottleneck_name)+'</td><td class="p-3"><span class="rounded-full bg-indigo-100 px-2 py-1 font-semibold text-indigo-700">'+esc(escalationLevel(p))+'</span></td><td class="p-3">'+(n?'<b>'+esc(n.status)+'</b><span class="block text-slate-500">'+esc(n.note)+'</span>':'<span class="text-slate-400">ยังไม่มี action note</span>')+'</td><td class="p-3 text-right">'+(ui.role==='executive'?'<span class="text-slate-400">View only</span>':'<button data-id="'+esc(p.position_id)+'" class="gov-action rounded-lg bg-indigo-600 px-2 py-1 text-white">Action note</button>')+'</td></tr>'}).join('')
        +'</tbody></table></div>':'<div class="p-8 text-center text-slate-400">ยังไม่มีรายการเกิน SLA</div>',
      '</div>'
    ].join('');
    document.querySelectorAll('.gov-action').forEach(btn=>btn.onclick=()=>openGovernanceModal(btn.dataset.id));
  }

  function renderAdmin() {
    const s = summary(scopedPositions());
    const localBytes = new Blob([JSON.stringify(state)]).size;
    byId('view-admin').innerHTML = [
      '<div class="mb-5"><h1 class="text-xl font-black">Admin, Role Simulation & Data Status</h1><p class="text-sm text-slate-500">ตรวจสอบ source, permission และ lifecycle ของ preview dataset</p></div>',
      '<div class="mb-5 rounded-2xl border-2 border-cyan-500 bg-cyan-50/30 p-5 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-3"><div><div class="text-xs font-black uppercase tracking-wider text-cyan-700">ใหม่ • Monthly J.18 Excel Import</div><h2 class="mt-1 text-lg font-black">นำเข้า จ.18 รายเดือน → Update Database</h2><p class="mt-1 text-xs text-slate-500">สำหรับ <b>REGION_ADMIN / บค.เขต</b> ใช้ช่วงต้นเดือนเมื่อได้รับไฟล์ จ.18 ใหม่</p></div><span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Static Preview</span></div>'
        +'<div class="mt-4 grid gap-3 md:grid-cols-3"><label class="text-xs font-semibold text-slate-600">1. เดือน Baseline<input id="previewHropsMonth" type="month" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label><label class="text-xs font-semibold text-slate-600 md:col-span-2">2. เลือกไฟล์ จ.18 (.xlsx)<input id="previewHropsFile" type="file" accept=".xlsx" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"></label></div>'
        +'<div id="previewHropsFileInfo" class="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ยังไม่ได้เลือกไฟล์ • Production รองรับไฟล์ประมาณ 36–50 MB</div>'
        +'<div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"><div id="previewHropsBar" class="h-full w-0 rounded-full bg-cyan-600 transition-all"></div></div>'
        +'<div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span id="previewHropsStatus" class="text-slate-500">ขั้นตอนจริง: Upload → ตรวจ Sheet 2 → UPSERT DB → Import History</span><span id="previewHropsPercent" class="font-bold text-cyan-800">0%</span></div>'
        +'<div class="mt-4 flex flex-wrap gap-2"><button id="previewHropsUpload" class="rounded-lg bg-cyan-700 px-4 py-2 text-xs font-bold text-white">จำลอง Upload & Update DB</button><span class="self-center text-[11px] text-slate-500">GitHub Pages จะไม่เขียน DB จริง • เมื่อ Deploy Server ปุ่มนี้จะเรียก <code>/api/hrops/imports</code></span></div>'
        +'<div class="mt-4 grid gap-2 text-xs md:grid-cols-5"><div class="rounded-xl border border-slate-100 p-3"><b>1</b><span class="block text-slate-500">เลือกเดือน</span></div><div class="rounded-xl border border-slate-100 p-3"><b>2</b><span class="block text-slate-500">เลือก .xlsx</span></div><div class="rounded-xl border border-slate-100 p-3"><b>3</b><span class="block text-slate-500">Upload พร้อม %</span></div><div class="rounded-xl border border-slate-100 p-3"><b>4</b><span class="block text-slate-500">Server Update DB</span></div><div class="rounded-xl border border-slate-100 p-3"><b>5</b><span class="block text-slate-500">ดูสรุป / History</span></div></div></div>',
      '<div class="grid gap-5 xl:grid-cols-3">',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Data status</h2><div class="mt-4 space-y-3 text-sm">'
        +statusLine('Preview version',state.meta.version||'2.0.0','ok')
        +statusLine('J.18 baseline',j18Baseline?.meta?.snapshot_date||'-','ok')
        +statusLine('Browser local persistence',localStorage.getItem(STORAGE_KEY)?'Active':'Seed only','ok')
        +statusLine('Google Sheets live sync','Not connected','warn')
        +statusLine('Position Master','J.18 linked','ok')
        +statusLine('Production authentication','Not enabled','warn')
        +'</div></div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Dataset</h2><div class="mt-4 grid grid-cols-2 gap-3">'
        +metricMini('Vacant master',scopedBaselineVacancies().length)+metricMini('Workflow cases',scopedPositions().length)+metricMini('History events',state.history.length)+metricMini('Governance notes',(state.governance_notes||[]).length)
        +'</div><div class="mt-4 text-xs text-slate-500">Local payload ~'+Math.round(localBytes/1024)+' KB • WIP '+s.active+' • SLA breached '+s.breached+'</div></div>',
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Role capability</h2><div class="mt-4 text-sm"><b>'+esc(roleName(ui.role))+'</b><p class="mt-2 text-xs text-slate-500">'+esc(permissionText())+'</p></div></div>',
      '</div>',
      '<div class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 class="font-bold">Preview data controls</h2><p class="mt-1 text-xs text-slate-500">Export JSON เก็บ state ทั้งหมดรวม audit/governance notes; Import เพื่อ restore ใน browser เครื่องนี้</p><div class="mt-4 flex flex-wrap gap-2">'
        +'<button id="adminExportJson" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">⬇ Export JSON backup</button>'
        +(ui.role==='reg_admin'?'<button id="adminImportJson" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">⬆ Import JSON backup (Preview)</button>':'')
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

    const previewMonth = byId('previewHropsMonth');
    if (previewMonth && !previewMonth.value) {
      const d = new Date();
      previewMonth.value = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    }
    const previewFile = byId('previewHropsFile');
    if (previewFile) previewFile.onchange = () => {
      const file = previewFile.files?.[0];
      if (!file) return;
      const mb = file.size / (1024*1024);
      const ok = file.name.toLowerCase().endsWith('.xlsx') && mb <= 95;
      byId('previewHropsFileInfo').innerHTML = '<b>'+esc(file.name)+'</b> • '+mb.toFixed(1)+' MB • '+(ok?'<span class="text-emerald-700">ผ่านการตรวจเบื้องต้น</span>':'<span class="text-rose-700">ไฟล์ไม่ผ่านเงื่อนไข</span>');
      byId('previewHropsStatus').textContent = ok ? 'พร้อมจำลอง Upload — Production จะอ่าน Sheet 2 “เขต 1”' : 'รองรับเฉพาะ .xlsx และขนาดไม่เกิน 95 MB ที่ browser';
    };
    const previewUpload = byId('previewHropsUpload');
    if (previewUpload) previewUpload.onclick = () => {
      const file = previewFile?.files?.[0];
      if (!file) { alert('กรุณาเลือกไฟล์ จ.18 .xlsx ก่อน'); return; }
      if (!file.name.toLowerCase().endsWith('.xlsx')) { alert('รองรับเฉพาะไฟล์ .xlsx'); return; }
      const mb = file.size/(1024*1024);
      if (mb > 95) { alert('ไฟล์ใหญ่เกิน 95 MB'); return; }
      let p = 0;
      byId('previewHropsStatus').textContent = 'กำลังจำลอง Upload...';
      previewUpload.disabled = true;
      const timer = setInterval(()=>{
        p += 10;
        byId('previewHropsBar').style.width = p+'%';
        byId('previewHropsPercent').textContent = p+'%';
        if (p >= 100) {
          clearInterval(timer);
          byId('previewHropsStatus').textContent = 'Static Preview: Upload ครบแล้ว • Production Server จะตรวจ Sheet 2 และ Update Database ต่อ';
          previewUpload.disabled = false;
        }
      },90);
    };
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
    const base = baselineRow(id);
    if (!base) return toast('ไม่พบตำแหน่งนี้ใน จ.18 Baseline');
    const raw = state.positions.find(p=>String(p.position_id)===String(id));
    const existing = raw ? enrich(raw) : null;
    const editable = existing ? canEdit(existing) : canCreate();
    modalMode = existing ? 'position-edit' : 'position-create';
    const p = existing || {
      position_id:String(base.hrops_position_no),
      unit_id:base.unit_id,
      position_name_th:base.position_name,
      position_level:base.position_level,
      cadre_group:base.position_type || 'ไม่ระบุ',
      specialist_name:base.specialist_name || '',
      employment_type:base.employment_type,
      vacant_date:base.vacancy_date || todayISO(),
      vacant_reason:base.vacancy_reason || '',
      management_channel:'รับย้าย',
      current_milestone:'M1',
      milestone_entry_date:todayISO(),
      sla_days:15,
      bottleneck_tag_id:8,
      hrops_synced:0,
      remarks:'',
      retirement_use_approved:false,
      retirement_approval_doc_no:'',
      retirement_use_from_date:'',
      process_level:'PROVINCE',
      process_status:'บค.สสจ. ตรวจสอบ',
      process_detail:'',
      process_updated_at:nowISO()
    };

    byId('modalRoot').innerHTML = modalShell(
      existing ? 'จัดการ Workflow • '+esc(id) : 'เริ่มติดตามตำแหน่ง • '+esc(id),
      '<div class="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">'
      +'<div class="grid gap-3 md:grid-cols-4 text-sm"><div><span class="block text-xs text-slate-500">เลขตำแหน่ง</span><b>'+esc(base.hrops_position_no||'-')+'</b></div>'
      +'<div><span class="block text-xs text-slate-500">หน่วยงาน</span><b>'+esc((base.unit_prefix||'')+(base.unit_name||'-'))+'</b></div>'
      +'<div><span class="block text-xs text-slate-500">ตำแหน่ง / ระดับ</span><b>'+esc(base.position_name||'-')+'</b><span class="block text-xs text-slate-500">'+esc(base.position_level||'-')+'</span></div>'
      +'<div><span class="block text-xs text-slate-500">ประเภทบุคลากร</span><b>'+esc(base.employment_type||'-')+'</b></div></div>'
      +'<div class="mt-3 text-xs text-slate-500">ข้อมูลส่วนนี้มาจาก จ.18 และแก้ไขจาก Workflow ไม่ได้ • เหตุว่าง: <b>'+esc(base.vacancy_reason||'-')+'</b> • วันที่ว่าง: <b>'+esc(base.vacancy_date||'-')+'</b></div></div>'
      +'<form id="positionForm" class="grid gap-3 md:grid-cols-2">'
      +selectHtml('fChannel','ช่องทางการบริหาร',['รับย้าย','เลื่อนระดับ','เรียกบัญชี สป.','สอบคัดเลือก','รับโอน','จ้าง/สรรหา'].map(x=>'<option>'+x+'</option>').join(''),p.management_channel)
      +selectHtml('fMilestone','Milestone',state.milestones.map(m=>'<option value="'+esc(m.milestone_code)+'">'+esc(m.milestone_code)+' • '+esc(m.milestone_name_th)+'</option>').join(''),p.current_milestone)
      +selectHtml('fProcessLevel','ระดับที่กำลังดำเนินการ',PROCESS_LEVELS.map(x=>'<option value="'+x.code+'">'+esc(x.label)+'</option>').join(''),p.process_level||inferProcessLevel(p))
      +selectHtml('fProcessStatus','สถานะปัจจุบัน',PROCESS_STATUSES.map(x=>'<option data-level="'+x.level+'" value="'+esc(x.value)+'">'+esc(x.value)+'</option>').join(''),p.process_status||inferProcessStatus(p))
      +inputText('fProcessDetail','รายละเอียดสถานะ / ชื่อผู้รับย้าย-รับโอน',p.process_detail||'','placeholder="ระบุเมื่อจำเป็น เช่น ชื่อผู้รับย้าย/รับโอน"')
      +inputText('fStageDate','วันที่เข้าสู่ milestone',p.milestone_entry_date,'type="date"')
      +selectHtml('fBottleneck','Bottleneck',state.bottlenecks.map(b=>'<option value="'+b.tag_id+'">'+esc(b.tag_name)+'</option>').join(''),String(p.bottleneck_tag_id||8))
      +(isRetirementReason(base.vacancy_reason)?'<div id="retirementApprovalBlock" class="rounded-xl border border-amber-200 bg-amber-50 p-3 md:col-span-2"><label class="flex items-center gap-2 text-sm font-semibold text-amber-900"><input id="fRetirementApproved" type="checkbox" class="h-4 w-4" '+(p.retirement_use_approved?'checked':'')+'> บค.สป. อนุมัติให้ใช้ตำแหน่งเกษียณอายุราชการแล้ว</label><div id="retirementApprovalDetails" class="mt-3 grid gap-3 md:grid-cols-2">'+inputText('fRetirementDoc','เลขหนังสืออนุมัติ บค.สป.',p.retirement_approval_doc_no||'','')+inputText('fRetirementUseFrom','ใช้ตำแหน่งได้ตั้งแต่วันที่',p.retirement_use_from_date||'','type="date"')+'</div></div>':'')
      +'<label class="md:col-span-2 text-xs text-slate-500">หมายเหตุ<textarea id="fRemarks" class="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-2 text-sm">'+esc(p.remarks||'')+'</textarea></label>'
      +'<label class="text-xs text-slate-500">เลขหนังสือ/เอกสารอ้างอิง<input id="fRefDoc" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></label>'
      +'<label class="flex items-end gap-2 pb-2 text-xs text-slate-600"><input id="fHrops" type="checkbox" '+(Number(p.hrops_synced)?'checked':'')+'> ปรับสถานะ HROPS แล้ว</label>'
      +'</form>',
      '<div class="flex flex-wrap justify-between gap-2"><div class="flex gap-2">'+(existing?'<button id="timelineModalBtn" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Timeline</button>':'')+(existing&&canDelete()?'<button id="deletePositionBtn" class="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-600">ลบ Workflow</button>':'')+'</div><div class="flex gap-2"><button class="modal-close rounded-lg border border-slate-300 px-3 py-2 text-xs">ปิด</button>'+(editable?'<button id="savePositionBtn" class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">'+(existing?'บันทึก':'เริ่ม Workflow')+'</button>':'')+'</div></div>'
    );
    setValue('fChannel',p.management_channel);
    setValue('fMilestone',p.current_milestone);
    setValue('fProcessLevel',p.process_level||inferProcessLevel(p));
    setValue('fProcessStatus',p.process_status||inferProcessStatus(p));
    setValue('fBottleneck',String(p.bottleneck_tag_id||8));
    if (byId('fProcessLevel')) byId('fProcessLevel').onchange = syncProcessStatusOptions;
    syncProcessStatusOptions();
    if (byId('fRetirementApproved')) {
      syncRetirementFields();
      byId('fRetirementApproved').onchange = syncRetirementFields;
    }
    bindModalClose();
    if (byId('savePositionBtn')) byId('savePositionBtn').onclick = savePosition;
    if (byId('timelineModalBtn')) byId('timelineModalBtn').onclick = () => openTimeline(id);
    if (byId('deletePositionBtn')) byId('deletePositionBtn').onclick = () => deletePosition(id);
  }

  function syncProcessStatusOptions() {
    const level = byId('fProcessLevel')?.value;
    const select = byId('fProcessStatus');
    if (!select) return;
    const previous = select.value;
    [...select.options].forEach(opt => { opt.hidden = Boolean(opt.dataset.level) && opt.dataset.level !== level; });
    const valid = [...select.options].find(opt => !opt.hidden && opt.value === previous);
    if (!valid) {
      const first = [...select.options].find(opt => !opt.hidden);
      if (first) select.value = first.value;
    }
  }

  function syncRetirementFields() {
    const details = byId('retirementApprovalDetails');
    const approved = byId('fRetirementApproved');
    if (!details || !approved) return;
    details.classList.toggle('hidden', !approved.checked);
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
    const id = String(selectedPositionId || '');
    const base = baselineRow(id);
    if (!base) return toast('ไม่พบตำแหน่งใน จ.18');
    const old = state.positions.find(p=>String(p.position_id)===id);
    const msCode = byId('fMilestone').value;
    const ms = milestone(msCode);
    const isRetirement = isRetirementReason(base.vacancy_reason);
    const retirementApproved = isRetirement && Boolean(byId('fRetirementApproved')?.checked);
    const retirementDoc = isRetirement ? (byId('fRetirementDoc')?.value.trim() || '') : '';
    const retirementUseFrom = isRetirement ? (byId('fRetirementUseFrom')?.value || '') : '';
    if (retirementApproved && !retirementDoc) return toast('กรุณาระบุเลขหนังสืออนุมัติ บค.สป.');
    if (retirementApproved && !retirementUseFrom) return toast('กรุณาระบุวันที่เริ่มใช้ตำแหน่งได้');

    const data = {
      position_id:id,
      position_uid:base.position_uid || null,
      unit_id:base.unit_id,
      position_name_th:base.position_name,
      position_level:base.position_level,
      cadre_group:base.position_type || 'ไม่ระบุ',
      specialist_name:base.specialist_name || '',
      employment_type:base.employment_type,
      vacant_date:base.vacancy_date || '',
      vacant_reason:base.vacancy_reason || '',
      retirement_use_approved:retirementApproved,
      retirement_approval_doc_no:retirementApproved ? retirementDoc : '',
      retirement_use_from_date:retirementApproved ? retirementUseFrom : '',
      management_channel:byId('fChannel').value,
      current_milestone:msCode,
      process_level:byId('fProcessLevel').value,
      process_status:byId('fProcessStatus').value,
      process_detail:byId('fProcessDetail').value.trim(),
      process_updated_at:nowISO(),
      milestone_entry_date:byId('fStageDate').value,
      sla_days:Number(ms?.default_sla_days||30),
      bottleneck_tag_id:Number(byId('fBottleneck').value),
      hrops_synced:byId('fHrops').checked?1:0,
      remarks:byId('fRemarks').value.trim(),
      created_at:old?.created_at||nowISO(),
      updated_at:nowISO()
    };
    const actor = roleName(ui.role);
    if (old) {
      const idx=state.positions.findIndex(p=>String(p.position_id)===id);
      state.positions[idx]=data;
      state.history.push({
        event_id:Date.now(),position_id:id,from_milestone:old.current_milestone,to_milestone:data.current_milestone,
        transition_date:(data.milestone_entry_date||todayISO())+' 09:00:00',updated_by_user:actor,
        reference_doc_no:retirementApproved ? retirementDoc : (byId('fRefDoc').value.trim()||null),
        bottleneck_tag_id:data.bottleneck_tag_id,notes:data.remarks||'อัปเดต Workflow',event_type:old.current_milestone!==data.current_milestone?'transition':'update'
      });
    } else {
      state.positions.push(data);
      state.history.push({
        event_id:Date.now(),position_id:id,from_milestone:null,to_milestone:data.current_milestone,
        transition_date:(data.milestone_entry_date||todayISO())+' 09:00:00',updated_by_user:actor,
        reference_doc_no:retirementApproved ? retirementDoc : (byId('fRefDoc').value.trim()||null),
        bottleneck_tag_id:data.bottleneck_tag_id,notes:data.remarks||'เริ่มติดตามจาก จ.18 Position Master',event_type:'create'
      });
    }
    persist(); closeModal(); renderCurrent(); toast(old?'บันทึก Workflow แล้ว':'เริ่ม Workflow แล้ว');
  }

  function deletePosition(id) {
    if (ui.role!=='reg_admin') return;
    if (!confirm('ลบ Workflow ของตำแหน่ง '+id+' หรือไม่? ข้อมูลตำแหน่งใน จ.18 จะไม่ถูกลบ')) return;
    state.positions = state.positions.filter(p=>p.position_id!==id);
    state.history.push({event_id:Date.now(),position_id:id,from_milestone:null,to_milestone:null,transition_date:nowISO(),updated_by_user:roleName(ui.role),reference_doc_no:null,bottleneck_tag_id:null,notes:'Position deleted from preview',event_type:'delete'});
    persist(); closeModal(); renderCurrent(); toast('ลบ Workflow แล้ว • ตำแหน่งใน จ.18 ยังคงอยู่');
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

  function exportMasterCsv(rows) {
    const headers=['เลขตำแหน่ง','จังหวัด','อำเภอ','หน่วยงาน','ประเภทหน่วยงาน','ชื่อตำแหน่ง','ประเภทตำแหน่ง','ระดับ','ประเภทบุคลากร','วันที่ว่าง','เหตุว่าง','Workflow','Milestone','SLA'];
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const lines=[headers.map(quote).join(',')].concat(rows.map(p=>[
      p.hrops_position_no,p.province_name,p.amphur_name,(p.unit_prefix||'')+(p.unit_name||''),p.unit_type,
      p.position_name,p.position_type,p.position_level,p.employment_type,p.vacancy_date,p.vacancy_reason,
      p.workflow_started?'STARTED':'NOT_STARTED',p.workflow?.current_milestone||'',p.workflow?.sla_status||''
    ].map(quote).join(',')));
    downloadBlob('\uFEFF'+lines.join('\n'),'CHRO_HR1_positions_'+todayISO()+'.csv','text/csv;charset=utf-8');
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
    if (!confirm('ลบ Workflow / Timeline / Governance ที่บันทึกใน browser นี้ทั้งหมด และกลับไปเริ่มจาก จ.18 Baseline หรือไม่?')) return;
    state=migrateState(seed); persist(); normalizeScope(); renderHeaderState(); renderCurrent(); toast('Reset Workflow แล้ว • จ.18 Baseline ยังคงเดิม');
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
      else if(ui.role==='hosp_operator') ui.scope=baselineUnits()[0]?.unit_id||'ALL';
      else ui.scope='ALL';
      ui.filters={province:'',employment:'',workflow:'',milestone:'',sla:'',q:''};
      persist(); renderHeaderState(); renderCurrent();
    };
    byId('scopeSelector').onchange=()=>{ui.scope=byId('scopeSelector').value; ui.filters={province:'',employment:'',workflow:'',milestone:'',sla:'',q:''}; positionPage=1; persist(); renderCurrent();};
    byId('importJsonInput').onchange=(e)=>{const f=e.target.files?.[0]; if(f) importJson(f);};
  }

  layout();
  normalizeScope();
  renderHeaderState();
  bindGlobal();
  setTab(ui.tab || 'baseline');
})();