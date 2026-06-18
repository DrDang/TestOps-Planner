"use strict";

const STORAGE_KEY = "testops-planner-v2";
const EVENT_HIDDEN_COLUMNS_KEY = "testops-planner-event-hidden-columns";
const PLAN_FILE_DB = "testops-planner-file-handles";
const PLAN_FILE_STORE = "handles";
const LAST_PLAN_FILE_KEY = "last-json";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROGRAM_COLORS = ["#246b5d", "#8b4b8f", "#2f6f9f", "#b45c2d", "#5b6f28", "#7d4e2c", "#355da8", "#9a3d54"];
const BAD_STATUSES = new Set(["Down", "Out for Calibration", "Retired", "Unknown"]);
const EVENT_CATEGORIES = ["Test", "Demo", "Calibration", "Maintenance", "Outage"];
const DUT_TYPE = "DUT";
const RACK_TYPE = "Rack";
const TEST_OPERATOR_TYPE = "Test Operator";
const CATEGORY_COLORS = {
  Demo: "#2d6f9f",
  Calibration: "#7a5c12",
  Maintenance: "#6f6460",
  Outage: "#b83232"
};
const DOUBLE_BOOKING_CONFLICT_TYPES = new Set(["Station", "Operator", "Equipment", "Rack", "UUT"]);
const EVENT_TABLE_COLUMNS = ["id", "category", "name", "program", "uut", "dates", "station", "rack", "operators", "equipment", "priority", "status", "roleStatus", "conflicts", "actions"];
const EVENT_TABLE_OPTIONAL_COLUMNS = EVENT_TABLE_COLUMNS.filter((column) => column !== "actions");
const DEFAULT_EVENT_HIDDEN_COLUMNS = ["priority"];

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
    asset("A-003", "Spectrum Analyzer SA-001", "Spectrum Analyzer", false, "Metrology", "Available", 1, true, "2026-08-01", "", "A-001"),
    asset("A-004", "10 MHz Reference", "Timing Reference", false, "Test Engineering", "Available", 3, true, "2027-01-10", "", "A-001"),
    asset("A-005", "ESS Station", "Station", true, "Env Test", "Available", 1, false, ""),
    asset("A-006", "EMI Receiver", "EMI Equipment", false, "Compliance", "Out for Calibration", 1, true, "2026-06-20"),
    asset("A-007", "Power Supply Stack", "Power Supply", false, "Test Engineering", "Available", 2, true, "2026-11-30"),
    asset("A-009", "5VDC Bench Supply", "5VDC Power Supply", false, "Test Engineering", "Available", 1, true, "2026-12-15", "", "A-001"),
    asset("A-010", "Oscilloscope MSO-4", "Oscilloscope", false, "Metrology", "Available", 1, true, "2026-10-05", "", "A-001"),
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
let currentEventReport = null;
let pendingRackImportId = "";
let pendingDeleteRequest = null;
let planFileHandle = null;
let planFileName = "";
let canUseStoredPlanFileHandle = true;
let saveJsonFeedbackTimer = 0;
const eventDrafts = new Map();
const NEW_EVENT_DRAFT_KEY = "__new_event__";
const assetDrafts = new Map();
const NEW_ASSET_DRAFT_KEY = "__new_asset__";
const assetColumnFilters = {};
const conflictColumnFilters = {};
const eventHiddenColumns = new Set(loadEventHiddenColumns());
const ASSET_COLUMN_EMPTY_FILTER = "__empty__";
const CONFLICT_COLUMN_EMPTY_FILTER = "__empty__";

function asset(id, name, assetType, isStation, owner, status, quantity, calibrationRequired, calibrationDueDate, imageData = "", stationGroupId = "") {
  return { id, manufacturer: "", name, assetType, stationGroupId, isStation, isRack: false, isOperator: false, isDut: false, allowMultiRoleUse: false, quantity, serialNumber: "", owner, status, calibrationRequired, calibrationDueDate, capabilities: "", imagePath: "", imageData, notes: "" };
}

function event(id, name, program, uut, testType, startDate, endDate, stationAssetId, requiredAssetIds, priority, owner, status, equipmentRoles = [], eventCategory = "Test") {
  return { id, name, eventCategory, program, uut, testType, startDate, endDate, stationAssetId, stationGroupId: "", operatorAssetId: "", operatorAssetIds: [], requiredAssetIds, equipmentRoles, priority, owner, status, notes: "" };
}

function equipmentRole(id, label, assetType, quantity = 1, assignedAssetIds = [], requirements = "", rationale = "") {
  return { id, label, assetType, quantity, assignedAssetIds, requirements, rationale };
}

function eventUsesUut(eventCategory) {
  return eventCategory === "Test" || eventCategory === "Demo";
}

function eventUsesEquipment(eventCategory) {
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

function loadEventHiddenColumns() {
  try {
    const stored = JSON.parse(localStorage.getItem(EVENT_HIDDEN_COLUMNS_KEY) || "null");
    return Array.isArray(stored) ? stored.filter((column) => EVENT_TABLE_OPTIONAL_COLUMNS.includes(column)) : DEFAULT_EVENT_HIDDEN_COLUMNS;
  } catch {
    return DEFAULT_EVENT_HIDDEN_COLUMNS;
  }
}

function saveEventHiddenColumns() {
  localStorage.setItem(EVENT_HIDDEN_COLUMNS_KEY, JSON.stringify([...eventHiddenColumns]));
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
  nextState.settings.dutTypeDependencies = normalizeDutDependencyMap(nextState.settings.dutTypeDependencies);
  nextState.assets = nextState.assets.map(({ assetTag, shareable, location, maxConcurrentUses, ...assetItem }) => {
    const incomingTypes = assetTypesFor(assetItem);
    const isRack = Boolean(assetItem.isRack) || incomingTypes.includes(RACK_TYPE);
    const isDut = Boolean(assetItem.isDut) || incomingTypes.includes(DUT_TYPE);
    const assetTypes = unique([...incomingTypes, ...(isRack ? [RACK_TYPE] : []), ...(isDut ? [DUT_TYPE] : [])]);
    return {
      ...assetItem,
      manufacturer: assetItem.manufacturer || "",
      isStation: isRack ? false : Boolean(assetItem.isStation),
      isRack,
      isOperator: Boolean(assetItem.isOperator),
      isDut,
      allowMultiRoleUse: !isRack && !assetItem.isOperator && !isDut && Boolean(assetItem.allowMultiRoleUse),
      dutType: assetItem.dutType || "",
      assetTypes,
      assetType: assetTypes[0] || "",
      stationGroupId: assetItem.stationGroupId || "",
      quantity: Number(maxConcurrentUses || assetItem.quantity || 1),
      capabilities: assetItem.capabilities || "",
      imagePath: assetItem.imagePath || "",
      imageData: assetItem.imageData || ""
    };
  });
  const assetExpansion = expandMultiQuantityAssets(nextState.assets);
  nextState.assets = assetExpansion.assets;
  nextState.testEvents = remapExpandedAssetReferences(nextState.testEvents, assetExpansion.pools);
  const validAssetIds = new Set(nextState.assets.map((item) => item.id));
  const stationIds = new Set(nextState.assets.filter((item) => item.isStation).map((item) => item.id));
  const rackIds = new Set(nextState.assets.filter((item) => item.isRack).map((item) => item.id));
  nextState.assets = nextState.assets.map((assetItem) => ({
    ...assetItem,
    stationGroupId: !assetItem.isOperator && !assetItem.isDut && !assetItem.isRack && rackIds.has(assetItem.stationGroupId) && assetItem.stationGroupId !== assetItem.id ? assetItem.stationGroupId : ""
  }));
  const operatorIds = new Set(nextState.assets.filter((item) => item.isOperator).map((item) => item.id));
  const assetsById = byId(nextState.assets);
  nextState.testEvents = nextState.testEvents.map((testEvent) => {
    const eventCategory = EVENT_CATEGORIES.includes(testEvent.eventCategory) ? testEvent.eventCategory : "Test";
    const stationAssetId = stationIds.has(testEvent.stationAssetId) ? testEvent.stationAssetId : "";
    const stationGroupId = rackIds.has(testEvent.stationGroupId) ? testEvent.stationGroupId : "";
    const operatorAssetIds = operatorIdsForEvent(testEvent).filter((assetId) => operatorIds.has(assetId));
    const legacyEquipmentIds = [...new Set((testEvent.requiredAssetIds || []).filter((assetId) => validAssetIds.has(assetId) && assetId !== stationAssetId && !operatorAssetIds.includes(assetId)))];
    const equipmentRoles = eventUsesEquipment(eventCategory) ? normalizeEquipmentRoles(testEvent.equipmentRoles, legacyEquipmentIds, assetsById) : [];
    const assignedEquipmentIds = equipmentRoles.flatMap((role) => role.assignedAssetIds || []);
    return {
      ...testEvent,
      eventCategory,
      uut: eventUsesUut(eventCategory) ? testEvent.uut : "",
      testType: eventCategory === "Test" || eventCategory === "Demo" ? testEvent.testType : "",
      stationAssetId,
      stationGroupId,
      operatorAssetId: operatorAssetIds[0] || "",
      operatorAssetIds,
      equipmentRoles,
      requiredAssetIds: [...new Set([stationAssetId, ...operatorAssetIds, ...assignedEquipmentIds].filter((assetId) => validAssetIds.has(assetId)))]
    };
  });
  nextState.programs = unique([...(nextState.programs || []), ...nextState.testEvents.map((item) => item.program)]);
  const eventUuts = unique(nextState.testEvents.filter((item) => eventUsesUut(item.eventCategory)).map((item) => item.uut));
  nextState.uuts = unique([...(nextState.uuts || []), ...eventUuts]);
  syncDutAssetsFromUuts(nextState, eventUuts);
  return nextState;
}

function expandMultiQuantityAssets(assets) {
  const expanded = [];
  const pools = new Map();
  assets.forEach((assetItem) => {
    const count = Math.max(1, Math.floor(Number(assetItem.quantity) || 1));
    const pool = [assetItem.id];
    const base = { ...assetItem, quantity: 1 };
    const useSerialPlaceholder = assetUsesSerialNumber(base);
    if (count > 1 && useSerialPlaceholder && !String(base.serialNumber || "").trim()) {
      base.serialNumber = nextUndefinedSerial([...expanded, base]);
    }
    expanded.push(base);
    for (let index = 1; index < count; index += 1) {
      const copyId = nextId("A", [...expanded, ...assets]);
      const copy = {
        ...JSON.parse(JSON.stringify(assetItem)),
        id: copyId,
        quantity: 1,
        imageData: "",
        serialNumber: useSerialPlaceholder ? nextUndefinedSerial(expanded) : "",
        notes: assetItem.notes || ""
      };
      expanded.push(copy);
      pool.push(copyId);
    }
    if (pool.length > 1) pools.set(assetItem.id, pool);
  });
  return { assets: expanded, pools };
}

function remapExpandedAssetReferences(testEvents, pools) {
  if (!pools.size) return testEvents;
  const nextEvents = testEvents.map((testEvent) => ({
    ...testEvent,
    operatorAssetIds: Array.isArray(testEvent.operatorAssetIds) ? [...testEvent.operatorAssetIds] : [],
    requiredAssetIds: Array.isArray(testEvent.requiredAssetIds) ? [...testEvent.requiredAssetIds] : [],
    equipmentRoles: Array.isArray(testEvent.equipmentRoles)
      ? testEvent.equipmentRoles.map((role) => ({
        ...role,
        assignedAssetIds: Array.isArray(role.assignedAssetIds) ? [...role.assignedAssetIds] : []
      }))
      : []
  }));
  const allocations = new Map();
  const assignedEvents = (assetId) => allocations.get(assetId) || [];
  const reserve = (assetId, testEvent) => {
    if (!allocations.has(assetId)) allocations.set(assetId, []);
    allocations.get(assetId).push(testEvent);
    return assetId;
  };
  const chooseAsset = (assetId, testEvent, eventChoices) => {
    if (!assetId) return "";
    const pool = pools.get(assetId);
    if (!pool) return reserve(assetId, testEvent);
    const openAssetId = pool.find((candidateId) => !eventChoices.has(candidateId) && !assignedEvents(candidateId).some((assignedEvent) => overlaps(assignedEvent, testEvent)));
    const fallbackAssetId = openAssetId || pool.find((candidateId) => !eventChoices.has(candidateId)) || pool[0];
    eventChoices.add(fallbackAssetId);
    return reserve(fallbackAssetId, testEvent);
  };

  nextEvents
    .map((testEvent, index) => ({ testEvent, index }))
    .sort((a, b) => String(a.testEvent.startDate || "").localeCompare(String(b.testEvent.startDate || "")) || a.index - b.index)
    .forEach(({ testEvent }) => {
      const eventChoices = new Set();
      const originalStationAssetId = testEvent.stationAssetId;
      const originalOperatorIds = operatorIdsForEvent(testEvent);
      const hasEquipmentRoles = Boolean((testEvent.equipmentRoles || []).length);
      if (testEvent.stationAssetId) testEvent.stationAssetId = chooseAsset(testEvent.stationAssetId, testEvent, eventChoices);
      const operatorIds = originalOperatorIds.map((assetId) => chooseAsset(assetId, testEvent, eventChoices));
      testEvent.operatorAssetIds = uniqueIds(operatorIds);
      testEvent.operatorAssetId = testEvent.operatorAssetIds[0] || "";
      testEvent.equipmentRoles = (testEvent.equipmentRoles || []).map((role) => ({
        ...role,
        assignedAssetIds: (role.assignedAssetIds || []).map((assetId) => chooseAsset(assetId, testEvent, eventChoices))
      }));
      if (hasEquipmentRoles) return;
      testEvent.requiredAssetIds = uniqueIds((testEvent.requiredAssetIds || []).map((assetId) => {
        if (assetId === originalStationAssetId) return testEvent.stationAssetId;
        const operatorIndex = originalOperatorIds.indexOf(assetId);
        if (operatorIndex >= 0) return testEvent.operatorAssetIds[operatorIndex] || "";
        return chooseAsset(assetId, testEvent, eventChoices);
      }));
    });
  return nextEvents;
}

function normalizeDutDependencyMap(dependencyMap = {}) {
  return Object.fromEntries(Object.entries(dependencyMap || {}).map(([dutType, dependencies]) => [
    dutType,
    normalizeDutDependencies(dependencies)
  ]).filter(([dutType, dependencies]) => dutType && dependencies.length));
}

function normalizeDutDependencies(dependencies = []) {
  return dependencies.map((dependency) => ({
    assetType: String(dependency.assetType || "").trim(),
    quantity: Math.max(1, Number(dependency.quantity) || 1),
    requirements: String(dependency.requirements || "").trim()
  })).filter((dependency) => dependency.assetType);
}

function syncDutAssetsFromUuts(nextState, uutNames) {
  uutNames.filter(Boolean).forEach((uutName) => {
    const existing = nextState.assets.find((assetItem) => comparableText(assetItem.name) === comparableText(uutName) && (assetItem.isDut || (!assetItem.isStation && !assetItem.isRack && !assetItem.isOperator)));
    if (existing) {
      existing.isDut = true;
      existing.isStation = false;
      existing.isRack = false;
      existing.isOperator = false;
      existing.stationGroupId = "";
      existing.assetTypes = unique([...assetTypesFor(existing), DUT_TYPE]);
      existing.assetType = existing.assetTypes[0] || DUT_TYPE;
      existing.dutType = existing.dutType || "";
      existing.quantity = 1;
      return;
    }
    const nextIdValue = nextId("A", nextState.assets);
    nextState.assets.push({
      id: nextIdValue,
      manufacturer: "",
      name: uutName,
      assetType: DUT_TYPE,
      assetTypes: [DUT_TYPE],
      stationGroupId: "",
      isStation: false,
      isRack: false,
      isOperator: false,
      isDut: true,
      dutType: "",
      quantity: 1,
      serialNumber: "",
      owner: "",
      status: "Available",
      calibrationRequired: false,
      calibrationDueDate: "",
      capabilities: "",
      imagePath: "",
      imageData: "",
      notes: "Created from an event UUT."
    });
  });
}

function normalizeEquipmentRoles(roles, legacyEquipmentIds, assetsById) {
  const validAssetIds = new Set(assetsById.keys());
  if (Array.isArray(roles) && roles.length) {
    return sanitizeEquipmentRoleAssignments(roles.map((role, index) => {
      const quantity = Math.max(1, Number(role.quantity) || 1);
      const incomingAssignedIds = (role.assignedAssetIds || []).filter((assetId) => validAssetIds.has(assetId));
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
        requirements: String(role.requirements || "").trim(),
        rationale: String(role.rationale || "").trim(),
        assignedAssetIds
      };
    }), assetsById);
  }
  return sanitizeEquipmentRoleAssignments(legacyEquipmentIds.map((assetId, index) => {
    const assetItem = assetsById.get(assetId);
    const assetType = assetTypesFor(assetItem)[0] || "";
    return equipmentRole(`R-${String(index + 1).padStart(3, "0")}`, assetType || assetItem?.name || "Equipment", assetType, 1, [assetId]);
  }), assetsById);
}

function sanitizeEquipmentRoleAssignments(roles, assetsById = byId(state.assets)) {
  const usage = new Map();
  return (roles || []).map((role) => {
    const quantity = Math.max(1, Number(role.quantity) || 1);
    const assignedAssetIds = [];
    (role.assignedAssetIds || []).slice(0, quantity).forEach((assetId) => {
      const assetItem = assetsById.get(assetId);
      if (!assetItem || !assetMatchesType(assetItem, role.assetType)) return;
      const assignedRoleTypes = usage.get(assetId) || new Set();
      if (assignedRoleTypes.size && !canShareAssetForRole(assetItem, role, assignedRoleTypes)) return;
      assignedAssetIds.push(assetId);
      if (!usage.has(assetId)) usage.set(assetId, assignedRoleTypes);
      assignedRoleTypes.add(String(role.assetType || role.label || "").trim());
    });
    return { ...role, quantity, assignedAssetIds };
  });
}

