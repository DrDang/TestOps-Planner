"use strict";

const STORAGE_KEY = "testops-planner-v2";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROGRAM_COLORS = ["#246b5d", "#8b4b8f", "#2f6f9f", "#b45c2d", "#5b6f28", "#7d4e2c", "#355da8", "#9a3d54"];
const BAD_STATUSES = new Set(["Down", "Out for Calibration", "Retired", "Unknown"]);
const EVENT_CATEGORIES = ["Test", "Demo", "Calibration", "Maintenance", "Outage"];
const CATEGORY_COLORS = {
  Demo: "#2d6f9f",
  Calibration: "#7a5c12",
  Maintenance: "#6f6460",
  Outage: "#b83232"
};

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
    asset("A-001", "RF Station 1", "Station", true, "Test Engineering", "Available", 1, false, ""),
    asset("A-002", "Thermal Chamber East", "Chamber", false, "Env Test", "Available", 1, true, "2026-09-15"),
    asset("A-003", "Spectrum Analyzer SA-001", "Spectrum Analyzer", false, "Metrology", "Available", 1, true, "2026-08-01"),
    asset("A-004", "10 MHz Reference", "Timing Reference", false, "Test Engineering", "Available", 3, true, "2027-01-10"),
    asset("A-005", "ESS Station", "Station", true, "Env Test", "Available", 1, false, ""),
    asset("A-006", "EMI Receiver", "EMI Equipment", false, "Compliance", "Out for Calibration", 1, true, "2026-06-20"),
    asset("A-007", "Power Supply Stack", "Power Supply", false, "Test Engineering", "Available", 2, true, "2026-11-30"),
    asset("A-009", "5VDC Bench Supply", "5VDC Power Supply", false, "Test Engineering", "Available", 1, true, "2026-12-15"),
    asset("A-010", "Oscilloscope MSO-4", "Oscilloscope", false, "Metrology", "Available", 1, true, "2026-10-05"),
    asset("A-008", "Integration Bench 2", "Station", true, "Systems", "Available", 1, false, "")
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
let inspectedEventId = "";
let activeView = "schedule";
const eventDrafts = new Map();
const NEW_EVENT_DRAFT_KEY = "__new_event__";

function asset(id, name, assetType, isStation, owner, status, quantity, calibrationRequired, calibrationDueDate, imageData = "") {
  return { id, name, assetType, isStation, quantity, serialNumber: "", owner, status, calibrationRequired, calibrationDueDate, imageData, notes: "" };
}

function event(id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, priority, owner, status, equipmentRoles = [], eventCategory = "Test") {
  return { id, name, eventCategory, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, equipmentRoles, priority, owner, status, notes: "" };
}

function equipmentRole(id, label, assetType, quantity = 1, assignedAssetIds = []) {
  return { id, label, assetType, quantity, assignedAssetIds };
}

function eventUsesUut(eventCategory) {
  return eventCategory === "Test" || eventCategory === "Demo";
}

