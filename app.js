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
    asset("A-001", "RF Station 1", "Station", true, "RF Lab", "Test Engineering", "Available", 1, false, ""),
    asset("A-002", "Thermal Chamber East", "Chamber", false, "Environmental Lab", "Env Test", "Available", 1, true, "2026-09-15"),
    asset("A-003", "Spectrum Analyzer SA-001", "Spectrum Analyzer", false, "RF Lab", "Metrology", "Available", 1, true, "2026-08-01"),
    asset("A-004", "10 MHz Reference", "Timing Reference", false, "RF Lab", "Test Engineering", "Available", 3, true, "2027-01-10"),
    asset("A-005", "ESS Station", "Station", true, "Environmental Lab", "Env Test", "Available", 1, false, ""),
    asset("A-006", "EMI Receiver", "EMI Equipment", false, "Compliance Lab", "Compliance", "Out for Calibration", 1, true, "2026-06-20"),
    asset("A-007", "Power Supply Stack", "Power Supply", false, "Bench 4", "Test Engineering", "Available", 2, true, "2026-11-30"),
    asset("A-009", "5VDC Bench Supply", "5VDC Power Supply", false, "Bench 2", "Test Engineering", "Available", 1, true, "2026-12-15"),
    asset("A-010", "Oscilloscope MSO-4", "Oscilloscope", false, "Bench 2", "Metrology", "Available", 1, true, "2026-10-05"),
    asset("A-008", "Integration Bench 2", "Station", true, "Systems Lab", "Systems", "Available", 1, false, "")
  ],
  testEvents: [
    event("T-001", "Avionics RF Checkout", "Program Alpha", "UUT-001", "RF Checkout", "2026-07-08", "2026-07-12", "A-001", ["A-003", "A-004", "A-007", "A-009", "A-010"], "High", "Test Engineering", "Planned", [
      equipmentRole("R-001", "Spectrum analyzer", "Spectrum Analyzer", 1, ["A-003"]),
      equipmentRole("R-002", "Timing reference", "Timing Reference", 1, ["A-004"]),
      equipmentRole("R-003", "DC power", "Power Supply", 1, ["A-007"]),
      equipmentRole("R-004", "5VDC supply", "5VDC Power Supply", 1, ["A-009"]),
      equipmentRole("R-005", "Scope", "Oscilloscope", 1, ["A-010"])
    ]),
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

function asset(id, name, assetType, isStation, location, owner, status, maxConcurrentUses, calibrationRequired, calibrationDueDate) {
  return { id, name, assetType, isStation, quantity: maxConcurrentUses, serialNumber: "", location, owner, status, maxConcurrentUses, calibrationRequired, calibrationDueDate, notes: "" };
}

function event(id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, priority, owner, status, equipmentRoles = []) {
  return { id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, equipmentRoles, priority, owner, status, notes: "" };
}

function equipmentRole(id, label, assetType, quantity = 1, assignedAssetIds = []) {
  return { id, label, assetType, quantity, assignedAssetIds };
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
  nextState.assets = nextState.assets.map(({ assetTag, shareable, ...assetItem }) => assetItem);
  const validAssetIds = new Set(nextState.assets.map((item) => item.id));
  const stationIds = new Set(nextState.assets.filter((item) => item.isStation).map((item) => item.id));
  const assetsById = byId(nextState.assets);
  nextState.testEvents = nextState.testEvents.map((testEvent) => {
    const stationAssetId = stationIds.has(testEvent.stationAssetId) ? testEvent.stationAssetId : "";
    const legacyEquipmentIds = [...new Set((testEvent.requiredAssetIds || []).filter((assetId) => validAssetIds.has(assetId) && assetId !== stationAssetId))];
    const equipmentRoles = normalizeEquipmentRoles(testEvent.equipmentRoles, legacyEquipmentIds, assetsById);
    const assignedEquipmentIds = equipmentRoles.flatMap((role) => role.assignedAssetIds || []);
    return {
      ...testEvent,
      stationAssetId,
      equipmentRoles,
      requiredAssetIds: [...new Set([stationAssetId, ...assignedEquipmentIds].filter((assetId) => validAssetIds.has(assetId)))]
    };
  });
  nextState.programs = unique([...(nextState.programs || []), ...nextState.testEvents.map((item) => item.program)]);
  nextState.uuts = unique([...(nextState.uuts || []), ...nextState.testEvents.map((item) => item.uut)]);
  return nextState;
}

function normalizeEquipmentRoles(roles, legacyEquipmentIds, assetsById) {
  const validAssetIds = new Set(assetsById.keys());
  if (Array.isArray(roles) && roles.length) {
    return roles.map((role, index) => {
      const quantity = Math.max(1, Number(role.quantity) || 1);
      const incomingAssignedIds = [...new Set((role.assignedAssetIds || []).filter((assetId) => validAssetIds.has(assetId)))];
      const firstAssigned = assetsById.get(incomingAssignedIds[0]);
      const assetType = String(role.assetType || firstAssigned?.assetType || "").trim();
      const assignedAssetIds = incomingAssignedIds.filter((assetId) => {
        const assetItem = assetsById.get(assetId);
        return assetItem && (!assetType || assetItem.assetType === assetType);
      }).slice(0, quantity);
      return {
        id: role.id || `R-${String(index + 1).padStart(3, "0")}`,
        label: String(role.label || assetType || "Equipment role").trim(),
        assetType,
        quantity,
        assignedAssetIds
      };
    });
  }
  return legacyEquipmentIds.map((assetId, index) => {
    const assetItem = assetsById.get(assetId);
    return equipmentRole(`R-${String(index + 1).padStart(3, "0")}`, assetItem?.assetType || assetItem?.name || "Equipment", assetItem?.assetType || "", 1, [assetId]);
  });
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

function roleFillCount(role) {
  return (role.assignedAssetIds || []).filter(Boolean).length;
}

function roleSummary(testEvent) {
  const roles = testEvent.equipmentRoles || [];
  if (!roles.length) return "No equipment roles";
  const assigned = roles.reduce((sum, role) => sum + roleFillCount(role), 0);
  const needed = roles.reduce((sum, role) => sum + (Number(role.quantity) || 1), 0);
  return `${roles.length} role${roles.length === 1 ? "" : "s"} / ${assigned} of ${needed} assigned`;
}

function equipmentTypeOptions() {
  return unique([
    ...(state.settings.equipmentTypes || []),
    ...state.assets.filter((assetItem) => !assetItem.isStation).map((assetItem) => assetItem.assetType),
    ...state.testEvents.flatMap((testEvent) => (testEvent.equipmentRoles || []).map((role) => role.assetType))
  ]);
}

function rememberEquipmentType(assetType) {
  const normalized = String(assetType || "").trim();
  if (!normalized) return "";
  state.settings.equipmentTypes = unique([...(state.settings.equipmentTypes || []), normalized]);
  return normalized;
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
    (testEvent.equipmentRoles || []).forEach((role) => {
      const quantity = Number(role.quantity) || 1;
      const assignedCount = roleFillCount(role);
      if (assignedCount < quantity) {
        addConflict({
          conflictType: "Unassigned Equipment",
          assetId: "",
          uut: "",
          startDate: testEvent.startDate,
          endDate: testEvent.endDate,
          eventIds: [testEvent.id],
          programs: [testEvent.program].filter(Boolean),
          severity: testEvent.priority === "Critical" ? "High" : "Medium",
          explanation: `${testEvent.name} needs ${quantity} ${role.assetType || role.label || "equipment"} role${quantity === 1 ? "" : "s"}, but only ${assignedCount} ${assignedCount === 1 ? "is" : "are"} assigned.`,
          suggestedResolution: "Assign matching inventory, add inventory capacity, or revise the role quantity."
        });
      }
    });

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
      ${assetTypeInput(item.assetType)}
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
      <label>Equipment Roles</label>
      <div id="eventEquipmentRoles" class="role-list"></div>
      <button type="button" class="secondary" id="addEquipmentRoleBtn">Add Equipment Role</button>
    </div>
    ${textarea("Notes", "notes", item.notes)}
    <div class="form-actions">
      <button type="submit">${selectedEventId ? "Save Event" : "Create Event"}</button>
      <button type="button" class="secondary" id="cancelEventBtn">Cancel</button>
    </div>
  `;
  refreshEventEquipmentRoles();
}

function refreshEventEquipmentRoles() {
  const target = document.getElementById("eventEquipmentRoles");
  if (!target) return;
  const eventId = formValue(new FormData(document.getElementById("eventForm")), "id");
  const startDate = value("event-startDate");
  const endDate = value("event-endDate");
  const roles = readEquipmentRolesFromForm();
  if (!roles.length) {
    target.innerHTML = `<div class="empty compact-empty"><h3>No equipment roles</h3><p>Add a role such as 5VDC power supply, oscilloscope, chamber, or fixture.</p></div>`;
    return;
  }
  target.innerHTML = `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId)).join("")}`;
}

function renderEquipmentRole(role, index, startDate, endDate, eventId) {
  const typeOptions = equipmentTypeOptions();
  const matchingAssets = state.assets.filter((assetItem) => !assetItem.isStation && assetItem.assetType === role.assetType);
  const quantity = Math.max(1, Number(role.quantity) || 1);
  const assigned = [...new Set(role.assignedAssetIds || [])].slice(0, quantity);
  const openSlots = Array.from({ length: quantity }, (_, slotIndex) => assigned[slotIndex] || "");
  const statusClass = assigned.filter(Boolean).length >= quantity ? "ok" : "medium";
  const matchText = role.assetType ? `${matchingAssets.length} match${matchingAssets.length === 1 ? "" : "es"}` : "Set type";
  return `
    <section class="equipment-role" data-role-index="${index}">
      <input type="hidden" name="equipmentRoleId[]" value="${escapeHtml(role.id)}">
      <input type="hidden" name="equipmentRoleLabel[]" value="${escapeHtml(role.assetType || role.label || "")}">
      <div class="role-type-cell">
        ${roleInputWithDatalist("Type", "equipmentRoleType[]", role.assetType, typeOptions, index)}
      </div>
      ${roleInput("Qty", "equipmentRoleQuantity[]", quantity, index, "number")}
      <div class="role-assignment-cell">
        ${openSlots.map((assetId, slotIndex) => renderRoleAssignment(role, index, slotIndex, assetId, matchingAssets, startDate, endDate, eventId)).join("")}
      </div>
      <div class="role-status-cell">${badge(`${assigned.filter(Boolean).length}/${quantity}`, statusClass)}<small>${escapeHtml(matchText)}</small></div>
      <button type="button" class="secondary icon-button" data-remove-equipment-role="${index}" aria-label="Remove equipment role">X</button>
    </section>
  `;
}

function equipmentRoleHeader() {
  return `
    <div class="role-list-header" aria-hidden="true">
      <span>Type</span>
      <span>Qty</span>
      <span>Assignment</span>
      <span>Filled</span>
      <span></span>
    </div>
  `;
}

function renderRoleAssignment(role, roleIndex, slotIndex, assetId, matchingAssets, startDate, endDate, eventId) {
  const selectedAsset = state.assets.find((assetItem) => assetItem.id === assetId);
  const selectedMatchesRole = selectedAsset && (!role.assetType || selectedAsset.assetType === role.assetType);
  const options = matchingAssets.some((assetItem) => assetItem.id === assetId) || !selectedMatchesRole ? matchingAssets : [selectedAsset, ...matchingAssets];
  const selectedAllocation = assetId ? assetAllocation(assetId, startDate, endDate, eventId) : null;
  return `
    <div class="role-assignment">
      <div class="field">
        <label class="sr-only" for="role-${roleIndex}-slot-${slotIndex}">Assignment ${slotIndex + 1}</label>
        <select id="role-${roleIndex}-slot-${slotIndex}" name="equipmentRoleAssignedAssetIds[]">
          <option value="" data-role-index="${roleIndex}">Unassigned ${escapeHtml(role.assetType || "equipment")}</option>
          ${options.map((assetItem) => {
            const allocation = assetAllocation(assetItem.id, startDate, endDate, eventId);
            const status = allocation.level === "open" ? "" : ` (${allocation.label})`;
            return `<option value="${escapeHtml(assetItem.id)}" data-role-index="${roleIndex}" ${assetItem.id === assetId ? "selected" : ""}>${escapeHtml(assetOptionLabel(assetItem))}${escapeHtml(status)}</option>`;
          }).join("")}
        </select>
      </div>
      <small class="${selectedAllocation ? `assignment-${selectedAllocation.level}` : ""}">${escapeHtml(selectedAllocation?.detail || "Select a matching inventory item later, or leave this role unresolved.")}</small>
    </div>
  `;
}

function roleInput(labelText, name, inputValue, index, type = "text") {
  return `<div class="field compact-role-field"><label class="sr-only" for="role-${index}-${name.replace(/\W/g, "")}">${labelText}</label><input id="role-${index}-${name.replace(/\W/g, "")}" name="${name}" type="${type}" min="1" value="${escapeHtml(inputValue ?? "")}"></div>`;
}

function roleInputWithDatalist(labelText, name, inputValue, options, index) {
  const choices = unique([inputValue, ...options]);
  return `
    <div class="field compact-role-field">
      <label class="sr-only" for="role-${index}-type">${labelText}</label>
      <select id="role-${index}-type" name="${name}" data-current-type="${escapeHtml(inputValue || "")}">
        <option value="">Select type</option>
        ${choices.map((option) => `<option value="${escapeHtml(option)}" ${option === inputValue ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        <option value="__new_equipment_type__">New type...</option>
      </select>
    </div>
  `;
}

function readEquipmentRolesFromForm() {
  const formEl = document.getElementById("eventForm");
  if (!formEl) return [];
  const eventId = formValue(new FormData(formEl), "id");
  const currentEvent = state.testEvents.find((eventItem) => eventItem.id === eventId);
  const roleIds = [...formEl.querySelectorAll('input[name="equipmentRoleId[]"]')];
  if (!roleIds.length) return structuredClone(currentEvent?.equipmentRoles || []);

  const labels = [...formEl.querySelectorAll('input[name="equipmentRoleLabel[]"]')];
  const types = [...formEl.querySelectorAll('[name="equipmentRoleType[]"]')];
  const quantities = [...formEl.querySelectorAll('input[name="equipmentRoleQuantity[]"]')];
  const assignmentsByRole = new Map();
  [...formEl.querySelectorAll('select[name="equipmentRoleAssignedAssetIds[]"]')].forEach((selectEl) => {
    const roleIndex = Number(selectEl.selectedOptions[0]?.dataset.roleIndex || selectEl.querySelector("option")?.dataset.roleIndex || 0);
    if (!assignmentsByRole.has(roleIndex)) assignmentsByRole.set(roleIndex, []);
    if (selectEl.value) assignmentsByRole.get(roleIndex).push(selectEl.value);
  });
  return roleIds.map((idInput, index) => {
    const assetType = types[index]?.value.trim() || "";
    const quantity = Math.max(1, Number(quantities[index]?.value) || 1);
    const assignedAssetIds = [...new Set(assignmentsByRole.get(index) || [])].filter((assetId) => {
      const assetItem = state.assets.find((item) => item.id === assetId);
      return assetItem && (!assetType || assetItem.assetType === assetType);
    });
    return {
      id: idInput.value || nextRoleId(index),
      label: assetType || labels[index]?.value.trim() || "Equipment role",
      assetType,
      quantity,
      assignedAssetIds
    };
  });
}

function nextRoleId(offset = 0) {
  const formEl = document.getElementById("eventForm");
  const roles = formEl ? [...formEl.querySelectorAll('input[name="equipmentRoleId[]"]')].map((inputEl) => ({ id: inputEl.value })) : [];
  const highest = roles.reduce((max, role) => Math.max(max, Number(String(role.id).replace("R-", "")) || 0), 0);
  return `R-${String(highest + offset + 1).padStart(3, "0")}`;
}

function addEquipmentRole() {
  const roles = readEquipmentRolesFromForm();
  const nextIndex = roles.length;
  roles.push(equipmentRole(nextRoleId(), "", "", 1, []));
  renderEquipmentRolesFrom(roles);
  document.getElementById(`role-${nextIndex}-type`)?.focus();
}

function removeEquipmentRole(index) {
  const roles = readEquipmentRolesFromForm();
  roles.splice(index, 1);
  renderEquipmentRolesFrom(roles);
}

function renderEquipmentRolesFrom(roles) {
  const target = document.getElementById("eventEquipmentRoles");
  if (!target) return;
  const eventId = formValue(new FormData(document.getElementById("eventForm")), "id");
  const startDate = value("event-startDate");
  const endDate = value("event-endDate");
  target.innerHTML = roles.length
    ? `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId)).join("")}`
    : `<div class="empty compact-empty"><h3>No equipment roles</h3><p>Add a role such as 5VDC power supply, oscilloscope, chamber, or fixture.</p></div>`;
}

function input(labelText, name, inputValue, type = "text", disabled = false) {
  const prefix = labelText.startsWith("Asset") || ["Quantity", "Status", "Max Concurrent Uses", "Serial Number", "Location", "Calibration Due Date"].includes(labelText) ? "asset" : "event";
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><input id="${prefix}-${name}" name="${name}" type="${type}" value="${escapeHtml(inputValue ?? "")}" ${disabled ? "disabled" : ""}></div>`;
}

function inputWithDatalist(labelText, name, inputValue, options) {
  const listId = `event-${name}-options`;
  return `<div class="field"><label for="event-${name}">${labelText}</label><input id="event-${name}" name="${name}" list="${listId}" value="${escapeHtml(inputValue ?? "")}"><datalist id="${listId}">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist></div>`;
}

function assetTypeInput(inputValue) {
  const options = equipmentTypeOptions();
  return `<div class="field"><label for="asset-assetType">Asset Type</label><input id="asset-assetType" name="assetType" list="asset-type-options" value="${escapeHtml(inputValue ?? "")}"><datalist id="asset-type-options">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist></div>`;
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
  return { id: next, name: "", assetType: "", isStation: false, quantity: 1, serialNumber: "", location: "", owner: "", status: "Available", maxConcurrentUses: 1, calibrationRequired: false, calibrationDueDate: "", notes: "" };
}

function emptyEvent() {
  const next = nextId("T", state.testEvents);
  const today = dateISO(new Date());
  return { id: next, name: "", program: "", uut: "", testType: "", startDate: today, endDate: today, stationAssetId: "", requiredAssetIds: [], equipmentRoles: [], priority: "Medium", owner: "", status: "Draft", notes: "" };
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
    equipment: roleSummary(item),
    priority: item.priority,
    status: item.status,
    conflicts: conflictEvents.has(item.id) ? badge("Conflict", "high") : badge("Clear", "ok"),
    actions: rowActions("event", item.id)
  }));
  renderTable("eventTable", ["id", "name", "program", "uut", "dates", "station", "equipment", "priority", "status", "conflicts", "actions"], rows);
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
    item: item.assetId ? assetsById.get(item.assetId)?.name || item.assetId : item.uut || "Equipment role",
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
  const roleRows = state.testEvents.map((item) => ({
    event: item.name,
    program: item.program,
    equipmentRoles: roleSummary(item)
  }));
  document.getElementById("report").innerHTML = `
    <h3>Planning Summary</h3>
    <div class="report-grid">
      ${metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations`)}
      ${metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`)}
      ${metric("Conflicts", conflicts.length, `${conflicts.filter((item) => item.severity === "Critical").length} critical`)}
    </div>
    <h3>Highest Demand Assets</h3>
    ${tableMarkup(["asset", "assetType", "conflicts", "events", "peakDemand", "capacity", "action"], bottlenecks)}
    <h3>Equipment Role Coverage</h3>
    ${tableMarkup(["event", "program", "equipmentRoles"], roleRows)}
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
    assetType: rememberEquipmentType(formText(form, "assetType")),
    quantity: Number(formValue(form, "quantity")) || 1,
    serialNumber: formText(form, "serialNumber"),
    location: formText(form, "location"),
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Available",
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
  const equipmentRoles = readEquipmentRolesFromForm().map((role) => ({
    ...role,
    assetType: rememberEquipmentType(role.assetType),
    label: rememberEquipmentType(role.assetType) || role.label,
    assignedAssetIds: [...new Set((role.assignedAssetIds || []).filter((assetId) => validAssetIds.has(assetId)))].slice(0, Math.max(1, Number(role.quantity) || 1))
  })).filter((role) => role.label || role.assetType || role.assignedAssetIds.length);
  const assignedAssetIds = equipmentRoles.flatMap((role) => role.assignedAssetIds);
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
    equipmentRoles,
    requiredAssetIds: [...new Set([stationAssetId, ...assignedAssetIds].filter(Boolean))],
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
  const roleText = (testEvent) => (testEvent.equipmentRoles || []).map((role) => {
    const assigned = (role.assignedAssetIds || []).map((id) => assetsById.get(id)?.name || id).join(" + ") || "unassigned";
    return `${role.label || role.assetType || "Equipment"} (${role.assetType || "any"} x${role.quantity || 1}): ${assigned}`;
  }).join("; ");
  const datasets = {
    assets: state.assets,
    events: state.testEvents.map((item) => ({ ...item, equipmentRoles: roleText(item), requiredAssets: fullAssetIds(item).map((id) => assetsById.get(id)?.name || id).join("; ") })),
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
  if (target.id === "addEquipmentRoleBtn") {
    addEquipmentRole();
  }
  if (target.dataset.removeEquipmentRole) {
    removeEquipmentRole(Number(target.dataset.removeEquipmentRole));
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
      requiredAssetIds: (testEvent.requiredAssetIds || []).filter((assetId) => assetId !== deletedAssetId),
      equipmentRoles: (testEvent.equipmentRoles || []).map((role) => ({
        ...role,
        assignedAssetIds: (role.assignedAssetIds || []).filter((assetId) => assetId !== deletedAssetId)
      }))
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
    if (eventObj.target.id === id) refreshEventEquipmentRoles();
  });
});

document.addEventListener("change", (eventObj) => {
  if (!eventObj.target.closest("#eventEquipmentRoles")) return;
  if (eventObj.target.name === "equipmentRoleType[]" && eventObj.target.value === "__new_equipment_type__") {
    const newType = prompt("New equipment type");
    const normalized = rememberEquipmentType(newType);
    if (normalized) {
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      option.selected = true;
      eventObj.target.insertBefore(option, eventObj.target.querySelector('option[value="__new_equipment_type__"]'));
      saveState();
    } else {
      eventObj.target.value = eventObj.target.dataset.currentType || "";
    }
  }
  refreshEventEquipmentRoles();
});

document.getElementById("importJson").addEventListener("change", (eventObj) => {
  const file = eventObj.target.files[0];
  if (file) importJson(file);
  eventObj.target.value = "";
});

refresh();