function saveState() {
  state.metadata.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isStorageQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED" || error?.code === 22 || error?.code === 1014;
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

function monthStartISO(value) {
  const date = parseDate(value);
  return dateISO(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndISO(value) {
  const date = parseDate(value);
  return dateISO(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function daysInclusive(startDate, endDate) {
  return Math.max(1, Math.round((parseDate(endDate) - parseDate(startDate)) / MS_PER_DAY) + 1);
}

function durationLabel(startDate, endDate) {
  const days = daysInclusive(startDate, endDate);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function compactDate(value) {
  const date = parseDate(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function compactDateWithoutYear(value) {
  const date = parseDate(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compactDateRange(startDate, endDate) {
  if (!startDate || !endDate) return "";
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (startDate === endDate) return compactDate(startDate);
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      const month = start.toLocaleDateString(undefined, { month: "short" });
      return `${month} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${compactDateWithoutYear(startDate)} - ${compactDate(endDate)}`;
  }
  return `${compactDate(startDate)} - ${compactDate(endDate)}`;
}

function eventDateRangeMarkup(startDate, endDate) {
  const label = compactDateRange(startDate, endDate);
  const title = `${startDate} to ${endDate}`;
  return `<span class="event-date-range" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function overlaps(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function overlapRange(a, b) {
  return { startDate: a.startDate > b.startDate ? a.startDate : b.startDate, endDate: a.endDate < b.endDate ? a.endDate : b.endDate };
}

function fullAssetIds(testEvent) {
  return uniqueIds([testEvent.stationAssetId, testEvent.stationGroupId, ...operatorIdsForEvent(testEvent), ...(testEvent.requiredAssetIds || [])]);
}

function roleAssetIds(testEvent) {
  return (testEvent.equipmentRoles || []).flatMap((role) => role.assignedAssetIds || []).filter(Boolean);
}

function assetDemandCount(testEvent, assetId) {
  return fullAssetIds(testEvent).includes(assetId) ? 1 : 0;
}

function eventReservesAsset(testEvent, assetId, assetsById = byId(state.assets)) {
  if (fullAssetIds(testEvent).includes(assetId)) return true;
  const assetItem = assetsById.get(assetId);
  return Boolean(assetItem && testEvent.stationGroupId && assetItem.stationGroupId === testEvent.stationGroupId);
}

function assetReservationCount(testEvent, assetId, assetsById = byId(state.assets)) {
  return eventReservesAsset(testEvent, assetId, assetsById) ? 1 : 0;
}

function eventReservedAssetIds(testEvent, assetsById = byId(state.assets)) {
  const ids = fullAssetIds(testEvent);
  if (testEvent.stationGroupId) {
    assetsById.forEach((assetItem) => {
      if (assetItem.stationGroupId === testEvent.stationGroupId) ids.push(assetItem.id);
    });
  }
  return uniqueIds(ids);
}

function roleFillCount(role) {
  return (role.assignedAssetIds || []).filter(Boolean).length;
}

function roleSummary(testEvent) {
  if (!eventUsesEquipment(testEvent.eventCategory || "Test")) return "Not required";
  const roles = testEvent.equipmentRoles || [];
  if (!roles.length) return "No equipment roles";
  const assigned = roles.reduce((sum, role) => sum + roleFillCount(role), 0);
  const needed = roles.reduce((sum, role) => sum + (Number(role.quantity) || 1), 0);
  return `${roles.length} role${roles.length === 1 ? "" : "s"} / ${assigned} of ${needed} assigned`;
}

function hasUnassignedRoles(testEvent) {
  if (!eventUsesEquipment(testEvent.eventCategory || "Test")) return false;
  return (testEvent.equipmentRoles || []).some((role) => roleFillCount(role) < (Number(role.quantity) || 1));
}

function isDoubleBookingConflict(conflict) {
  return DOUBLE_BOOKING_CONFLICT_TYPES.has(conflict.conflictType) && (conflict.eventIds || []).length > 1;
}

function isPlanningIssue(conflict) {
  return !isDoubleBookingConflict(conflict);
}

function equipmentTypeOptions(extraTypes = []) {
  return unique([
    ...(state.settings.equipmentTypes || []),
    ...state.assets.flatMap((assetItem) => assetTypesFor(assetItem)),
    ...state.testEvents.flatMap((testEvent) => (testEvent.equipmentRoles || []).map((role) => role.assetType)),
    ...extraTypes
  ]);
}

function dutTypeOptions(extraTypes = []) {
  return unique([
    ...Object.keys(state.settings.dutTypeDependencies || {}),
    ...state.assets.filter((assetItem) => assetKind(assetItem) === "dut").map((assetItem) => assetItem.dutType),
    ...extraTypes
  ]);
}

function dutAssetForUut(uutName, assets = state.assets) {
  const normalized = comparableText(uutName);
  if (!normalized) return null;
  return assets.find((assetItem) => assetKind(assetItem) === "dut" && comparableText(assetItem.name) === normalized) || null;
}

function dutTypeForUut(uutName) {
  return dutAssetForUut(uutName)?.dutType || "";
}

function dutDependenciesForType(dutType) {
  return (state.settings.dutTypeDependencies || {})[dutType] || [];
}

function dependencyRoleKey(role) {
  return `${comparableText(role.assetType)}|${comparableText(role.requirements)}`;
}

function applyDutDependenciesToRoles(roles, dutType) {
  const dependencies = dutDependenciesForType(dutType);
  if (!dependencies.length) return roles;
  const existingKeys = new Set(roles.map(dependencyRoleKey));
  const nextRoles = [...roles];
  dependencies.forEach((dependency) => {
    if (!dependency.assetType) return;
    const key = dependencyRoleKey(dependency);
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    nextRoles.push(equipmentRole(nextRoleIdForRoles(nextRoles), dependency.assetType, dependency.assetType, dependency.quantity || 1, [], dependency.requirements || ""));
  });
  return nextRoles;
}

function nextRoleIdForRoles(roles) {
  const highest = roles.reduce((max, role) => Math.max(max, Number(String(role.id || "").replace("R-", "")) || 0), 0);
  return `R-${String(highest + 1).padStart(3, "0")}`;
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

function assetKind(assetItem = {}) {
  if (assetItem.isOperator) return "operator";
  if (assetItem.isDut || assetTypesFor(assetItem).includes(DUT_TYPE)) return "dut";
  if (assetItem.isRack || assetTypesFor(assetItem).includes(RACK_TYPE)) return "rack";
  return "asset";
}

function assetCategory(assetItem = {}) {
  const kind = assetKind(assetItem);
  if (kind === "rack") return "rack";
  if (kind === "asset") return "testEquipment";
  return kind;
}

function assetMatchesCategory(assetItem, category) {
  return !category || assetCategory(assetItem) === category;
}

function assetMatchesSearch(assetItem, searchText, assetsById = byId(state.assets)) {
  const query = comparableText(searchText);
  if (!query) return true;
  const haystack = [
    assetItem.id,
    assetItem.manufacturer,
    assetItem.name,
    assetDisplayName(assetItem),
    assetTypeText(assetItem),
    assetItem.dutType,
    assetItem.serialNumber,
    assetItem.owner,
    assetItem.status,
    stationGroupLabel(assetItem.stationGroupId, assetsById),
    assetItem.capabilities,
    assetItem.notes
  ].map(comparableText).join(" ");
  return haystack.includes(query);
}

function assetCategoryLabel(category) {
  return {
    testEquipment: "Test Equipment",
    dut: "DUT",
    rack: "Racks",
    operator: "Test Operators"
  }[category] || "All assets";
}

function stationGroupOptions(currentAssetId = "") {
  return state.assets
    .filter((assetItem) => assetItem.isRack && assetItem.id !== currentAssetId)
    .map((assetItem) => ({ value: assetItem.id, label: assetOptionLabel(assetItem) }));
}

function stationGroupAssets(stationGroupId) {
  if (!stationGroupId) return [];
  return state.assets.filter((assetItem) => assetItem.stationGroupId === stationGroupId && !assetItem.isRack && !assetItem.isOperator && !assetItem.isDut);
}

function stationGroupLabel(stationGroupId, assetsById = byId(state.assets)) {
  const station = assetsById.get(stationGroupId);
  return station ? assetDisplayName(station) || station.name || station.id : "";
}

function rackIdForName(rackName, currentAssetId = "") {
  const normalized = comparableText(rackName);
  if (!normalized) return "";
  const match = stationGroupOptions(currentAssetId).find((option) => comparableText(option.label) === normalized || comparableText(option.value) === normalized);
  return match?.value || "";
}

function createRack(rackName, { owner = "", reservedAssetId = "" } = {}) {
  const rackId = nextId("A", reservedAssetId ? [...state.assets, { id: reservedAssetId }] : state.assets);
  const rack = {
    ...emptyAsset(),
    id: rackId,
    manufacturer: "",
    name: rackName,
    assetTypes: [RACK_TYPE],
    assetType: RACK_TYPE,
    stationGroupId: "",
    quantity: 1,
    serialNumber: "",
    owner,
    status: "Available",
    calibrationRequired: false,
    calibrationDueDate: "",
    imagePath: "",
    imageData: "",
    capabilities: "",
    notes: "Created while assigning an asset to a rack.",
    isStation: false,
    isRack: true,
    isOperator: false,
    isDut: false
  };
  state.assets.push(rack);
  rememberEquipmentType(RACK_TYPE);
  return rack;
}

function comparableText(text) {
  return String(text || "").trim().toLowerCase();
}

function assetDuplicateMatches(candidate, currentAssetId = "") {
  const candidateManufacturer = comparableText(candidate.manufacturer);
  const candidateName = comparableText(candidate.name);
  const candidateSerial = comparableText(candidate.serialNumber);
  const candidateTypes = assetTypesFor(candidate).map(comparableText);
  return state.assets.filter((assetItem) => {
    if (assetItem.id === currentAssetId) return false;
    const assetSerial = comparableText(assetItem.serialNumber);
    const manufacturerMatch = !candidateManufacturer || comparableText(assetItem.manufacturer) === candidateManufacturer;
    const nameMatch = candidateName && comparableText(assetItem.name) === candidateName;
    const typeMatch = candidateTypes.length && assetTypesFor(assetItem).map(comparableText).some((assetType) => candidateTypes.includes(assetType));
    const sameInventoryFamily = manufacturerMatch && (nameMatch || typeMatch);
    const serialMatch = candidateSerial && assetSerial === candidateSerial && sameInventoryFamily;
    const untrackedSerializedCopy = !candidateSerial && !assetSerial && manufacturerMatch && nameMatch && typeMatch;
    return serialMatch || untrackedSerializedCopy;
  });
}

function assetDuplicateWarningText(matches) {
  if (!matches.length) return "";
  const names = matches.slice(0, 3).map((item) => `${item.id} ${assetDisplayName(item) || item.name}`).join(", ");
  const extra = matches.length > 3 ? `, and ${matches.length - 3} more` : "";
  return `Possible duplicate: ${names}${extra}. Matching serial numbers or untracked same-model assets may represent the same physical unit.`;
}

function assetIdentity(assetItem) {
  return assetItem.serialNumber ? `SN ${assetItem.serialNumber}` : "No serial number";
}

function assetUsesSerialNumber(assetItem) {
  return !assetItem.isOperator && !assetItem.isRack;
}

function nextUndefinedSerial(assets = state.assets) {
  const used = new Set(assets.map((assetItem) => comparableText(assetItem.serialNumber)));
  let index = 1;
  while (used.has(comparableText(`Undefined ${index}`))) index += 1;
  return `Undefined ${index}`;
}

function assetDisplayName(assetItem) {
  const name = String(assetItem?.name || "").trim();
  const manufacturer = String(assetItem?.manufacturer || "").trim();
  if (!manufacturer) return name;
  return name.toLowerCase().startsWith(manufacturer.toLowerCase()) ? name : `${manufacturer} ${name}`.trim();
}

function assetOptionLabel(assetItem) {
  const displayName = assetDisplayName(assetItem) || assetItem.id;
  return `${displayName}${assetItem.serialNumber ? ` / SN ${assetItem.serialNumber}` : ""}`;
}

function truncateText(text, maxLength = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}...` : value;
}

function assetImageMarkup(assetItem, altText = "") {
  if (assetItem?.imagePath) return `<img src="${escapeHtml(assetItem.imagePath)}" alt="${escapeHtml(altText || assetItem.name || "Asset picture")}">`;
  if (assetItem?.imageData) return `<img src="${escapeHtml(assetItem.imageData)}" alt="${escapeHtml(altText || assetItem.name || "Asset picture")}">`;
  return `<span>No image</span>`;
}

function assetImageSource(assetItem) {
  return assetItem?.imagePath || assetItem?.imageData || "";
}

function assetAllocation(assetId, startDate, endDate, currentEventId = "") {
  const assetItem = state.assets.find((item) => item.id === assetId);
  if (!assetItem || !startDate || !endDate) return { level: "open", label: "Check dates", detail: "Set event dates to check allocation." };
  const assetsById = byId(state.assets);
  const range = { startDate, endDate };
  const overlappingEvents = state.testEvents.filter((testEvent) => {
    if (testEvent.id === currentEventId) return false;
    return eventReservesAsset(testEvent, assetId, assetsById) && overlaps(testEvent, range);
  });
  const capacity = Number(assetItem.quantity || 1);
  const overlappingDemand = overlappingEvents.reduce((sum, testEvent) => sum + assetReservationCount(testEvent, assetId, assetsById), 0);

  if (BAD_STATUSES.has(assetItem.status)) {
    return { level: "blocked", label: assetItem.status, detail: `Asset status is ${assetItem.status}.` };
  }
  if (assetItem.calibrationRequired && assetItem.calibrationDueDate && assetItem.calibrationDueDate < endDate) {
    return { level: "warning", label: "Calibration due", detail: `Calibration due ${assetItem.calibrationDueDate}.` };
  }
  if (overlappingDemand >= capacity) {
    return {
      level: "allocated",
      label: "Already allocated",
      detail: overlappingEvents.map((testEvent) => `${testEvent.name} (${testEvent.startDate} to ${testEvent.endDate})`).join("; ")
    };
  }
  if (overlappingDemand) {
    return {
      level: "shared",
      label: `${capacity - overlappingDemand} slot open`,
      detail: `${overlappingDemand} overlapping use${overlappingDemand === 1 ? "" : "s"} of ${capacity}.`
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

function formValues(form, name) {
  return form.getAll(name).map((item) => String(item)).filter(Boolean);
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function operatorIdsForEvent(testEvent) {
  return uniqueIds([...(Array.isArray(testEvent.operatorAssetIds) ? testEvent.operatorAssetIds : []), testEvent.operatorAssetId]);
}

function operatorNamesForEvent(testEvent, assetsById = byId(state.assets), emptyLabel = "") {
  const names = operatorIdsForEvent(testEvent).map((assetId) => {
    const assetItem = assetsById.get(assetId);
    return assetItem ? assetDisplayName(assetItem) : assetId;
  });
  return names.length ? names.join(", ") : emptyLabel;
}

function selectedOperatorIdsFromForm(form, validOperatorIds = new Set(state.assets.filter((item) => item.isOperator).map((item) => item.id))) {
  return uniqueIds(formValues(form, "operatorAssetIds[]")).filter((assetId) => validOperatorIds.has(assetId));
}

function setActiveView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === activeView));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${activeView}`));
  const scheduleFilters = document.getElementById("scheduleFilters");
  if (scheduleFilters) scheduleFilters.hidden = !["schedule", "events"].includes(activeView);
  const scheduleViewModeField = document.getElementById("scheduleViewModeField");
  if (scheduleViewModeField) scheduleViewModeField.hidden = activeView !== "schedule";
}

function openAssetModal() {
  document.getElementById("assetModalTitle").textContent = selectedAssetId ? "Edit Asset" : "Add Asset";
  renderAssetForm();
  document.getElementById("assetModal").hidden = false;
  document.getElementById("asset-name")?.focus();
}

function closeAssetModal(saveDraft = true) {
  if (saveDraft) saveAssetDraftFromForm();
  document.getElementById("assetModal").hidden = true;
}

function assetDraftKey(id = selectedAssetId) {
  return id || NEW_ASSET_DRAFT_KEY;
}

function syncAssetCalibrationRequiredFromDate() {
  const dueDateEl = document.getElementById("asset-calibrationDueDate");
  const requiredEl = document.getElementById("asset-calibrationRequired");
  if (dueDateEl?.value && requiredEl) requiredEl.checked = true;
}

function saveAssetDraftFromForm() {
  const formEl = document.getElementById("assetForm");
  const modalEl = document.getElementById("assetModal");
  if (!formEl || modalEl.hidden || !formEl.innerHTML.trim()) return;
  const form = new FormData(formEl);
  const kind = formValue(form, "assetKind") || "asset";
  const isOperator = kind === "operator";
  const isRack = kind === "rack";
  const isDut = kind === "dut";
  const isStation = !isOperator && !isRack && !isDut && form.has("isStation");
  const assetTypes = isOperator ? [TEST_OPERATOR_TYPE] : isDut ? [DUT_TYPE] : isRack ? [RACK_TYPE] : readAssetTypesFromForm(formEl, true);
  const calibrationDueDate = isOperator || isDut || isRack ? "" : formValue(form, "calibrationDueDate");
  assetDrafts.set(assetDraftKey(selectedAssetId), {
    id: formValue(form, "id"),
    manufacturer: isOperator || isDut || isRack ? "" : formText(form, "manufacturer"),
    name: formText(form, "name"),
    assetTypes,
    assetType: assetTypes[0] || "",
    stationGroupId: !isOperator && !isRack && !isDut ? rackIdForName(formText(form, "stationGroupName"), formValue(form, "id")) : "",
    rackName: !isOperator && !isRack && !isDut ? formText(form, "stationGroupName") : "",
    quantity: 1,
    serialNumber: isOperator || isRack ? "" : formText(form, "serialNumber"),
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Available",
    calibrationRequired: !isOperator && !isDut && !isRack && (form.has("calibrationRequired") || Boolean(calibrationDueDate)),
    calibrationDueDate,
    allowMultiRoleUse: !isOperator && !isDut && !isRack && form.has("allowMultiRoleUse"),
    imagePath: isOperator || isDut || isRack ? "" : formText(form, "imagePath"),
    imageData: isOperator || isDut || isRack ? "" : formValue(form, "imageData"),
    capabilities: isOperator || isDut || isRack ? "" : formText(form, "capabilities"),
    notes: formText(form, "notes"),
    dutType: isDut ? formText(form, "dutType") : "",
    dutDependencies: isDut ? readDutDependenciesFromForm(formEl) : [],
    stationGroupMemberIds: isRack ? formValues(form, "stationGroupMemberIds[]") : [],
    isStation,
    isRack,
    isOperator,
    isDut
  });
}

function openEventModal() {
  document.getElementById("eventModalTitle").textContent = selectedEventId ? "Edit Event" : "Add Event";
  renderEventForm();
  document.getElementById("eventModal").hidden = false;
  document.getElementById("event-name")?.focus();
}

function closeEventModal(saveDraft = true) {
  if (saveDraft) saveEventDraftFromForm();
  closeStationGroupImportConfirmation();
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
  const operatorAssetIds = selectedOperatorIdsFromForm(form);
  const uut = eventUsesUut(eventCategory) ? formText(form, "uut") : "";
  const usesEquipment = eventUsesEquipment(eventCategory);
  const equipmentRoles = usesEquipment ? applyDutDependenciesToRoles(readEquipmentRolesFromForm(), dutTypeForUut(uut)) : [];
  eventDrafts.set(eventDraftKey(selectedEventId), {
    id,
    name: formText(form, "name"),
    eventCategory,
    program: formText(form, "program"),
    uut,
    testType: eventCategory === "Test" ? formText(form, "testType") : "",
    startDate: formValue(form, "startDate"),
    endDate: formValue(form, "endDate"),
    stationAssetId: formValue(form, "stationAssetId"),
    stationGroupId: usesEquipment ? formValue(form, "stationGroupId") : "",
    operatorAssetId: operatorAssetIds[0] || "",
    operatorAssetIds,
    requiredAssetIds: [],
    equipmentRoles,
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

      const firstReservedAssets = eventReservedAssetIds(first, assetsById);
      const secondReservedAssets = eventReservedAssetIds(second, assetsById);
      const sameReservedRack = first.stationGroupId && first.stationGroupId === second.stationGroupId ? first.stationGroupId : "";
      const sharedAssets = firstReservedAssets.filter((assetId) => {
        if (!secondReservedAssets.includes(assetId)) return false;
        const assetItem = assetsById.get(assetId);
        return !sameReservedRack || assetId === sameReservedRack || assetItem?.stationGroupId !== sameReservedRack;
      });
      sharedAssets.forEach((assetId) => {
        const conflictedAsset = assetsById.get(assetId);
        if (!conflictedAsset) return;
        const capacity = Number(conflictedAsset.quantity || 1);
        const combinedDemand = assetReservationCount(first, assetId, assetsById) + assetReservationCount(second, assetId, assetsById);
        if (combinedDemand <= capacity) return;
        const conflictType = conflictedAsset.isRack ? "Rack" : conflictedAsset.isStation ? "Station" : conflictedAsset.isOperator ? "Operator" : "Equipment";
        addConflict({
          conflictType,
          assetId,
          uut: "",
          ...window,
          eventIds: [first.id, second.id],
          programs: [...new Set([first.program, second.program].filter(Boolean))],
          severity: severityFor([first, second], window),
          explanation: `${first.name} and ${second.name} require ${combinedDemand} total use${combinedDemand === 1 ? "" : "s"} of ${conflictedAsset.name} from ${window.startDate} to ${window.endDate}. ${conflictedAsset.name} supports ${capacity} concurrent use${capacity === 1 ? "" : "s"}.`,
          suggestedResolution: conflictedAsset.isRack ? "Assign a different rack, remove the rack reservation, or reschedule one event." : conflictedAsset.isStation ? "Reschedule one event or move an event to another station." : conflictedAsset.isOperator ? "Assign a different qualified operator or reschedule one event." : "Reschedule, substitute another asset, or add another inventory item."
        });
      });
    }
  }

  state.assets.forEach((assetItem) => {
    const capacity = Number(assetItem.quantity || 1);
    if (capacity <= 1) return;
    const usingEvents = events.filter((testEvent) => eventReservesAsset(testEvent, assetItem.id, assetsById));
    const peak = peakDemand(usingEvents, (testEvent) => assetReservationCount(testEvent, assetItem.id, assetsById));
    if (peak.count <= capacity) return;
    const activeEvents = usingEvents.filter((testEvent) => testEvent.startDate <= peak.dates && testEvent.endDate >= peak.dates);
    addConflict({
      conflictType: assetItem.isRack ? "Rack" : assetItem.isStation ? "Station" : assetItem.isOperator ? "Operator" : "Equipment",
      assetId: assetItem.id,
      uut: "",
      startDate: peak.dates,
      endDate: peak.dates,
      eventIds: activeEvents.map((testEvent) => testEvent.id),
      programs: [...new Set(activeEvents.map((testEvent) => testEvent.program).filter(Boolean))],
      severity: severityFor(activeEvents, { startDate: peak.dates, endDate: peak.dates }),
      explanation: `${assetItem.name} has peak demand of ${peak.count} concurrent events on ${peak.dates}, exceeding available capacity of ${capacity}.`,
      suggestedResolution: assetItem.isStation ? "Move one or more events to another station or reschedule." : assetItem.isOperator ? "Assign another operator or reschedule lower-priority events." : "Add compatible inventory, substitute compatible assets, or reschedule lower-priority events."
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
          suggestedResolution: "Assign matching inventory, add another inventory item, or revise the role quantity."
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
  const assetsById = byId(state.assets);
  events.forEach((testEvent) => {
    eventReservedAssetIds(testEvent, assetsById).forEach((assetId) => {
      if (!assetEvents.has(assetId)) assetEvents.set(assetId, []);
      assetEvents.get(assetId).push(testEvent);
    });
  });

  return state.assets.map((item) => {
    const usedBy = assetEvents.get(item.id) || [];
    const relatedConflicts = conflicts.filter((conflict) => conflict.assetId === item.id);
    const programs = new Set(usedBy.map((testEvent) => testEvent.program).filter(Boolean));
    const totalDays = usedBy.reduce((sum, testEvent) => sum + daysInclusive(testEvent.startDate, testEvent.endDate), 0);
    const peak = peakDemand(usedBy, (testEvent) => assetReservationCount(testEvent, item.id, assetsById));
    const capacity = Number(item.quantity || 1);
    const shortage = Math.max(0, peak.count - capacity);
    const action = shortage > 0 ? "Buy/rent/borrow or reschedule" : relatedConflicts.length ? "Review conflict timing" : usedBy.length >= capacity * 3 ? "Monitor demand" : "No action";
    return {
      asset: assetDisplayName(item),
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

function peakDemand(events, demandForEvent = () => 1) {
  if (!events.length) return { count: 0, dates: "", events: [] };
  const starts = events.map((item) => item.startDate).sort();
  const ends = events.map((item) => item.endDate).sort();
  let min = starts[0];
  let max = ends[ends.length - 1];
  let best = { count: 0, date: min, events: [] };
  for (let cursor = parseDate(min); cursor <= parseDate(max); cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
    const iso = dateISO(cursor);
    const active = events.filter((item) => item.startDate <= iso && item.endDate >= iso);
    const count = active.reduce((sum, item) => sum + Math.max(0, Number(demandForEvent(item)) || 0), 0);
    if (count > best.count) best = { count, date: iso, events: active.map((item) => item.id) };
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
  renderCalibrationTable();
  renderEventTable();
  renderGantt();
  renderEventInspector();
  renderConflictTable();
  renderIssueTable();
  renderBottlenecks();
  renderReport();
  setActiveView(activeView);
}

function renderFilters() {
  fillSelect("programFilter", unique([...state.programs, ...state.testEvents.map((item) => item.program)]), "All programs", value("programFilter"));
  fillSelect("uutFilter", uutFilterOptions(), value("programFilter") ? "All UUTs for program" : "All UUTs", value("uutFilter"));
  fillSelect("stationFilter", state.assets.filter((item) => item.isStation).map((item) => ({ value: item.id, label: assetDisplayName(item) || item.name })), "All stations", value("stationFilter"));
  fillSelect("ownerFilter", unique([...state.testEvents.map((item) => item.owner), ...state.assets.map((item) => item.owner)]), "All owners", value("ownerFilter"));
  fillSelect("assetTypeFilter", assetTypeFilterOptions(), "All types", value("assetTypeFilter"));
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

function assetTypeFilterOptions(category = value("assetCategoryFilter")) {
  return unique(state.assets
    .filter((assetItem) => assetMatchesCategory(assetItem, category))
    .flatMap((assetItem) => assetTypesFor(assetItem)));
}

function renderAssetFilterState() {
  const clearButton = document.getElementById("clearAssetTypeFilterBtn");
  const activeType = value("assetTypeFilter");
  if (clearButton) {
    clearButton.hidden = !activeType;
    clearButton.textContent = activeType ? `Clear Type: ${activeType}` : "Clear Type Filter";
    clearButton.title = activeType ? `Clear type filter: ${activeType}` : "";
  }
}

function renderDashboard() {
  const conflicts = state.conflicts.filter(isDoubleBookingConflict);
  const planningIssues = state.conflicts.filter(isPlanningIssue);
  const calibrationRows = calibrationDueRows();
  const bottlenecks = computeBottlenecks(state.testEvents, conflicts);
  const topBottleneck = bottlenecks.find((item) => item.conflicts > 0 || item.shortage > 0);
  const critical = conflicts.filter((item) => item.severity === "Critical").length;
  const highPlanningIssues = planningIssues.filter((item) => ["Critical", "High"].includes(item.severity)).length;
  const overdueCalibration = calibrationRows.filter((item) => item.daysUntil < 0).length;
  const stationConflicts = conflicts.filter((item) => item.conflictType === "Station").length;
  const operatorConflicts = conflicts.filter((item) => item.conflictType === "Operator").length;
  document.getElementById("dashboard").innerHTML = [
    metric("Assets", state.assets.length, `${state.assets.filter((item) => item.isStation).length} stations / ${state.assets.filter((item) => item.isOperator).length} operators`),
    metric("Events", state.testEvents.length, `${unique(state.testEvents.map((item) => item.program)).length} programs`),
    metric("Cal Due Dates", calibrationRows.length, `${overdueCalibration} overdue`),
    metric("Open Conflicts", conflicts.length, `${critical} critical`),
    metric("Planning Issues", planningIssues.length, `${highPlanningIssues} high priority`),
    metric("Resource Issues", stationConflicts + operatorConflicts, `${stationConflicts} station / ${operatorConflicts} operator`),
    metric("Top Bottleneck", topBottleneck?.asset || "None", topBottleneck ? `${topBottleneck.conflicts} conflicts / ${topBottleneck.shortage} shortage` : "no active bottlenecks")
  ].join("");
}

function metric(label, valueText, detail) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText))}</strong><em>${escapeHtml(detail)}</em></article>`;
}

function renderAssetForm() {
  const item = assetDrafts.get(assetDraftKey()) || state.assets.find((assetItem) => assetItem.id === selectedAssetId) || emptyAsset();
  const kind = assetKind(item);
  const isOperator = kind === "operator";
  const isRack = kind === "rack";
  const isDut = kind === "dut";
  document.getElementById("assetForm").innerHTML = `
    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
    <div class="form-row">
      ${input("Asset ID", "idVisible", item.id, "text", true)}
      ${assetKindInput(kind)}
    </div>
    ${isOperator || isDut || isRack ? `
      <input type="hidden" name="assetTypes[]" value="${isOperator ? TEST_OPERATOR_TYPE : isDut ? DUT_TYPE : RACK_TYPE}">
      <div class="form-row">
        ${assetTextInput(isOperator ? "Person Name" : isDut ? "DUT Name" : "Rack Name", "name", item.name)}
        ${isDut ? dutTypeInput(item) : assetTextInput(isOperator ? "Team / Org" : "Owner", "owner", item.owner)}
      </div>
      ${isDut ? `<div class="form-row">
        ${assetTextInput("Serial Number", "serialNumber", item.serialNumber)}
        ${assetTextInput("Owner", "owner", item.owner)}
      </div>` : ""}
      <div class="form-row">
        ${select("Status", "status", ["Available", "Down", "Retired", "Limited Use", "Unknown"], item.status)}
      </div>
      ${isDut ? dutDependencyEditor(item.dutType || "", item.dutDependencies) : ""}
      ${isRack ? stationGroupMemberEditor(item) : ""}
    ` : `
      <input type="hidden" id="asset-imageData" name="imageData" value="${escapeHtml(item.imageData || "")}">
      ${assetImageInput(item)}
      <div class="form-row">
        ${input("Manufacturer", "manufacturer", item.manufacturer)}
        ${input("Asset Name", "name", item.name)}
      </div>
      <div class="form-row">
        ${assetTypeInput(item)}
        ${assetStationGroupInput(item)}
      </div>
      <div class="form-row">
        ${input("Serial Number", "serialNumber", item.serialNumber)}
        ${input("Owner", "owner", item.owner)}
      </div>
      <div class="form-row">
        ${select("Status", "status", ["Available", "Down", "Out for Calibration", "Retired", "Limited Use", "Unknown"], item.status)}
        <div class="field">
          <label>Flags</label>
          <div class="checkbox-row"><input id="asset-isStation" name="isStation" type="checkbox" ${item.isStation ? "checked" : ""}><span>Test Station?</span></div>
          <div class="checkbox-row"><input id="asset-calibrationRequired" name="calibrationRequired" type="checkbox" ${item.calibrationRequired ? "checked" : ""}><span>Calibration Required?</span></div>
          <div class="checkbox-row"><input id="asset-allowMultiRoleUse" name="allowMultiRoleUse" type="checkbox" ${item.allowMultiRoleUse ? "checked" : ""}><span>Can fill multiple role types in the same event?</span></div>
          <small>Uses the Asset Types list above. Example: one timing source can fill both 1PPS Source and 10 MHz Source roles.</small>
        </div>
      </div>
      <div class="form-row">
        ${input("Calibration Due Date", "calibrationDueDate", item.calibrationDueDate, "date")}
        
      </div>
      ${textarea("Capabilities", "capabilities", item.capabilities)}
    `}
    ${textarea("Notes", "notes", item.notes)}
    ${isOperator || isDut || isRack ? "" : `<div id="assetTypeRequiredWarning" class="form-warning" aria-live="polite" hidden>At least one asset type is required.</div>`}
    <div id="assetDuplicateWarning" class="form-warning" aria-live="polite" hidden></div>
    <div class="form-actions">
      <button type="submit">${selectedAssetId ? `Save ${isOperator ? "Operator" : isDut ? "DUT" : isRack ? "Rack" : "Asset"}` : `Create ${isOperator ? "Operator" : isDut ? "DUT" : isRack ? "Rack" : "Asset"}`}</button>
      <button type="button" class="secondary" id="cancelAssetBtn">Cancel</button>
    </div>
  `;
  renderAssetDuplicateWarning();
}

function renderEventForm() {
  const item = eventDrafts.get(eventDraftKey()) || state.testEvents.find((eventItem) => eventItem.id === selectedEventId) || emptyEvent();
  const eventCategory = EVENT_CATEGORIES.includes(item.eventCategory) ? item.eventCategory : "Test";
  const stations = state.assets.filter((assetItem) => assetItem.isStation).map((assetItem) => ({ value: assetItem.id, label: assetOptionLabel(assetItem) }));
  const operators = state.assets.filter((assetItem) => assetItem.isOperator).map((assetItem) => ({ value: assetItem.id, label: assetOptionLabel(assetItem) }));
  const selectedOperatorIds = operatorIdsForEvent(item);
  const stationGroups = stationGroupOptions().map((option) => ({ ...option, label: `${option.label} (${stationGroupAssets(option.value).length} equipment)` }));
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
      ${eventCategory === "Test" ? input("Owner", "owner", item.owner) : operatorPicker("Test Operators", operators, selectedOperatorIds)}
    </div>` : `
    <div class="form-row">
      ${select("Affected Station", "stationAssetId", stations, item.stationAssetId, "No station")}
      ${operatorPicker("Test Operators", operators, selectedOperatorIds)}
    </div>
    <div class="form-row">
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
    ${eventUsesEquipment(eventCategory) ? `
    <div class="form-row">
      ${select("Assigned Rack", "stationGroupId", stationGroups, item.stationGroupId, "No rack")}
    </div>
    <div class="field">
      <label>Equipment Roles</label>
      ${stationGroupImportControl(stationGroups)}
      <div id="eventEquipmentRoles" class="role-list"></div>
    </div>
    ${eventCategory === "Test" ? operatorPicker("Test Operators", operators, selectedOperatorIds) : ""}` : ""}
    ${textarea("Notes", "notes", item.notes)}
    <div class="form-actions">
      <button type="submit">${selectedEventId ? "Save Event" : "Create Event"}</button>
      <button type="button" class="secondary" id="cancelEventBtn">Cancel</button>
    </div>
  `;
  if (eventUsesEquipment(eventCategory)) renderEquipmentRolesFrom(applyDutDependenciesToRoles(item.equipmentRoles || [], dutTypeForUut(item.uut)));
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
  const roles = applyDutDependenciesToRoles(readEquipmentRolesFromForm(), dutTypeForUut(value("event-uut")));
  target.classList.toggle("is-empty", !roles.length);
  if (!roles.length) {
    target.innerHTML = emptyEquipmentRolesMarkup();
    return;
  }
  const typeOptions = equipmentTypeOptions(roles.map((role) => role.assetType));
  target.innerHTML = `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions, roles)).join("")}<div class="role-add-row">${equipmentRoleAddMarkup("Add Role")}</div>`;
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
        <label for="asset-imagePath">Picture Path</label>
        <input id="asset-imagePath" name="imagePath" type="text" value="${escapeHtml(item.imagePath || "")}" placeholder="asset-images/A-025.jpg">
        <small>Put image files in the asset-images folder and reference them by relative path.</small>
        <label for="asset-imageFile">Embedded Picture</label>
        <input id="asset-imageFile" name="imageFile" type="file" accept="image/*">
        <small>Legacy fallback; embedded pictures increase browser storage usage.</small>
        <button type="button" class="secondary" id="removeAssetImageBtn" ${assetImageSource(item) ? "" : "disabled"}>Remove Picture</button>
      </div>
    </div>
  `;
}

function equipmentRoleAddMarkup(labelText = "Add Role") {
  return `<button type="button" class="secondary" id="addEquipmentRoleBtn">${escapeHtml(labelText)}</button>`;
}

function renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions = equipmentTypeOptions(), allRoles = []) {
  const matchingAssets = state.assets.filter((assetItem) => assetMatchesType(assetItem, role.assetType));
  const quantity = Math.max(1, Number(role.quantity) || 1);
  const assigned = (role.assignedAssetIds || []).slice(0, quantity);
  const openSlots = Array.from({ length: quantity }, (_, slotIndex) => assigned[slotIndex] || "");
  const statusClass = assigned.filter(Boolean).length >= quantity ? "ok" : "medium";
  const fillText = quantity === 1 ? assigned.filter(Boolean).length ? "Assigned" : "Open" : `${assigned.filter(Boolean).length}/${quantity}`;
  return `
    <section class="equipment-role" data-role-index="${index}">
      <input type="hidden" name="equipmentRoleId[]" value="${escapeHtml(role.id)}">
      <input type="hidden" name="equipmentRoleLabel[]" value="${escapeHtml(role.assetType || role.label || "")}">
      <input type="hidden" name="equipmentRoleCommittedType[]" value="${escapeHtml(role.assetType || "")}">
      <input type="hidden" name="equipmentRoleRequirements[]" value="${escapeHtml(role.requirements || "")}">
      <input type="hidden" name="equipmentRoleQuantity[]" value="${escapeHtml(quantity)}">
      <div class="role-type-cell">
        ${roleInputWithDatalist("Type", "equipmentRoleType[]", role.assetType, typeOptions, index)}
        ${role.requirements ? `<small class="role-requirement">${escapeHtml(role.requirements)}</small>` : ""}
      </div>
      <div class="role-assignment-cell">
        ${openSlots.map((assetId, slotIndex) => renderRoleAssignment(role, index, slotIndex, assetId, matchingAssets, startDate, endDate, eventId, assignedEquipmentUsageOutsideSlot(allRoles, index, slotIndex))).join("")}
      </div>
      <div class="field role-rationale-cell">
        <label class="sr-only" for="role-${index}-rationale">Rationale</label>
        <textarea id="role-${index}-rationale" name="equipmentRoleRationale[]" placeholder="Why is this role/equipment needed?">${escapeHtml(role.rationale || "")}</textarea>
      </div>
      <div class="role-status-cell">${badge(fillText, statusClass)}</div>
      <button type="button" class="secondary icon-button role-remove-button" data-remove-equipment-role="${index}" aria-label="Remove equipment role">X</button>
    </section>
  `;
}

function equipmentRoleHeader() {
  return `
    <div class="role-list-header" aria-hidden="true">
      <span>Type</span>
      <span>Need</span>
      <span>Rationale</span>
      <span>Filled</span>
      <span></span>
    </div>
  `;
}

function assignedEquipmentUsageOutsideSlot(roles, roleIndex, slotIndex) {
  const usage = new Map();
  (roles || []).forEach((role, index) => {
    const quantity = Math.max(1, Number(role.quantity) || 1);
    (role.assignedAssetIds || []).slice(0, quantity).forEach((assetId, currentSlotIndex) => {
      if (!assetId || (index === roleIndex && currentSlotIndex === slotIndex)) return;
      if (!usage.has(assetId)) usage.set(assetId, new Set());
      usage.get(assetId).add(String(role.assetType || role.label || "").trim());
    });
  });
  return usage;
}

function canShareAssetForRole(assetItem, role, assignedRoleTypes = new Set()) {
  const roleType = String(role.assetType || "").trim();
  return Boolean(assetItem?.allowMultiRoleUse && roleType && assetTypesFor(assetItem).includes(roleType) && !assignedRoleTypes.has(roleType));
}

function roleAssignmentAssetLabel(assetItem, assetsById = byId(state.assets)) {
  const typeSuffix = assetTypeText(assetItem) ? ` [${assetTypeText(assetItem)}]` : "";
  const rackName = stationGroupLabel(assetItem.stationGroupId, assetsById) || "No rack";
  const capabilities = assetItem.capabilities ? ` | Cap: ${truncateText(assetItem.capabilities, 80)}` : "";
  return `${assetOptionLabel(assetItem)}${typeSuffix} [Rack: ${rackName}]${capabilities}`;
}

function roleAssetDetailMarkup(assetItem, allocation, assetsById = byId(state.assets)) {
  if (!assetItem) return "";
  const rackName = stationGroupLabel(assetItem.stationGroupId, assetsById) || "No rack";
  const allocationLevel = allocation?.level || "open";
  const allocationClass = allocationLevel === "open" ? "ok" : allocationLevel === "warning" ? "warning" : "danger";
  const calibration = assetItem.calibrationRequired ? assetItem.calibrationDueDate || "Required, no due date" : "Not required";
  return `
    <dl class="role-asset-detail">
      <div><dt>Rack</dt><dd>${escapeHtml(rackName)}</dd></div>
      <div><dt>Types</dt><dd>${escapeHtml(assetTypeText(assetItem) || "No type")}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(assetItem.status || "Unknown")}</dd></div>
      <div><dt>Availability</dt><dd><span class="detail-status ${allocationClass}">${escapeHtml(allocation?.label || "Available")}</span></dd></div>
      <div><dt>Calibration</dt><dd>${escapeHtml(calibration)}</dd></div>
      <div><dt>Capabilities</dt><dd>${escapeHtml(assetItem.capabilities || "No capabilities recorded")}</dd></div>
      ${assetItem.notes ? `<div><dt>Notes</dt><dd>${escapeHtml(assetItem.notes)}</dd></div>` : ""}
    </dl>
  `;
}

function renderRoleAssignment(role, roleIndex, slotIndex, assetId, matchingAssets, startDate, endDate, eventId, assignmentUsage = new Map()) {
  const selectedAsset = state.assets.find((assetItem) => assetItem.id === assetId);
  const options = matchingAssets.some((assetItem) => assetItem.id === assetId) || !selectedAsset ? matchingAssets : [selectedAsset, ...matchingAssets];
  const selectedAllocation = assetId ? assetAllocation(assetId, startDate, endDate, eventId) : null;
  const selectedAssignedRoleTypes = assetId ? assignmentUsage.get(assetId) || new Set() : new Set();
  const sharedInEvent = Boolean(assetId && selectedAssignedRoleTypes.size);
  const needsAssignment = !assetId;
  const helperText = matchingAssets.length
    ? sharedInEvent ? "Shared with another role in this event." : selectedAllocation && selectedAllocation.level !== "open" ? selectedAllocation.detail : ""
    : role.assetType
      ? `No inventory assets match ${role.assetType}. Add a matching asset or adjust this role type.`
      : "Set the role type to see matching inventory.";
  const selectClass = [
    selectedAllocation && selectedAllocation.level !== "open" ? "allocation-select-warning" : "",
    needsAssignment ? "assignment-select-needed" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="role-assignment">
      <div class="field">
        <label class="sr-only" for="role-${roleIndex}-slot-${slotIndex}">Assignment ${slotIndex + 1}</label>
        <select id="role-${roleIndex}-slot-${slotIndex}" class="${selectClass}" name="equipmentRoleAssignedAssetIds[]" data-current-value="${escapeHtml(assetId || "")}">
          <option value="" data-role-index="${roleIndex}">Unassigned ${escapeHtml(role.assetType || "equipment")}</option>
          ${options.map((assetItem) => {
            const allocation = assetAllocation(assetItem.id, startDate, endDate, eventId);
            const status = allocation.level === "open" ? "" : ` (${allocation.label})`;
            const assignedRoleTypes = assignmentUsage.get(assetItem.id) || new Set();
            const assignedInThisEvent = assignedRoleTypes.size > 0;
            const canShare = canShareAssetForRole(assetItem, role, assignedRoleTypes);
            const sharedSuffix = assignedInThisEvent ? canShare ? " (multi-role available)" : " (assigned in this event)" : "";
            const hideAssigned = assignedInThisEvent && assetItem.id !== assetId && !canShare ? "hidden" : "";
            const optionClass = allocation.level === "open" ? "" : "unavailable-option";
            return `<option value="${escapeHtml(assetItem.id)}" class="${optionClass}" data-role-index="${roleIndex}" ${hideAssigned} ${assetItem.id === assetId ? "selected" : ""}>${escapeHtml(roleAssignmentAssetLabel(assetItem))}${escapeHtml(sharedSuffix)}${escapeHtml(status)}</option>`;
          }).join("")}
        </select>
      </div>
      ${needsAssignment ? `<span class="assignment-needed-badge">Assignment needed</span>` : ""}
      ${sharedInEvent ? `<span class="shared-equipment-badge">Shared</span>` : ""}
      ${helperText ? `<small class="${selectedAllocation ? `assignment-${selectedAllocation.level}` : ""}">${escapeHtml(helperText)}</small>` : ""}
      ${roleAssetDetailMarkup(selectedAsset, selectedAllocation)}
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
  const requirements = [...formEl.querySelectorAll('input[name="equipmentRoleRequirements[]"]')];
  const rationales = [...formEl.querySelectorAll('[name="equipmentRoleRationale[]"]')];
  const quantities = [...formEl.querySelectorAll('input[name="equipmentRoleQuantity[]"]')];
  const assignmentsByRole = new Map();
  [...formEl.querySelectorAll('select[name="equipmentRoleAssignedAssetIds[]"]')].forEach((selectEl) => {
    const roleIndex = Number(selectEl.selectedOptions[0]?.dataset.roleIndex || selectEl.querySelector("option")?.dataset.roleIndex || 0);
    if (!assignmentsByRole.has(roleIndex)) assignmentsByRole.set(roleIndex, []);
    if (selectEl.value) assignmentsByRole.get(roleIndex).push(selectEl.value);
  });
  return sanitizeEquipmentRoleAssignments(roleIds.map((idInput, index) => {
    const selectedType = types[index]?.value.trim() || "";
    const committedType = committedTypes[index]?.value.trim() || "";
    const assetType = selectedType === "__new_equipment_type__" ? committedType : selectedType || committedType;
    const quantity = Math.max(1, Number(quantities[index]?.value) || 1);
    const assignedAssetIds = (assignmentsByRole.get(index) || []).filter((assetId) => {
      const assetItem = state.assets.find((item) => item.id === assetId);
      return assetItem && assetMatchesType(assetItem, assetType);
    });
    return {
      id: idInput.value || nextRoleId(index),
      label: assetType || labels[index]?.value.trim() || "Equipment role",
      assetType,
      quantity,
      requirements: requirements[index]?.value.trim() || "",
      rationale: rationales[index]?.value.trim() || "",
      assignedAssetIds
    };
  }));
}

function readDutDependenciesFromForm(formEl = document.getElementById("assetForm")) {
  if (!formEl) return [];
  const types = [...formEl.querySelectorAll('input[name="dutDependencyAssetType[]"]')];
  const requirements = [...formEl.querySelectorAll('input[name="dutDependencyRequirements[]"]')];
  const quantities = [...formEl.querySelectorAll('input[name="dutDependencyQuantity[]"]')];
  return normalizeDutDependencies(types.map((typeInput, index) => ({
    assetType: typeInput.value,
    requirements: requirements[index]?.value || "",
    quantity: quantities[index]?.value || 1
  })));
}

function renderDutDependenciesFrom(dependencies) {
  const formEl = document.getElementById("assetForm");
  const dutType = formEl ? formText(new FormData(formEl), "dutType") : "";
  const target = document.getElementById("dutDependencyRows");
  if (!target || !dutType) return;
  target.innerHTML = `
    ${dutDependencyHeader()}
    ${dependencies.length ? dependencies.map((dependency, index) => renderDutDependency(dependency, index)).join("") : `<div class="role-empty-row"><span>No dependencies defined for this DUT type.</span></div>`}
    <div class="role-add-row"><button type="button" class="secondary" id="addDutDependencyBtn">Add Dependency</button></div>
  `;
}

function addDutDependency() {
  const dependencies = readDutDependenciesFromForm();
  dependencies.push({ assetType: "", requirements: "", quantity: 1 });
  renderDutDependenciesFrom(dependencies);
  document.getElementById(`dut-dependency-${dependencies.length - 1}-type`)?.focus();
}

function removeDutDependency(index) {
  const dependencies = readDutDependenciesFromForm();
  dependencies.splice(index, 1);
  renderDutDependenciesFrom(dependencies);
  saveAssetDraftFromForm();
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

function highestEquipmentRoleNumber(roles = []) {
  return roles.reduce((max, role) => Math.max(max, Number(String(role.id || "").replace("R-", "")) || 0), 0);
}

function equipmentRolesForStationGroup(stationGroupId, { startAt = 0, excludeAssetIds = new Set() } = {}) {
  return stationGroupAssets(stationGroupId).filter((assetItem) => !excludeAssetIds.has(assetItem.id)).map((assetItem, index) => {
    const assetType = assetTypesFor(assetItem)[0] || assetItem.name || "Equipment";
    return equipmentRole(`R-${String(startAt + index + 1).padStart(3, "0")}`, assetType, assetType, 1, [assetItem.id], assetItem.capabilities || "");
  });
}

function openStationGroupImportConfirmation(stationGroupId) {
  const modalEl = document.getElementById("rackImportModal");
  const summaryEl = document.getElementById("rackImportSummary");
  if (!modalEl || !summaryEl) return;
  const rackLabel = stationGroupLabel(stationGroupId) || "this rack";
  const importCount = stationGroupAssets(stationGroupId).length;
  pendingRackImportId = stationGroupId;
  summaryEl.textContent = `Import ${importCount} equipment item${importCount === 1 ? "" : "s"} from ${rackLabel}?`;
  modalEl.hidden = false;
  modalEl.querySelector('[data-rack-import-mode="append"]')?.focus();
}

function closeStationGroupImportConfirmation() {
  pendingRackImportId = "";
  document.getElementById("rackImportModal").hidden = true;
}

function openDeleteConfirmation(kind, id) {
  const modalEl = document.getElementById("deleteConfirmModal");
  const summaryEl = document.getElementById("deleteConfirmSummary");
  const detailEl = document.getElementById("deleteConfirmDetail");
  if (!modalEl || !summaryEl || !detailEl) return;
  const item = kind === "asset" ? state.assets.find((assetItem) => assetItem.id === id) : state.testEvents.find((eventItem) => eventItem.id === id);
  if (!item) return;
  pendingDeleteRequest = { kind, id };
  if (kind === "asset") {
    summaryEl.textContent = `Delete asset "${assetDisplayName(item) || item.name || item.id}"?`;
    detailEl.textContent = "This will also remove it from rack membership and any event assignments.";
  } else {
    summaryEl.textContent = `Delete event "${item.name || item.id}"?`;
    detailEl.textContent = "This removes the event from the schedule, event table, reports, and conflict calculations.";
  }
  modalEl.hidden = false;
  modalEl.querySelector("[data-confirm-delete]")?.focus();
}

function closeDeleteConfirmation() {
  pendingDeleteRequest = null;
  document.getElementById("deleteConfirmModal").hidden = true;
}

function confirmPendingDelete() {
  const request = pendingDeleteRequest;
  closeDeleteConfirmation();
  if (!request) return;
  if (request.kind === "asset") deleteAssetById(request.id);
  if (request.kind === "event") deleteEventById(request.id);
}

function applyStationGroupToEventForm(stationGroupId, mode = "replace") {
  const formEl = document.getElementById("eventForm");
  if (!formEl || !eventUsesEquipment(formValue(new FormData(formEl), "eventCategory"))) return;
  const rackEl = document.getElementById("event-stationGroupId");
  if (rackEl && [...rackEl.options].some((option) => option.value === stationGroupId)) rackEl.value = stationGroupId;
  const currentRoles = readEquipmentRolesFromForm();
  const existingAssignments = new Set(currentRoles.flatMap((role) => role.assignedAssetIds || []).filter(Boolean));
  const importedRoles = mode === "append"
    ? equipmentRolesForStationGroup(stationGroupId, { startAt: highestEquipmentRoleNumber(currentRoles), excludeAssetIds: existingAssignments })
    : equipmentRolesForStationGroup(stationGroupId);
  renderEquipmentRolesFrom(mode === "append" ? [...currentRoles, ...importedRoles] : importedRoles);
  saveEventDraftFromForm();
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
    ? `${equipmentRoleHeader()}${roles.map((role, index) => renderEquipmentRole(role, index, startDate, endDate, eventId, typeOptions, roles)).join("")}<div class="role-add-row">${equipmentRoleAddMarkup("Add Role")}</div>`
    : emptyEquipmentRolesMarkup();
}

function input(labelText, name, inputValue, type = "text", disabled = false) {
  const prefix = labelText.startsWith("Asset") || ["Manufacturer", "Quantity", "Status", "Serial Number", "Calibration Due Date"].includes(labelText) ? "asset" : "event";
  return `<div class="field"><label for="${prefix}-${name}">${labelText}</label><input id="${prefix}-${name}" name="${name}" type="${type}" value="${escapeHtml(inputValue ?? "")}" ${disabled ? "disabled" : ""}></div>`;
}

function assetTextInput(labelText, name, inputValue, type = "text", disabled = false) {
  return `<div class="field"><label for="asset-${name}">${labelText}</label><input id="asset-${name}" name="${name}" type="${type}" value="${escapeHtml(inputValue ?? "")}" ${disabled ? "disabled" : ""}></div>`;
}

function inputWithDatalist(labelText, name, inputValue, options) {
  const listId = `event-${name}-options`;
  return `<div class="field"><label for="event-${name}">${labelText}</label><input id="event-${name}" name="${name}" list="${listId}" value="${escapeHtml(inputValue ?? "")}"><datalist id="${listId}">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist></div>`;
}

function assetKindInput(kind) {
  const options = [
    { value: "asset", label: "Test Equipment" },
    { value: "dut", label: "DUT" },
    { value: "rack", label: "Rack" },
    { value: "operator", label: "Test Operator" }
  ];
  return `
    <div class="field">
      <label for="asset-kind">Record Type</label>
      <select id="asset-kind" name="assetKind">
        ${options.map((option) => `<option value="${option.value}" ${option.value === kind ? "selected" : ""}>${option.label}</option>`).join("")}
      </select>
    </div>
  `;
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

function dutTypeInput(item) {
  const options = dutTypeOptions([item.dutType]);
  return `
    <div class="field">
      <label for="asset-dutType">DUT Type</label>
      <input id="asset-dutType" name="dutType" list="asset-dut-type-options" value="${escapeHtml(item.dutType || "")}" placeholder="Select or type a DUT type">
      <datalist id="asset-dut-type-options">${options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist>
    </div>
  `;
}

function dutDependencyEditor(dutType, dependenciesOverride = null) {
  const dependencies = dutType ? dependenciesOverride || dutDependenciesForType(dutType) : [];
  return `
    <div class="field dut-dependency-editor">
      <label>DUT Type Dependencies</label>
      ${dutType ? `
        <div id="dutDependencyRows" class="dut-dependency-list">
          ${dutDependencyHeader()}
          ${dependencies.length ? dependencies.map((dependency, index) => renderDutDependency(dependency, index)).join("") : `<div class="role-empty-row"><span>No dependencies defined for this DUT type.</span></div>`}
          <div class="role-add-row"><button type="button" class="secondary" id="addDutDependencyBtn">Add Dependency</button></div>
        </div>
      ` : `<div class="choice-list empty-choice-list">Set a DUT Type to define required equipment roles.</div>`}
    </div>
  `;
}

function dutDependencyHeader() {
  return `
    <div class="dut-dependency-header" aria-hidden="true">
      <span>Asset Type</span>
      <span>Need</span>
      <span>Qty</span>
      <span></span>
    </div>
  `;
}

function renderDutDependency(dependency, index) {
  const typeOptions = equipmentTypeOptions([dependency.assetType]);
  const needOptions = dutDependencyNeedOptions(dependency.assetType, dependency.requirements);
  return `
    <div class="dut-dependency-row">
      <div class="field compact-role-field">
        <label class="sr-only" for="dut-dependency-${index}-type">Asset Type</label>
        <input id="dut-dependency-${index}-type" name="dutDependencyAssetType[]" list="dut-dependency-${index}-type-options" value="${escapeHtml(dependency.assetType || "")}" placeholder="Select or type">
        <datalist id="dut-dependency-${index}-type-options">${typeOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist>
      </div>
      <div class="field compact-role-field">
        <label class="sr-only" for="dut-dependency-${index}-need">Need</label>
        <input id="dut-dependency-${index}-need" name="dutDependencyRequirements[]" list="dut-dependency-${index}-need-options" value="${escapeHtml(dependency.requirements || "")}" placeholder="${dependency.assetType ? "Select or type need" : "Choose asset type first"}">
        <datalist id="dut-dependency-${index}-need-options">${needOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}</datalist>
      </div>
      <div class="field compact-role-field">
        <label class="sr-only" for="dut-dependency-${index}-qty">Qty</label>
        <input id="dut-dependency-${index}-qty" name="dutDependencyQuantity[]" type="number" min="1" value="${escapeHtml(dependency.quantity || 1)}">
      </div>
      <button type="button" class="secondary icon-button" data-remove-dut-dependency="${index}" aria-label="Remove DUT dependency">X</button>
    </div>
  `;
}

function dutDependencyNeedOptions(assetType, currentNeed = "") {
  return unique([
    currentNeed,
    ...state.assets
      .filter((assetItem) => assetKind(assetItem) === "asset" && assetMatchesType(assetItem, assetType))
      .map((assetItem) => assetDisplayName(assetItem) || assetItem.name || assetItem.id)
  ]);
}

function assetStationGroupInput(item) {
  const options = stationGroupOptions(item.id);
  const selectedLabel = item.rackName || stationGroupLabel(item.stationGroupId) || "";
  return `
    <div class="field">
      <label for="asset-stationGroupName">Rack</label>
      <div class="rack-combobox" data-rack-combobox>
        <div class="rack-combobox-control">
          <input id="asset-stationGroupName" name="stationGroupName" value="${escapeHtml(selectedLabel)}" placeholder="No rack" autocomplete="off" aria-controls="asset-rack-options" aria-expanded="false">
          <button type="button" class="secondary icon-button" data-toggle-rack-options aria-label="Show racks" aria-expanded="false">v</button>
        </div>
        <div id="asset-rack-options" class="rack-option-list" role="listbox" hidden>
          ${options.length ? options.map((option) => `<button type="button" class="rack-option" data-rack-option="${escapeHtml(option.label)}">${escapeHtml(option.label)}</button>`).join("") : `<div class="rack-option-empty">No racks defined yet.</div>`}
        </div>
      </div>
      <small>Choose an existing rack or type a new rack name.</small>
    </div>
  `;
}

function setRackOptionsOpen(open) {
  const combo = document.querySelector("[data-rack-combobox]");
  const list = document.getElementById("asset-rack-options");
  const input = document.getElementById("asset-stationGroupName");
  const toggle = document.querySelector("[data-toggle-rack-options]");
  if (!combo || !list || !input || !toggle) return;
  list.hidden = !open;
  input.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-expanded", String(open));
}

function selectRackOption(rackName) {
  const input = document.getElementById("asset-stationGroupName");
  if (!input) return;
  input.value = rackName;
  setRackOptionsOpen(false);
  saveAssetDraftFromForm();
}

function stationGroupMemberEditor(item) {
  const eligibleMembers = state.assets
    .filter((assetItem) => assetItem.id !== item.id && !assetItem.isRack && !assetItem.isOperator && !assetItem.isDut)
    .sort((a, b) => assetDisplayName(a).localeCompare(assetDisplayName(b)));
  if (!eligibleMembers.length) {
    return `<div class="field station-group-editor"><label>Rack Members</label><div class="choice-list empty-choice-list">No eligible equipment assets yet.</div></div>`;
  }
  const selectedIds = new Set(Array.isArray(item.stationGroupMemberIds) ? item.stationGroupMemberIds : stationGroupAssets(item.id).map((assetItem) => assetItem.id));
  const currentMembers = eligibleMembers.filter((assetItem) => selectedIds.has(assetItem.id));
  const availableMembers = eligibleMembers.filter((assetItem) => !selectedIds.has(assetItem.id));
  return `
    <div class="field station-group-editor">
      <label>Rack Members</label>
      <div class="rack-member-list">
        ${currentMembers.length ? currentMembers.map((assetItem) => `
          <div class="rack-member-row">
            <input type="hidden" name="stationGroupMemberIds[]" value="${escapeHtml(assetItem.id)}">
            <span><strong>${escapeHtml(assetOptionLabel(assetItem))}</strong><small>${escapeHtml(assetTypeText(assetItem))}</small></span>
            <button type="button" class="secondary icon-button" data-remove-rack-member="${escapeHtml(assetItem.id)}" aria-label="Remove ${escapeHtml(assetDisplayName(assetItem) || assetItem.id)} from rack">X</button>
          </div>
        `).join("") : `<div class="choice-list empty-choice-list">No members assigned yet.</div>`}
      </div>
      <div class="rack-member-add">
        <select id="rackMemberToAdd">
          <option value="">Add member</option>
          ${availableMembers.map((assetItem) => {
            const currentGroup = assetItem.stationGroupId && assetItem.stationGroupId !== item.id ? stationGroupLabel(assetItem.stationGroupId) : "";
            const meta = [assetTypeText(assetItem), currentGroup ? `Currently in ${currentGroup}` : ""].filter(Boolean).join(" / ");
            return `<option value="${escapeHtml(assetItem.id)}">${escapeHtml(`${assetOptionLabel(assetItem)}${meta ? ` (${meta})` : ""}`)}</option>`;
          }).join("")}
        </select>
        <button type="button" class="secondary" id="addRackMemberBtn" ${availableMembers.length ? "" : "disabled"}>Add Member</button>
      </div>
    </div>
  `;
}

function selectedRackMemberIdsFromForm() {
  const formEl = document.getElementById("assetForm");
  if (!formEl) return [];
  return formValues(new FormData(formEl), "stationGroupMemberIds[]");
}

function addRackMember() {
  const memberId = value("rackMemberToAdd");
  if (!memberId) return;
  saveAssetDraftFromForm();
  const draft = assetDrafts.get(assetDraftKey(selectedAssetId));
  if (!draft) return;
  draft.stationGroupMemberIds = uniqueIds([...selectedRackMemberIdsFromForm(), memberId]);
  renderAssetForm();
}

function removeRackMember(memberId) {
  saveAssetDraftFromForm();
  const draft = assetDrafts.get(assetDraftKey(selectedAssetId));
  if (!draft) return;
  draft.stationGroupMemberIds = selectedRackMemberIdsFromForm().filter((assetId) => assetId !== memberId);
  renderAssetForm();
}

function operatorPicker(labelText, operators, selectedIds = []) {
  const selected = new Set(selectedIds);
  if (!operators.length) {
    return `<div class="field"><label>${escapeHtml(labelText)}</label><div class="choice-list empty-choice-list">No test operators available.</div></div>`;
  }
  return `
    <div class="field">
      <label>${escapeHtml(labelText)}</label>
      <div class="choice-list operator-picker">
        ${operators.map((operator) => `
          <label class="choice-row">
            <input type="checkbox" name="operatorAssetIds[]" value="${escapeHtml(operator.value)}" ${selected.has(operator.value) ? "checked" : ""}>
            <span><strong>${escapeHtml(operator.label)}</strong></span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function stationGroupImportControl(stationGroups) {
  if (!stationGroups.length) {
    return `<div class="import-group-control empty-choice-list">No racks available to import.</div>`;
  }
  return `
    <div class="import-group-control">
      <select id="event-stationGroupImportId" aria-label="Rack to import">
        <option value="">Choose rack</option>
        ${stationGroups.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
      </select>
      <button type="button" class="secondary" id="importStationGroupBtn">Import Rack Equipment</button>
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
  return { id: next, manufacturer: "", name: "", assetType: "", assetTypes: [], stationGroupId: "", isStation: false, isRack: false, isOperator: false, isDut: false, allowMultiRoleUse: false, quantity: 1, serialNumber: "", owner: "", status: "Available", calibrationRequired: false, calibrationDueDate: "", capabilities: "", imagePath: "", imageData: "", notes: "" };
}

function emptyEvent() {
  const next = nextId("T", state.testEvents);
  const today = dateISO(new Date());
  return { id: next, name: "", eventCategory: "Test", program: "", uut: "", testType: "", startDate: today, endDate: today, stationAssetId: "", stationGroupId: "", operatorAssetId: "", operatorAssetIds: [], requiredAssetIds: [], equipmentRoles: [], priority: "Medium", owner: "", status: "Draft", notes: "" };
}

function nextId(prefix, collection) {
  const highest = collection.reduce((max, item) => Math.max(max, Number(String(item.id).replace(`${prefix}-`, "")) || 0), 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function renderAssetTable() {
  const assetTypeFilter = value("assetTypeFilter");
  const categoryFilter = value("assetCategoryFilter");
  const searchFilter = value("assetSearchFilter");
  const assetsById = byId(state.assets);
  document.getElementById("assetTable")?.classList.toggle("compact-asset-table", Boolean(categoryFilter));
  renderAssetFilterState();
  const filteredAssets = state.assets.filter((item) => assetMatchesType(item, assetTypeFilter) && assetMatchesCategory(item, categoryFilter) && assetMatchesSearch(item, searchFilter, assetsById));
  if (categoryFilter === "rack") {
    const rows = filteredAssets.map((item) => {
      const members = stationGroupAssets(item.id);
      return {
        id: item.id,
        name: item.name,
        type: assetTypeText(item),
        members: `${members.length} member${members.length === 1 ? "" : "s"}`,
        memberAssets: members.map((member) => assetOptionLabel(member)).join("; ") || "No member assets",
        status: statusBadge(item.status),
        calDue: item.calibrationRequired ? item.calibrationDueDate || "Required" : "N/A",
        owner: item.owner,
        actions: rowActions("asset", item.id)
      };
    });
    renderAssetTableRows(["id", "name", "type", "members", "memberAssets", "status", "calDue", "owner", "actions"], rows);
    return;
  }
  if (categoryFilter === "dut") {
    const rows = filteredAssets.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.dutType || "Not set",
      serial: item.serialNumber,
      status: statusBadge(item.status),
      owner: item.owner,
      actions: rowActions("asset", item.id)
    }));
    renderAssetTableRows(["id", "name", "type", "serial", "status", "owner", "actions"], rows);
    return;
  }
  const rows = filteredAssets.map((item) => ({
    picture: assetImageSource(item)
      ? `<button type="button" class="asset-thumb" data-view-asset-image="${escapeHtml(item.id)}" aria-label="View ${escapeHtml(item.name)} picture">${assetImageMarkup(item, `${item.name} picture`)}</button>`
      : `<div class="asset-thumb">${assetImageMarkup(item, `${item.name} picture`)}</div>`,
    id: item.id,
    manufacturer: item.manufacturer,
    name: item.name,
    type: assetTypeText(item),
    serial: item.serialNumber,
    rack: item.isRack ? `${stationGroupAssets(item.id).length} member${stationGroupAssets(item.id).length === 1 ? "" : "s"}` : stationGroupLabel(item.stationGroupId, assetsById),
    status: statusBadge(item.status),
    calDue: item.calibrationRequired ? item.calibrationDueDate || "Required" : "N/A",
    capabilities: item.capabilities,
    owner: item.owner,
    actions: rowActions("asset", item.id)
  }));
  renderAssetTableRows(["picture", "id", "manufacturer", "name", "type", "serial", "rack", "status", "calDue", "capabilities", "owner", "actions"], rows);
}

function renderAssetTableRows(columns, rows) {
  pruneAssetColumnFilters(columns);
  const filteredRows = filterAssetRowsByColumns(rows, columns);
  const target = document.getElementById("assetTable");
  if (!rows.length) {
    target.innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }
  const tableHead = `<thead><tr>${columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("")}</tr>${assetColumnFilterRow(columns, rows)}</thead>`;
  if (!filteredRows.length) {
    target.innerHTML = `<table>${tableHead}</table>${document.getElementById("emptyState").innerHTML}`;
    return;
  }
  target.innerHTML = `<table>${tableHead}<tbody>${filteredRows.map((row) => `<tr>${columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function calibrationDueRows() {
  const assetsById = byId(state.assets);
  const today = dateISO(new Date());
  return state.assets
    .filter((item) => item.calibrationDueDate)
    .map((item) => {
      const daysUntil = Math.round((parseDate(item.calibrationDueDate) - parseDate(today)) / MS_PER_DAY);
      return {
        id: item.id,
        name: assetDisplayName(item) || item.name,
        type: assetTypeText(item),
        serial: item.serialNumber,
        rack: item.isRack ? `${stationGroupAssets(item.id).length} member${stationGroupAssets(item.id).length === 1 ? "" : "s"}` : stationGroupLabel(item.stationGroupId, assetsById),
        status: item.status,
        owner: item.owner,
        calibrationDueDate: item.calibrationDueDate,
        daysUntil,
        dueStatus: calibrationDueStatusText(daysUntil)
      };
    })
    .sort((a, b) => a.calibrationDueDate.localeCompare(b.calibrationDueDate) || a.name.localeCompare(b.name));
}

function calibrationDueStatusText(daysUntil) {
  if (daysUntil < 0) return `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"}`;
  if (daysUntil === 0) return "Due today";
  if (daysUntil <= 30) return `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  return `Current (${daysUntil} days)`;
}

function calibrationDueStatusBadge(daysUntil) {
  const level = daysUntil < 0 ? "high" : daysUntil <= 30 ? "medium" : "ok";
  return badge(calibrationDueStatusText(daysUntil), level);
}

function renderCalibrationTable() {
  const rows = calibrationDueRows().map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    serial: item.serial,
    rack: item.rack,
    assetStatus: statusBadge(item.status),
    calibrationDueDate: item.calibrationDueDate,
    dueStatus: calibrationDueStatusBadge(item.daysUntil),
    owner: item.owner,
    actions: rowActions("asset", item.id)
  }));
  renderTable("calibrationTable", ["id", "name", "type", "serial", "rack", "assetStatus", "calibrationDueDate", "dueStatus", "owner", "actions"], rows);
}

function assetColumnFilterRow(columns, rows) {
  return `<tr class="asset-column-filter-row">${columns.map((column) => `<th>${assetColumnCanFilter(column) ? assetColumnFilterSelect(column, rows) : ""}</th>`).join("")}</tr>`;
}

function assetColumnFilterSelect(column, rows) {
  const selected = assetColumnFilters[column] || "";
  const cellValues = rows.map((row) => cellText(row[column]));
  const hasEmptyValues = cellValues.some((cellValue) => !cellValue);
  const options = unique(cellValues);
  return `
    <select data-asset-column-filter="${escapeHtml(column)}" aria-label="Filter ${escapeHtml(labelize(column))}">
      <option value="">All</option>
      ${hasEmptyValues ? `<option value="${ASSET_COLUMN_EMPTY_FILTER}" ${selected === ASSET_COLUMN_EMPTY_FILTER ? "selected" : ""}>Unspecified</option>` : ""}
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  `;
}

function assetColumnCanFilter(column) {
  return !["picture", "actions"].includes(column);
}

function filterAssetRowsByColumns(rows, columns) {
  return rows.filter((row) => columns.every((column) => {
    if (!assetColumnCanFilter(column)) return true;
    const filterValue = assetColumnFilters[column] || "";
    const cellValue = cellText(row[column]);
    if (filterValue === ASSET_COLUMN_EMPTY_FILTER) return !cellValue;
    const filterText = comparableText(filterValue);
    return !filterText || comparableText(cellValue) === filterText;
  }));
}

function pruneAssetColumnFilters(columns) {
  Object.keys(assetColumnFilters).forEach((column) => {
    if (!columns.includes(column) || !assetColumnCanFilter(column)) delete assetColumnFilters[column];
  });
}

function clearAssetColumnFilters() {
  Object.keys(assetColumnFilters).forEach((column) => delete assetColumnFilters[column]);
}

function cellText(valueText) {
  const text = String(valueText ?? "");
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function renderEventTable() {
  const assetsById = byId(state.assets);
  const doubleBookedEvents = new Set(state.conflicts.filter(isDoubleBookingConflict).flatMap((item) => item.eventIds));
  const planningIssueEvents = new Set(state.conflicts.filter(isPlanningIssue).flatMap((item) => item.eventIds));
  const rows = getFilteredEvents().map((item) => ({
    id: item.id,
    category: item.eventCategory || "Test",
    name: item.name,
    program: item.program,
    uut: item.uut,
    dates: eventDateRangeMarkup(item.startDate, item.endDate),
    station: assetsById.get(item.stationAssetId) ? assetDisplayName(assetsById.get(item.stationAssetId)) : "",
    rack: stationGroupLabel(item.stationGroupId, assetsById),
    operators: operatorNamesForEvent(item, assetsById),
    equipment: roleSummary(item),
    priority: item.priority,
    status: item.status,
    roleStatus: hasUnassignedRoles(item) ? badge("Unassigned", "medium") : badge("Assigned", "ok"),
    conflicts: eventFindingBadges(item.id, doubleBookedEvents, planningIssueEvents),
    actions: rowActions("event", item.id)
  }));
  renderEventColumnPicker();
  renderTable("eventTable", visibleEventTableColumns(), rows);
}

function eventFindingBadges(eventId, doubleBookedEvents, planningIssueEvents) {
  const badges = [
    doubleBookedEvents.has(eventId) ? conflictLinkBadge(eventId) : "",
    planningIssueEvents.has(eventId) ? issueLinkBadge(eventId) : ""
  ].filter(Boolean);
  return badges.length ? `<div class="finding-badge-list">${badges.join("")}</div>` : badge("Clear", "ok");
}

function conflictLinkBadge(eventId) {
  return `<button type="button" class="badge high badge-button" data-view-conflicts-for="${escapeHtml(eventId)}">Double-booked</button>`;
}

function issueLinkBadge(eventId) {
  return `<button type="button" class="badge medium badge-button" data-view-issues-for="${escapeHtml(eventId)}">Issues</button>`;
}

function visibleEventTableColumns() {
  return EVENT_TABLE_COLUMNS.filter((column) => column === "actions" || !eventHiddenColumns.has(column));
}

function eventColumnLabel(column) {
  if (column === "uut") return "UUT";
  if (column === "roleStatus") return "Role Status";
  if (column === "conflicts") return "Findings";
  return labelize(column);
}

function renderEventColumnPicker() {
  const target = document.getElementById("eventColumnPicker");
  if (!target) return;
  const visibleCount = EVENT_TABLE_OPTIONAL_COLUMNS.filter((column) => !eventHiddenColumns.has(column)).length;
  target.innerHTML = `
    <details class="column-menu">
      <summary>Columns (${visibleCount}/${EVENT_TABLE_OPTIONAL_COLUMNS.length})</summary>
      <div class="column-menu-panel">
        ${EVENT_TABLE_OPTIONAL_COLUMNS.map((column) => `
          <label>
            <input type="checkbox" name="eventTableColumn[]" data-event-column="${escapeHtml(column)}" ${eventHiddenColumns.has(column) ? "" : "checked"}>
            <span>${escapeHtml(eventColumnLabel(column))}</span>
          </label>
        `).join("")}
      </div>
    </details>
  `;
}

function rowActions(kind, id) {
  const duplicate = kind === "asset" ? `<button type="button" class="secondary" data-duplicate-asset="${escapeHtml(id)}">Duplicate</button>` : "";
  const report = kind === "event" ? `<button type="button" class="secondary" data-event-report="${escapeHtml(id)}">Report</button>` : "";
  return `<div class="row-actions"><button type="button" class="secondary" data-edit-${kind}="${escapeHtml(id)}">Edit</button>${report}${duplicate}<button type="button" class="secondary" data-delete-${kind}="${escapeHtml(id)}">Delete</button></div>`;
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
  const labelForColumn = (column) => targetId === "eventTable" ? eventColumnLabel(column) : labelize(column);
  target.innerHTML = `<table><thead><tr>${columns.map((column) => `<th data-column="${escapeHtml(column)}">${escapeHtml(labelForColumn(column))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr ${row.__rowAttrs || ""}>${columns.map((column) => `<td data-column="${escapeHtml(column)}">${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderGantt() {
  const ganttView = value("groupBy");
  const groupBy = ganttView === "calibration" ? "events" : ganttView;
  const events = getGanttEvents(ganttView).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const assetsById = byId(state.assets);
  const conflictEvents = new Set(state.conflicts.filter(isDoubleBookingConflict).flatMap((item) => item.eventIds));
  const planningIssueEvents = new Set(state.conflicts.filter(isPlanningIssue).flatMap((item) => item.eventIds));
  document.getElementById("ganttTitle").textContent = ganttView === "calibration" ? "Calibration Events" : labelize(groupBy === "events" ? "event schedule" : `${groupBy} schedule`);
  if (!events.length) {
    document.getElementById("gantt").innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }
  const firstEventStart = events.map((item) => item.startDate).sort()[0];
  const lastEventEnd = events.map((item) => item.endDate).sort().at(-1);
  const start = monthStartISO(firstEventStart);
  const end = monthEndISO(lastEventEnd);
  const months = monthSegments(start, end);
  const monthColumns = months.map((month) => `${month.days}fr`).join(" ");
  const totalDays = Math.max(1, Math.round((parseDate(end) - parseDate(start)) / MS_PER_DAY) + 1);
  const monthLines = monthLineMarkup(months, totalDays);
  const groups = buildGroups(groupBy, events, assetsById);
  const html = `
    ${renderScheduleLegend(events)}
    <div class="timeline">
      <div class="timeline-head">
        <div></div>
        <div class="month-grid" style="grid-template-columns: ${monthColumns}">${monthLines}${months.map((month) => `<div class="month">${escapeHtml(month.label)}</div>`).join("")}</div>
      </div>
      ${groups.map((group) => renderLane(group, start, totalDays, monthLines, assetsById, conflictEvents, planningIssueEvents)).join("")}
    </div>
  `;
  document.getElementById("gantt").innerHTML = html;
}

function getGanttEvents(ganttView = value("groupBy")) {
  const events = getFilteredEvents();
  if (ganttView === "calibration") return events.filter((item) => item.eventCategory === "Calibration");
  return events;
}

function renderScheduleLegend(events) {
  const visiblePrograms = unique(events.filter((item) => !item.eventCategory || item.eventCategory === "Test").map((item) => item.program));
  const visibleCategories = unique(events.filter((item) => item.eventCategory && item.eventCategory !== "Test").map((item) => item.eventCategory));
  const programItems = visiblePrograms.map((program) => legendItem(program || "Unassigned program", programColor(program), false));
  const categoryItems = visibleCategories.map((category) => legendItem(category, CATEGORY_COLORS[category] || "#6f6460", true));
  const conflict = `<span class="legend-item"><span class="legend-swatch conflict-swatch"></span>Conflict outline</span>`;
  const planningIssue = `<span class="legend-item"><span class="legend-swatch issue-swatch"></span>Planning issue</span>`;
  return `<div class="schedule-legend" aria-label="Schedule color legend">${[...programItems, ...categoryItems, conflict, planningIssue].join("")}</div>`;
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
  if (groupBy === "stations") state.assets.filter((item) => item.isStation).forEach((item) => ensure(item.id, assetDisplayName(item) || item.name, assetTypeText(item)));
  if (groupBy === "operators") state.assets.filter((item) => item.isOperator).forEach((item) => ensure(item.id, assetDisplayName(item) || item.name, assetTypeText(item)));
  events.forEach((item) => {
    if (groupBy === "stations") {
      const station = assetsById.get(item.stationAssetId);
      ensure(item.stationAssetId || "unassigned", station ? assetDisplayName(station) : "Unassigned", "station").events.push(item);
    }
    if (groupBy === "operators") {
      const operatorIds = operatorIdsForEvent(item);
      if (!operatorIds.length) ensure("unassigned", "Unassigned", "operator").events.push(item);
      operatorIds.forEach((operatorId) => {
        const operator = assetsById.get(operatorId);
        ensure(operatorId || "unassigned", operator ? assetDisplayName(operator) : "Unassigned", "operator").events.push(item);
      });
    }
    if (groupBy === "programs") ensure(item.program || item.eventCategory || "Unassigned", item.program || item.eventCategory || "Unassigned", "program").events.push(item);
    if (groupBy === "uuts") ensure(item.uut || item.eventCategory || "Unassigned", item.uut || item.eventCategory || "Unassigned", item.program || item.eventCategory).events.push(item);
    if (groupBy === "assets") fullAssetIds(item).forEach((assetId) => {
      const assetItem = assetsById.get(assetId);
      ensure(assetId, assetItem ? assetDisplayName(assetItem) : assetId, assetItem ? assetTypeText(assetItem) : "asset").events.push(item);
    });
  });
  return [...map.values()].filter((group) => group.events.length || groupBy === "stations" || groupBy === "operators");
}

function renderLane(group, start, totalDays, monthLines, assetsById, conflictEvents, planningIssueEvents) {
  const barTrackGap = 12;
  const narrowBarThreshold = 12;
  const trackEndDates = [];
  const trackHeights = [];
  const estimateBarHeight = (item, widthPercent, hasBadges, subtitle, dateRange, isNarrow) => {
    const minimumHeight = hasBadges ? 96 : 76;
    const estimatedZoneWidth = 780;
    const barWidthPx = isNarrow ? 260 : Math.max(28, widthPercent / 100 * estimatedZoneWidth);
    const contentWidthPx = Math.max(14, barWidthPx - (hasBadges ? 28 : 16));
    const charsPerLine = Math.max(2, Math.floor(contentWidthPx / 7));
    const textLines = [item.name, subtitle.context, subtitle.resources, dateRange].reduce((sum, text) => {
      return sum + Math.max(1, Math.ceil(String(text || "").length / charsPerLine));
    }, 0);
    const badgeSpace = hasBadges ? 29 : 0;
    return Math.max(minimumHeight, 20 + badgeSpace + textLines * 16);
  };
  const layoutItems = [...group.events].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)).map((item) => {
    const eventStart = parseDate(item.startDate);
    const eventEnd = parseDate(item.endDate);
    let trackIndex = trackEndDates.findIndex((trackEnd) => eventStart > trackEnd);
    if (trackIndex === -1) {
      trackIndex = trackEndDates.length;
      trackEndDates.push(eventEnd);
    } else {
      trackEndDates[trackIndex] = eventEnd;
    }
    const left = Math.max(0, ((parseDate(item.startDate) - parseDate(start)) / MS_PER_DAY) / totalDays * 100);
    const width = Math.max(2, daysInclusive(item.startDate, item.endDate) / totalDays * 100);
    const color = eventColor(item);
    const stationItem = assetsById.get(item.stationAssetId);
    const station = stationItem ? assetDisplayName(stationItem) : "No station";
    const hasConflict = conflictEvents.has(item.id);
    const hasPlanningIssue = planningIssueEvents.has(item.id);
    const duration = durationLabel(item.startDate, item.endDate);
    const dateRange = `${item.startDate} to ${item.endDate}`;
    const scheduleTime = `${dateRange} (${duration})`;
    const badges = [
      hasConflict ? '<span class="bar-badge conflict-badge">Conflict</span>' : "",
      hasPlanningIssue ? '<span class="bar-badge issue-badge">Issue</span>' : ""
    ].filter(Boolean).join("");
    const badgeRail = badges ? `<span class="bar-badge-rail">${badges}</span>` : "";
    const subtitle = eventSubtitleParts(item, assetsById);
    const isNarrow = width < narrowBarThreshold;
    const labelSide = isNarrow && left > 72 ? "left" : "right";
    const barHeight = estimateBarHeight(item, width, Boolean(badges), subtitle, scheduleTime, isNarrow);
    trackHeights[trackIndex] = Math.max(trackHeights[trackIndex] || 0, barHeight);
    return { item, left, width, color, hasConflict, hasPlanningIssue, trackIndex, scheduleTime, badgeRail, subtitle, barHeight, isNarrow, labelSide };
  });
  const trackTops = [];
  trackHeights.reduce((top, height, index) => {
    trackTops[index] = top;
    return top + height + barTrackGap;
  }, 10);
  const bars = layoutItems.map(({ item, left, width, color, hasConflict, hasPlanningIssue, trackIndex, scheduleTime, badgeRail, subtitle, barHeight, isNarrow, labelSide }) => {
    const top = trackTops[trackIndex] || 10;
    const fullLabel = `${item.name} / ${subtitle.context} / ${subtitle.resources} / ${scheduleTime}`;
    return `<button type="button" class="bar ${isNarrow ? `narrow label-${labelSide}` : ""} ${item.eventCategory !== "Test" ? "non-test" : ""} ${hasConflict ? "conflict" : ""} ${hasPlanningIssue ? "planning-issue" : ""} ${inspectedEventId === item.id ? "selected" : ""}" data-inspect-event="${escapeHtml(item.id)}" title="${escapeHtml(fullLabel)}" aria-label="${escapeHtml(fullLabel)}" style="left:${left}%;width:${width}%;top:${top}px;min-height:${barHeight}px;background:${color}">${badgeRail}<span class="bar-content" style="--bar-color:${escapeHtml(color)}"><strong>${escapeHtml(item.name)}</strong><span class="bar-line">${escapeHtml(subtitle.context)}</span><span class="bar-line resource-line">${escapeHtml(subtitle.resources)}</span><em>${escapeHtml(scheduleTime)}</em></span></button>`;
  }).join("");
  const height = Math.max(86, 24 + trackHeights.reduce((sum, trackHeight) => sum + trackHeight + barTrackGap, 0));
  return `<div class="lane" style="min-height:${height}px"><div class="lane-label">${escapeHtml(group.label)}<small>${escapeHtml(group.sublabel || `${group.events.length} event${group.events.length === 1 ? "" : "s"}`)}</small></div><div class="bar-zone" style="min-height:${height}px">${monthLines}${bars}</div></div>`;
}

function eventSubtitle(item, assetsById = byId(state.assets)) {
  const parts = eventSubtitleParts(item, assetsById);
  return `${parts.context} / ${parts.resources}`;
}

function eventSubtitleParts(item, assetsById = byId(state.assets)) {
  const stationItem = assetsById.get(item.stationAssetId);
  const station = stationItem ? assetDisplayName(stationItem) : "No station";
  const rackItem = assetsById.get(item.stationGroupId);
  const rack = rackItem ? assetDisplayName(rackItem) : "No rack";
  const operators = operatorNamesForEvent(item, assetsById, "No operator");
  const resources = `${station} / ${rack} / ${operators}`;
  if (item.eventCategory === "Demo") return { context: `${item.program || "No program"} / ${item.uut || "No demo unit"}`, resources };
  if (item.eventCategory && item.eventCategory !== "Test") return { context: item.eventCategory, resources };
  return { context: `${item.program || "No program"} / ${item.uut || "No UUT"}`, resources };
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
  const rack = assetsById.get(item.stationGroupId);
  const operators = operatorNamesForEvent(item, assetsById, "No operator assigned");
  const conflicts = state.conflicts.filter((conflict) => (conflict.eventIds || []).includes(item.id));
  const doubleBookingConflicts = conflicts.filter(isDoubleBookingConflict);
  const planningIssues = conflicts.filter(isPlanningIssue);
  target.hidden = false;
  target.innerHTML = `
    <div class="inspector-sticky">
      <div class="inspector-header">
        <div>
          <span>${escapeHtml(item.id)}</span>
          <h3>${escapeHtml(item.name || "Untitled event")}</h3>
        </div>
        <button type="button" class="secondary icon-button" data-close-event-inspector aria-label="Close event details">X</button>
      </div>
      <div class="inspector-actions">
        <button type="button" data-edit-event="${escapeHtml(item.id)}">Edit Event</button>
        <button type="button" class="secondary" data-event-report="${escapeHtml(item.id)}">Event Report</button>
      </div>
    </div>
    <dl class="detail-list">
      ${detailItem("Category", item.eventCategory || "Test")}
      ${detailItem("Program", item.program)}
      ${eventUsesUut(item.eventCategory || "Test") ? detailItem(eventUutLabel(item.eventCategory || "Test"), item.uut) : ""}
      ${item.eventCategory === "Test" ? detailItem("Test Type", item.testType) : ""}
      ${detailItem("Dates", `${item.startDate} to ${item.endDate} (${durationLabel(item.startDate, item.endDate)})`)}
      ${detailItem(item.eventCategory === "Test" ? "Station" : item.eventCategory === "Demo" ? "Demo Station" : "Affected Station", station ? assetOptionLabel(station) : "No station assigned")}
      ${eventUsesEquipment(item.eventCategory || "Test") ? detailItem("Rack", rack ? assetDisplayName(rack) : "No rack assigned") : ""}
      ${detailItem("Test Operators", operators)}
      ${detailItem("Priority", item.priority)}
      ${detailItem("Status", item.status)}
      ${detailItem("Owner", item.owner)}
    </dl>
    ${eventUsesEquipment(item.eventCategory || "Test") ? `<div class="inspector-section">
      <h4>Equipment Roles</h4>
      ${renderInspectorEquipmentRoles(item, assetsById)}
    </div>` : ""}
    <div class="inspector-section">
      <h4>Resource Conflicts</h4>
      ${doubleBookingConflicts.length ? doubleBookingConflicts.map((conflict) => `<p class="inspector-conflict">${badge(conflict.severity, conflict.severity === "Critical" ? "high" : "medium")} ${escapeHtml(conflict.conflictType)}: ${escapeHtml(conflict.explanation)}</p>`).join("") : `<p class="muted-line">No double-booked resources for this event.</p>`}
    </div>
    <div class="inspector-section">
      <h4>Planning Issues</h4>
      ${planningIssues.length ? planningIssues.map((conflict) => `<p class="inspector-conflict">${badge(conflict.severity, conflict.severity === "Critical" ? "high" : "medium")} ${escapeHtml(conflict.conflictType)}: ${escapeHtml(conflict.explanation)}</p>`).join("") : `<p class="muted-line">No assignment or readiness issues for this event.</p>`}
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
    const assigned = (role.assignedAssetIds || []).map((assetId) => assetsById.get(assetId) ? assetDisplayName(assetsById.get(assetId)) : assetId);
    const needed = Math.max(1, Number(role.quantity) || 1);
    const missing = Math.max(0, needed - assigned.length);
    const assignmentText = [...assigned, ...Array.from({ length: missing }, () => "Unassigned")].join(", ");
    return `
      <article class="inspector-role">
        <strong>${escapeHtml(role.label || role.assetType || "Equipment role")}</strong>
        <span>${escapeHtml(role.assetType || "Any type")} x${needed}</span>
        ${role.requirements ? `<small>${escapeHtml(role.requirements)}</small>` : ""}
        <small>${escapeHtml(assignmentText)}</small>
      </article>
    `;
  }).join("");
}

function monthSegments(start, end) {
  const segments = [];
  const first = parseDate(start);
  const last = parseDate(end);
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cursor <= last) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const visibleStart = monthStart < first ? first : monthStart;
    const visibleEnd = monthEnd > last ? last : monthEnd;
    const days = Math.max(1, Math.round((visibleEnd - visibleStart) / MS_PER_DAY) + 1);
    segments.push({
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      days
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return segments.length ? segments : [{ label: "Schedule", days: 1 }];
}

function monthLineMarkup(months, totalDays) {
  let elapsed = 0;
  const positions = [0];
  months.slice(0, -1).forEach((month) => {
    elapsed += month.days;
    positions.push(elapsed / totalDays * 100);
  });
  positions.push(100);
  return `<div class="time-grid-lines" aria-hidden="true">${positions.map((position) => `<span class="time-grid-line" style="left:${position}%"></span>`).join("")}</div>`;
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

function recipeTypeForAsset(assetItem) {
  return assetTypesFor(assetItem).find((assetType) => assetType && assetType !== RACK_TYPE && assetType !== DUT_TYPE && assetType !== TEST_OPERATOR_TYPE) || assetTypeText(assetItem) || assetItem.name || "Equipment";
}

function rackRecipe(rackId) {
  const recipeMap = new Map();
  stationGroupAssets(rackId).forEach((assetItem) => {
    const type = recipeTypeForAsset(assetItem);
    const existing = recipeMap.get(type) || { type, required: 0, members: [] };
    existing.required += 1;
    existing.members.push(assetItem);
    recipeMap.set(type, existing);
  });
  return [...recipeMap.values()].sort((a, b) => a.type.localeCompare(b.type));
}

function allocationIsUsable(allocation) {
  return ["open", "warning", "shared"].includes(allocation?.level);
}

function resolverAllocation(assetItem, conflict) {
  return assetAllocation(assetItem.id, conflict.startDate, conflict.endDate);
}

function rackAvailabilityNote(rackItem, conflict) {
  const allocation = resolverAllocation(rackItem, conflict);
  if (allocation.level === "open") return "Rack is open for this window.";
  return `${allocation.label}${allocation.detail ? `: ${allocation.detail}` : ""}`;
}

function compatibleAvailableAssets(type, conflict, excludeAssetIds = new Set()) {
  return state.assets
    .filter((assetItem) => !assetItem.isRack && !assetItem.isOperator && !assetItem.isDut)
    .filter((assetItem) => !excludeAssetIds.has(assetItem.id))
    .filter((assetItem) => assetMatchesType(assetItem, type))
    .map((assetItem) => ({ assetItem, allocation: resolverAllocation(assetItem, conflict) }))
    .filter((candidate) => allocationIsUsable(candidate.allocation))
    .sort((a, b) => {
      const rackSort = Boolean(a.assetItem.stationGroupId) - Boolean(b.assetItem.stationGroupId);
      if (rackSort) return rackSort;
      return assetOptionLabel(a.assetItem).localeCompare(assetOptionLabel(b.assetItem));
    });
}

function summarizeAvailableAsset(candidate, assetsById = byId(state.assets)) {
  const rack = stationGroupLabel(candidate.assetItem.stationGroupId, assetsById);
  const capability = truncateText(candidate.assetItem.capabilities, 80);
  return `
    <div class="resolver-asset-option">
      <strong>${escapeHtml(assetOptionLabel(candidate.assetItem))}</strong>
      <span>${escapeHtml(rack ? `Rack: ${rack}` : "No rack")} - ${escapeHtml(candidate.allocation.label)}</span>
      ${capability ? `<span>${escapeHtml(capability)}</span>` : ""}
    </div>
  `;
}

function rackCandidateScore(rackItem, recipe, conflict) {
  const rackAllocation = resolverAllocation(rackItem, conflict);
  const rackUsable = allocationIsUsable(rackAllocation);
  const availableMembers = stationGroupAssets(rackItem.id)
    .map((assetItem) => ({ assetItem, allocation: resolverAllocation(assetItem, conflict) }))
    .filter((candidate) => allocationIsUsable(candidate.allocation));
  const usedIds = new Set();
  const coverage = recipe.map((recipeItem) => {
    const matches = availableMembers.filter((candidate) => !usedIds.has(candidate.assetItem.id) && assetMatchesType(candidate.assetItem, recipeItem.type));
    matches.slice(0, recipeItem.required).forEach((candidate) => usedIds.add(candidate.assetItem.id));
    return {
      type: recipeItem.type,
      required: recipeItem.required,
      covered: Math.min(recipeItem.required, matches.length),
      candidates: matches.slice(0, recipeItem.required)
    };
  });
  const covered = coverage.reduce((sum, item) => sum + item.covered, 0);
  const required = recipe.reduce((sum, item) => sum + item.required, 0);
  const missing = Math.max(0, required - covered);
  return {
    rackItem,
    rackAllocation,
    rackUsable,
    coverage,
    covered,
    required,
    missing,
    score: required ? covered / required : 0
  };
}

function renderResolverTable(columns, rows) {
  if (!rows.length) return document.getElementById("emptyState").innerHTML;
  return `
    <div class="resolver-table-wrap">
      <table class="resolver-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderRackConflictResolver(conflict) {
  const assetsById = byId(state.assets);
  const eventsById = byId(state.testEvents);
  const rackItem = assetsById.get(conflict.assetId);
  const recipe = rackRecipe(conflict.assetId);
  const rackMemberIds = new Set(stationGroupAssets(conflict.assetId).map((assetItem) => assetItem.id));
  const eventNames = conflict.eventIds.map((eventId) => eventsById.get(eventId)?.name || eventId).join(", ");
  if (!rackItem) {
    return `<div class="empty"><h3>Rack not found</h3><p>This conflict references an asset that is no longer in the inventory.</p></div>`;
  }
  if (!recipe.length) {
    return `<div class="empty"><h3>No rack members</h3><p>${escapeHtml(assetDisplayName(rackItem) || rackItem.id)} does not have member equipment to use as a recipe.</p></div>`;
  }

  const recipeRows = recipe.map((recipeItem) => ({
    type: escapeHtml(recipeItem.type),
    required: recipeItem.required,
    currentRackMembers: recipeItem.members.map((assetItem) => escapeHtml(assetOptionLabel(assetItem))).join("<br>")
  }));

  const rackCandidates = state.assets
    .filter((assetItem) => assetItem.isRack && assetItem.id !== conflict.assetId)
    .map((assetItem) => rackCandidateScore(assetItem, recipe, conflict))
    .filter((candidate) => candidate.covered > 0 || candidate.rackUsable)
    .sort((a, b) => b.score - a.score || a.missing - b.missing || assetDisplayName(a.rackItem).localeCompare(assetDisplayName(b.rackItem)))
    .slice(0, 6);

  const rackRows = rackCandidates.map((candidate) => ({
    rack: escapeHtml(assetOptionLabel(candidate.rackItem)),
    coverage: `<strong>${candidate.covered}/${candidate.required}</strong> (${Math.round(candidate.score * 100)}%)`,
    missing: candidate.coverage.filter((item) => item.covered < item.required).map((item) => `${escapeHtml(item.type)} (${item.required - item.covered})`).join("<br>") || badge("Complete", "ok"),
    status: `<span class="resolver-status resolver-status-${escapeHtml(candidate.rackAllocation.level)}">${escapeHtml(candidate.rackAllocation.label)}</span>`,
    notes: escapeHtml(rackAvailabilityNote(candidate.rackItem, conflict))
  }));

  const poolRows = recipe.map((recipeItem) => {
    const candidates = compatibleAvailableAssets(recipeItem.type, conflict, rackMemberIds);
    return {
      type: escapeHtml(recipeItem.type),
      need: recipeItem.required,
      available: candidates.length >= recipeItem.required ? badge(`${candidates.length} available`, "ok") : badge(`${candidates.length} available`, "high"),
      candidates: candidates.length ? candidates.slice(0, 5).map((candidate) => summarizeAvailableAsset(candidate, assetsById)).join("") : "<span class=\"muted-line\">No available substitutes found.</span>"
    };
  });

  return `
    <div class="resolver-summary">
      <div>
        <span class="muted-line">Conflict</span>
        <strong>${escapeHtml(conflict.id)} - ${escapeHtml(conflict.startDate)} to ${escapeHtml(conflict.endDate)}</strong>
      </div>
      <div>
        <span class="muted-line">Rack</span>
        <strong>${escapeHtml(assetOptionLabel(rackItem))}</strong>
      </div>
      <div>
        <span class="muted-line">Events</span>
        <strong>${escapeHtml(eventNames)}</strong>
      </div>
    </div>
    <section class="resolver-section">
      <h3>Rack Recipe</h3>
      ${renderResolverTable(["type", "required", "currentRackMembers"], recipeRows)}
    </section>
    <details class="resolver-section resolver-collapsible-section">
      <summary>Best Substitute Racks</summary>
      ${renderResolverTable(["rack", "coverage", "missing", "status", "notes"], rackRows)}
    </details>
    <section class="resolver-section">
      <h3>Available Equipment Pool</h3>
      ${renderResolverTable(["type", "need", "available", "candidates"], poolRows)}
    </section>
  `;
}

function renderEquipmentConflictResolver(conflict) {
  const assetsById = byId(state.assets);
  const assetItem = assetsById.get(conflict.assetId);
  const assetType = assetItem ? recipeTypeForAsset(assetItem) : "";
  const candidates = assetType ? compatibleAvailableAssets(assetType, conflict, new Set([conflict.assetId])) : [];
  return `
    <div class="resolver-summary">
      <div>
        <span class="muted-line">Conflict</span>
        <strong>${escapeHtml(conflict.id)} - ${escapeHtml(conflict.startDate)} to ${escapeHtml(conflict.endDate)}</strong>
      </div>
      <div>
        <span class="muted-line">Equipment</span>
        <strong>${escapeHtml(assetItem ? assetOptionLabel(assetItem) : conflict.assetId || "Equipment")}</strong>
      </div>
      <div>
        <span class="muted-line">Type</span>
        <strong>${escapeHtml(assetType || "Unknown")}</strong>
      </div>
    </div>
    <section class="resolver-section">
      <h3>Available Alternatives</h3>
      ${candidates.length ? `<div class="resolver-option-list">${candidates.slice(0, 12).map((candidate) => summarizeAvailableAsset(candidate, assetsById)).join("")}</div>` : "<p class=\"muted-line\">No available same-type alternatives found for this conflict window.</p>"}
    </section>
  `;
}

function openConflictResolver(conflictId) {
  const conflict = state.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return;
  document.getElementById("conflictResolverTitle").textContent = conflict.conflictType === "Rack" ? "Resolve Rack Conflict" : "Resolve Equipment Conflict";
  document.getElementById("conflictResolverBody").innerHTML = conflict.conflictType === "Rack" ? renderRackConflictResolver(conflict) : renderEquipmentConflictResolver(conflict);
  document.getElementById("conflictResolverModal").hidden = false;
}

function closeConflictResolver() {
  document.getElementById("conflictResolverModal").hidden = true;
  document.getElementById("conflictResolverBody").innerHTML = "";
}

function renderConflictTable() {
  const assetsById = byId(state.assets);
  const eventsById = byId(state.testEvents);
  const columns = ["id", "type", "item", "dates", "events", "programs", "severity", "explanation", "suggestedResolution", "status", "actions"];
  const rows = state.conflicts.filter(isDoubleBookingConflict).map((item) => ({
    __rowAttrs: `data-conflict-id="${escapeHtml(item.id)}" data-conflict-events="${escapeHtml(item.eventIds.join(" "))}"`,
    id: item.id,
    type: item.conflictType,
    item: item.assetId ? assetsById.get(item.assetId)?.name || item.assetId : item.uut || "Equipment role",
    dates: `${item.startDate} to ${item.endDate}`,
    events: item.eventIds.map((id) => eventsById.get(id)?.name || id).join(", "),
    programs: item.programs.join(", "),
    severity: badge(item.severity, item.severity),
    explanation: escapeHtml(item.explanation),
    suggestedResolution: escapeHtml(item.suggestedResolution),
    status: item.status,
    actions: `<button type="button" class="secondary" data-resolve-conflict="${escapeHtml(item.id)}">Resolve</button>`
  }));
  pruneConflictColumnFilters(columns);
  const filteredRows = filterConflictRowsByColumns(rows, columns);
  const target = document.getElementById("conflictTable");
  if (!rows.length) {
    target.innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }
  const tableHead = `<thead><tr>${columns.map((column) => `<th data-column="${escapeHtml(column)}">${escapeHtml(labelize(column))}</th>`).join("")}</tr>${conflictColumnFilterRow(columns, rows)}</thead>`;
  if (!filteredRows.length) {
    target.innerHTML = `<table>${tableHead}</table>${document.getElementById("emptyState").innerHTML}`;
    return;
  }
  target.innerHTML = `<table>${tableHead}<tbody>${filteredRows.map((row) => `<tr ${row.__rowAttrs || ""}>${columns.map((column) => `<td data-column="${escapeHtml(column)}">${row[column] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function conflictColumnFilterRow(columns, rows) {
  return `<tr class="conflict-column-filter-row">${columns.map((column) => `<th>${conflictColumnCanFilter(column) ? conflictColumnFilterSelect(column, rows) : ""}</th>`).join("")}</tr>`;
}

function conflictColumnFilterSelect(column, rows) {
  const selected = conflictColumnFilters[column] || "";
  const cellValues = rows.flatMap((row) => conflictColumnValues(row, column));
  const hasEmptyValues = cellValues.some((cellValue) => !cellValue);
  const options = unique(cellValues);
  return `
    <select data-conflict-column-filter="${escapeHtml(column)}" aria-label="Filter ${escapeHtml(labelize(column))}">
      <option value="">All</option>
      ${hasEmptyValues ? `<option value="${CONFLICT_COLUMN_EMPTY_FILTER}" ${selected === CONFLICT_COLUMN_EMPTY_FILTER ? "selected" : ""}>Unspecified</option>` : ""}
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  `;
}

function conflictColumnCanFilter(column) {
  return !["actions", "explanation", "suggestedResolution"].includes(column);
}

function conflictColumnValues(row, column) {
  const text = cellText(row[column]);
  if (!text) return [""];
  if (["events", "programs"].includes(column)) return text.split(",").map((item) => item.trim()).filter(Boolean);
  return [text];
}

function filterConflictRowsByColumns(rows, columns) {
  return rows.filter((row) => columns.every((column) => {
    if (!conflictColumnCanFilter(column)) return true;
    const filterValue = conflictColumnFilters[column] || "";
    const cellValues = conflictColumnValues(row, column);
    if (filterValue === CONFLICT_COLUMN_EMPTY_FILTER) return cellValues.every((cellValue) => !cellValue);
    const filterText = comparableText(filterValue);
    return !filterText || cellValues.some((cellValue) => comparableText(cellValue) === filterText);
  }));
}

function pruneConflictColumnFilters(columns) {
  Object.keys(conflictColumnFilters).forEach((column) => {
    if (!columns.includes(column) || !conflictColumnCanFilter(column)) delete conflictColumnFilters[column];
  });
}

function clearConflictColumnFilters() {
  Object.keys(conflictColumnFilters).forEach((column) => delete conflictColumnFilters[column]);
}

function showConflictsForEvent(eventId) {
  setActiveView("conflicts");
  clearConflictColumnFilters();
  renderConflictTable();
  document.querySelectorAll("#conflictTable tr.conflict-row-highlight").forEach((row) => row.classList.remove("conflict-row-highlight"));
  const matches = [...document.querySelectorAll("#conflictTable tr[data-conflict-events]")].filter((row) => row.dataset.conflictEvents.split(" ").includes(eventId));
  matches.forEach((row) => row.classList.add("conflict-row-highlight"));
  matches[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderIssueTable() {
  const assetsById = byId(state.assets);
  const eventsById = byId(state.testEvents);
  const columns = ["id", "type", "event", "category", "program", "uut", "dates", "item", "severity", "explanation", "suggestedResolution", "status", "actions"];
  const rows = state.conflicts.filter(isPlanningIssue).map((item) => {
    const events = (item.eventIds || []).map((eventId) => eventsById.get(eventId)).filter(Boolean);
    const eventNames = (item.eventIds || []).map((eventId) => eventsById.get(eventId)?.name || eventId).join(", ");
    const primaryEvent = events[0];
    const assetItem = item.assetId ? assetsById.get(item.assetId) : null;
    return {
      __rowAttrs: `data-issue-id="${escapeHtml(item.id)}" data-issue-events="${escapeHtml((item.eventIds || []).join(" "))}"`,
      id: item.id,
      type: item.conflictType,
      event: eventNames,
      category: unique(events.map((eventItem) => eventItem.eventCategory || "Test")).join(", ") || primaryEvent?.eventCategory || "",
      program: item.programs?.join(", ") || unique(events.map((eventItem) => eventItem.program)).join(", "),
      uut: item.uut || unique(events.map((eventItem) => eventItem.uut)).join(", "),
      dates: `${item.startDate} to ${item.endDate}`,
      item: assetItem ? assetOptionLabel(assetItem) : item.uut || "Equipment role",
      severity: badge(item.severity, item.severity === "Critical" ? "high" : item.severity),
      explanation: escapeHtml(item.explanation),
      suggestedResolution: escapeHtml(item.suggestedResolution),
      status: item.status,
      actions: primaryEvent ? `<div class="row-actions"><button type="button" class="secondary" data-edit-event="${escapeHtml(primaryEvent.id)}">Edit Event</button><button type="button" class="secondary" data-event-report="${escapeHtml(primaryEvent.id)}">Report</button></div>` : ""
    };
  });
  renderTable("issueTable", columns, rows);
}

function showIssuesForEvent(eventId) {
  setActiveView("issues");
  renderIssueTable();
  document.querySelectorAll("#issueTable tr.conflict-row-highlight").forEach((row) => row.classList.remove("conflict-row-highlight"));
  const matches = [...document.querySelectorAll("#issueTable tr[data-issue-events]")].filter((row) => row.dataset.issueEvents.split(" ").includes(eventId));
  matches.forEach((row) => row.classList.add("conflict-row-highlight"));
  matches[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderBottlenecks() {
  const rows = computeBottlenecks().filter((item) => item.shortage > 0 || item.conflicts > 0).map((item) => ({
    asset: item.asset,
    assetType: item.assetType,
    conflicts: item.conflicts,
    events: item.events,
    programs: item.programs,
    totalDays: item.totalDays,
    peakDemand: item.peakDemand,
    shortage: item.shortage,
    peakDates: item.peakDates,
    affectedPrograms: item.affectedPrograms,
    action: item.action
  }));
  renderTable("bottleneckTable", ["asset", "assetType", "conflicts", "events", "programs", "totalDays", "peakDemand", "shortage", "peakDates", "affectedPrograms", "action"], rows);
}

function renderReport() {
  const conflicts = state.conflicts.filter(isDoubleBookingConflict);
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
    ${tableMarkup(["asset", "assetType", "conflicts", "events", "peakDemand", "action"], bottlenecks)}
    <h3>Equipment Role Coverage</h3>
    ${tableMarkup(["event", "program", "equipmentRoles"], roleRows)}
    <h3>Event Equipment Review</h3>
    ${tableMarkup(["event", "category", "station", "role", "requirement", "requiredQty", "assignedEquipment", "missing"], equipmentReviewRows)}
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
  const kind = formValue(form, "assetKind") || "asset";
  const isOperator = kind === "operator";
  const isRack = kind === "rack";
  const isDut = kind === "dut";
  const isStation = !isOperator && !isRack && !isDut && form.has("isStation");
  const assetTypes = isOperator ? [TEST_OPERATOR_TYPE] : isDut ? [DUT_TYPE] : isRack ? [RACK_TYPE] : readAssetTypesFromForm(eventObj.currentTarget, true);
  const selectedMemberIds = new Set(formValues(form, "stationGroupMemberIds[]"));
  const requestedRackName = !isOperator && !isRack && !isDut ? formText(form, "stationGroupName") : "";
  const existingRackId = rackIdForName(requestedRackName, current.id);
  const calibrationDueDate = isOperator || isDut || isRack ? "" : formValue(form, "calibrationDueDate");
  if (!isOperator && !isDut && !isRack && !assetTypes.length) {
    renderAssetTypeRequiredWarning(true);
    document.getElementById("asset-typeEntry")?.focus();
    return;
  }
  const next = {
    ...current,
    manufacturer: isOperator || isDut || isRack ? "" : formText(form, "manufacturer"),
    name: formText(form, "name"),
    assetTypes: assetTypes.map((assetType) => rememberEquipmentType(assetType)).filter(Boolean),
    assetType: rememberEquipmentType(assetTypes[0] || ""),
    stationGroupId: !isDut && !isRack ? existingRackId : "",
    quantity: 1,
    serialNumber: isOperator || isRack ? "" : formText(form, "serialNumber"),
    owner: formText(form, "owner"),
    status: formValue(form, "status") || "Available",
    calibrationRequired: !isOperator && !isDut && !isRack && (form.has("calibrationRequired") || Boolean(calibrationDueDate)),
    calibrationDueDate,
    allowMultiRoleUse: !isOperator && !isDut && !isRack && form.has("allowMultiRoleUse"),
    imagePath: isOperator || isDut || isRack ? "" : formText(form, "imagePath"),
    imageData: isOperator || isDut || isRack ? "" : formValue(form, "imageData"),
    capabilities: isOperator || isDut || isRack ? "" : formText(form, "capabilities"),
    notes: formText(form, "notes"),
    dutType: isDut ? formText(form, "dutType") : "",
    isStation,
    isRack,
    isOperator,
    isDut
  };
  const duplicateMatches = assetDuplicateMatches(next, current.id);
  if (duplicateMatches.length && !confirm(`${assetDuplicateWarningText(duplicateMatches)}\n\nSave this asset anyway?`)) return;
  if (requestedRackName && !next.stationGroupId) {
    next.stationGroupId = createRack(requestedRackName, { owner: next.owner, reservedAssetId: next.id }).id;
  }
  if (isDut && next.dutType) {
    const dependencies = readDutDependenciesFromForm(eventObj.currentTarget).map((dependency) => ({
      ...dependency,
      assetType: rememberEquipmentType(dependency.assetType)
    })).filter((dependency) => dependency.assetType);
    state.settings.dutTypeDependencies = {
      ...(state.settings.dutTypeDependencies || {}),
      [next.dutType]: dependencies
    };
  }
  const index = state.assets.findIndex((item) => item.id === next.id);
  if (index >= 0) state.assets[index] = next;
  else state.assets.push(next);
  state.assets = state.assets.map((assetItem) => {
    if (assetItem.id === next.id) return next;
    const canBeGroupMember = !assetItem.isRack && !assetItem.isOperator && !assetItem.isDut;
    if (next.isRack && canBeGroupMember) {
      if (selectedMemberIds.has(assetItem.id)) return { ...assetItem, stationGroupId: next.id };
      if (assetItem.stationGroupId === next.id) return { ...assetItem, stationGroupId: "" };
    }
    if (!next.isRack && assetItem.stationGroupId === next.id) return { ...assetItem, stationGroupId: "" };
    return assetItem;
  });
  assetDrafts.delete(assetDraftKey(selectedAssetId));
  assetDrafts.delete(assetDraftKey(next.id));
  selectedAssetId = next.id;
  setActiveView("assets");
  refresh();
  closeAssetModal(false);
}

function duplicateAsset(assetId) {
  const sourceIndex = state.assets.findIndex((item) => item.id === assetId);
  const source = state.assets[sourceIndex];
  if (!source) return;
  saveAssetDraftFromForm();
  const shouldAssignPlaceholderSerial = assetUsesSerialNumber(source);
  const next = {
    ...JSON.parse(JSON.stringify(source)),
    id: nextId("A", state.assets),
    imageData: "",
    serialNumber: shouldAssignPlaceholderSerial ? nextUndefinedSerial() : ""
  };
  state.assets.splice(sourceIndex + 1, 0, next);
  selectedAssetId = next.id;
  assetDrafts.delete(assetDraftKey(next.id));
  setActiveView("assets");
  try {
    refresh();
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    state.assets = state.assets.filter((item) => item.id !== next.id);
    selectedAssetId = source.id;
    refresh();
    alert("The asset could not be duplicated because browser storage is full. Remove one or more asset pictures, export a backup, or start a smaller plan before duplicating.");
    return;
  }
  openAssetModal();
  document.getElementById("asset-serialNumber")?.focus();
}

function deleteAssetById(deletedAssetId) {
  state.assets = state.assets.filter((item) => item.id !== deletedAssetId).map((assetItem) => ({
    ...assetItem,
    stationGroupId: assetItem.stationGroupId === deletedAssetId ? "" : assetItem.stationGroupId
  }));
  state.testEvents = state.testEvents.map((testEvent) => {
    const operatorAssetIds = operatorIdsForEvent(testEvent).filter((assetId) => assetId !== deletedAssetId);
    return {
      ...testEvent,
      stationAssetId: testEvent.stationAssetId === deletedAssetId ? "" : testEvent.stationAssetId,
      stationGroupId: testEvent.stationGroupId === deletedAssetId ? "" : testEvent.stationGroupId,
      operatorAssetId: operatorAssetIds[0] || "",
      operatorAssetIds,
      requiredAssetIds: (testEvent.requiredAssetIds || []).filter((assetId) => assetId !== deletedAssetId),
      equipmentRoles: (testEvent.equipmentRoles || []).map((role) => ({
        ...role,
        assignedAssetIds: (role.assignedAssetIds || []).filter((assetId) => assetId !== deletedAssetId)
      }))
    };
  });
  selectedAssetId = "";
  refresh();
}

function deleteEventById(eventId) {
  state.testEvents = state.testEvents.filter((item) => item.id !== eventId);
  eventDrafts.delete(eventDraftKey(eventId));
  if (inspectedEventId === eventId) inspectedEventId = "";
  selectedEventId = "";
  refresh();
}

function handleEventSubmit(eventObj) {
  eventObj.preventDefault();
  eventObj.stopPropagation();
  const form = new FormData(eventObj.currentTarget);
  const current = state.testEvents.find((item) => item.id === formValue(form, "id")) || emptyEvent();
  const validAssetIds = new Set(state.assets.map((item) => item.id));
  const stationIds = new Set(state.assets.filter((item) => item.isStation).map((item) => item.id));
  const operatorIds = new Set(state.assets.filter((item) => item.isOperator).map((item) => item.id));
  const eventCategory = EVENT_CATEGORIES.includes(formValue(form, "eventCategory")) ? formValue(form, "eventCategory") : "Test";
  const uut = formText(form, "uut");
  const equipmentRoles = eventUsesEquipment(eventCategory) ? applyDutDependenciesToRoles(readEquipmentRolesFromForm(), dutTypeForUut(eventUsesUut(eventCategory) ? uut : "")).map((role) => ({
    ...role,
    assetType: rememberEquipmentType(role.assetType),
    label: rememberEquipmentType(role.assetType) || role.label,
    assignedAssetIds: (role.assignedAssetIds || []).filter((assetId) => validAssetIds.has(assetId)).slice(0, Math.max(1, Number(role.quantity) || 1))
  })).filter((role) => role.label || role.assetType || role.assignedAssetIds.length) : [];
  const assignedAssetIds = equipmentRoles.flatMap((role) => role.assignedAssetIds);
  const stationAssetId = stationIds.has(formValue(form, "stationAssetId")) ? formValue(form, "stationAssetId") : "";
  const rackIds = new Set(state.assets.filter((item) => item.isRack).map((item) => item.id));
  const stationGroupId = eventUsesEquipment(eventCategory) && rackIds.has(formValue(form, "stationGroupId")) ? formValue(form, "stationGroupId") : "";
  const operatorAssetIds = selectedOperatorIdsFromForm(form, operatorIds);
  const startDate = formValue(form, "startDate");
  const endDate = formValue(form, "endDate");
  const program = formText(form, "program");
  const next = {
    ...current,
    name: formText(form, "name"),
    eventCategory,
    program,
    uut: eventUsesUut(eventCategory) ? uut : "",
    testType: eventCategory === "Test" ? formText(form, "testType") : "",
    startDate: startDate <= endDate ? startDate : endDate,
    endDate: endDate >= startDate ? endDate : startDate,
    stationAssetId,
    stationGroupId,
    operatorAssetId: operatorAssetIds[0] || "",
    operatorAssetIds,
    equipmentRoles,
    requiredAssetIds: uniqueIds([stationAssetId, ...operatorAssetIds, ...assignedAssetIds]),
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
    const stationItem = assetsById.get(testEvent.stationAssetId);
    const station = stationItem ? assetDisplayName(stationItem) : "No station";
    if (!eventUsesEquipment(testEvent.eventCategory || "Test")) {
      return [{
        event: testEvent.name,
        category: testEvent.eventCategory,
        station,
        role: "Station unavailable",
        requirement: "",
        requiredQty: 1,
        assignedEquipment: station,
        missing: station === "No station" ? 1 : 0
      }];
    }
    const roles = testEvent.equipmentRoles || [];
    if (!roles.length) {
      return [{
        event: testEvent.name,
        category: testEvent.eventCategory || "Test",
        station,
        role: "No equipment roles",
        requirement: "",
        requiredQty: 0,
        assignedEquipment: "",
        missing: 0
      }];
    }
    return roles.map((role) => {
      const requiredQty = Math.max(1, Number(role.quantity) || 1);
      const assigned = (role.assignedAssetIds || []).map((assetId) => assetsById.get(assetId) ? assetDisplayName(assetsById.get(assetId)) : assetId);
      return {
        event: testEvent.name,
        category: "Test",
        station,
        role: role.label || role.assetType || "Equipment role",
        requirement: role.requirements || "",
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

function planJson() {
  return JSON.stringify(state, null, 2);
}

function defaultPlanFilename() {
  return planFileName || `testops-plan-${dateISO(new Date())}.json`;
}

async function saveJson() {
  saveState();
  const filename = defaultPlanFilename();
  const content = planJson();
  if ("showSaveFilePicker" in window) {
    try {
      if (!planFileHandle && canUseStoredPlanFileHandle) {
        planFileHandle = await readStoredPlanFileHandle();
        if (planFileHandle?.name) planFileName = planFileHandle.name;
      }
      if (planFileHandle && !(await ensurePlanFilePermission(planFileHandle))) {
        await forgetPlanFileHandle(false);
      }
      if (!planFileHandle) {
        planFileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "TestOps JSON plan",
              accept: { "application/json": [".json"] }
            }
          ]
        });
      }
      await writeJsonFile(planFileHandle, content);
      planFileName = planFileHandle.name || filename;
      canUseStoredPlanFileHandle = true;
      await storePlanFileHandle(planFileHandle);
      showSaveJsonFeedback("Saved");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      await forgetPlanFileHandle(false);
      alert(`Could not save JSON directly: ${error.message}`);
      return;
    }
  }
  planFileName = filename;
  download(filename, content, "application/json");
  showSaveJsonFeedback("Downloaded");
}

async function ensurePlanFilePermission(fileHandle) {
  if (!fileHandle?.queryPermission || !fileHandle?.requestPermission) return true;
  const options = { mode: "readwrite" };
  if (await fileHandle.queryPermission(options) === "granted") return true;
  return await fileHandle.requestPermission(options) === "granted";
}

async function writeJsonFile(fileHandle, content) {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function showSaveJsonFeedback(text) {
  const button = document.getElementById("saveJsonBtn");
  if (!button) return;
  clearTimeout(saveJsonFeedbackTimer);
  button.textContent = text;
  saveJsonFeedbackTimer = setTimeout(() => {
    button.textContent = "Save JSON";
  }, 1600);
}

function openPlanFileDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PLAN_FILE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PLAN_FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredPlanFileHandle() {
  if (!("indexedDB" in window)) return null;
  try {
    const db = await openPlanFileDb();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PLAN_FILE_STORE, "readonly");
      const request = transaction.objectStore(PLAN_FILE_STORE).get(LAST_PLAN_FILE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

async function storePlanFileHandle(fileHandle) {
  if (!("indexedDB" in window)) return;
  try {
    const db = await openPlanFileDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PLAN_FILE_STORE, "readwrite");
      transaction.objectStore(PLAN_FILE_STORE).put(fileHandle, LAST_PLAN_FILE_KEY);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch {
    // Remembering the handle is a convenience; the active save still succeeded.
  }
}

async function forgetPlanFileHandle(allowStoredHandle = false) {
  planFileHandle = null;
  canUseStoredPlanFileHandle = allowStoredHandle;
  if (!("indexedDB" in window)) return;
  try {
    const db = await openPlanFileDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PLAN_FILE_STORE, "readwrite");
      transaction.objectStore(PLAN_FILE_STORE).delete(LAST_PLAN_FILE_KEY);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch {
    // Best effort only; in-memory state is already cleared.
  }
}

function exportCsv(kind) {
  const assetsById = byId(state.assets);
  const roleText = (testEvent) => (testEvent.equipmentRoles || []).map((role) => {
    const assigned = (role.assignedAssetIds || []).map((id) => assetsById.get(id) ? assetOptionLabel(assetsById.get(id)) : id).join(" + ") || "unassigned";
    const requirement = role.requirements ? ` / ${role.requirements}` : "";
    return `${role.label || role.assetType || "Equipment"} (${role.assetType || "any"}${requirement} x${role.quantity || 1}): ${assigned}`;
  }).join("; ");
  const datasets = {
    assets: state.assets.map(({ imageData, ...assetItem }) => ({ ...assetItem, assetTypes: assetTypeText(assetItem), rack: stationGroupLabel(assetItem.stationGroupId, assetsById), hasPicture: assetImageSource({ ...assetItem, imageData }) ? "Yes" : "No" })),
    events: state.testEvents.map(({ stationGroupId, operatorAssetId, operatorAssetIds, ...item }) => ({ ...item, rack: stationGroupLabel(stationGroupId, assetsById), operators: operatorNamesForEvent({ ...item, operatorAssetId, operatorAssetIds }, assetsById), equipmentRoles: roleText(item), requiredAssets: fullAssetIds({ ...item, stationGroupId, operatorAssetId, operatorAssetIds }).map((id) => assetsById.get(id) ? assetOptionLabel(assetsById.get(id)) : id).join("; ") })),
    conflicts: state.conflicts.filter(isDoubleBookingConflict),
    issues: issueCsvRows(assetsById),
    calibration: calibrationDueCsvRows(),
    bottlenecks: computeBottlenecks(),
    schedule: getGanttEvents()
  };
  const rows = datasets[kind] || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  download(`testops-${kind}-${dateISO(new Date())}.csv`, csv, "text/csv");
}

function calibrationDueCsvRows() {
  return calibrationDueRows().map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    serial: item.serial,
    rack: item.rack,
    assetStatus: item.status,
    calibrationDueDate: item.calibrationDueDate,
    daysUntilDue: item.daysUntil,
    dueStatus: item.dueStatus,
    owner: item.owner
  }));
}

function issueCsvRows(assetsById = byId(state.assets)) {
  const eventsById = byId(state.testEvents);
  return state.conflicts.filter(isPlanningIssue).map((item) => {
    const events = (item.eventIds || []).map((eventId) => eventsById.get(eventId)).filter(Boolean);
    const assetItem = item.assetId ? assetsById.get(item.assetId) : null;
    return {
      id: item.id,
      type: item.conflictType,
      eventIds: (item.eventIds || []).join("; "),
      events: (item.eventIds || []).map((eventId) => eventsById.get(eventId)?.name || eventId).join("; "),
      categories: unique(events.map((eventItem) => eventItem.eventCategory || "Test")).join("; "),
      programs: (item.programs || []).join("; "),
      uut: item.uut || unique(events.map((eventItem) => eventItem.uut)).join("; "),
      startDate: item.startDate,
      endDate: item.endDate,
      item: assetItem ? assetOptionLabel(assetItem) : item.uut || "Equipment role",
      severity: item.severity,
      explanation: item.explanation,
      suggestedResolution: item.suggestedResolution,
      status: item.status
    };
  });
}

function exportEventReport(eventId) {
  const testEvent = state.testEvents.find((item) => item.id === eventId);
  if (!testEvent) return;
  const assetsById = byId(state.assets);
  const station = assetsById.get(testEvent.stationAssetId);
  const rack = assetsById.get(testEvent.stationGroupId);
  const operators = operatorNamesForEvent(testEvent, assetsById, "No operator assigned");
  const conflicts = state.conflicts.filter((conflict) => (conflict.eventIds || []).includes(testEvent.id));
  const doubleBookingConflicts = conflicts.filter(isDoubleBookingConflict);
  const planningIssues = conflicts.filter(isPlanningIssue);
  const roleRows = (testEvent.equipmentRoles || []).flatMap((role) => {
    const quantity = Math.max(1, Number(role.quantity) || 1);
    const assignments = [...(role.assignedAssetIds || []), ...Array.from({ length: Math.max(0, quantity - (role.assignedAssetIds || []).length) }, () => "")].slice(0, quantity);
    return assignments.map((assetId, index) => {
      const assetItem = assetsById.get(assetId);
      const allocation = assetId ? assetAllocation(assetId, testEvent.startDate, testEvent.endDate, testEvent.id) : null;
      return {
        role: role.label || role.assetType || "Equipment role",
        type: role.assetType || "Any type",
        requirement: role.requirements || "",
        rationale: role.rationale || "",
        slot: index + 1,
        asset: assetItem ? assetOptionLabel(assetItem) : "Unassigned",
        status: assetItem?.status || "",
        calibration: assetItem?.calibrationRequired ? assetItem.calibrationDueDate || "Required" : "Not required",
        allocation: allocation?.label || "Unassigned"
      };
    });
  });
  const body = `
    <section class="hero">
      <p>${escapeHtml(testEvent.id)} / ${escapeHtml(testEvent.eventCategory || "Test")}</p>
      <h1>${escapeHtml(testEvent.name || "Untitled event")}</h1>
      <dl>
        ${reportDetail("Program", testEvent.program)}
        ${eventUsesUut(testEvent.eventCategory || "Test") ? reportDetail(eventUutLabel(testEvent.eventCategory || "Test"), testEvent.uut) : ""}
        ${reportDetail("Dates", `${testEvent.startDate} to ${testEvent.endDate}`)}
        ${reportDetail("Station", station ? assetOptionLabel(station) : "No station assigned")}
        ${eventUsesEquipment(testEvent.eventCategory || "Test") ? reportDetail("Rack", rack ? assetDisplayName(rack) : "No rack assigned") : ""}
        ${reportDetail("Test Operators", operators)}
        ${reportDetail("Priority", testEvent.priority)}
        ${reportDetail("Owner", testEvent.owner)}
      </dl>
    </section>
    <h2>Required Equipment Roles</h2>
    ${tableMarkup(["role", "type", "requirement", "rationale", "slot", "asset", "status", "calibration", "allocation"], roleRows)}
    <h2>Allocated Assets</h2>
    ${assetInventoryCards(uniqueIds([testEvent.stationAssetId, testEvent.stationGroupId, ...operatorIdsForEvent(testEvent), ...roleAssetIds(testEvent)]).map((assetId) => assetsById.get(assetId)).filter(Boolean))}
    <h2>Resource Conflicts</h2>
    ${reportIssueList(doubleBookingConflicts)}
    <h2>Planning Issues</h2>
    ${reportIssueList(planningIssues)}
    ${testEvent.notes ? `<h2>Notes</h2><p>${escapeHtml(testEvent.notes)}</p>` : ""}
  `;
  const title = `${testEvent.name || "Event"} Report`;
  currentEventReport = {
    filename: `testops-event-report-${safeFilename(testEvent.id || testEvent.name)}-${dateISO(new Date())}.html`,
    html: standaloneReportHtml(title, body),
    title
  };
  openEventReportViewer();
}

function openEventReportViewer() {
  if (!currentEventReport) return;
  const modalEl = document.getElementById("eventReportViewer");
  const titleEl = document.getElementById("eventReportViewerTitle");
  const frameEl = document.getElementById("eventReportFrame");
  if (titleEl) titleEl.textContent = currentEventReport.title;
  if (frameEl) frameEl.srcdoc = currentEventReport.html;
  if (modalEl) modalEl.hidden = false;
}

function closeEventReportViewer() {
  const modalEl = document.getElementById("eventReportViewer");
  const frameEl = document.getElementById("eventReportFrame");
  if (modalEl) modalEl.hidden = true;
  if (frameEl) frameEl.srcdoc = "";
}

function printCurrentEventReport() {
  const frameEl = document.getElementById("eventReportFrame");
  frameEl?.contentWindow?.focus();
  frameEl?.contentWindow?.print();
}

function saveCurrentEventReport() {
  if (!currentEventReport) return;
  download(currentEventReport.filename, currentEventReport.html, "text/html");
}

function exportAssetsHtml() {
  const assetTypeFilter = value("assetTypeFilter");
  const categoryFilter = value("assetCategoryFilter");
  const searchFilter = value("assetSearchFilter");
  const categoryLabel = assetCategoryLabel(categoryFilter);
  const assetsById = byId(state.assets);
  const assets = state.assets.filter((item) => assetMatchesType(item, assetTypeFilter) && assetMatchesCategory(item, categoryFilter) && assetMatchesSearch(item, searchFilter, assetsById));
  const body = `
    <section class="hero">
      <p>TestOps Planner</p>
      <h1>${categoryFilter ? categoryLabel : "Asset Inventory"}</h1>
      <dl>
        ${reportDetail("Assets", assets.length)}
        ${reportDetail("View", categoryLabel)}
        ${reportDetail("Type Filter", assetTypeFilter || "All types")}
        ${reportDetail("Search", searchFilter || "None")}
        ${reportDetail("Generated", new Date().toLocaleString())}
      </dl>
    </section>
    ${assetInventoryCards(assets)}
  `;
  download(`testops-asset-inventory-${dateISO(new Date())}.html`, standaloneReportHtml("Asset Inventory", body), "text/html");
}

function assetInventoryCards(assets) {
  if (!assets.length) return document.getElementById("emptyState").innerHTML;
  const assetsById = byId(state.assets);
  return `<div class="asset-report-grid">${assets.map((assetItem) => `
    <article class="asset-report-card">
      <div class="asset-report-image">${assetImageMarkup(assetItem, `${assetItem.name} picture`)}</div>
      <div>
        <h2>${escapeHtml(assetDisplayName(assetItem) || assetItem.id)}</h2>
        <dl>
          ${reportDetail("ID", assetItem.id)}
          ${reportDetail("Manufacturer", assetItem.manufacturer)}
          ${reportDetail("Type", assetTypeText(assetItem))}
          ${reportDetail("Serial", assetItem.serialNumber)}
          ${reportDetail("Status", assetItem.status)}
          ${reportDetail("Owner", assetItem.owner)}
          ${reportDetail("Calibration", assetItem.calibrationRequired ? assetItem.calibrationDueDate || "Required" : "Not required")}
          ${reportDetail("Station", assetItem.isStation ? "Yes" : "No")}
          ${reportDetail("DUT", assetItem.isDut ? "Yes" : "No")}
          ${reportDetail("Rack", assetItem.isRack ? `${stationGroupAssets(assetItem.id).length} members` : stationGroupLabel(assetItem.stationGroupId, assetsById))}
          ${reportDetail("Test Operator", assetItem.isOperator ? "Yes" : "No")}
        </dl>
        ${assetItem.capabilities ? `<p>${escapeHtml(assetItem.capabilities)}</p>` : ""}
        ${assetItem.notes ? `<p>${escapeHtml(assetItem.notes)}</p>` : ""}
      </div>
    </article>
  `).join("")}</div>`;
}

function reportIssueList(issues) {
  if (!issues.length) return `<p class="muted">None.</p>`;
  return `<ul class="issue-list">${issues.map((issue) => `<li><strong>${escapeHtml(issue.conflictType)}</strong> ${escapeHtml(issue.explanation)} <em>${escapeHtml(issue.suggestedResolution)}</em></li>`).join("")}</ul>`;
}

function reportDetail(label, valueText) {
  const displayValue = valueText === undefined || valueText === null || valueText === "" ? "Not set" : valueText;
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(displayValue)}</dd></div>`;
}

function standaloneReportHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { max-width: 100%; overflow-x: hidden; }
    body { color: #1f2933; font-family: Arial, sans-serif; margin: 24px; }
    h1, h2 { margin: 0 0 12px; }
    h2 { border-bottom: 1px solid #d8dee4; font-size: 18px; padding-bottom: 6px; }
    .hero { border-bottom: 3px solid #246b5d; margin-bottom: 24px; padding-bottom: 16px; }
    .hero p, .muted { color: #667085; font-weight: 700; margin: 0 0 6px; }
    dl { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; }
    dt { color: #667085; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    dd { margin: 0; overflow-wrap: anywhere; }
    table { border-collapse: collapse; margin-bottom: 22px; table-layout: fixed; width: 100%; }
    th, td { border: 1px solid #d8dee4; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; padding: 7px; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #f4f7f6; }
    tbody tr:nth-child(even) td { background: #f8faf8; }
    tbody tr:nth-child(odd) td { background: #fff; }
    .asset-report-grid { display: grid; gap: 14px; }
    .asset-report-card { border: 1px solid #d8dee4; border-radius: 8px; display: grid; gap: 14px; grid-template-columns: minmax(120px, 180px) minmax(0, 1fr); padding: 12px; break-inside: avoid; max-width: 100%; }
    .asset-report-image { align-items: center; background: #f7f9fb; border: 1px solid #d8dee4; border-radius: 6px; display: flex; justify-content: center; min-height: 130px; overflow: hidden; }
    .asset-report-image img { height: 100%; max-height: 170px; max-width: 100%; object-fit: contain; }
    .asset-report-image span { color: #667085; }
    .issue-list { display: grid; gap: 8px; padding-left: 20px; }
    .issue-list em { color: #667085; display: block; }
    @media (max-width: 760px) {
      body { margin: 14px; }
      dl { grid-template-columns: 1fr; }
      .asset-report-card { grid-template-columns: 1fr; }
    }
    @media print { body { margin: 18px; } }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function safeFilename(text) {
  return String(text || "report").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";
}

function csvCell(valueCell) {
  const text = Array.isArray(valueCell) ? valueCell.join("; ") : String(valueCell ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
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
      forgetPlanFileHandle(false);
      planFileName = file.name || "";
      assetDrafts.clear();
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
    compressAssetImage(imageData).then(setAssetImageData);
  };
  reader.readAsDataURL(file);
}

function setAssetImageData(imageData) {
  const inputEl = document.getElementById("asset-imageData");
  const pathEl = document.getElementById("asset-imagePath");
  const previewEl = document.getElementById("assetImagePreview");
  const removeBtn = document.getElementById("removeAssetImageBtn");
  if (pathEl) pathEl.value = "";
  if (inputEl) inputEl.value = imageData;
  if (previewEl) previewEl.innerHTML = assetImageMarkup({ imageData }, "Asset image preview");
  if (removeBtn) removeBtn.disabled = false;
  saveAssetDraftFromForm();
}

function updateAssetImagePath() {
  const pathEl = document.getElementById("asset-imagePath");
  const inputEl = document.getElementById("asset-imageData");
  const previewEl = document.getElementById("assetImagePreview");
  const removeBtn = document.getElementById("removeAssetImageBtn");
  const imagePath = pathEl?.value.trim() || "";
  if (inputEl && imagePath) inputEl.value = "";
  if (previewEl) previewEl.innerHTML = assetImageMarkup({ imagePath }, "Asset image preview");
  if (removeBtn) removeBtn.disabled = !imagePath && !inputEl?.value;
  saveAssetDraftFromForm();
}

function compressAssetImage(imageData) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 520;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(imageData);
        return;
      }
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve(imageData);
    img.src = imageData;
  });
}

function imageFileFromItems(items = []) {
  return [...items].map((item) => item.kind === "file" ? item.getAsFile() : null).find((file) => file?.type.startsWith("image/"));
}

function setAssetDropActive(isActive) {
  document.getElementById("assetImagePreview")?.classList.toggle("drag-active", isActive);
}

function removeAssetImage() {
  const inputEl = document.getElementById("asset-imageData");
  const pathEl = document.getElementById("asset-imagePath");
  const fileEl = document.getElementById("asset-imageFile");
  const previewEl = document.getElementById("assetImagePreview");
  const removeBtn = document.getElementById("removeAssetImageBtn");
  if (inputEl) inputEl.value = "";
  if (pathEl) pathEl.value = "";
  if (fileEl) fileEl.value = "";
  if (previewEl) previewEl.innerHTML = assetImageMarkup({ imageData: "" }, "Asset image preview");
  if (removeBtn) removeBtn.disabled = true;
  saveAssetDraftFromForm();
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
  saveAssetDraftFromForm();
}

function removeAssetType(assetType) {
  [...document.querySelectorAll('input[name="assetTypes[]"]')].find((inputEl) => inputEl.value === assetType)?.closest(".asset-type-chip")?.remove();
  renderAssetDuplicateWarning();
  saveAssetDraftFromForm();
}

function readAssetCandidateFromForm(formEl = document.getElementById("assetForm")) {
  if (!formEl) return {};
  const form = new FormData(formEl);
  const isOperator = formValue(form, "assetKind") === "operator";
  const isDut = formValue(form, "assetKind") === "dut";
  const isRack = formValue(form, "assetKind") === "rack";
  const assetTypes = isOperator ? [TEST_OPERATOR_TYPE] : isDut ? [DUT_TYPE] : isRack ? [RACK_TYPE] : readAssetTypesFromForm(formEl, true);
  return {
    id: formValue(form, "id"),
    manufacturer: isOperator || isDut || isRack ? "" : formText(form, "manufacturer"),
    name: formText(form, "name"),
    assetTypes,
    assetType: assetTypes[0] || "",
    serialNumber: isOperator || isRack ? "" : formText(form, "serialNumber")
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
  if (["operator", "dut", "rack"].includes(formValue(new FormData(formEl), "assetKind"))) {
    warningEl.hidden = true;
    document.querySelector(".asset-type-editor")?.classList.remove("field-error");
    return;
  }
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
  if (eventObj.target.closest("[data-close-event-report]")) {
    closeEventReportViewer();
    return;
  }
  if (eventObj.target.closest("[data-close-rack-import]")) {
    closeStationGroupImportConfirmation();
    return;
  }
  if (eventObj.target.closest("[data-close-delete-confirm]")) {
    closeDeleteConfirmation();
    return;
  }
  if (eventObj.target.closest("[data-close-conflict-resolver]")) {
    closeConflictResolver();
    return;
  }
  if (inspectedEventId && activeView === "schedule" && !eventObj.target.closest("#eventInspector") && !eventObj.target.closest("[data-inspect-event]") && !eventObj.target.closest("#eventModal")) {
    inspectedEventId = "";
    renderGantt();
    renderEventInspector();
  }
  const rackOption = eventObj.target.closest("[data-rack-option]");
  if (rackOption) {
    selectRackOption(rackOption.dataset.rackOption);
    return;
  }
  if (eventObj.target.closest("[data-toggle-rack-options]")) {
    const list = document.getElementById("asset-rack-options");
    setRackOptionsOpen(Boolean(list?.hidden));
    return;
  }
  if (!eventObj.target.closest("[data-rack-combobox]")) setRackOptionsOpen(false);
  const target = eventObj.target.closest("button");
  if (!target) return;
  if (target.type === "submit" && target.closest("form")) return;
  if (target.dataset.viewAssetImage) {
    const assetItem = state.assets.find((item) => item.id === target.dataset.viewAssetImage);
    openImageViewer(assetImageSource(assetItem), assetItem?.name || "Asset Picture");
  }
  if (target.dataset.previewCurrentAssetImage !== undefined) {
    const form = new FormData(document.getElementById("assetForm"));
    openImageViewer(formText(form, "imagePath") || formValue(form, "imageData"), formValue(form, "name") || "Asset Picture");
  }
  if (target.dataset.inspectEvent) {
    inspectedEventId = target.dataset.inspectEvent;
    renderGantt();
    renderEventInspector();
  }
  if (target.dataset.eventReport) {
    exportEventReport(target.dataset.eventReport);
  }
  if (target.id === "printEventReportBtn") {
    printCurrentEventReport();
  }
  if (target.id === "saveEventReportBtn") {
    saveCurrentEventReport();
  }
  if (target.dataset.closeEventInspector !== undefined) {
    inspectedEventId = "";
    renderGantt();
    renderEventInspector();
  }
  if (target.dataset.view) {
    setActiveView(target.dataset.view);
  }
  if (target.dataset.viewConflictsFor) {
    showConflictsForEvent(target.dataset.viewConflictsFor);
  }
  if (target.dataset.viewIssuesFor) {
    showIssuesForEvent(target.dataset.viewIssuesFor);
  }
  if (target.dataset.resolveConflict) {
    openConflictResolver(target.dataset.resolveConflict);
  }
  if (target.id === "sampleBtn") {
    state = structuredClone(sampleData);
    selectedAssetId = "";
    selectedEventId = "";
    inspectedEventId = "";
    planFileName = "";
    forgetPlanFileHandle(false);
    assetDrafts.clear();
    eventDrafts.clear();
    refresh();
  }
  if (target.id === "newPlanBtn" && confirm("Start a new blank plan? This will replace the current local plan in this browser.")) {
    state = structuredClone(emptyData);
    selectedAssetId = "";
    selectedEventId = "";
    inspectedEventId = "";
    planFileName = "";
    forgetPlanFileHandle(false);
    assetDrafts.clear();
    eventDrafts.clear();
    refresh();
  }
  if (target.id === "saveJsonBtn") saveJson();
  if (target.id === "exportJsonBtn") exportJson();
  if (target.id === "addAssetBtn" || target.id === "addAssetFloatingBtn") {
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
  if (target.id === "addDutDependencyBtn") {
    addDutDependency();
  }
  if (target.dataset.removeDutDependency) {
    removeDutDependency(Number(target.dataset.removeDutDependency));
  }
  if (target.id === "addRackMemberBtn") {
    addRackMember();
  }
  if (target.dataset.removeRackMember) {
    removeRackMember(target.dataset.removeRackMember);
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
  if (target.id === "importStationGroupBtn") {
    const stationGroupId = value("event-stationGroupImportId");
    if (stationGroupId) openStationGroupImportConfirmation(stationGroupId);
  }
  if (target.dataset.rackImportMode) {
    if (pendingRackImportId) applyStationGroupToEventForm(pendingRackImportId, target.dataset.rackImportMode);
    closeStationGroupImportConfirmation();
  }
  if (target.dataset.confirmDelete !== undefined) {
    confirmPendingDelete();
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
    eventObj.preventDefault();
    eventObj.stopPropagation();
    duplicateAsset(target.dataset.duplicateAsset);
    return;
  }
  if (target.dataset.deleteAsset) openDeleteConfirmation("asset", target.dataset.deleteAsset);
  if (target.dataset.deleteEvent) openDeleteConfirmation("event", target.dataset.deleteEvent);
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
  if (target.id === "exportAssetsHtmlBtn") exportAssetsHtml();
  if (target.id === "exportCalibrationCsvBtn") exportCsv("calibration");
  if (target.id === "exportEventsCsvBtn") exportCsv("events");
  if (target.id === "exportConflictsCsvBtn") exportCsv("conflicts");
  if (target.id === "exportIssuesCsvBtn") exportCsv("issues");
  if (target.id === "exportBottlenecksCsvBtn") exportCsv("bottlenecks");
  if (target.id === "exportScheduleCsvBtn") exportCsv("schedule");
});

document.getElementById("assetForm").addEventListener("submit", handleAssetSubmit);
document.getElementById("eventForm").addEventListener("submit", handleEventSubmit);

document.addEventListener("keydown", (eventObj) => {
  if ((eventObj.ctrlKey || eventObj.metaKey) && eventObj.key.toLowerCase() === "s") {
    eventObj.preventDefault();
    saveJson();
    return;
  }
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
    closeEventReportViewer();
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

["event-startDate", "event-endDate", "event-stationAssetId", "event-uut"].forEach((id) => {
  document.addEventListener("change", (eventObj) => {
    if (eventObj.target.id === id) {
      if (eventObj.target.id === "event-startDate") syncEventEndDateBounds();
      refreshEventEquipmentRoles();
    }
  });
});

document.addEventListener("change", (eventObj) => {
  if (eventObj.target.id === "assetCategoryFilter") {
    setValue("assetSearchFilter", "");
    clearAssetColumnFilters();
    fillSelect("assetTypeFilter", assetTypeFilterOptions(eventObj.target.value), "All types", "");
    renderAssetTable();
  }
  if (eventObj.target.id === "assetTypeFilter") renderAssetTable();
  if (eventObj.target.dataset.assetColumnFilter) {
    const column = eventObj.target.dataset.assetColumnFilter;
    if (eventObj.target.value) assetColumnFilters[column] = eventObj.target.value;
    else delete assetColumnFilters[column];
    renderAssetTable();
  }
  if (eventObj.target.dataset.conflictColumnFilter) {
    const column = eventObj.target.dataset.conflictColumnFilter;
    if (eventObj.target.value) conflictColumnFilters[column] = eventObj.target.value;
    else delete conflictColumnFilters[column];
    renderConflictTable();
  }
  if (eventObj.target.dataset.eventColumn) {
    const column = eventObj.target.dataset.eventColumn;
    if (eventObj.target.checked) eventHiddenColumns.delete(column);
    else eventHiddenColumns.add(column);
    saveEventHiddenColumns();
    renderEventTable();
  }
});

document.addEventListener("input", (eventObj) => {
  if (eventObj.target.id === "assetSearchFilter") renderAssetTable();
});

document.addEventListener("focusin", (eventObj) => {
  if (eventObj.target.id === "asset-stationGroupName") setRackOptionsOpen(true);
});

document.addEventListener("change", (eventObj) => {
  if (!eventObj.target.closest("#assetForm")) return;
  if (eventObj.target.id === "asset-calibrationDueDate") syncAssetCalibrationRequiredFromDate();
  renderAssetTypeRequiredWarning(false);
  renderAssetDuplicateWarning();
  saveAssetDraftFromForm();
  if (eventObj.target.name === "dutDependencyAssetType[]") {
    const dependencies = readDutDependenciesFromForm();
    renderDutDependenciesFrom(dependencies);
    saveAssetDraftFromForm();
    return;
  }
  if (eventObj.target.id === "asset-dutType") {
    const draft = assetDrafts.get(assetDraftKey(selectedAssetId));
    if (draft) delete draft.dutDependencies;
    renderAssetForm();
  }
  if (eventObj.target.id === "asset-kind") renderAssetForm();
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
  if (eventObj.target.id === "asset-stationGroupName") setRackOptionsOpen(true);
  if (eventObj.target.id === "asset-calibrationDueDate") syncAssetCalibrationRequiredFromDate();
  if (eventObj.target.id === "asset-imagePath") {
    updateAssetImagePath();
    return;
  }
  renderAssetTypeRequiredWarning(false);
  renderAssetDuplicateWarning();
  saveAssetDraftFromForm();
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
