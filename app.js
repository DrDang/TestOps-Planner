"use strict";

const STORAGE_KEY = "testops-planner-v2";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROGRAM_COLORS = ["#246b5d", "#8b4b8f", "#2f6f9f", "#b45c2d", "#5b6f28", "#7d4e2c", "#355da8", "#9a3d54"];
const BAD_STATUSES = new Set(["Down", "Out for Calibration", "Retired", "Unknown"]);

const emptyData = {
  metadata: { name: "Untitled TestOps Plan", updatedAt: new Date().toISOString() },
  programs: [],
  uuts: [],
  assets: [],
  testEvents: [],
  conflicts: [],
  settings: {}
};

const sampleData = {
  metadata: { name: "Sample TestOps Plan", updatedAt: new Date().toISOString() },
  programs: ["Program Alpha", "Program Beta", "Program Orion", "Program Lumen"],
  uuts: ["UUT-001", "UUT-002", "UUT-003", "Payload A", "Flight Unit 2"],
  assets: [
    asset("A-001", "RF Station 1", "Station", true, "RF Lab", "Test Engineering", "Available", false, 1, false, ""),
    asset("A-002", "Thermal Chamber East", "Chamber", false, "Environmental Lab", "Env Test", "Available", false, 1, true, "2026-09-15"),
    asset("A-003", "Spectrum Analyzer SA-001", "Spectrum Analyzer", false, "RF Lab", "Metrology", "Available", false, 1, true, "2026-08-01"),
    asset("A-004", "10 MHz Reference", "Timing Reference", false, "RF Lab", "Test Engineering", "Available", true, 3, true, "2027-01-10"),
    asset("A-005", "ESS Station", "Station", true, "Environmental Lab", "Env Test", "Available", false, 1, false, ""),
    asset("A-006", "EMI Receiver", "EMI Equipment", false, "Compliance Lab", "Compliance", "Out for Calibration", false, 1, true, "2026-06-20"),
    asset("A-007", "Power Supply Stack", "Power Supply", false, "Bench 4", "Test Engineering", "Available", false, 2, true, "2026-11-30"),
    asset("A-008", "Integration Bench 2", "Station", true, "Systems Lab", "Systems", "Available", false, 1, false, "")
  ],
  testEvents: [
    event("T-001", "Avionics RF Checkout", "Program Alpha", "UUT-001", "RF Checkout", "2026-07-08", "2026-07-12", "A-001", ["A-003", "A-004", "A-007"], "High", "Test Engineering", "Planned"),
    event("T-002", "Payload Thermal Cycle", "Program Orion", "Payload A", "ESS", "2026-07-10", "2026-07-18", "A-005", ["A-002", "A-007"], "Critical", "Env Test", "Approved"),
    event("T-003", "EMI Pre-Scan", "Program Beta", "UUT-002", "EMI", "2026-07-09", "2026-07-11", "A-008", ["A-006", "A-004"], "Medium", "Compliance", "Planned"),
    event("T-004", "RF Regression", "Program Beta", "UUT-003", "RF Checkout", "2026-07-10", "2026-07-14", "A-001", ["A-003", "A-004"], "High", "Test Engineering", "Planned"),
    event("T-005", "Flight Unit Integration", "Program Lumen", "Flight Unit 2", "Integration", "2026-07-22", "2026-07-30", "A-008", ["A-004", "A-007"], "Medium", "Systems", "Draft"),
    event("T-006", "UUT-001 Debug Retest", "Program Alpha", "UUT-001", "Debug", "2026-07-11", "2026-07-16", "A-008", ["A-007"], "High", "Test Engineering", "Delayed")
  ],
  conflicts: [],
  settings: {}
};

let state = loadState();
let selectedAssetId = "";
let selectedEventId = "";
let activeView = "schedule";

function asset(id, name, assetType, isStation, location, owner, status, shareable, maxConcurrentUses, calibrationRequired, calibrationDueDate) {
  return { id, name, assetType, isStation, quantity: maxConcurrentUses, serialNumber: "", location, owner, status, shareable, maxConcurrentUses, calibrationRequired, calibrationDueDate, notes: "" };
}

function event(id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, priority, owner, status) {
  return { id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, priority, owner, status, notes: "" };
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(emptyData);
  try {
    return normalizeState(JSON.parse(stored));
  } catch {
    return structuredClone(emptyData);
  }
}

function normalizeState(data) {
  const normalized = {
    metadata: data.metadata || {},
    programs: data.programs || [],
    uuts: data.uuts || [],
    assets: data.assets || [],
    testEvents: data.testEvents || [],
    conflicts: data.conflicts || [],
    settings: data.settings || {}
  };
  return reconcileState(normalized);
}

function reconcileState(nextState = state) {
  nextState.assets = nextState.assets.map(({ assetTag, ...assetItem }) => assetItem);
  const validAssetIds = new Set(nextState.assets.map((item) => item.id));
  const stationIds = new Set(nextState.assets.filter((item) => item.isStation).map((item) => item.id));
  nextState.testEvents = nextState.testEvents.map((testEvent) => {
    const stationAssetId = stationIds.has(testEvent.stationAssetId) ? testEvent.stationAssetId : "";
    return {
      ...testEvent,
      stationAssetId,
      requiredAssetIds: [...new Set([stationAssetId, ...(testEvent.requiredAssetIds || [])].filter((assetId) => validAssetIds.has(assetId)))]
    };
  });
  nextState.programs = unique([...(nextState.programs || []), ...nextState.testEvents.map((item) => item.program)]);
  nextState.uuts = unique([...(nextState.uuts || []), ...nextState.testEvents.map((item) => item.uut)]);
  return nextState;
}

function saveState() {
  state.metadata.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state, null, 2));
}