function eventUutLabel(eventCategory) {
  return eventCategory === "Demo" ? "Demo Unit" : "UUT";
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
  nextState.assets = nextState.assets.map(({ assetTag, shareable, location, maxConcurrentUses, ...assetItem }) => ({
    ...assetItem,
    assetTypes: unique(assetTypesFor(assetItem)),
    assetType: assetTypesFor(assetItem)[0] || "",
    quantity: Number(maxConcurrentUses || assetItem.quantity || 1),
    imageData: assetItem.imageData || ""
  }));
  const validAssetIds = new Set(nextState.assets.map((item) => item.id));
  const stationIds = new Set(nextState.assets.filter((item) => item.isStation).map((item) => item.id));
  const assetsById = byId(nextState.assets);
  nextState.testEvents = nextState.testEvents.map((testEvent) => {
    const eventCategory = EVENT_CATEGORIES.includes(testEvent.eventCategory) ? testEvent.eventCategory : "Test";
    const stationAssetId = stationIds.has(testEvent.stationAssetId) ? testEvent.stationAssetId : "";
    const legacyEquipmentIds = [...new Set((testEvent.requiredAssetIds || []).filter((assetId) => validAssetIds.has(assetId) && assetId !== stationAssetId))];
    const equipmentRoles = eventCategory === "Test" ? normalizeEquipmentRoles(testEvent.equipmentRoles, legacyEquipmentIds, assetsById) : [];
    const assignedEquipmentIds = equipmentRoles.flatMap((role) => role.assignedAssetIds || []);
    return {
      ...testEvent,
      eventCategory,
      uut: eventUsesUut(eventCategory) ? testEvent.uut : "",
      testType: eventCategory === "Test" || eventCategory === "Demo" ? testEvent.testType : "",
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
      const assetType = String(role.assetType || assetTypesFor(firstAssigned)[0] || "").trim();
      const assignedAssetIds = incomingAssignedIds.filter((assetId) => {
        const assetItem = assetsById.get(assetId);
        return assetItem && assetMatchesType(assetItem, assetType);
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
    const assetType = assetTypesFor(assetItem)[0] || "";
    return equipmentRole(`R-${String(index + 1).padStart(3, "0")}`, assetType || assetItem?.name || "Equipment", assetType, 1, [assetId]);
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
  if (testEvent.eventCategory && testEvent.eventCategory !== "Test") return "Not required";
  const roles = testEvent.equipmentRoles || [];
  if (!roles.length) return "No equipment roles";
  const assigned = roles.reduce((sum, role) => sum + roleFillCount(role), 0);
  const needed = roles.reduce((sum, role) => sum + (Number(role.quantity) || 1), 0);
  return `${roles.length} role${roles.length === 1 ? "" : "s"} / ${assigned} of ${needed} assigned`;
}

function equipmentTypeOptions(extraTypes = []) {
  return unique([
    ...(state.settings.equipmentTypes || []),
    ...state.assets.flatMap((assetItem) => assetTypesFor(assetItem)),
    ...state.testEvents.flatMap((testEvent) => (testEvent.equipmentRoles || []).map((role) => role.assetType)),
    ...extraTypes
  ]);
}

function rememberEquipmentType(assetType) {
  const normalized = String(assetType || "").trim();
  if (!normalized) return "";
  state.settings.equipmentTypes = unique([...(state.settings.equipmentTypes || []), normalized]);
  return normalized;
}

function parseAssetTypes(text) {
  return unique(String(text || "").split(",").map((item) => item.trim()));
}

function readAssetTypesFromForm(formEl = document.getElementById("assetForm"), includePendingEntry = false) {
  const chipTypes = [...formEl.querySelectorAll('input[name="assetTypes[]"]')].map((inputEl) => inputEl.value.trim());
  const pendingType = includePendingEntry ? formEl.querySelector("#asset-typeEntry")?.value.trim() : "";
  return unique([...chipTypes, pendingType]);
}

function assetTypesFor(assetItem) {
  return unique([...(assetItem?.assetTypes || []), assetItem?.assetType]);
}

function assetTypeText(assetItem) {
  return assetTypesFor(assetItem).join(", ");
}

function assetMatchesType(assetItem, assetType) {
  return !assetType || assetTypesFor(assetItem).includes(assetType);
}

function comparableText(text) {
  return String(text || "").trim().toLowerCase();
}

function assetDuplicateMatches(candidate, currentAssetId = "") {
  const candidateName = comparableText(candidate.name);
  const candidateSerial = comparableText(candidate.serialNumber);
  const candidateTypes = assetTypesFor(candidate).map(comparableText);
  return state.assets.filter((assetItem) => {
    if (assetItem.id === currentAssetId) return false;
    const serialMatch = candidateSerial && comparableText(assetItem.serialNumber) === candidateSerial;
    const nameMatch = candidateName && comparableText(assetItem.name) === candidateName;
    const typeMatch = candidateTypes.length && assetTypesFor(assetItem).map(comparableText).some((assetType) => candidateTypes.includes(assetType));
    return serialMatch || (nameMatch && typeMatch);
  });
}

function assetDuplicateWarningText(matches) {
  if (!matches.length) return "";
  const names = matches.slice(0, 3).map((item) => `${item.id} ${item.name}`).join(", ");
  const extra = matches.length > 3 ? `, and ${matches.length - 3} more` : "";
  return `Possible duplicate: ${names}${extra}. Check name, type, and serial number before saving.`;
}

function assetIdentity(assetItem) {
  return assetItem.serialNumber ? `SN ${assetItem.serialNumber}` : "No serial number";
}

function assetOptionLabel(assetItem) {
  return `${assetItem.name}${assetItem.serialNumber ? ` / SN ${assetItem.serialNumber}` : ""}`;
}

function assetImageMarkup(assetItem, altText = "") {
  if (assetItem?.imageData) return `<img src="${escapeHtml(assetItem.imageData)}" alt="${escapeHtml(altText || assetItem.name || "Asset picture")}">`;
  return `<span>No image</span>`;
}

function assetAllocation(assetId, startDate, endDate, currentEventId = "") {
  const assetItem = state.assets.find((item) => item.id === assetId);
  if (!assetItem || !startDate || !endDate) return { level: "open", label: "Check dates", detail: "Set event dates to check allocation." };
  const range = { startDate, endDate };
  const overlappingEvents = state.testEvents.filter((testEvent) => {
    if (testEvent.id === currentEventId) return false;
    return fullAssetIds(testEvent).includes(assetId) && overlaps(testEvent, range);
  });
  const capacity = Number(assetItem.quantity || 1);

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

function uutFilterOptions(program = value("programFilter")) {
  const matchingEvents = program ? state.testEvents.filter((item) => item.program === program) : state.testEvents;
  const eventUuts = matchingEvents.map((item) => item.uut);
  return unique(program ? eventUuts : [...state.uuts, ...eventUuts]);
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

function closeEventModal(saveDraft = true) {
  if (saveDraft) saveEventDraftFromForm();
  document.getElementById("eventModal").hidden = true;
}

function eventDraftKey(id = selectedEventId) {
  return id || NEW_EVENT_DRAFT_KEY;
}

function saveEventDraftFromForm() {
  const formEl = document.getElementById("eventForm");
  const modalEl = document.getElementById("eventModal");
  if (!formEl || modalEl.hidden || !formEl.innerHTML.trim()) return;
  const form = new FormData(formEl);
  const id = formValue(form, "id");
  const eventCategory = formValue(form, "eventCategory") || "Test";
  eventDrafts.set(eventDraftKey(selectedEventId), {
    id,
    name: formText(form, "name"),
    eventCategory,
    program: formText(form, "program"),
    uut: eventUsesUut(eventCategory) ? formText(form, "uut") : "",
    testType: eventCategory === "Test" || eventCategory === "Demo" ? formText(form, "testType") : "",
    startDate: formValue(form, "startDate"),
    endDate: formValue(form, "endDate"),
    stationAssetId: formValue(form, "stationAssetId"),
    requiredAssetIds: [],
    equipmentRoles: eventCategory === "Test" ? readEquipmentRolesFromForm() : [],
    priority: formValue(form, "priority") || "Medium",
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Draft",
    notes: formText(form, "notes")
  });
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
        const capacity = Number(conflictedAsset.quantity || 1);
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
    const capacity = Number(assetItem.quantity || 1);
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
    const capacity = Number(item.quantity || 1);
    const shortage = Math.max(0, peak.count - capacity);
    const action = shortage > 0 ? "Buy/rent/borrow or reschedule" : relatedConflicts.length ? "Review conflict timing" : usedBy.length >= capacity * 3 ? "Monitor demand" : "No action";
    return {
      asset: item.name,
      assetId: item.id,
      assetType: assetTypeText(item),
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
  renderEventInspector();
  renderConflictTable();
  renderBottlenecks();
  renderReport();
  setActiveView(activeView);
}

function renderFilters() {
  fillSelect("programFilter", unique([...state.programs, ...state.testEvents.map((item) => item.program)]), "All programs", value("programFilter"));
  fillSelect("uutFilter", uutFilterOptions(), value("programFilter") ? "All UUTs for program" : "All UUTs", value("uutFilter"));
  fillSelect("stationFilter", state.assets.filter((item) => item.isStation).map((item) => ({ value: item.id, label: item.name })), "All stations", value("stationFilter"));
  fillSelect("ownerFilter", unique([...state.testEvents.map((item) => item.owner), ...state.assets.map((item) => item.owner)]), "All owners", value("ownerFilter"));
  fillSelect("assetTypeFilter", equipmentTypeOptions(), "All types", value("assetTypeFilter"));
  renderAssetFilterState();
}

function renderUutFilter() {
  fillSelect("uutFilter", uutFilterOptions(), value("programFilter") ? "All UUTs for program" : "All UUTs", value("uutFilter"));
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

function renderAssetFilterState() {
  const clearButton = document.getElementById("clearAssetTypeFilterBtn");
  if (!clearButton) return;
  const activeType = value("assetTypeFilter");
  clearButton.hidden = !activeType;
  clearButton.textContent = activeType ? `Clear Type: ${activeType}` : "Clear Type Filter";
  clearButton.title = activeType ? `Clear type filter: ${activeType}` : "";
}

function renderDashboard() {
  const conflicts = state.conflicts;
  const bottlenecks = computeBottlenecks(state.testEvents, conflicts);
  const topBottleneck = bottlenecks.find((item) => item.conflicts > 0 || item.shortage > 0);
  const critical = conflicts.filter((item) => item.severity === "Critical").length;
  const stationConflicts = conflicts.filter((item) => item.conflictType === "Station").length;
  document.getElementById("dashboard").innerHTML = [
    metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations`),
    metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`),
    metric("Open Conflicts", conflicts.length, `${critical} critical`),
    metric("Station Issues", stationConflicts, "overlap count"),
    metric("Top Bottleneck", topBottleneck?.asset || "None", topBottleneck ? `${topBottleneck.conflicts} conflicts / ${topBottleneck.shortage} shortage` : "no active bottlenecks")
  ].join("");
}

function metric(label, valueText, detail) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText))}</strong><em>${escapeHtml(detail)}</em></article>`;
}

function renderAssetForm() {
  const item = state.assets.find((assetItem) => assetItem.id === selectedAssetId) || emptyAsset();
  document.getElementById("assetForm").innerHTML = `
    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
    <input type="hidden" id="asset-imageData" name="imageData" value="${escapeHtml(item.imageData || "")}">
    ${assetImageInput(item)}
    <div class="form-row">
      ${input("Asset ID", "idVisible", item.id, "text", true)}
      ${input("Asset Name", "name", item.name)}
    </div>
    <div class="form-row">
      ${assetTypeInput(item)}
      ${input("Quantity", "quantity", item.quantity, "number")}
    </div>
    <div class="form-row">
      ${select("Status", "status", ["Available", "Down", "Out for Calibration", "Retired", "Limited Use", "Unknown"], item.status)}
      ${input("Serial Number", "serialNumber", item.serialNumber)}
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
    <div id="assetTypeRequiredWarning" class="form-warning" aria-live="polite" hidden>At least one asset type is required.</div>
    <div id="assetDuplicateWarning" class="form-warning" aria-live="polite" hidden></div>
    <div class="form-actions">
      <button type="submit">${selectedAssetId ? "Save Asset" : "Create Asset"}</button>
      <button type="button" class="secondary" id="cancelAssetBtn">Cancel</button>
    </div>
  `;
  renderAssetDuplicateWarning();
}

function renderEventForm() {
  const item = eventDrafts.get(eventDraftKey()) || state.testEvents.find((eventItem) => eventItem.id === selectedEventId) || emptyEvent();
  const eventCategory = EVENT_CATEGORIES.includes(item.eventCategory) ? item.eventCategory : "Test";
  const stations = state.assets.filter((assetItem) => assetItem.isStation).map((assetItem) => ({ value: assetItem.id, label: assetOptionLabel(assetItem) }));
  const programOptions = unique([...state.programs, ...state.testEvents.map((eventItem) => eventItem.program)]);
  const uutOptions = unique([...state.uuts, ...state.testEvents.map((eventItem) => eventItem.uut)]);
  const testTypeOptions = unique(state.testEvents.map((eventItem) => eventItem.testType));
  document.getElementById("eventForm").innerHTML = `
    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
    <div class="form-row">
      ${input("Event ID", "idVisible", item.id, "text", true)}
      ${input("Event Name", "name", item.name)}
    </div>
    <div class="form-row">
      ${select("Category", "eventCategory", EVENT_CATEGORIES, eventCategory)}
      ${inputWithDatalist("Program", "program", item.program, programOptions)}
    </div>
    ${eventUsesUut(eventCategory) ? `
    <div class="form-row">
      ${inputWithDatalist(eventUutLabel(eventCategory), "uut", item.uut, uutOptions)}
      ${eventCategory === "Test" ? inputWithDatalist("Test Type", "testType", item.testType, testTypeOptions) : input("Owner", "owner", item.owner)}
    </div>
    <div class="form-row">
      ${select(eventCategory === "Demo" ? "Demo Station" : "Assigned Station", "stationAssetId", stations, item.stationAssetId, "No station")}
      ${eventCategory === "Test" ? input("Owner", "owner", item.owner) : input("Demo Type", "testType", item.testType)}
    </div>` : `
    <div class="form-row">
      ${select("Affected Station", "stationAssetId", stations, item.stationAssetId, "No station")}
      ${input("Owner", "owner", item.owner)}
    </div>`}
    <div class="form-row">
      ${input("Start Date", "startDate", item.startDate, "date")}
      ${input("End Date", "endDate", item.endDate, "date")}
    </div>
    <div class="form-row">
      ${select("Priority", "priority", ["Critical", "High", "Medium", "Low"], item.priority)}
      ${select("Status", "status", ["Draft", "Planned", "Approved", "In Work", "Complete", "Delayed", "Canceled"], item.status)}
    </div>
    ${eventCategory === "Test" ? `
    <div class="field">
      <label>Equipment Roles</label>
      <div id="eventEquipmentRoles" class="role-list"></div>
    </div>` : ""}
    ${textarea("Notes", "notes", item.notes)}
    <div class="form-actions">
      <button type="submit">${selectedEventId ? "Save Event" : "Create Event"}</button>
      <button type="button" class="secondary" id="cancelEventBtn">Cancel</button>
    </div>
  `;
  if (eventCategory === "Test") renderEquipmentRolesFrom(item.equipmentRoles || []);
  syncEventEndDateBounds();
}

function syncEventEndDateBounds() {
  const startEl = document.getElementById("event-startDate");
  const endEl = document.getElementById("event-endDate");
  if (!startEl || !endEl || !startEl.value) return;
  endEl.min = startEl.value;
  if (!endEl.value || endEl.value < startEl.value) endEl.value = startEl.value;
}

function refreshEventEquipmentRoles() {
  const target = document.getElementById("eventEquipmentRoles");
  if (!target) return;
  const eventId = formValue(new FormData(document.getElementById("eventForm")), "id");
  const startDate = value("event-startDate");
  const endDate = value("event-endDate");
  const roles = readEquipmentRolesFromForm();
  target.classList.toggle("is-empty", !roles.length);
  if (!roles.length) {
    target.innerHTML = emptyEquipmentRolesMarkup();
    return;
  }
  const typeOptions = equipmentTypeOptions(roles.map((role) => role.assetType));
  target.innerHTML = `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions)).join("")}<div class="role-add-row">${equipmentRoleAddMarkup("Add Role")}</div>`;
}

function emptyEquipmentRolesMarkup() {
  return `
    <div class="role-empty-row">
      <span>No equipment roles yet</span>
      ${equipmentRoleAddMarkup("Add Role")}
    </div>
  `;
}

function assetImageInput(item) {
  return `
    <div class="asset-image-field">
      <button type="button" id="assetImagePreview" class="asset-image-preview" data-preview-current-asset-image aria-label="Asset picture drop zone">${assetImageMarkup(item, "Asset image preview")}</button>
      <div class="asset-image-controls">
        <label for="asset-imageFile">Picture</label>
        <input id="asset-imageFile" name="imageFile" type="file" accept="image/*">
        <small>Choose a file, drag an image here, or click the picture box before pasting.</small>
        <button type="button" class="secondary" id="removeAssetImageBtn" ${item.imageData ? "" : "disabled"}>Remove Picture</button>
      </div>
    </div>
  `;
}

function equipmentRoleAddMarkup(labelText = "Add Role") {
  return `<button type="button" class="secondary" id="addEquipmentRoleBtn">${escapeHtml(labelText)}</button>`;
}

function renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions = equipmentTypeOptions()) {
  const matchingAssets = state.assets.filter((assetItem) => assetMatchesType(assetItem, role.assetType));
  const quantity = Math.max(1, Number(role.quantity) || 1);
  const assigned = [...new Set(role.assignedAssetIds || [])].slice(0, quantity);
  const openSlots = Array.from({ length: quantity }, (_, slotIndex) => assigned[slotIndex] || "");
  const statusClass = assigned.filter(Boolean).length >= quantity ? "ok" : "medium";
  const matchText = role.assetType ? `${matchingAssets.length} match${matchingAssets.length === 1 ? "" : "es"}` : "Set type";
  return `
    <section class="equipment-role" data-role-index="${index}">
      <input type="hidden" name="equipmentRoleId[]" value="${escapeHtml(role.id)}">
      <input type="hidden" name="equipmentRoleLabel[]" value="${escapeHtml(role.assetType || role.label || "")}">
      <input type="hidden" name="equipmentRoleCommittedType[]" value="${escapeHtml(role.assetType || "")}">
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
  const selectedMatchesRole = selectedAsset && assetMatchesType(selectedAsset, role.assetType);
  const options = matchingAssets.some((assetItem) => assetItem.id === assetId) || !selectedMatchesRole ? matchingAssets : [selectedAsset, ...matchingAssets];
  const selectedAllocation = assetId ? assetAllocation(assetId, startDate, endDate, eventId) : null;
  const helperText = matchingAssets.length
    ? selectedAllocation?.detail || "Select a matching inventory item later, or leave this role unresolved."
    : role.assetType
      ? `No inventory assets match ${role.assetType}. Add a matching asset or adjust this role type.`
      : "Set the role type to see matching inventory.";
  return `
    <div class="role-assignment">
      <div class="field">
        <label class="sr-only" for="role-${roleIndex}-slot-${slotIndex}">Assignment ${slotIndex + 1}</label>
        <select id="role-${roleIndex}-slot-${slotIndex}" name="equipmentRoleAssignedAssetIds[]">
          <option value="" data-role-index="${roleIndex}">Unassigned ${escapeHtml(role.assetType || "equipment")}</option>
          ${options.map((assetItem) => {
            const allocation = assetAllocation(assetItem.id, startDate, endDate, eventId);
            const status = allocation.level === "open" ? "" : ` (${allocation.label})`;
            const typeSuffix = assetTypeText(assetItem) ? ` [${assetTypeText(assetItem)}]` : "";
            return `<option value="${escapeHtml(assetItem.id)}" data-role-index="${roleIndex}" ${assetItem.id === assetId ? "selected" : ""}>${escapeHtml(assetOptionLabel(assetItem))}${escapeHtml(typeSuffix)}${escapeHtml(status)}</option>`;
          }).join("")}
        </select>
      </div>
      <small class="${selectedAllocation ? `assignment-${selectedAllocation.level}` : ""}">${escapeHtml(helperText)}</small>
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
      <input id="role-${index}-type" name="${name}" list="role-${index}-type-options" value="${escapeHtml(inputValue || "")}" placeholder="Select or type">
      <datalist id="role-${index}-type-options">
        ${choices.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}
      </datalist>
    </div>
  `;
}

function showInlineEquipmentTypeEditor(selectEl) {
  const roleEl = selectEl.closest(".equipment-role");
  const roleIndex = roleEl?.dataset.roleIndex || "0";
  const currentValue = selectEl.dataset.currentType || "";
  selectEl.value = currentValue;
  roleEl?.querySelector(".new-equipment-type-row")?.remove();
  const editor = document.createElement("div");
  editor.className = "new-equipment-type-row";
  editor.innerHTML = `
    <label class="sr-only" for="new-equipment-type-${roleIndex}">New equipment type</label>
    <input id="new-equipment-type-${roleIndex}" type="text" placeholder="New type name" data-new-equipment-type-input>
    <button type="button" data-add-equipment-type>Add</button>
    <button type="button" class="secondary" data-cancel-equipment-type>Cancel</button>
  `;
  selectEl.closest(".role-type-cell")?.appendChild(editor);
  editor.querySelector("input")?.focus();
}

function commitInlineEquipmentType(buttonEl) {
  if (!buttonEl) return;
  const editor = buttonEl.closest(".new-equipment-type-row");
  const roleEl = editor?.closest(".equipment-role");
  const roleIndex = Number(roleEl?.dataset.roleIndex || 0);
  const normalized = rememberEquipmentType(editor?.querySelector("input")?.value);
  if (!normalized || !roleEl) {
    editor?.querySelector("input")?.focus();
    return;
  }
  const committedTypeInput = roleEl.querySelector('input[name="equipmentRoleCommittedType[]"]');
  const selectEl = roleEl.querySelector('select[name="equipmentRoleType[]"]');
  if (committedTypeInput) committedTypeInput.value = normalized;
  if (selectEl) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = normalized;
    option.selected = true;
    selectEl.insertBefore(option, selectEl.querySelector('option[value="__new_equipment_type__"]'));
    selectEl.value = normalized;
  }
  const roles = readEquipmentRolesFromForm();
  const role = roles[roleIndex];
  if (!role) return;
  role.assetType = normalized;
  role.label = normalized;
  role.assignedAssetIds = (role.assignedAssetIds || []).filter((assetId) => assetMatchesType(state.assets.find((item) => item.id === assetId), normalized));
  saveState();
  renderEquipmentRolesFrom(roles);
  document.getElementById(`role-${roleIndex}-type`)?.focus();
}

