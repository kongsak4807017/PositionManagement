(() => {
  "use strict";

  const TOKEN_KEY = "chro_hr1_token";
  const state = { token: sessionStorage.getItem(TOKEN_KEY), me: null, provinces: [], units: [], page: "dashboard" };

  const ROLE_RULES = {
    MOPH_ADMIN: { hrops:true, users:true, audit:true, write:true, scope:"ทั้งเขตสุขภาพที่ 1", permission:"บริหารระบบทั้งหมด, Upload HROPS, จัดการผู้ใช้, แก้ไข workflow และตรวจ Audit" },
    REGION_ADMIN: { hrops:true, users:true, audit:true, write:true, scope:"ทั้งเขตสุขภาพที่ 1", permission:"บค.เขต: Upload HROPS, จัดการผู้ใช้ระดับเขต/จังหวัด/หน่วยงาน และบริหาร Vacancy Workflow" },
    REGION_EXECUTIVE: { hrops:false, users:false, audit:false, write:false, scope:"ทั้งเขตสุขภาพที่ 1", permission:"ผู้บริหารเขต: อ่าน Dashboard, Position Master และ Vacancy Workflow ทั้งเขต" },
    PROVINCE_ADMIN: { hrops:false, users:false, audit:false, write:true, scope:"เฉพาะจังหวัด", permission:"สสจ.: อ่านและบันทึก Vacancy Workflow ภายในจังหวัดของตน" },
    HOSPITAL_HR: { hrops:false, users:false, audit:false, write:true, scope:"เฉพาะหน่วยงาน", permission:"รพศ./รพท.: อ่านและบันทึก Vacancy Workflow เฉพาะหน่วยงานของตน" },
    AUDITOR: { hrops:false, users:false, audit:true, write:false, scope:"ทั้งเขตสุขภาพที่ 1", permission:"ผู้ตรวจสอบ: อ่านข้อมูลทั้งเขตและ Audit Log โดยไม่มีสิทธิ์แก้ไข" }
  };

  const PROCESS_STATUS = {
    PROVINCE:["บค.สสจ. ตรวจสอบ","CHRO จังหวัด พิจารณา"],
    REGION:["CHRO เขต พิจารณา"],
    MOPH:[
      "อนุมัติ บรรจุผู้สอบแข่งขัน","อนุมัติ บรรจุผู้ได้รับคัดเลือก","อนุมัติ ปรับปรุง",
      "อนุมัติ ยุบกำหนดตำแหน่งสูงขึ้น","อนุมัติ รับย้าย (ระบุชื่อ)","อนุมัติ รับโอน (ระบุชื่อ)",
      "อนุมัติ รับย้าย/รับโอน","อนุมัติ เลื่อน","อนุมัติ เกลี่ย","อนุมัติ เปลี่ยนตำแหน่ง",
      "อนุมัติ เปลี่ยนประเภทการจ้าง","อนุมัติ จ้างทดแทน","อื่นๆ"
    ],
    DONE:["ดำเนินการเสร็จสิ้น"]
  };
  const PROCESS_LEVEL_LABEL = {PROVINCE:"ระดับจังหวัด",REGION:"ระดับเขต",MOPH:"ระดับ สป.",DONE:"เสร็จสิ้น"};

  function fillProcessStatus(levelId,statusId,allowKeep=false) {
    const level = $(levelId).value || (allowKeep ? "" : "PROVINCE");
    const previous = $(statusId).value;
    const options = level ? (PROCESS_STATUS[level] || []) : [];
    $(statusId).innerHTML = (allowKeep ? '<option value="">คงเดิม</option>' : "") + options.map(x => '<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    if ([...$(statusId).options].some(o => o.value === previous)) $(statusId).value = previous;
  }

  const pageTitles = {
    dashboard:"ภาพรวมระบบ", positions:"Position Master", vacancies:"ตำแหน่งว่างและ Workflow",
    hrops:"นำเข้า จ.18 / HROPS", users:"ผู้ใช้งานและสิทธิ์", audit:"Audit Log"
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const fmtDate = value => {
    if (!value) return "-";
    const d = new Date(String(value).length === 10 ? value + "T00:00:00" : value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return new Intl.DateTimeFormat("th-TH",{year:"numeric",month:"short",day:"numeric"}).format(d);
  };
  const fmtDateTime = value => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return new Intl.DateTimeFormat("th-TH",{year:"2-digit",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
  };
  const roleRules = () => ROLE_RULES[state.me?.role] || {hrops:false,users:false,audit:false,write:false,scope:"-",permission:"-"};

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  async function api(path, options={}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", "Bearer " + state.token);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
    const response = await fetch(path, {...options, headers});
    if (response.status === 401) {
      logout(false);
      throw new Error("Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail || data));
    }
    return data;
  }

  function logout(show=true) {
    state.token = null; state.me = null;
    sessionStorage.removeItem(TOKEN_KEY);
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    if (show) toast("ออกจากระบบแล้ว");
  }

  function configureRoleUI() {
    const rules = roleRules();
    document.querySelectorAll("[data-permission]").forEach(el => {
      const key = el.dataset.permission;
      el.classList.toggle("hidden", !rules[key]);
    });
    $("userName").textContent = state.me.full_name;
    $("userRole").textContent = state.me.role;
    $("userInitial").textContent = (state.me.full_name || state.me.username || "U").trim().charAt(0).toUpperCase();
    const scopeParts = [rules.scope];
    if (state.me.province_code) scopeParts.push("จังหวัด " + state.me.province_code);
    if (state.me.unit_id) scopeParts.push("หน่วยงาน " + state.me.unit_id);
    $("sidebarScope").innerHTML = "<strong>Data Scope</strong><br>" + esc(scopeParts.join(" • "));
    $("currentPermissionText").textContent = rules.permission;
    $("vacancyScopeLabel").textContent = rules.scope;
  }

  async function loadReferences() {
    const data = await api("/api/reference");
    state.provinces = data.provinces || [];
    state.units = data.units || [];
    $("newProvince").innerHTML = '<option value="">เลือกจังหวัด</option>' + state.provinces.map(p => '<option value="'+esc(p.province_code)+'">'+esc(p.province_name_th)+'</option>').join("");
    renderUnitOptions();
  }

  function renderUnitOptions() {
    const province = $("newProvince").value;
    const units = province ? state.units.filter(u => u.province_code === province) : state.units;
    $("newUnit").innerHTML = '<option value="">เลือกหน่วยงาน</option>' + units.map(u => '<option value="'+esc(u.unit_id)+'">'+esc(u.unit_name)+' ('+esc(u.province_code)+')</option>').join("");
  }

  function configureNewUserForm() {
    if (!state.me) return;
    const roles = state.me.role === "MOPH_ADMIN"
      ? ["MOPH_ADMIN","REGION_ADMIN","REGION_EXECUTIVE","PROVINCE_ADMIN","HOSPITAL_HR","AUDITOR"]
      : ["REGION_ADMIN","REGION_EXECUTIVE","PROVINCE_ADMIN","HOSPITAL_HR","AUDITOR"];
    $("newRole").innerHTML = roles.map(r => '<option value="'+r+'">'+r+'</option>').join("");
    updateScopeFields();
  }

  function updateScopeFields() {
    const role = $("newRole").value;
    $("provinceField").classList.toggle("hidden", role !== "PROVINCE_ADMIN");
    $("unitField").classList.toggle("hidden", role !== "HOSPITAL_HR");
  }

  function navigate(page) {
    const rules = roleRules();
    if ((page === "hrops" && !rules.hrops) || (page === "users" && !rules.users) || (page === "audit" && !rules.audit)) page = "dashboard";
    state.page = page;
    document.querySelectorAll(".page").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
    $("page-" + page).classList.add("active");
    $("pageTitle").textContent = pageTitles[page] || "CHRO HR1";
    if (page === "dashboard") loadDashboard();
    if (page === "positions") loadPositions();
    if (page === "vacancies") loadVacancies();
    if (page === "hrops") loadHropsHistory();
    if (page === "users") { configureNewUserForm(); loadUsers(); }
    if (page === "audit") loadAudit();
  }

  async function loadDashboard() {
    try {
      const d = await api("/api/dashboard/summary");
      $("metricPositions").textContent = Number(d.positions_total || 0).toLocaleString("th-TH");
      $("metricVacancies").textContent = Number(d.vacancies_active || 0).toLocaleString("th-TH");
      $("metricWaiting").textContent = Number(d.waiting_approval || 0).toLocaleString("th-TH");
      $("metricRecruiting").textContent = Number(d.recruiting_or_appointing || 0).toLocaleString("th-TH");
      if (d.latest_import) {
        const x = d.latest_import;
        $("latestImport").innerHTML = '<strong>'+esc(fmtDate(x.baseline_month))+'</strong><span>'+esc(x.original_filename)+' • '+Number(x.row_count || 0).toLocaleString("th-TH")+' rows</span><span>Status: '+esc(x.status)+' • '+esc(fmtDateTime(x.created_at))+'</span>';
      } else {
        $("latestImport").innerHTML = "<strong>ยังไม่มี Baseline</strong><span>รอ บค.เขต Upload จ.18 / HROPS รอบแรก</span>";
      }
    } catch (e) { toast(e.message); }
  }

  async function loadPositions() {
    const q = $("positionSearch").value.trim();
    $("positionRows").innerHTML = '<tr><td colspan="7">กำลังโหลด...</td></tr>';
    try {
      const d = await api("/api/positions?limit=100&q=" + encodeURIComponent(q));
      $("positionCount").textContent = Number(d.total || 0).toLocaleString("th-TH") + " รายการ";
      const canWrite = roleRules().write;
      $("positionRows").innerHTML = (d.positions || []).map(p => {
        const action = canWrite ? '<button class="btn btn-ghost open-vacancy" data-position="'+esc(p.position_uid)+'" data-unit="'+esc(p.unit_id)+'" data-label="'+esc((p.hrops_position_no||p.chro_position_id)+" • "+p.position_name_th+" • "+p.unit_name)+'">เปิด Case</button>' : "";
        return '<tr><td><div class="cell-title">'+esc(p.hrops_position_no || p.chro_position_id)+'</div><div class="cell-sub">'+esc(p.chro_position_id)+'</div></td><td>'+esc(p.position_type || "-")+'</td><td>'+esc(p.position_name_th)+'</td><td>'+esc(p.position_level || "-")+'</td><td>'+esc(p.unit_name)+'</td><td>'+esc(p.province_code)+'</td><td>'+action+'</td></tr>';
      }).join("") || '<tr><td colspan="7">ไม่พบข้อมูล</td></tr>';
      document.querySelectorAll(".open-vacancy").forEach(btn => btn.addEventListener("click", () => openVacancyDialog(btn)));
    } catch (e) { $("positionRows").innerHTML = '<tr><td colspan="7">'+esc(e.message)+'</td></tr>'; }
  }

  function statusBadge(status) {
    let cls = "badge";
    if (status === "WAITING_APPROVAL") cls += " wait";
    else if (status === "FILLED") cls += " good";
    else if (["READY_TO_RECRUIT","RECRUITING","APPOINTING"].includes(status)) cls += " blue";
    return '<span class="'+cls+'">'+esc(status || "-")+'</span>';
  }

  async function loadVacancies() {
    $("vacancyRows").innerHTML = '<tr><td colspan="9">กำลังโหลด...</td></tr>';
    try {
      const d = await api("/api/vacancies?limit=200");
      $("vacancyCount").textContent = Number(d.total || 0).toLocaleString("th-TH") + " รายการ";
      const canWrite = roleRules().write;
      $("vacancyRows").innerHTML = (d.vacancies || []).map(v => {
        const action = canWrite ? '<button class="btn btn-ghost update-vacancy" data-case="'+esc(v.case_id)+'" data-label="'+esc(v.case_no+" • "+v.position_name_th)+'">อัปเดต</button>' : "";
        const approve = v.retirement_use_approved ? '<div class="cell-sub">✓ บค.สป. อนุมัติแล้ว</div>' : "";
        const process = '<span class="badge blue">'+esc(PROCESS_LEVEL_LABEL[v.process_level] || v.process_level || "-")+'</span><div class="cell-title">'+esc(v.process_status || "-")+'</div>'+(v.process_detail?'<div class="cell-sub">'+esc(v.process_detail)+'</div>':'');
        return '<tr><td><div class="cell-title">'+esc(v.case_no)+'</div></td><td>'+esc(v.position_name_th)+'<div class="cell-sub">'+esc(v.position_level || "-")+'</div></td><td>'+esc(v.unit_name)+'</td><td>'+fmtDate(v.vacant_date)+'</td><td>'+esc(v.vacant_reason)+approve+'</td><td>'+process+'</td><td>'+esc(v.current_milestone)+'</td><td>'+statusBadge(v.status)+'</td><td>'+action+'</td></tr>';
      }).join("") || '<tr><td colspan="9">ยังไม่มี Vacancy Case</td></tr>';
      document.querySelectorAll(".update-vacancy").forEach(btn => btn.addEventListener("click", () => openEventDialog(btn)));
    } catch (e) { $("vacancyRows").innerHTML = '<tr><td colspan="9">'+esc(e.message)+'</td></tr>'; }
  }

  function openVacancyDialog(btn) {
    $("vacancyPositionUid").value = btn.dataset.position;
    $("vacancyUnitId").value = btn.dataset.unit;
    $("vacancyPositionLabel").textContent = btn.dataset.label;
    $("vacancyCaseNo").value = "VAC-" + new Date().getFullYear() + "-";
    $("vacancyDate").value = new Date().toISOString().slice(0,10);
    $("vacancyProcessLevel").value = "PROVINCE";
    fillProcessStatus("vacancyProcessLevel","vacancyProcessStatus");
    $("vacancyProcessDetail").value = "";
    $("vacancyRemarks").value = "";
    $("vacancyDialog").showModal();
  }

  function openEventDialog(btn) {
    $("eventCaseId").value = btn.dataset.case;
    $("eventCaseLabel").textContent = btn.dataset.label;
    $("eventType").value = "STATUS_UPDATED";
    $("eventStatus").value = "";
    $("eventMilestone").value = "";
    $("eventProcessLevel").value = "";
    fillProcessStatus("eventProcessLevel","eventProcessStatus",true);
    $("eventProcessDetail").value = "";
    $("eventDocNo").value = "";
    $("eventRetirementApproved").checked = false;
    $("eventDocDate").value = "";
    $("eventUseFrom").value = "";
    $("eventNotes").value = "";
    $("eventDialog").showModal();
  }

  async function loadHropsHistory() {
    $("hropsHistory").innerHTML = "กำลังโหลด...";
    try {
      const rows = await api("/api/hrops/imports");
      $("hropsHistory").innerHTML = rows.map(x => {
        const s = x.validation_summary || {};
        return '<div class="history-item"><div class="history-top"><strong>'+fmtDate(x.baseline_month)+'</strong>'+statusBadge(x.status)+'</div><span>'+esc(x.original_filename)+'</span><span>'+Number(x.row_count || 0).toLocaleString("th-TH")+' rows • Insert '+Number(s.inserted||0).toLocaleString("th-TH")+' • Update '+Number(s.updated||0).toLocaleString("th-TH")+'</span><span>'+fmtDateTime(x.created_at)+'</span></div>';
      }).join("") || '<div class="muted">ยังไม่มีประวัติการนำเข้า</div>';
    } catch(e) { $("hropsHistory").textContent = e.message; }
  }

  async function loadUsers() {
    $("userRows").innerHTML = '<tr><td colspan="4">กำลังโหลด...</td></tr>';
    try {
      const rows = await api("/api/admin/users");
      $("userRows").innerHTML = rows.map(u => {
        const scope = u.unit_id ? "Unit " + u.unit_id : u.province_code ? "Province " + u.province_code : "Region 1";
        return '<tr><td><div class="cell-title">'+esc(u.full_name)+'</div><div class="cell-sub">'+esc(u.username)+'</div></td><td><span class="badge blue">'+esc(u.role)+'</span></td><td>'+esc(scope)+'</td><td>'+(u.is_active?'<span class="badge good">Active</span>':'<span class="badge">Inactive</span>')+'</td></tr>';
      }).join("");
    } catch(e) { $("userRows").innerHTML = '<tr><td colspan="4">'+esc(e.message)+'</td></tr>'; }
  }

  async function loadAudit() {
    $("auditRows").innerHTML = '<tr><td colspan="6">กำลังโหลด...</td></tr>';
    try {
      const rows = await api("/api/audit?limit=300");
      $("auditRows").innerHTML = rows.map(x => '<tr><td>'+fmtDateTime(x.created_at)+'</td><td><span class="badge">'+esc(x.action)+'</span></td><td>'+esc(x.entity_type)+'<div class="cell-sub">'+esc(x.entity_id || "")+'</div></td><td>'+esc(x.actor_user_id || "-")+'</td><td>'+esc(x.request_path || "-")+'</td><td>'+esc(x.ip_address || "-")+'</td></tr>').join("");
    } catch(e) { $("auditRows").innerHTML = '<tr><td colspan="6">'+esc(e.message)+'</td></tr>'; }
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("loginMessage").textContent = "กำลังตรวจสอบ...";
    try {
      const body = new URLSearchParams({username:$("loginUsername").value.trim(), password:$("loginPassword").value});
      const r = await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || "เข้าสู่ระบบไม่สำเร็จ");
      state.token = data.access_token;
      sessionStorage.setItem(TOKEN_KEY,state.token);
      await boot();
      $("loginMessage").textContent = "";
    } catch(e2) { $("loginMessage").textContent = e2.message; }
  });

  async function boot() {
    state.me = await api("/api/auth/me");
    await loadReferences();
    configureRoleUI();
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    navigate("dashboard");
  }

  $("logoutButton").addEventListener("click", () => logout());
  $("refreshDashboard").addEventListener("click", loadDashboard);
  $("positionSearchButton").addEventListener("click", loadPositions);
  $("positionSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadPositions(); });
  $("refreshAudit").addEventListener("click", loadAudit);
  $("newProvince").addEventListener("change", renderUnitOptions);
  $("newRole").addEventListener("change", updateScopeFields);
  $("vacancyProcessLevel").addEventListener("change", () => fillProcessStatus("vacancyProcessLevel","vacancyProcessStatus"));
  $("eventProcessLevel").addEventListener("change", () => fillProcessStatus("eventProcessLevel","eventProcessStatus",true));

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.page)));
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => $(btn.dataset.close).close()));

  $("vacancyForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const payload = {
        case_no:$("vacancyCaseNo").value.trim(),
        position_uid:$("vacancyPositionUid").value,
        responsible_unit_id:$("vacancyUnitId").value,
        vacant_date:$("vacancyDate").value,
        vacant_reason:$("vacancyReason").value,
        status:"OPEN",
        current_milestone:$("vacancyMilestone").value,
        process_level:$("vacancyProcessLevel").value,
        process_status:$("vacancyProcessStatus").value,
        process_detail:$("vacancyProcessDetail").value.trim() || null,
        remarks:$("vacancyRemarks").value.trim() || null
      };
      await api("/api/vacancies",{method:"POST",body:JSON.stringify(payload)});
      $("vacancyDialog").close();
      toast("สร้าง Vacancy Case แล้ว");
      loadVacancies();
    } catch(e2) { toast(e2.message); }
  });

  $("eventForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("eventCaseId").value;
    try {
      const payload = {
        event_type:$("eventType").value,
        to_status:$("eventStatus").value || null,
        milestone:$("eventMilestone").value || null,
        process_level:$("eventProcessLevel").value || null,
        process_status:$("eventProcessStatus").value || null,
        process_detail:$("eventProcessDetail").value.trim() || null,
        reference_doc_no:$("eventDocNo").value.trim() || null,
        notes:$("eventNotes").value.trim() || null,
        retirement_use_approved:$("eventRetirementApproved").checked ? true : null,
        retirement_approval_doc_no:$("eventDocNo").value.trim() || null,
        retirement_approval_doc_date:$("eventDocDate").value || null,
        retirement_use_from_date:$("eventUseFrom").value || null
      };
      await api("/api/vacancies/"+encodeURIComponent(id)+"/events",{method:"POST",body:JSON.stringify(payload)});
      $("eventDialog").close();
      toast("บันทึก Workflow Event แล้ว");
      loadVacancies(); loadDashboard();
    } catch(e2) { toast(e2.message); }
  });

  $("hropsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const file = $("hropsFile").files[0], month = $("hropsMonth").value;
    if (!file || !month) return;
    const body = new FormData();
    body.append("baseline_month", month + "-01");
    body.append("notes", $("hropsNotes").value.trim());
    body.append("file", file);
    $("hropsProgress").textContent = "กำลังอ่าน Sheet 2 และ Update DB...";
    $("hropsResult").classList.add("hidden");
    try {
      const r = await api("/api/hrops/imports",{method:"POST",body});
      const s = r.summary || {};
      $("hropsResult").innerHTML = '<strong>นำเข้าข้อมูลสำเร็จ</strong><div class="result-grid"><div><span>Rows</span><strong>'+Number(s.rows_seen||0).toLocaleString("th-TH")+'</strong></div><div><span>Insert</span><strong>'+Number(s.inserted||0).toLocaleString("th-TH")+'</strong></div><div><span>Update</span><strong>'+Number(s.updated||0).toLocaleString("th-TH")+'</strong></div><div><span>Unchanged</span><strong>'+Number(s.unchanged||0).toLocaleString("th-TH")+'</strong></div><div><span>Vacant</span><strong>'+Number(s.vacant||0).toLocaleString("th-TH")+'</strong></div><div><span>Skipped</span><strong>'+Number(s.skipped||0).toLocaleString("th-TH")+'</strong></div></div>';
      $("hropsResult").classList.remove("hidden");
      $("hropsProgress").textContent = "Database updated";
      toast("จ.18 / HROPS อัปเดตฐานข้อมูลแล้ว");
      await loadHropsHistory(); loadDashboard();
    } catch(e2) {
      $("hropsProgress").textContent = "ไม่สำเร็จ";
      $("hropsResult").innerHTML = '<strong>Import ไม่สำเร็จ</strong><div class="cell-sub">'+esc(e2.message)+'</div>';
      $("hropsResult").classList.remove("hidden");
    }
  });

  $("userForm").addEventListener("submit", async e => {
    e.preventDefault();
    const role = $("newRole").value;
    const payload = {
      full_name:$("newFullName").value.trim(),
      username:$("newUsername").value.trim(),
      password:$("newPassword").value,
      role,
      province_code: role === "PROVINCE_ADMIN" ? ($("newProvince").value || null) : null,
      unit_id: role === "HOSPITAL_HR" ? ($("newUnit").value || null) : null
    };
    $("userFormMessage").textContent = "กำลังสร้าง...";
    try {
      await api("/api/admin/users",{method:"POST",body:JSON.stringify(payload)});
      $("userForm").reset();
      configureNewUserForm();
      $("userFormMessage").textContent = "สร้างบัญชีเรียบร้อย";
      toast("สร้างผู้ใช้งานแล้ว");
      loadUsers();
    } catch(e2) { $("userFormMessage").textContent = e2.message; }
  });

  if (state.token) boot().catch(() => logout(false));
})();