function byId(collection) {
  return new Map(collection.map((item) => [item.id, item]));
}

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function dateISO(date) {
  return date.toISOString().slice(0, 10);
}

function daysInclusive(startDate, endDate) {
  return Math.max(1, Math.round((parseDate(endDate) - parseDate(startDate)) / MS_PER_DAY) + 1);
}

function overlaps(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function overlapRange(a, b) {
  return { startDate: a.startDate > b.startDate ? a.startDate : b.startDate, endDate: a.endDate < b.endDate ? a.endDate : b.endDate };
}

function fullAssetIds(testEvent) {
  return [...new Set([testEvent.stationAssetId, ...(testEvent.requiredAssetIds || [])].filter(Boolean))];
}

function assetIdentity(assetItem) {
  return assetItem.serialNumber ? `SN ${assetItem.serialNumber}` : "No serial number";
}

function assetOptionLabel(assetItem) {
  return `${assetItem.name}${assetItem.serialNumber ? ` / SN ${assetItem.serialNumber}` : ""}`;
}

function assetAllocation(assetId, startDate, endDate, currentEventId = "") {
  const assetItem = state.assets.find((item) => item.id === assetId);
  if (!assetItem || !startDate || !endDate) return { level: "open", label: "Check dates", detail: "Set event dates to check allocation." };
  const range = { startDate, endDate };
  const overlappingEvents = state.testEvents.filter((testEvent) => {
    if (testEvent.id === currentEventId) return false;
    return fullAssetIds(testEvent).includes(assetId) && overlaps(testEvent, range);
  });
  const capacity = Number(assetItem.maxConcurrentUses || assetItem.quantity || 1);

  if (BAD_STATUSES.has(assetItem.status)) {
    return { level: "blocked", label: assetItem.status, detail: `Asset status is ${assetItem.status}.` };
  }
  if (assetItem.calibrationRequired && assetItem.calibrationDueDate && assetItem.calibrationDueDate < endDate) {
    return { level: "warning", label: "Calibration due", detail: `Calibration due ${assetItem.calibrationDueDate}.` };
  }
  if (overlappingEvents.length >= capacity) {
    return {
      level: "allocated",
      label: "Already allocated",
      detail: overlappingEvents.map((testEvent) => `${testEvent.name} (${testEvent.startDate} to ${testEvent.endDate})`).join("; ")
    };
  }
  if (overlappingEvents.length) {
    return {
      level: "shared",
      label: `${capacity - overlappingEvents.length} slot open`,
      detail: `${overlappingEvents.length} overlapping use${overlappingEvents.length === 1 ? "" : "s"} of ${capacity}.`
    };
  }
  return { level: "open", label: "Available", detail: "No overlapping use for this event window." };
}

function getFilteredEvents() {
  const filters = readFilters();
  return state.testEvents.filter((item) => {
    if (filters.program && item.program !== filters.program) return false;
    if (filters.uut && item.uut !== filters.uut) return false;
    if (filters.station && item.stationAssetId !== filters.station) return false;
    if (filters.owner && item.owner !== filters.owner) return false;
    if (filters.from && item.endDate < filters.from) return false;
    if (filters.to && item.startDate > filters.to) return false;
    return true;
  });
}

function readFilters() {
  return {
    program: value("programFilter"),
    uut: value("uutFilter"),
    station: value("stationFilter"),
    owner: value("ownerFilter"),
    from: value("fromFilter"),
    to: value("toFilter")
  };
}

function value(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setValue(id, nextValue) {
  const el = document.getElementById(id);
  if (el) el.value = nextValue || "";
}

function formText(form, name) {
  return String(form.get(name) || "").trim();
}

function formValue(form, name) {
  return String(form.get(name) || "");
}

function setActiveView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === activeView));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${activeView}`));
}

function openAssetModal() {
  document.getElementById("assetModalTitle").textContent = selectedAssetId ? "Edit Asset" : "Add Asset";
  renderAssetForm();
  document.getElementById("assetModal").hidden = false;
  document.getElementById("asset-name")?.focus();
}

function closeAssetModal() {
  document.getElementById("assetModal").hidden = true;
}

function openEventModal() {
  document.getElementById("eventModalTitle").textContent = selectedEventId ? "Edit Event" : "Add Event";
  renderEventForm();
  document.getElementById("eventModal").hidden = false;
  document.getElementById("event-name")?.focus();
}

function closeEventModal() {
  document.getElementById("eventModal").hidden = true;
}

function detectConflicts(events = state.testEvents) {
  const assetsById = byId(state.assets);
  const conflicts = [];
  let sequence = 1;
  const addConflict = (conflict) => {
    conflicts.push({ id: `C-${String(sequence++).padStart(3, "0")}`, status: "Open", ...conflict });
  };

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const first = events[i];
      const second = events[j];
      if (!overlaps(first, second)) continue;
      const window = overlapRange(first, second);

      if (first.uut && first.uut === second.uut) {
        addConflict({
          conflictType: "UUT",
          assetId: "",
          uut: first.uut,
          ...window,
          eventIds: [first.id, second.id],
          programs: [...new Set([first.program, second.program].filter(Boolean))],
          severity: severityFor([first, second], window),
          explanation: `${first.name} and ${second.name} both use ${first.uut} from ${window.startDate} to ${window.endDate}.`,
          suggestedResolution: "Reschedule one event or confirm the UUT can support parallel test activity."
        });
      }

      const sharedAssets = fullAssetIds(first).filter((assetId) => fullAssetIds(second).includes(assetId));
      sharedAssets.forEach((assetId) => {
        const conflictedAsset = assetsById.get(assetId);
        if (!conflictedAsset) return;
        const capacity = Number(conflictedAsset.maxConcurrentUses || conflictedAsset.quantity || 1);
        if (capacity > 1) return;
        const conflictType = conflictedAsset.isStation ? "Station" : "Equipment";
        addConflict({
          conflictType,
          assetId,
          uut: "",
          ...window,
          eventIds: [first.id, second.id],
          programs: [...new Set([first.program, second.program].filter(Boolean))],
          severity: severityFor([first, second], window),
          explanation: `${first.name} and ${second.name} both require ${conflictedAsset.name} from ${window.startDate} to ${window.endDate}. ${conflictedAsset.name} supports ${capacity} concurrent use${capacity === 1 ? "" : "s"}.`,
          suggestedResolution: conflictedAsset.isStation ? "Reschedule one event or move an event to another station." : "Reschedule, substitute the asset, or buy/rent/borrow additional capacity."
        });
      });
    }
  }

  state.assets.forEach((assetItem) => {
    const capacity = Number(assetItem.maxConcurrentUses || assetItem.quantity || 1);
    if (capacity <= 1) return;
    const usingEvents = events.filter((testEvent) => fullAssetIds(testEvent).includes(assetItem.id));
    const peak = peakDemand(usingEvents);
    if (peak.count <= capacity) return;
    const activeEvents = usingEvents.filter((testEvent) => testEvent.startDate <= peak.dates && testEvent.endDate >= peak.dates);
    addConflict({
      conflictType: assetItem.isStation ? "Station" : "Equipment",
      assetId: assetItem.id,
      uut: "",
      startDate: peak.dates,
      endDate: peak.dates,
      eventIds: activeEvents.map((testEvent) => testEvent.id),
      programs: [...new Set(activeEvents.map((testEvent) => testEvent.program).filter(Boolean))],
      severity: severityFor(activeEvents, { startDate: peak.dates, endDate: peak.dates }),
      explanation: `${assetItem.name} has peak demand of ${peak.count} concurrent events on ${peak.dates}, exceeding available capacity of ${capacity}.`,
      suggestedResolution: assetItem.isStation ? "Move one or more events to another station or reschedule." : "Add capacity, substitute compatible assets, or reschedule lower-priority events."
    });
  });

  events.forEach((testEvent) => {
    fullAssetIds(testEvent).forEach((assetId) => {
      const usedAsset = assetsById.get(assetId);
      if (!usedAsset) return;
      if (BAD_STATUSES.has(usedAsset.status)) {
        addConflict({
          conflictType: "Availability",
          assetId,
          uut: "",
          startDate: testEvent.startDate,
          endDate: testEvent.endDate,
          eventIds: [testEvent.id],
          programs: [testEvent.program].filter(Boolean),
          severity: usedAsset.status === "Retired" || usedAsset.status === "Down" ? "High" : "Medium",
          explanation: `${testEvent.name} uses ${usedAsset.name}, but the asset status is ${usedAsset.status}.`,
          suggestedResolution: "Repair, replace, calibrate, or substitute the asset before the event starts."
        });
      }
      if (usedAsset.calibrationRequired && usedAsset.calibrationDueDate && usedAsset.calibrationDueDate < testEvent.endDate) {
        addConflict({
          conflictType: "Calibration",
          assetId,
          uut: "",
          startDate: testEvent.startDate,
          endDate: testEvent.endDate,
          eventIds: [testEvent.id],
          programs: [testEvent.program].filter(Boolean),
          severity: "Medium",
          explanation: `${usedAsset.name} calibration is due ${usedAsset.calibrationDueDate}, before ${testEvent.name} ends on ${testEvent.endDate}.`,
          suggestedResolution: "Calibrate before use, shorten the event, or assign a calibrated substitute."
        });
      }
    });
  });

  return conflicts;
}

function severityFor(events, window) {
  if (events.some((item) => ["Critical", "High"].includes(item.priority))) return "Critical";
  const daysUntil = Math.round((parseDate(window.startDate) - new Date()) / MS_PER_DAY);
  if (daysUntil <= 30) return "High";
  if (events.some((item) => item.priority === "Medium")) return "Medium";
  return "Low";
}

function computeBottlenecks(events = state.testEvents, conflicts = state.conflicts) {
  const assetEvents = new Map();
  events.forEach((testEvent) => {
    fullAssetIds(testEvent).forEach((assetId) => {
      if (!assetEvents.has(assetId)) assetEvents.set(assetId, []);
      assetEvents.get(assetId).push(testEvent);
    });
  });

  return state.assets.map((item) => {
    const usedBy = assetEvents.get(item.id) || [];
    const relatedConflicts = conflicts.filter((conflict) => conflict.assetId === item.id);
    const programs = new Set(usedBy.map((testEvent) => testEvent.program).filter(Boolean));
    const totalDays = usedBy.reduce((sum, testEvent) => sum + daysInclusive(testEvent.startDate, testEvent.endDate), 0);
    const peak = peakDemand(usedBy);
    const capacity = Number(item.maxConcurrentUses || item.quantity || 1);
    const shortage = Math.max(0, peak.count - capacity);
    const action = shortage > 0 ? "Buy/rent/borrow or reschedule" : relatedConflicts.length ? "Review conflict timing" : usedBy.length >= capacity * 3 ? "Monitor demand" : "No action";
    return {
      asset: item.name,
      assetId: item.id,
      assetType: item.assetType,
      conflicts: relatedConflicts.length,
      events: usedBy.length,
      programs: programs.size,
      totalDays,
      peakDemand: peak.count,
      capacity,
      shortage,
      peakDates: peak.dates,
      affectedEvents: peak.events.join(", "),
      affectedPrograms: [...programs].join(", "),
      action
    };
  }).sort((a, b) => b.conflicts - a.conflicts || b.peakDemand - a.peakDemand || b.totalDays - a.totalDays);
}

function peakDemand(events) {
  if (!events.length) return { count: 0, dates: "", events: [] };
  const starts = events.map((item) => item.startDate).sort();
  const ends = events.map((item) => item.endDate).sort();
  let min = starts[0];
  let max = ends[ends.length - 1];
  let best = { count: 0, date: min, events: [] };
  for (let cursor = parseDate(min); cursor <= parseDate(max); cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
    const iso = dateISO(cursor);
    const active = events.filter((item) => item.startDate <= iso && item.endDate >= iso);
    if (active.length > best.count) best = { count: active.length, date: iso, events: active.map((item) => item.id) };
  }
  return { count: best.count, dates: best.date, events: best.events };
}

function refresh() {
  state = reconcileState(state);
  state.conflicts = detectConflicts();
  saveState();
  renderFilters();
  renderDashboard();
  renderAssetForm();
  renderEventForm();
  renderAssetTable();
  renderEventTable();
  renderGantt();
  renderConflictTable();
  renderBottlenecks();
  renderReport();
  setActiveView(activeView);
}

function renderFilters() {
  fillSelect("programFilter", unique([...state.programs, ...state.testEvents.map((item) => item.program)]), "All programs", value("programFilter"));
  fillSelect("uutFilter", unique([...state.uuts, ...state.testEvents.map((item) => item.uut)]), "All UUTs", value("uutFilter"));
  fillSelect("stationFilter", state.assets.filter((item) => item.isStation).map((item) => ({ value: item.id, label: item.name })), "All stations", value("stationFilter"));
  fillSelect("ownerFilter", unique([...state.testEvents.map((item) => item.owner), ...state.assets.map((item) => item.owner)]), "All owners", value("ownerFilter"));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function fillSelect(id, options, emptyLabel, selected) {
  const select = document.getElementById(id);
  const normalized = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  select.innerHTML = [`<option value="">${emptyLabel}</option>`, ...normalized.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)].join("");
  select.value = normalized.some((option) => option.value === selected) ? selected : "";
}

function renderDashboard() {
  const conflicts = state.conflicts;
  const bottlenecks = computeBottlenecks(state.testEvents, conflicts);
  const critical = conflicts.filter((item) => item.severity === "Critical").length;
  const stationConflicts = conflicts.filter((item) => item.conflictType === "Station").length;
  document.getElementById("dashboard").innerHTML = [
    metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations`),
    metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`),
    metric("Open Conflicts", conflicts.length, `${critical} critical`),
    metric("Station Issues", stationConflicts, "overlap count"),
    metric("Top Bottleneck", bottlenecks[0]?.asset || "None", bottlenecks[0] ? `${bottlenecks[0].conflicts} conflicts` : "no demand")
  ].join("");
}

function metric(label, valueText, detail) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText))}</strong><em>${escapeHtml(detail)}</em></article>`;
}