function cancelInlineEquipmentType(buttonEl) {
  buttonEl.closest(".new-equipment-type-row")?.remove();
}

function readEquipmentRolesFromForm() {
  const formEl = document.getElementById("eventForm");
  if (!formEl) return [];
  const roleIds = [...formEl.querySelectorAll('input[name="equipmentRoleId[]"]')];
  if (!roleIds.length) return [];

  const labels = [...formEl.querySelectorAll('input[name="equipmentRoleLabel[]"]')];
  const types = [...formEl.querySelectorAll('[name="equipmentRoleType[]"]')];
  const committedTypes = [...formEl.querySelectorAll('input[name="equipmentRoleCommittedType[]"]')];
  const quantities = [...formEl.querySelectorAll('input[name="equipmentRoleQuantity[]"]')];
  const assignmentsByRole = new Map();
  [...formEl.querySelectorAll('select[name="equipmentRoleAssignedAssetIds[]"]')].forEach((selectEl) => {
    const roleIndex = Number(selectEl.selectedOptions[0]?.dataset.roleIndex || selectEl.querySelector("option")?.dataset.roleIndex || 0);
    if (!assignmentsByRole.has(roleIndex)) assignmentsByRole.set(roleIndex, []);
    if (selectEl.value) assignmentsByRole.get(roleIndex).push(selectEl.value);
  });
  return roleIds.map((idInput, index) => {
    const selectedType = types[index]?.value.trim() || "";
    const committedType = committedTypes[index]?.value.trim() || "";
    const assetType = selectedType === "__new_equipment_type__" ? committedType : selectedType || committedType;
    const quantity = Math.max(1, Number(quantities[index]?.value) || 1);
    const assignedAssetIds = [...new Set(assignmentsByRole.get(index) || [])].filter((assetId) => {
      const assetItem = state.assets.find((item) => item.id === assetId);
      return assetItem && assetMatchesType(assetItem, assetType);
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
  target.classList.toggle("is-empty", !roles.length);
  const typeOptions = equipmentTypeOptions(roles.map((role) => role.assetType));
  target.innerHTML = roles.length
    ? `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions)).join("")}<div class="role-add-row">${equipmentRoleAddMarkup("Add Role")}</div>`
    : emptyEquipmentRolesMarkup();
}

function input(labelText, name, inputValue, type = "text", disabled = false) {
  const prefix = labelText.startsWith("Asset") || ["Quantity", "Status", "Serial Number", "Calibration Due Date"].includes(labelText) ? "asset" : "event";
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><input id="${prefix}-${name}" name="${name}" type="${type}" value="${escapeHtml(inputValue ?? "")}" ${disabled ? "disabled" : ""}></div>`;
}

function inputWithDatalist(labelText, name, inputValue, options) {
  const listId = `event-${name}-options`;
  return `<div class="field"><label for="event-${name}">${labelText}</label><input id="event-${name}" name="${name}" list="${listId}" value="${escapeHtml(inputValue ?? "")}"><datalist id="${listId}">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist></div>`;
}

function assetTypeInput(item) {
  const options = equipmentTypeOptions();
  return `
    <div class="field asset-type-editor">
      <label for="asset-typeEntry">Asset Types <span class="required-mark">Required</span></label>
      <div id="assetTypeChips" class="asset-type-chips">${assetTypesFor(item).map((assetType) => assetTypeChip(assetType)).join("")}</div>
      <div class="asset-type-entry">
        <input id="asset-typeEntry" list="asset-type-options" placeholder="Select or type a type">
        <button type="button" class="secondary" id="addAssetTypeBtn">Add Type</button>
      </div>
      <datalist id="asset-type-options">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist>
    </div>
  `;
}

function assetTypeChip(assetType) {
  return `<span class="asset-type-chip"><input type="hidden" name="assetTypes[]" value="${escapeHtml(assetType)}"><span>${escapeHtml(assetType)}</span><button type="button" class="secondary icon-button" data-remove-asset-type="${escapeHtml(assetType)}" aria-label="Remove ${escapeHtml(assetType)}">X</button></span>`;
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
  return { id: next, name: "", assetType: "", assetTypes: [], isStation: false, quantity: 1, serialNumber: "", owner: "", status: "Available", calibrationRequired: false, calibrationDueDate: "", imageData: "", notes: "" };
}

function emptyEvent() {
  const next = nextId("T", state.testEvents);
  const today = dateISO(new Date());
  return { id: next, name: "", eventCategory: "Test", program: "", uut: "", testType: "", startDate: today, endDate: today, stationAssetId: "", requiredAssetIds: [], equipmentRoles: [], priority: "Medium", owner: "", status: "Draft", notes: "" };
}

function nextId(prefix, collection) {
  const highest = collection.reduce((max, item) => Math.max(max, Number(String(item.id).replace(`${prefix}-`, "")) || 0), 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function renderAssetTable() {
  const assetTypeFilter = value("assetTypeFilter");
  renderAssetFilterState();
  const rows = state.assets.filter((item) => assetMatchesType(item, assetTypeFilter)).map((item) => ({
    picture: item.imageData
      ? `<button type="button" class="asset-thumb" data-view-asset-image="${escapeHtml(item.id)}" aria-label="View ${escapeHtml(item.name)} picture">${assetImageMarkup(item, `${item.name} picture`)}</button>`
      : `<div class="asset-thumb">${assetImageMarkup(item, `${item.name} picture`)}</div>`,
    id: item.id,
    name: item.name,
    type: assetTypeText(item),
    serial: item.serialNumber,
    station: item.isStation ? "Yes" : "No",
    status: statusBadge(item.status),
    quantity: item.quantity || 1,
    owner: item.owner,
    actions: rowActions("asset", item.id)
  }));
  renderTable("assetTable", ["picture", "id", "name", "type", "serial", "station", "status", "quantity", "owner", "actions"], rows);
}

function renderEventTable() {
  const assetsById = byId(state.assets);
  const conflictEvents = new Set(state.conflicts.flatMap((item) => item.eventIds));
  const rows = getFilteredEvents().map((item) => ({
    id: item.id,
    category: item.eventCategory || "Test",
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
  renderTable("eventTable", ["id", "category", "name", "program", "uut", "dates", "station", "equipment", "priority", "status", "conflicts", "actions"], rows);
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
    ${renderScheduleLegend(events)}
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

function renderScheduleLegend(events) {
  const visiblePrograms = unique(events.filter((item) => !item.eventCategory || item.eventCategory === "Test").map((item) => item.program));
  const visibleCategories = unique(events.filter((item) => item.eventCategory && item.eventCategory !== "Test").map((item) => item.eventCategory));
  const programItems = visiblePrograms.map((program) => legendItem(program || "Unassigned program", programColor(program), false));
  const categoryItems = visibleCategories.map((category) => legendItem(category, CATEGORY_COLORS[category] || "#6f6460", true));
  const conflict = `<span class="legend-item"><span class="legend-swatch conflict-swatch"></span>Conflict outline</span>`;
  return `<div class="schedule-legend" aria-label="Schedule color legend">${[...programItems, ...categoryItems, conflict].join("")}</div>`;
}

function legendItem(label, color, dashed) {
  return `<span class="legend-item"><span class="legend-swatch ${dashed ? "dashed" : ""}" style="background:${escapeHtml(color)}"></span>${escapeHtml(label)}</span>`;
}

function buildGroups(groupBy, events, assetsById) {
  if (groupBy === "events") return events.map((item) => ({ label: item.name, sublabel: eventSubtitle(item, assetsById), events: [item] }));
  const map = new Map();
  const ensure = (key, label, sublabel = "") => {
    if (!map.has(key)) map.set(key, { label, sublabel, events: [] });
    return map.get(key);
  };
  if (groupBy === "stations") state.assets.filter((item) => item.isStation).forEach((item) => ensure(item.id, item.name, assetTypeText(item)));
  events.forEach((item) => {
    if (groupBy === "stations") ensure(item.stationAssetId || "unassigned", assetsById.get(item.stationAssetId)?.name || "Unassigned", "station").events.push(item);
    if (groupBy === "programs") ensure(item.program || item.eventCategory || "Unassigned", item.program || item.eventCategory || "Unassigned", "program").events.push(item);
    if (groupBy === "uuts") ensure(item.uut || item.eventCategory || "Unassigned", item.uut || item.eventCategory || "Unassigned", item.program || item.eventCategory).events.push(item);
    if (groupBy === "assets") fullAssetIds(item).forEach((assetId) => {
      const assetItem = assetsById.get(assetId);
      ensure(assetId, assetItem?.name || assetId, assetItem ? assetTypeText(assetItem) : "asset").events.push(item);
    });
  });
  return [...map.values()].filter((group) => group.events.length || groupBy === "stations");
}

function renderLane(group, start, totalDays, assetsById, conflictEvents) {
  const barSlotHeight = 64;
  const bars = group.events.map((item, index) => {
    const left = Math.max(0, ((parseDate(item.startDate) - parseDate(start)) / MS_PER_DAY) / totalDays * 100);
    const width = Math.max(2, daysInclusive(item.startDate, item.endDate) / totalDays * 100);
    const color = eventColor(item);
    const station = assetsById.get(item.stationAssetId)?.name || "No station";
    const hasConflict = conflictEvents.has(item.id);
    const top = 10 + index * barSlotHeight;
    const dateRange = `${item.startDate} to ${item.endDate}`;
    return `<button type="button" class="bar ${item.eventCategory !== "Test" ? "non-test" : ""} ${hasConflict ? "conflict" : ""} ${inspectedEventId === item.id ? "selected" : ""}" data-inspect-event="${escapeHtml(item.id)}" title="${escapeHtml(`${item.name} / ${dateRange}`)}" style="left:${left}%;width:${width}%;top:${top}px;background:${color}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(eventSubtitle(item, assetsById))}</span><em>${escapeHtml(dateRange)}</em>${hasConflict ? '<span class="bar-badge">!</span>' : ""}</button>`;
  }).join("");
  const height = Math.max(86, 28 + group.events.length * barSlotHeight);
  return `<div class="lane" style="min-height:${height}px"><div class="lane-label">${escapeHtml(group.label)}<small>${escapeHtml(group.sublabel || `${group.events.length} event${group.events.length === 1 ? "" : "s"}`)}</small></div><div class="bar-zone" style="min-height:${height}px">${bars}</div></div>`;
}

function eventSubtitle(item, assetsById = byId(state.assets)) {
  const station = assetsById.get(item.stationAssetId)?.name || "No station";
  if (item.eventCategory === "Demo") return `${item.program || "No program"} / ${item.uut || "No demo unit"} / ${station}`;
  if (item.eventCategory && item.eventCategory !== "Test") return `${item.eventCategory} / ${station}`;
  return `${item.program || "No program"} / ${item.uut || "No UUT"} / ${station}`;
}

function renderEventInspector() {
  const target = document.getElementById("eventInspector");
  if (!target) return;
  const item = state.testEvents.find((eventItem) => eventItem.id === inspectedEventId);
  if (!item) {
    inspectedEventId = "";
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const assetsById = byId(state.assets);
  const station = assetsById.get(item.stationAssetId);
  const conflicts = state.conflicts.filter((conflict) => (conflict.eventIds || []).includes(item.id));
  target.hidden = false;
  target.innerHTML = `
    <div class="inspector-header">
      <div>
        <span>${escapeHtml(item.id)}</span>
        <h3>${escapeHtml(item.name || "Untitled event")}</h3>
      </div>
      <button type="button" class="secondary icon-button" data-close-event-inspector aria-label="Close event details">X</button>
    </div>
    <div class="inspector-actions">
      <button type="button" data-edit-event="${escapeHtml(item.id)}">Edit Event</button>
    </div>
    <dl class="detail-list">
      ${detailItem("Category", item.eventCategory || "Test")}
      ${detailItem("Program", item.program)}
      ${eventUsesUut(item.eventCategory || "Test") ? detailItem(eventUutLabel(item.eventCategory || "Test"), item.uut) : ""}
      ${item.eventCategory === "Test" ? detailItem("Test Type", item.testType) : ""}
      ${item.eventCategory === "Demo" ? detailItem("Demo Type", item.testType) : ""}
      ${detailItem("Dates", `${item.startDate} to ${item.endDate} (${daysInclusive(item.startDate, item.endDate)} day${daysInclusive(item.startDate, item.endDate) === 1 ? "" : "s"})`)}
      ${detailItem(item.eventCategory === "Test" ? "Station" : item.eventCategory === "Demo" ? "Demo Station" : "Affected Station", station ? assetOptionLabel(station) : "No station assigned")}
      ${detailItem("Priority", item.priority)}
      ${detailItem("Status", item.status)}
      ${detailItem("Owner", item.owner)}
    </dl>
    ${item.eventCategory === "Test" ? `<div class="inspector-section">
      <h4>Equipment Roles</h4>
      ${renderInspectorEquipmentRoles(item, assetsById)}
    </div>` : ""}
    <div class="inspector-section">
      <h4>Conflicts</h4>
      ${conflicts.length ? conflicts.map((conflict) => `<p class="inspector-conflict">${badge(conflict.severity, conflict.severity === "Critical" ? "high" : "medium")} ${escapeHtml(conflict.conflictType)}: ${escapeHtml(conflict.explanation)}</p>`).join("") : `<p class="muted-line">No conflicts for this event.</p>`}
    </div>
    ${item.notes ? `<div class="inspector-section"><h4>Notes</h4><p>${escapeHtml(item.notes)}</p></div>` : ""}
  `;
}

function detailItem(label, valueText) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(valueText || "Not set")}</dd></div>`;
}

function renderInspectorEquipmentRoles(testEvent, assetsById) {
  const roles = testEvent.equipmentRoles || [];
  if (!roles.length) return `<p class="muted-line">No equipment roles assigned.</p>`;
  return roles.map((role) => {
    const assigned = (role.assignedAssetIds || []).map((assetId) => assetsById.get(assetId)?.name || assetId);
    const needed = Math.max(1, Number(role.quantity) || 1);
    const missing = Math.max(0, needed - assigned.length);
    const assignmentText = [...assigned, ...Array.from({ length: missing }, () => "Unassigned")].join(", ");
    return `
      <article class="inspector-role">
        <strong>${escapeHtml(role.label || role.assetType || "Equipment role")}</strong>
        <span>${escapeHtml(role.assetType || "Any type")} x${needed}</span>
        <small>${escapeHtml(assignmentText)}</small>
      </article>
    `;
  }).join("");
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

function eventColor(item) {
  if (item.eventCategory && item.eventCategory !== "Test") return CATEGORY_COLORS[item.eventCategory] || "#6f6460";
  return programColor(item.program);
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
    quantity: item.capacity,
    shortage: item.shortage,
    peakDates: item.peakDates,
    affectedPrograms: item.affectedPrograms,
    action: item.action
  }));
  renderTable("bottleneckTable", ["asset", "assetType", "conflicts", "events", "programs", "totalDays", "peakDemand", "quantity", "shortage", "peakDates", "affectedPrograms", "action"], rows);
}

function renderReport() {
  const conflicts = state.conflicts;
  const bottlenecks = computeBottlenecks().slice(0, 5);
  const roleRows = state.testEvents.map((item) => ({
    event: item.name,
    program: item.program,
    equipmentRoles: roleSummary(item)
  }));
  const equipmentReviewRows = eventEquipmentReviewRows();
  document.getElementById("report").innerHTML = `
    <h3>Planning Summary</h3>
    <div class="report-grid">
      ${metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations`)}
      ${metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`)}
      ${metric("Conflicts", conflicts.length, `${conflicts.filter((item) => item.severity === "Critical").length} critical`)}
    </div>
    <h3>Highest Demand Assets</h3>
    ${tableMarkup(["asset", "assetType", "conflicts", "events", "peakDemand", "quantity", "action"], bottlenecks.map((item) => ({ ...item, quantity: item.capacity })))}
    <h3>Equipment Role Coverage</h3>
    ${tableMarkup(["event", "program", "equipmentRoles"], roleRows)}
    <h3>Event Equipment Review</h3>
    ${tableMarkup(["event", "category", "station", "role", "requiredQty", "assignedEquipment", "missing"], equipmentReviewRows)}
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
  const assetTypes = readAssetTypesFromForm(eventObj.currentTarget, true);
  if (!assetTypes.length) {
    renderAssetTypeRequiredWarning(true);
    document.getElementById("asset-typeEntry")?.focus();
    return;
  }
  const next = {
    ...current,
    name: formText(form, "name"),
    assetTypes: assetTypes.map((assetType) => rememberEquipmentType(assetType)).filter(Boolean),
    assetType: rememberEquipmentType(assetTypes[0] || ""),
    quantity: Number(formValue(form, "quantity")) || 1,
    serialNumber: formText(form, "serialNumber"),
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Available",
    calibrationRequired: form.has("calibrationRequired"),
    calibrationDueDate: formValue(form, "calibrationDueDate"),
    imageData: formValue(form, "imageData"),
    notes: formText(form, "notes"),
    isStation: form.has("isStation")
  };
  const duplicateMatches = assetDuplicateMatches(next, current.id);
  if (duplicateMatches.length && !confirm(`${assetDuplicateWarningText(duplicateMatches)}\n\nSave this asset anyway?`)) return;
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
  const eventCategory = EVENT_CATEGORIES.includes(formValue(form, "eventCategory")) ? formValue(form, "eventCategory") : "Test";
  const equipmentRoles = eventCategory === "Test" ? readEquipmentRolesFromForm().map((role) => ({
    ...role,
    assetType: rememberEquipmentType(role.assetType),
    label: rememberEquipmentType(role.assetType) || role.label,
    assignedAssetIds: [...new Set((role.assignedAssetIds || []).filter((assetId) => validAssetIds.has(assetId)))].slice(0, Math.max(1, Number(role.quantity) || 1))
  })).filter((role) => role.label || role.assetType || role.assignedAssetIds.length) : [];
  const assignedAssetIds = equipmentRoles.flatMap((role) => role.assignedAssetIds);
  const stationAssetId = stationIds.has(formValue(form, "stationAssetId")) ? formValue(form, "stationAssetId") : "";
  const startDate = formValue(form, "startDate");
  const endDate = formValue(form, "endDate");
  const program = formText(form, "program");
  const uut = formText(form, "uut");
  const next = {
    ...current,
    name: formText(form, "name"),
    eventCategory,
    program,
    uut: eventUsesUut(eventCategory) ? uut : "",
    testType: eventCategory === "Test" || eventCategory === "Demo" ? formText(form, "testType") : "",
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
  state.uuts = unique([...state.uuts, eventUsesUut(eventCategory) ? uut : ""]);
  eventDrafts.delete(eventDraftKey(selectedEventId));
  eventDrafts.delete(eventDraftKey(next.id));
  selectedEventId = next.id;
  inspectedEventId = next.id;
  refresh();
  closeEventModal(false);
}

function eventEquipmentReviewRows() {
  const assetsById = byId(state.assets);
  return state.testEvents.flatMap((testEvent) => {
    const station = assetsById.get(testEvent.stationAssetId)?.name || "No station";
    if (testEvent.eventCategory && testEvent.eventCategory !== "Test") {
      return [{
        event: testEvent.name,
        category: testEvent.eventCategory,
        station,
        role: "Station unavailable",
        requiredQty: 1,
        assignedEquipment: station,
        missing: station === "No station" ? 1 : 0
      }];
    }
    const roles = testEvent.equipmentRoles || [];
    if (!roles.length) {
      return [{
        event: testEvent.name,
        category: "Test",
        station,
        role: "No equipment roles",
        requiredQty: 0,
        assignedEquipment: "",
        missing: 0
      }];
    }
    return roles.map((role) => {
      const requiredQty = Math.max(1, Number(role.quantity) || 1);
      const assigned = (role.assignedAssetIds || []).map((assetId) => assetsById.get(assetId)?.name || assetId);
      return {
        event: testEvent.name,
        category: "Test",
        station,
        role: role.label || role.assetType || "Equipment role",
        requiredQty,
        assignedEquipment: assigned.join("; ") || "Unassigned",
        missing: Math.max(0, requiredQty - assigned.length)
      };
    });
  });
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
    assets: state.assets.map(({ imageData, ...assetItem }) => ({ ...assetItem, assetTypes: assetTypeText(assetItem), hasPicture: imageData ? "Yes" : "No" })),
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
      inspectedEventId = "";
      eventDrafts.clear();
      refresh();
    } catch (error) {
      alert(`Could not import JSON: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function handleAssetImageSelect(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const imageData = String(reader.result || "");
    const inputEl = document.getElementById("asset-imageData");
    const previewEl = document.getElementById("assetImagePreview");
    const removeBtn = document.getElementById("removeAssetImageBtn");
    if (inputEl) inputEl.value = imageData;
    if (previewEl) previewEl.innerHTML = assetImageMarkup({ imageData }, "Asset image preview");
    if (removeBtn) removeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

function imageFileFromItems(items = []) {
  return [...items].map((item) => item.kind === "file" ? item.getAsFile() : null).find((file) => file?.type.startsWith("image/"));
}

function setAssetDropActive(isActive) {
  document.getElementById("assetImagePreview")?.classList.toggle("drag-active", isActive);
}

function removeAssetImage() {
  const inputEl = document.getElementById("asset-imageData");
  const fileEl = document.getElementById("asset-imageFile");
  const previewEl = document.getElementById("assetImagePreview");
  const removeBtn = document.getElementById("removeAssetImageBtn");
  if (inputEl) inputEl.value = "";
  if (fileEl) fileEl.value = "";
  if (previewEl) previewEl.innerHTML = assetImageMarkup({ imageData: "" }, "Asset image preview");
  if (removeBtn) removeBtn.disabled = true;
}

function addAssetTypeFromEntry() {
  const inputEl = document.getElementById("asset-typeEntry");
  const chipsEl = document.getElementById("assetTypeChips");
  const normalized = rememberEquipmentType(inputEl?.value);
  if (!normalized || !chipsEl) {
    inputEl?.focus();
    return;
  }
  if (!readAssetTypesFromForm().includes(normalized)) chipsEl.insertAdjacentHTML("beforeend", assetTypeChip(normalized));
  inputEl.value = "";
  inputEl.focus();
  renderAssetTypeRequiredWarning(false);
  renderAssetDuplicateWarning();
}

function removeAssetType(assetType) {
  [...document.querySelectorAll('input[name="assetTypes[]"]')].find((inputEl) => inputEl.value === assetType)?.closest(".asset-type-chip")?.remove();
  renderAssetDuplicateWarning();
}

function readAssetCandidateFromForm(formEl = document.getElementById("assetForm")) {
  if (!formEl) return {};
  const form = new FormData(formEl);
  const assetTypes = readAssetTypesFromForm(formEl, true);
  return {
    id: formValue(form, "id"),
    name: formText(form, "name"),
    assetTypes,
    assetType: assetTypes[0] || "",
    serialNumber: formText(form, "serialNumber")
  };
}

function renderAssetDuplicateWarning() {
  const warningEl = document.getElementById("assetDuplicateWarning");
  const formEl = document.getElementById("assetForm");
  if (!warningEl || !formEl) return;
  const candidate = readAssetCandidateFromForm(formEl);
  const matches = assetDuplicateMatches(candidate, candidate.id);
  const warningText = assetDuplicateWarningText(matches);
  warningEl.hidden = !warningText;
  warningEl.textContent = warningText;
}

function renderAssetTypeRequiredWarning(forceVisible = false) {
  const warningEl = document.getElementById("assetTypeRequiredWarning");
  const formEl = document.getElementById("assetForm");
  if (!warningEl || !formEl) return;
  const hasAssetType = readAssetTypesFromForm(formEl, true).length > 0;
  warningEl.hidden = hasAssetType || !forceVisible;
  document.querySelector(".asset-type-editor")?.classList.toggle("field-error", !hasAssetType && forceVisible);
}

function openImageViewer(imageData, title = "Asset Picture") {
  if (!imageData) return;
  document.getElementById("imageViewerTitle").textContent = title;
  document.getElementById("imageViewerBody").innerHTML = `<img src="${escapeHtml(imageData)}" alt="${escapeHtml(title)}">`;
  document.getElementById("imageViewer").hidden = false;
}

function closeImageViewer() {
  document.getElementById("imageViewer").hidden = true;
  document.getElementById("imageViewerBody").innerHTML = "";
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
  if (eventObj.target.closest("[data-close-image-viewer]")) {
    closeImageViewer();
    return;
  }
  if (inspectedEventId && activeView === "schedule" && !eventObj.target.closest("#eventInspector") && !eventObj.target.closest("[data-inspect-event]") && !eventObj.target.closest("#eventModal")) {
    inspectedEventId = "";
    renderGantt();
    renderEventInspector();
  }
  const target = eventObj.target.closest("button");
  if (!target) return;
  if (target.type === "submit" && target.closest("form")) return;
  if (target.dataset.viewAssetImage) {
    const assetItem = state.assets.find((item) => item.id === target.dataset.viewAssetImage);
    openImageViewer(assetItem?.imageData, assetItem?.name || "Asset Picture");
  }
  if (target.dataset.previewCurrentAssetImage !== undefined) {
    const imageData = value("asset-imageData");
    openImageViewer(imageData, formValue(new FormData(document.getElementById("assetForm")), "name") || "Asset Picture");
  }
  if (target.dataset.inspectEvent) {
    inspectedEventId = target.dataset.inspectEvent;
    renderGantt();
    renderEventInspector();
  }
  if (target.dataset.closeEventInspector !== undefined) {
    inspectedEventId = "";
    renderGantt();
    renderEventInspector();
  }
  if (target.dataset.view) {
    setActiveView(target.dataset.view);
  }
  if (target.id === "sampleBtn") {
    state = structuredClone(sampleData);
    selectedAssetId = "";
    selectedEventId = "";
    inspectedEventId = "";
    eventDrafts.clear();
    refresh();
  }
  if (target.id === "newPlanBtn" && confirm("Start a new blank plan? This will replace the current local plan in this browser.")) {
    state = structuredClone(emptyData);
    selectedAssetId = "";
    selectedEventId = "";
    inspectedEventId = "";
    eventDrafts.clear();
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
  if (target.id === "removeAssetImageBtn") {
    removeAssetImage();
  }
  if (target.id === "addAssetTypeBtn") {
    addAssetTypeFromEntry();
  }
  if (target.dataset.removeAssetType) {
    removeAssetType(target.dataset.removeAssetType);
  }
  if (target.id === "addEventBtn" || target.id === "addScheduleEventBtn") {
    selectedEventId = "";
    openEventModal();
  }
  if (target.id === "cancelEventBtn") {
    closeEventModal();
  }
  if (target.id === "addEquipmentRoleBtn") {
    addEquipmentRole();
  }
  if (target.dataset.addEquipmentType !== undefined) {
    commitInlineEquipmentType(target);
  }
  if (target.dataset.cancelEquipmentType !== undefined) {
    cancelInlineEquipmentType(target);
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
    if (!target.closest("#eventInspector")) setActiveView("events");
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
    eventDrafts.delete(eventDraftKey(target.dataset.deleteEvent));
    if (inspectedEventId === target.dataset.deleteEvent) inspectedEventId = "";
    selectedEventId = "";
    refresh();
  }
  if (target.id === "clearFiltersBtn") {
    ["programFilter", "uutFilter", "stationFilter", "ownerFilter", "fromFilter", "toFilter"].forEach((id) => setValue(id, ""));
    refresh();
  }
  if (target.id === "clearAssetTypeFilterBtn") {
    setValue("assetTypeFilter", "");
    renderAssetTable();
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
  if (eventObj.target.id === "asset-typeEntry" && eventObj.key === "Enter") {
    eventObj.preventDefault();
    addAssetTypeFromEntry();
    return;
  }
  if (eventObj.target.matches("[data-new-equipment-type-input]")) {
    if (eventObj.key === "Enter") {
      eventObj.preventDefault();
      commitInlineEquipmentType(eventObj.target.closest(".new-equipment-type-row")?.querySelector("[data-add-equipment-type]"));
    }
    if (eventObj.key === "Escape") {
      eventObj.preventDefault();
      eventObj.stopPropagation();
      cancelInlineEquipmentType(eventObj.target);
    }
    return;
  }
  if (eventObj.key === "Escape") {
    closeImageViewer();
    closeAssetModal();
    closeEventModal();
  }
});

["groupBy", "programFilter", "uutFilter", "stationFilter", "ownerFilter", "fromFilter", "toFilter"].forEach((id) => {
  document.addEventListener("change", (eventObj) => {
    if (eventObj.target.id === id) {
      if (eventObj.target.id === "programFilter") renderUutFilter();
      renderGantt();
      renderEventTable();
    }
  });
});

["event-startDate", "event-endDate", "event-stationAssetId"].forEach((id) => {
  document.addEventListener("change", (eventObj) => {
    if (eventObj.target.id === id) {
      if (eventObj.target.id === "event-startDate") syncEventEndDateBounds();
      refreshEventEquipmentRoles();
    }
  });
});

document.addEventListener("change", (eventObj) => {
  if (eventObj.target.id === "assetTypeFilter") renderAssetTable();
});

document.addEventListener("change", (eventObj) => {
  if (eventObj.target.id !== "event-eventCategory") return;
  saveEventDraftFromForm();
  renderEventForm();
});

document.addEventListener("change", (eventObj) => {
  if (!eventObj.target.closest("#eventEquipmentRoles")) return;
  if (eventObj.target.name === "equipmentRoleType[]" && eventObj.target.value === "__new_equipment_type__") {
    showInlineEquipmentTypeEditor(eventObj.target);
    return;
  }
  if (eventObj.target.name === "equipmentRoleType[]") {
    const roleEl = eventObj.target.closest(".equipment-role");
    const committedTypeInput = roleEl?.querySelector('input[name="equipmentRoleCommittedType[]"]');
    if (committedTypeInput) committedTypeInput.value = eventObj.target.value;
  }
  refreshEventEquipmentRoles();
});

document.getElementById("importJson").addEventListener("change", (eventObj) => {
  const file = eventObj.target.files[0];
  if (file) importJson(file);
  eventObj.target.value = "";
});

document.addEventListener("change", (eventObj) => {
  if (eventObj.target.id === "asset-imageFile") {
    handleAssetImageSelect(eventObj.target.files[0]);
  }
});

document.addEventListener("input", (eventObj) => {
  if (!eventObj.target.closest("#assetForm")) return;
  renderAssetTypeRequiredWarning(false);
  renderAssetDuplicateWarning();
});

document.addEventListener("dragover", (eventObj) => {
  if (!eventObj.target.closest("#assetImagePreview")) return;
  eventObj.preventDefault();
  setAssetDropActive(true);
});

document.addEventListener("dragleave", (eventObj) => {
  if (!eventObj.target.closest("#assetImagePreview")) return;
  setAssetDropActive(false);
});

document.addEventListener("drop", (eventObj) => {
  if (!eventObj.target.closest("#assetImagePreview")) return;
  eventObj.preventDefault();
  setAssetDropActive(false);
  const file = [...eventObj.dataTransfer.files].find((item) => item.type.startsWith("image/")) || imageFileFromItems(eventObj.dataTransfer.items || []);
  handleAssetImageSelect(file);
});

document.addEventListener("paste", (eventObj) => {
  const assetModalOpen = !document.getElementById("assetModal")?.hidden;
  if (!assetModalOpen || document.activeElement?.id !== "assetImagePreview") return;
  const file = imageFileFromItems(eventObj.clipboardData?.items || []);
  if (!file) return;
  eventObj.preventDefault();
  handleAssetImageSelect(file);
});

refresh();
