# Product Requirements Document

## TestOps Planner

## 1. Product Purpose

**TestOps Planner** is a lightweight browser-based planning tool for coordinating test events, test assets, stations, UUTs, and programs.

The tool helps users build a test asset inventory, define planned test events, assign required assets to those events, and visualize the schedule in multiple ways to identify conflicts and bottlenecks.

The primary purpose is to answer:

* What test events are planned?
* What assets does each event require?
* Which events overlap?
* Which events are using the same asset at the same time?
* Which stations are overbooked?
* Which UUTs are in test and when?
* Which programs are competing for resources?
* Which equipment is most in demand or most often conflicted?
* Do we need to buy, rent, borrow, or reschedule?

## 2. Product Philosophy

The tool should stay simple.

There are two primary edit areas:

1. **Test Asset Inventory**
2. **Test Events**

Everything else should be a view, report, or analysis derived from those two areas.

The user should not need to maintain separate disconnected schedules, station plans, equipment plans, and program plans. The user should define test events once, assign assets once, and then view the same underlying plan from different perspectives.

## 3. Core Workflow

The expected workflow is:

1. Build or import the test asset inventory.
2. Mark which assets are stations.
3. Define programs and UUTs as needed.
4. Create planned test events.
5. Assign required assets from the inventory to each test event.
6. Assign the event to a program and UUT.
7. Review the schedule/Gantt views.
8. Review conflicts caused by overlapping asset usage.
9. Review most-conflicted or most-in-demand assets.
10. Use the results to deconflict schedules or justify additional equipment purchases.

## 4. Core Data Areas

## 4.1 Test Asset Inventory

The asset inventory is the master list of test resources that can be assigned to test events.

An asset can be:

* Test station
* Test equipment
* Fixture
* Chamber
* Bench
* Software license
* Tooling
* Support equipment
* Facility resource
* Other shared resource

Each asset shall include:

| Field                     | Description                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| Asset ID                  | Unique identifier                                                   |
| Asset Name                | Human-readable name                                                 |
| Asset Type                | Spectrum analyzer, station, power supply, chamber, fixture, etc.    |
| Is Station?               | True/false flag identifying station assets                          |
| Quantity                  | Number available if managed as pooled quantity                      |
| Serial Number / Asset Tag | Optional physical asset identifier                                  |
| Location                  | Where the asset normally resides                                    |
| Owner                     | Responsible person or group                                         |
| Status                    | Available, down, out for calibration, retired, limited use, unknown |
| Shareable?                | Whether asset can be used by multiple events at once                |
| Max Concurrent Uses       | Usually 1, but can be greater for shared resources                  |
| Calibration Required?     | True/false                                                          |
| Calibration Due Date      | Date if applicable                                                  |
| Notes                     | Free text                                                           |

The `Is Station?` field is important because station-based schedule views should be generated from assets flagged as stations.

## 4.2 Test Events

A test event is a planned test activity with a schedule, program, UUT, and assigned assets.

Each test event shall include:

| Field            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| Event ID         | Unique identifier                                               |
| Event Name       | Human-readable name                                             |
| Program          | Program or project associated with the event                    |
| UUT              | Unit under test                                                 |
| Test Type        | ATP, ESS, RF checkout, debug, qual, NFR, EMI, integration, etc. |
| Start Date       | Planned start                                                   |
| End Date         | Planned finish                                                  |
| Assigned Station | Station asset selected from inventory                           |
| Required Assets  | List of assets selected from inventory                          |
| Priority         | Critical, high, medium, low                                     |
| Owner            | Responsible person                                              |
| Status           | Draft, planned, approved, in work, complete, delayed, canceled  |
| Notes            | Free text                                                       |

The assigned station should also be treated as one of the event’s required assets for conflict detection.

## 5. Primary Views

## 5.1 Test Event Schedule View

The tool shall provide a Gantt-style schedule view showing test events over time.

This view should show:

* Test events as horizontal bars
* Event name
* Program
* UUT
* Assigned station
* Start and end dates
* Conflict indicator
* Status
* Priority

Events may be color-coded by program.

This should be the main planning view.

## 5.2 Station Schedule View

The tool shall provide a Gantt-style view grouped by station.

Stations are assets where `Is Station? = true`.

This view should show:

* Each station as a swimlane
* Test events scheduled on that station
* Overlapping station use
* Station conflicts
* Program color coding
* UUT labels if practical

This view answers:

* Which stations are being used?
* When is each station occupied?
* Are two tests scheduled on the same station at the same time?
* Are we station-limited?

## 5.3 Program Schedule View

The tool shall provide a Gantt-style view grouped by program.

This view should show:

* Each program as a swimlane
* Test events belonging to that program
* Event timing
* UUT
* Station
* Conflict indicators
* Program-specific schedule density

This view answers:

* What does each program have planned?
* Which program has the most test demand?
* Which program is affected by resource conflicts?
* Are programs competing for the same assets?