function renderAssetForm() {
  const item = state.assets.find((assetItem) => assetItem.id === selectedAssetId) || emptyAsset();
  document.getElementById("assetForm").innerHTML = `
    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
    <div class="form-row">
      ${input("Asset ID", "idVisible", item.id, "text", true)}
      ${input("Asset Name", "name", item.name)}
    </div>
    <div class="form-row">
      ${input("Asset Type", "assetType", item.assetType)}
      ${input("Quantity", "quantity", item.quantity, "number")}
    </div>
    <div class="form-row">
      ${select("Status", "status", ["Available", "Down", "Out for Calibration", "Retired", "Limited Use", "Unknown"], item.status)}
      ${input("Max Concurrent Uses", "maxConcurrentUses", item.maxConcurrentUses, "number")}
    </div>
    <div class="form-row">
      ${input("Serial Number", "serialNumber", item.serialNumber)}
      ${input("Location", "location", item.location)}
    </div>
    <div class="form-row">
      ${input("Owner", "owner", item.owner)}
      ${input("Calibration Due Date", "calibrationDueDate", item.calibrationDueDate, "date")}
    </div>
    <div class="form-row">
      <div class="field">
        <label>Flags</label>
        <div class="checkbox-row"><input id="asset-isStation" name="isStation" type="checkbox" ${item.isStation ? "checked" : ""}><span>Is Station?</span></div>
        <div class="checkbox-row"><input id="asset-shareable" name="shareable" type="checkbox" ${item.shareable ? "checked" : ""}><span>Shareable?</span></div>
        <div class="checkbox-row"><input id="asset-calibrationRequired" name="calibrationRequired" type="checkbox" ${item.calibrationRequired ? "checked" : ""}><span>Calibration Required?</span></div>
      </div>
    </div>
    ${textarea("Notes", "notes", item.notes)}
    <div class="form-actions">
      <button type="submit">${selectedAssetId ? "Save Asset" : "Create Asset"}</button>
      <button type="button" class="secondary" id="cancelAssetBtn">Cancel</button>
    </div>
  `;
}

function renderEventForm() {
  const item = state.testEvents.find((eventItem) => eventItem.id === selectedEventId) || emptyEvent();
  const stations = state.assets.filter((assetItem) => assetItem.isStation).map((assetItem) => ({ value: assetItem.id, label: assetOptionLabel(assetItem) }));
  const programOptions = unique([...state.programs, ...state.testEvents.map((eventItem) => eventItem.program)]);
  const uutOptions = unique([...state.uuts, ...state.testEvents.map((eventItem) => eventItem.uut)]);
  document.getElementById("eventForm").innerHTML = `
    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
    <div class="form-row">
      ${input("Event ID", "idVisible", item.id, "text", true)}
      ${input("Event Name", "name", item.name)}
    </div>
    <div class="form-row">
      ${inputWithDatalist("Program", "program", item.program, programOptions)}
      ${inputWithDatalist("UUT", "uut", item.uut, uutOptions)}
    </div>
    <div class="form-row">
      ${input("Test Type", "testType", item.testType)}
      ${select("Assigned Station", "stationAssetId", stations, item.stationAssetId, "No station")}
    </div>
    <div class="form-row">
      ${input("Start Date", "startDate", item.startDate, "date")}
      ${input("End Date", "endDate", item.endDate, "date")}
    </div>
    <div class="form-row">
      ${select("Priority", "priority", ["Critical", "High", "Medium", "Low"], item.priority)}
      ${select("Status", "status", ["Draft", "Planned", "Approved", "In Work", "Complete", "Delayed", "Canceled"], item.status)}
    </div>
    ${input("Owner", "owner", item.owner)}
    <div class="field">
      <label>Required Equipment From Inventory</label>
      <div id="eventAssetPicker" class="asset-picker"></div>
    </div>
    ${textarea("Notes", "notes", item.notes)}
    <div class="form-actions">
      <button type="submit">${selectedEventId ? "Save Event" : "Create Event"}</button>
      <button type="button" class="secondary" id="cancelEventBtn">Cancel</button>
    </div>
  `;
  refreshEventAssetPicker();
}