## 5.4 UUT Schedule View

The tool shall provide a Gantt-style view grouped by UUT.

This view should show:

* Each UUT as a swimlane
* Test events involving that UUT
* Station assignment
* Program
* Event sequence
* Overlapping tests on the same UUT

This view answers:

* Where is each UUT scheduled?
* Is the same UUT double-booked?
* What is the test flow for a specific UUT?
* Are UUTs waiting on constrained assets or stations?

## 5.5 Asset Schedule View

The tool shall provide a Gantt-style view grouped by asset.

This view should show:

* Each asset as a swimlane
* Events using that asset
* Overlapping use
* Conflict indicators
* Program and UUT labels

This view answers:

* When is each piece of equipment being used?
* Which assets are double-booked?
* Which equipment is most constrained?
* Where should we buy/rent/borrow more?

## 6. Conflict Detection

## 6.1 Primary Conflict Rule

A conflict exists when two or more test events overlap in time and require the same non-shareable asset.

Date ranges overlap if:

```text
Event A Start <= Event B End
AND
Event B Start <= Event A End
```

If overlapping events use the same asset and that asset has `Max Concurrent Uses = 1`, then the tool shall flag a conflict.

## 6.2 Station Conflict

A station conflict exists when two or more overlapping test events are assigned to the same station and the station’s max concurrent use is exceeded.

## 6.3 UUT Conflict

A UUT conflict exists when two or more overlapping test events use the same UUT and the UUT is not allowed to be in multiple events simultaneously.

## 6.4 Equipment Conflict

An equipment conflict exists when two or more overlapping test events require the same asset and the asset’s max concurrent use is exceeded.

## 6.5 Asset Availability Conflict

The tool should warn when a test event uses an asset that is not available.

Examples:

* Asset status is Down
* Asset status is Out for Calibration
* Asset status is Retired
* Asset status is Unknown
* Calibration due date occurs before the test event ends

## 6.6 Conflict Severity

Conflict severity should be assigned using simple rules.

Suggested default logic:

| Severity | Rule                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| Critical | Conflict involves critical/high-priority test and no obvious spare asset exists |
| High     | Conflict affects scheduled events within next 30 days                           |
| Medium   | Conflict exists but event is lower priority or farther out                      |
| Low      | Warning, soft conflict, or incomplete data                                      |
| Info     | Missing data or planning note                                                   |

## 6.7 Conflict Output

Each conflict should include:

| Field                | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| Conflict ID          | Unique identifier                                           |
| Conflict Type        | Station, equipment, UUT, availability, calibration          |
| Asset or UUT         | The conflicted item                                         |
| Date Range           | Conflict window                                             |
| Events Involved      | Events causing the conflict                                 |
| Programs Involved    | Programs affected                                           |
| Severity             | Critical, high, medium, low, info                           |
| Explanation          | Plain-English reason                                        |
| Suggested Resolution | Reschedule, change asset, buy/rent/borrow, repair/calibrate |
| Status               | Open, in review, resolved, accepted                         |

Example explanation:

> Events T-001 and T-004 both require Spectrum Analyzer SA-001 from July 8 to July 10. SA-001 only supports one concurrent use.

## 7. Bottleneck / Demand Analysis

The tool shall provide a summary of most-used, most-conflicted, and highest-demand assets.

## 7.1 Most Conflicted Assets View

This view should show:

| Field                          | Description                                 |
| ------------------------------ | ------------------------------------------- |
| Asset                          | Asset name                                  |
| Asset Type                     | Equipment/station/fixture/etc.              |
| Number of Conflicts            | Count of conflicts involving this asset     |
| Number of Events               | Number of events using this asset           |
| Number of Programs             | Number of programs needing this asset       |
| Total Scheduled Days           | Total planned use days                      |
| Peak Concurrent Demand         | Maximum simultaneous demand                 |
| Quantity / Max Concurrent Uses | Available capacity                          |
| Suggested Action               | Buy more, rent, borrow, reschedule, monitor |

This view helps answer:

* What equipment is most often causing conflicts?
* What assets should we consider buying more of?
* What assets are heavily used but not yet conflicted?
* Which stations are most overloaded?

## 7.2 Demand vs Capacity

For each asset or asset type, the tool should show:

* Available capacity
* Peak demand
* Shortage amount
* Dates of peak demand
* Affected events
* Affected programs

Example:

| Asset Type        | Available | Peak Demand | Shortage | Peak Dates    |
| ----------------- | --------: | ----------: | -------: | ------------- |
| Spectrum Analyzer |         1 |           3 |        2 | Jul 8–Jul 12  |
| RF Station        |         2 |           2 |        0 | Jul 15–Jul 19 |
| Thermal Chamber   |         1 |           2 |        1 | Aug 1–Aug 5   |

## 8. Recommended MVP Scope