function refreshEventAssetPicker() {
  const picker = document.getElementById("eventAssetPicker");
  if (!picker) return;
  const eventId = formValue(new FormData(document.getElementById("eventForm")), "id");
  const startDate = value("event-startDate");
  const endDate = value("event-endDate");
  const renderedCheckboxes = [...document.querySelectorAll('input[name="requiredAssetIds"]')];
  const selectedIds = new Set(
    renderedCheckboxes.filter((inputEl) => inputEl.checked).map((inputEl) => inputEl.value)
  );
  const currentEvent = state.testEvents.find((eventItem) => eventItem.id === eventId);
  if (!renderedCheckboxes.length) {
    (currentEvent?.requiredAssetIds || []).forEach((assetId) => selectedIds.add(assetId));
  }
  const stationAssetId = value("event-stationAssetId");
  selectedIds.delete(stationAssetId);
  const equipment = state.assets.filter((assetItem) => !assetItem.isStation);

  if (!equipment.length) {
    picker.innerHTML = `<div class="empty compact-empty"><h3>No equipment in inventory</h3><p>Add assets first, then assign them here.</p></div>`;
    return;
  }

  picker.innerHTML = equipment.map((assetItem) => {
    const allocation = assetAllocation(assetItem.id, startDate, endDate, eventId);
    const checked = selectedIds.has(assetItem.id) ? "checked" : "";
    const capacity = Number(assetItem.maxConcurrentUses || assetItem.quantity || 1);
    return `
      <label class="asset-choice ${allocation.level}">
        <input type="checkbox" name="requiredAssetIds" value="${escapeHtml(assetItem.id)}" ${checked}>
        <span class="asset-choice-main">
          <strong>${escapeHtml(assetItem.name || "Unnamed asset")}</strong>
          <span>${escapeHtml(assetItem.assetType || "Asset")} / ${escapeHtml(assetIdentity(assetItem))}</span>
          <small>${escapeHtml(assetItem.location || "No location")} / Capacity ${capacity}</small>
        </span>
        <span class="asset-choice-status">
          <b>${escapeHtml(allocation.label)}</b>
          <small>${escapeHtml(allocation.detail)}</small>
        </span>
      </label>
    `;
  }).join("");
}

function input(labelText, name, inputValue, type = "text", disabled = false) {
  const prefix = labelText.startsWith("Asset") || ["Quantity", "Status", "Max Concurrent Uses", "Serial Number", "Location", "Calibration Due Date"].includes(labelText) ? "asset" : "event";
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><input id="${prefix}-${name}" name="${name}" type="${type}" value="${escapeHtml(inputValue ?? "")}" ${disabled ? "disabled" : ""}></div>`;
}

function inputWithDatalist(labelText, name, inputValue, options) {
  const listId = `event-${name}-options`;
  return `<div class="field"><label for="event-${name}">${labelText}</label><input id="event-${name}" name="${name}" list="${listId}" value="${escapeHtml(inputValue ?? "")}"><datalist id="${listId}">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist></div>`;
}

function select(labelText, name, options, selected, emptyLabel = "") {
  const prefix = labelText === "Status" && name === "status" ? "asset" : "event";
  const normalized = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const choices = emptyLabel ? [`<option value="">${escapeHtml(emptyLabel)}</option>`] : [];
  choices.push(...normalized.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`));
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><select id="${prefix}-${name}" name="${name}">${choices.join("")}</select></div>`;
}

function textarea(labelText, name, textValue) {
  const prefix = labelText === "Notes" ? "event" : "asset";
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><textarea id="${prefix}-${name}" name="${name}">${escapeHtml(textValue || "")}</textarea></div>`;
}

function emptyAsset() {
  const next = nextId("A", state.assets);
  return { id: next, name: "", assetType: "", isStation: false, quantity: 1, serialNumber: "", location: "", owner: "", status: "Available", shareable: false, maxConcurrentUses: 1, calibrationRequired: false, calibrationDueDate: "", notes: "" };
}

function emptyEvent() {
  const next = nextId("T", state.testEvents);
  const today = dateISO(new Date());
  return { id: next, name: "", program: "", uut: "", testType: "", startDate: today, endDate: today, stationAssetId: "", requiredAssetIds: [], priority: "Medium", owner: "", status: "Draft", notes: "" };
}

function nextId(prefix, collection) {
  const highest = collection.reduce((max, item) => Math.max(max, Number(String(item.id).replace(`${prefix}-`, "")) || 0), 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function renderAssetTable() {
  const rows = state.assets.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.assetType,
    serial: item.serialNumber,
    station: item.isStation ? "Yes" : "No",
    status: statusBadge(item.status),
    capacity: item.maxConcurrentUses || item.quantity || 1,
    location: item.location,
    owner: item.owner,
    actions: rowActions("asset", item.id)
  }));
  renderTable("assetTable", ["id", "name", "type", "serial", "station", "status", "capacity", "location", "owner", "actions"], rows);
}

function renderEventTable() {
  const assetsById = byId(state.assets);
  const conflictEvents = new Set(state.conflicts.flatMap((item) => item.eventIds));
  const rows = getFilteredEvents().map((item) => ({
    id: item.id,
    name: item.name,
    program: item.program,
    uut: item.uut,
    dates: `${item.startDate} to ${item.endDate}`,
    station: assetsById.get(item.stationAssetId)?.name || "",
    priority: item.priority,
    status: item.status,
    conflicts: conflictEvents.has(item.id) ? badge("Conflict", "high") : badge("Clear", "ok"),
    actions: rowActions("event", item.id)
  }));
  renderTable("eventTable", ["id", "name", "program", "uut", "dates", "station", "priority", "status", "conflicts", "actions"], rows);
}

function rowActions(kind, id) {
  const duplicate = kind === "asset" ? `<button class="secondary" data-duplicate-asset="${escapeHtml(id)}">Duplicate</button>` : "";
  return `<div class="row-actions"><button class="secondary" data-edit-${kind}="${escapeHtml(id)}">Edit</button>${duplicate}<button class="secondary" data-delete-${kind}="${escapeHtml(id)}">Delete</button></div>`;
}

function statusBadge(status) {
  if (BAD_STATUSES.has(status)) return badge(status, "high");
  if (status === "Limited Use") return badge(status, "medium");
  return badge(status || "Unknown", "ok");
}

function badge(text, level) {
  return `<span class="badge ${escapeHtml(level.toLowerCase())}">${escapeHtml(text)}</span>`;
}

function renderTable(targetId, columns, rows) {
  const target = document.getElementById(targetId);
  if (!rows.length) {
    target.innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }
  target.innerHTML = `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderGantt() {
  const groupBy = value("groupBy");
  const events = getFilteredEvents().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const assetsById = byId(state.assets);
  const conflictEvents = new Set(state.conflicts.flatMap((item) => item.eventIds));
  document.getElementById("ganttTitle").textContent = labelize(groupBy === "events" ? "event schedule" : `${groupBy} schedule`);
  if (!events.length) {
    document.getElementById("gantt").innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }
  const start = events.map((item) => item.startDate).sort()[0];
  const end = events.map((item) => item.endDate).sort().at(-1);
  const months = monthLabels(start, end);
  const totalDays = Math.max(1, Math.round((parseDate(end) - parseDate(start)) / MS_PER_DAY) + 1);
  const groups = buildGroups(groupBy, events, assetsById);
  const html = `
    <div class="timeline">
      <div class="timeline-head">
        <div></div>
        <div class="month-grid" style="grid-template-columns: repeat(${months.length}, 1fr)">${months.map((month) => `<div class="month">${escapeHtml(month)}</div>`).join("")}</div>
      </div>
      ${groups.map((group) => renderLane(group, start, totalDays, assetsById, conflictEvents)).join("")}
    </div>
  `;
  document.getElementById("gantt").innerHTML = html;
}

function buildGroups(groupBy, events, assetsById) {
  if (groupBy === "events") return events.map((item) => ({ label: item.name, sublabel: `${item.program} / ${item.uut}`, events: [item] }));
  const map = new Map();
  const ensure = (key, label, sublabel = "") => {
    if (!map.has(key)) map.set(key, { label, sublabel, events: [] });
    return map.get(key);
  };
  if (groupBy === "stations") state.assets.filter((item) => item.isStation).forEach((item) => ensure(item.id, item.name, item.location));
  events.forEach((item) => {
    if (groupBy === "stations") ensure(item.stationAssetId || "unassigned", assetsById.get(item.stationAssetId)?.name || "Unassigned", "station").events.push(item);
    if (groupBy === "programs") ensure(item.program || "Unassigned", item.program || "Unassigned", "program").events.push(item);
    if (groupBy === "uuts") ensure(item.uut || "Unassigned", item.uut || "Unassigned", item.program).events.push(item);
    if (groupBy === "assets") fullAssetIds(item).forEach((assetId) => ensure(assetId, assetsById.get(assetId)?.name || assetId, assetsById.get(assetId)?.assetType || "asset").events.push(item));
  });
  return [...map.values()].filter((group) => group.events.length || groupBy === "stations");
}

function renderLane(group, start, totalDays, assetsById, conflictEvents) {
  const bars = group.events.map((item, index) => {
    const left = Math.max(0, ((parseDate(item.startDate) - parseDate(start)) / MS_PER_DAY) / totalDays * 100);
    const width = Math.max(2, daysInclusive(item.startDate, item.endDate) / totalDays * 100);
    const color = programColor(item.program);
    const station = assetsById.get(item.stationAssetId)?.name || "No station";
    const hasConflict = conflictEvents.has(item.id);
    const top = 10 + index * 40;
    return `<div class="bar ${hasConflict ? "conflict" : ""}" title="${escapeHtml(item.name)}" style="left:${left}%;width:${width}%;top:${top}px;background:${color}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.program)} / ${escapeHtml(item.uut)} / ${escapeHtml(station)}</span>${hasConflict ? '<span class="bar-badge">!</span>' : ""}</div>`;
  }).join("");
  const height = Math.max(64, 28 + group.events.length * 40);
  return `<div class="lane" style="min-height:${height}px"><div class="lane-label">${escapeHtml(group.label)}<small>${escapeHtml(group.sublabel || `${group.events.length} event${group.events.length === 1 ? "" : "s"}`)}</small></div><div class="bar-zone" style="min-height:${height}px">${bars}</div></div>`;
}