The MVP should include only the core features required to make the tool useful.

## 8.1 MVP Must Have

1. Browser-based, local-first application.
2. No server, no install, no external dependencies.
3. JSON import/export.
4. Test asset inventory editor.
5. Test event editor.
6. Ability to assign assets from inventory to test events.
7. Ability to mark assets as stations.
8. Event Gantt/schedule view.
9. Station Gantt/schedule view.
10. Program Gantt/schedule view.
11. UUT Gantt/schedule view.
12. Conflict detection for overlapping use of the same asset.
13. Conflict detection for overlapping use of the same station.
14. Conflict detection for overlapping use of the same UUT.
15. Conflict report/table.
16. Most-conflicted / most-in-demand assets view.
17. CSV export.
18. Sample data.
19. Clean, beautiful UI suitable for screen sharing.

## 8.2 MVP Should Have

1. Asset status warnings.
2. Calibration due-date warnings.
3. Filtering by program, UUT, station, asset, owner, and date range.
4. Program color coding.
5. Conflict badges on Gantt bars.
6. Print-friendly report view.
7. Simple dashboard cards.

## 8.3 Later Features

Later versions may include:

1. What-if scenarios.
2. Drag-and-drop schedule editing.
3. Test templates.
4. Substitute asset groups.
5. Buy/rent recommendation workflow.
6. Decision register.
7. Assumption register.
8. Risk register lite.
9. Import from MS Project or Excel.
10. SharePoint-friendly workflow guidance.
11. Multi-user workflow or merge support.

## 9. Simplified Data Model

## 9.1 Top-Level JSON Structure

```json
{
  "metadata": {},
  "programs": [],
  "uuts": [],
  "assets": [],
  "testEvents": [],
  "conflicts": [],
  "settings": {}
}
```

## 9.2 Asset Object

```json
{
  "id": "A-001",
  "name": "RF Station 1",
  "assetType": "Station",
  "isStation": true,
  "quantity": 1,
  "assetTag": "ST-001",
  "serialNumber": "",
  "location": "RF Lab",
  "owner": "Test Engineering",
  "status": "Available",
  "shareable": false,
  "maxConcurrentUses": 1,
  "calibrationRequired": false,
  "calibrationDueDate": "",
  "notes": ""
}
```

## 9.3 Test Event Object

```json
{
  "id": "T-001",
  "name": "Avionics RF Checkout",
  "program": "Program Alpha",
  "uut": "UUT-001",
  "testType": "RF Checkout",
  "startDate": "2026-07-08",
  "endDate": "2026-07-12",
  "stationAssetId": "A-001",
  "requiredAssetIds": ["A-001", "A-014", "A-021"],
  "priority": "High",
  "owner": "Test Engineering",
  "status": "Planned",
  "notes": "Requires 10 MHz reference."
}
```

## 9.4 Conflict Object

```json
{
  "id": "C-001",
  "conflictType": "Equipment",
  "assetId": "A-014",
  "uut": "",
  "startDate": "2026-07-08",
  "endDate": "2026-07-10",
  "eventIds": ["T-001", "T-004"],
  "programs": ["Program Alpha", "Program Beta"],
  "severity": "High",
  "explanation": "Two overlapping test events require Spectrum Analyzer SA-001, which supports only one concurrent use.",
  "suggestedResolution": "Reschedule one event or obtain another compatible spectrum analyzer.",
  "status": "Open"
}
```

## 10. View Design Summary

The tool should not require the user to create separate schedules.

The same test event data should power all views:

| View            | Grouping               | Primary Question                                  |
| --------------- | ---------------------- | ------------------------------------------------- |
| Event Schedule  | Events over time       | What tests are planned and where do they overlap? |
| Station View    | Station assets         | Are stations overbooked?                          |
| Program View    | Programs               | What does each program need and when?             |
| UUT View        | UUTs                   | Is a UUT double-booked and what is its test flow? |
| Asset View      | Assets                 | Which equipment is overbooked?                    |
| Bottleneck View | Asset demand/conflicts | What should we buy/rent/borrow?                   |

## 11. Success Criteria

The tool is successful if a user can:

1. Build a usable asset inventory.
2. Define planned test events.
3. Assign inventory assets to test events.
4. See overlapping test events in a Gantt-style view.
5. See station schedules.
6. See program schedules.
7. See UUT schedules.
8. Automatically identify conflicts caused by shared assets.
9. Identify the most conflicted or in-demand assets.
10. Use the output to decide whether to reschedule tests or acquire more equipment.

## 12. Design Guardrails

The first version should avoid becoming a full enterprise scheduling system.

Do not overbuild:

* Advanced workflow
* Formal approvals
* Complex procurement tracking
* Multi-user permissions
* Deep resource optimization
* Enterprise integrations
* Full risk/decision management

The core value is simple:

> Define test events. Assign assets. See conflicts. Plan deconfliction.