function monthLabels(start, end) {
  const labels = [];
  const cursor = new Date(parseDate(start).getFullYear(), parseDate(start).getMonth(), 1);
  const last = parseDate(end);
  while (cursor <= last) {
    labels.push(cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return labels.length ? labels : ["Schedule"];
}

function programColor(program) {
  const programs = unique(state.testEvents.map((item) => item.program));
  const index = Math.max(0, programs.indexOf(program));
  return PROGRAM_COLORS[index % PROGRAM_COLORS.length];
}

function renderConflictTable() {
  const assetsById = byId(state.assets);
  const eventsById = byId(state.testEvents);
  const rows = state.conflicts.map((item) => ({
    id: item.id,
    type: item.conflictType,
    item: item.assetId ? assetsById.get(item.assetId)?.name || item.assetId : item.uut,
    dates: `${item.startDate} to ${item.endDate}`,
    events: item.eventIds.map((id) => eventsById.get(id)?.name || id).join(", "),
    programs: item.programs.join(", "),
    severity: badge(item.severity, item.severity),
    explanation: escapeHtml(item.explanation),
    suggestedResolution: escapeHtml(item.suggestedResolution),
    status: item.status
  }));
  renderTable("conflictTable", ["id", "type", "item", "dates", "events", "programs", "severity", "explanation", "suggestedResolution", "status"], rows);
}

function renderBottlenecks() {
  const rows = computeBottlenecks().map((item) => ({
    asset: item.asset,
    assetType: item.assetType,
    conflicts: item.conflicts,
    events: item.events,
    programs: item.programs,
    totalDays: item.totalDays,
    peakDemand: item.peakDemand,
    capacity: item.capacity,
    shortage: item.shortage,
    peakDates: item.peakDates,
    affectedPrograms: item.affectedPrograms,
    action: item.action
  }));
  renderTable("bottleneckTable", ["asset", "assetType", "conflicts", "events", "programs", "totalDays", "peakDemand", "capacity", "shortage", "peakDates", "affectedPrograms", "action"], rows);
}

function renderReport() {
  const conflicts = state.conflicts;
  const bottlenecks = computeBottlenecks().slice(0, 5);
  document.getElementById("report").innerHTML = `
    <h3>Planning Summary</h3>
    <div class="report-grid">
      ${metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations`)}
      ${metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`)}
      ${metric("Conflicts", conflicts.length, `${conflicts.filter((item) => item.severity === "Critical").length} critical`)}
    </div>
    <h3>Highest Demand Assets</h3>
    ${tableMarkup(["asset", "assetType", "conflicts", "events", "peakDemand", "capacity", "action"], bottlenecks)}
    <h3>Open Conflicts</h3>
    ${tableMarkup(["id", "conflictType", "severity", "explanation", "suggestedResolution"], conflicts.slice(0, 12))}
  `;
}

function tableMarkup(columns, rows) {
  if (!rows.length) return document.getElementById("emptyState").innerHTML;
  return `<div class="table-wrap"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function handleAssetSubmit(eventObj) {
  eventObj.preventDefault();
  eventObj.stopPropagation();
  const form = new FormData(eventObj.currentTarget);
  const current = state.assets.find((item) => item.id === formValue(form, "id")) || emptyAsset();
  const next = {
    ...current,
    name: formText(form, "name"),
    assetType: formText(form, "assetType"),
    quantity: Number(formValue(form, "quantity")) || 1,
    serialNumber: formText(form, "serialNumber"),
    location: formText(form, "location"),
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Available",
    shareable: form.has("shareable"),
    maxConcurrentUses: Number(formValue(form, "maxConcurrentUses")) || 1,
    calibrationRequired: form.has("calibrationRequired"),
    calibrationDueDate: formValue(form, "calibrationDueDate"),
    notes: formText(form, "notes"),
    isStation: form.has("isStation")
  };
  const index = state.assets.findIndex((item) => item.id === next.id);
  if (index >= 0) state.assets[index] = next;
  else state.assets.push(next);
  selectedAssetId = next.id;
  setActiveView("assets");
  refresh();
  closeAssetModal();
}

function duplicateAsset(assetId) {
  const source = state.assets.find((item) => item.id === assetId);
  if (!source) return;
  const next = {
    ...structuredClone(source),
    id: nextId("A", state.assets),
    serialNumber: "",
    notes: source.notes ? `${source.notes}\nDuplicated from ${source.id}.` : `Duplicated from ${source.id}.`
  };
  state.assets.push(next);
  selectedAssetId = next.id;
  setActiveView("assets");
  refresh();
  openAssetModal();
}

function handleEventSubmit(eventObj) {
  eventObj.preventDefault();
  eventObj.stopPropagation();
  const form = new FormData(eventObj.currentTarget);
  const current = state.testEvents.find((item) => item.id === formValue(form, "id")) || emptyEvent();
  const validAssetIds = new Set(state.assets.map((item) => item.id));
  const stationIds = new Set(state.assets.filter((item) => item.isStation).map((item) => item.id));
  const requiredAssetIds = [...document.querySelectorAll('input[name="requiredAssetIds"]:checked')].map((inputEl) => inputEl.value).filter((assetId) => validAssetIds.has(assetId));
  const stationAssetId = stationIds.has(formValue(form, "stationAssetId")) ? formValue(form, "stationAssetId") : "";
  const startDate = formValue(form, "startDate");
  const endDate = formValue(form, "endDate");
  const program = formText(form, "program");
  const uut = formText(form, "uut");
  const next = {
    ...current,
    name: formText(form, "name"),
    program,
    uut,
    testType: formText(form, "testType"),
    startDate: startDate <= endDate ? startDate : endDate,
    endDate: endDate >= startDate ? endDate : startDate,
    stationAssetId,
    requiredAssetIds: [...new Set([stationAssetId, ...requiredAssetIds].filter(Boolean))],
    priority: formValue(form, "priority") || "Medium",
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Draft",
    notes: formText(form, "notes")
  };
  const index = state.testEvents.findIndex((item) => item.id === next.id);
  if (index >= 0) state.testEvents[index] = next;
  else state.testEvents.push(next);
  state.programs = unique([...state.programs, program]);
  state.uuts = unique([...state.uuts, uut]);
  selectedEventId = next.id;
  setActiveView("events");
  refresh();
  closeEventModal();
}

function exportJson() {
  download(`testops-plan-${dateISO(new Date())}.json`, JSON.stringify(state, null, 2), "application/json");
}

function exportCsv(kind) {
  const assetsById = byId(state.assets);
  const datasets = {
    assets: state.assets,
    events: state.testEvents.map((item) => ({ ...item, requiredAssets: fullAssetIds(item).map((id) => assetsById.get(id)?.name || id).join("; ") })),
    conflicts: state.conflicts,
    bottlenecks: computeBottlenecks(),
    schedule: getFilteredEvents()
  };
  const rows = datasets[kind] || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  download(`testops-${kind}-${dateISO(new Date())}.csv`, csv, "text/csv");
}

function csvCell(valueCell) {
  const text = Array.isArray(valueCell) ? valueCell.join("; ") : String(valueCell ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(JSON.parse(reader.result));
      selectedAssetId = "";
      selectedEventId = "";
      refresh();
    } catch (error) {
      alert(`Could not import JSON: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function labelize(text) {
  return String(text).replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

document.addEventListener("click", (eventObj) => {
  const closeTarget = eventObj.target.closest("[data-close-modal]");
  if (closeTarget) {
    if (closeTarget.dataset.closeModal === "asset") closeAssetModal();
    if (closeTarget.dataset.closeModal === "event") closeEventModal();
    return;
  }
  const target = eventObj.target.closest("button");
  if (!target) return;
  if (target.type === "submit" && target.closest("form")) return;
  if (target.dataset.view) {
    setActiveView(target.dataset.view);
  }
  if (target.id === "sampleBtn") {
    state = structuredClone(sampleData);
    selectedAssetId = "";
    selectedEventId = "";
    refresh();
  }
  if (target.id === "newPlanBtn" && confirm("Start a new blank plan? This will replace the current local plan in this browser.")) {
    state = structuredClone(emptyData);
    selectedAssetId = "";
    selectedEventId = "";
    refresh();
  }
  if (target.id === "exportJsonBtn") exportJson();
  if (target.id === "addAssetBtn") {
    selectedAssetId = "";
    openAssetModal();
  }
  if (target.id === "cancelAssetBtn") {
    closeAssetModal();
  }
  if (target.id === "addEventBtn") {
    selectedEventId = "";
    openEventModal();
  }
  if (target.id === "cancelEventBtn") {
    closeEventModal();
  }
  if (target.dataset.editAsset) {
    selectedAssetId = target.dataset.editAsset;
    setActiveView("assets");
    openAssetModal();
  }
  if (target.dataset.editEvent) {
    selectedEventId = target.dataset.editEvent;
    setActiveView("events");
    openEventModal();
  }
  if (target.dataset.duplicateAsset) {
    duplicateAsset(target.dataset.duplicateAsset);
  }
  if (target.dataset.deleteAsset && confirm("Delete this asset? It will also be removed from any event assignments.")) {
    const deletedAssetId = target.dataset.deleteAsset;
    state.assets = state.assets.filter((item) => item.id !== deletedAssetId);
    state.testEvents = state.testEvents.map((testEvent) => ({
      ...testEvent,
      stationAssetId: testEvent.stationAssetId === deletedAssetId ? "" : testEvent.stationAssetId,
      requiredAssetIds: (testEvent.requiredAssetIds || []).filter((assetId) => assetId !== deletedAssetId)
    }));
    selectedAssetId = "";
    refresh();
  }
  if (target.dataset.deleteEvent && confirm("Delete this event?")) {
    state.testEvents = state.testEvents.filter((item) => item.id !== target.dataset.deleteEvent);
    selectedEventId = "";
    refresh();
  }
  if (target.id === "clearFiltersBtn") {
    ["programFilter", "uutFilter", "stationFilter", "ownerFilter", "fromFilter", "toFilter"].forEach((id) => setValue(id, ""));
    refresh();
  }
  if (target.id === "printBtn") window.print();
  if (target.id === "exportAssetsCsvBtn") exportCsv("assets");
  if (target.id === "exportEventsCsvBtn") exportCsv("events");
  if (target.id === "exportConflictsCsvBtn") exportCsv("conflicts");
  if (target.id === "exportBottlenecksCsvBtn") exportCsv("bottlenecks");
  if (target.id === "exportScheduleCsvBtn") exportCsv("schedule");
});

document.getElementById("assetForm").addEventListener("submit", handleAssetSubmit);
document.getElementById("eventForm").addEventListener("submit", handleEventSubmit);

document.addEventListener("keydown", (eventObj) => {
  if (eventObj.key === "Escape") {
    closeAssetModal();
    closeEventModal();
  }
});

["groupBy", "programFilter", "uutFilter", "stationFilter", "ownerFilter", "fromFilter", "toFilter"].forEach((id) => {
  document.addEventListener("change", (eventObj) => {
    if (eventObj.target.id === id) {
      renderGantt();
      renderEventTable();
    }
  });
});

["event-startDate", "event-endDate", "event-stationAssetId"].forEach((id) => {
  document.addEventListener("change", (eventObj) => {
    if (eventObj.target.id === id) refreshEventAssetPicker();
  });
});

document.getElementById("importJson").addEventListener("change", (eventObj) => {
  const file = eventObj.target.files[0];
  if (file) importJson(file);
  eventObj.target.value = "";
});

refresh();
