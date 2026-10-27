# Graph Report - DaylightDDC  (2026-10-26)

## Corpus Check
- 14 files · ~7,659 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 1, .qml 1)

## Summary
- 118 nodes · 223 edges · 10 communities (5 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `25354d5e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- extension.js
- daylight-ddc.py
- Daylight DDC
- Service
- daylight-ddc-macos.py
- install.py
- Changelog
- json
- apply
- install.sh

## God Nodes (most connected - your core abstractions)
1. `Service` - 15 edges
2. `Daylight DDC` - 11 edges
3. `serve()` - 9 edges
4. `main()` - 9 edges
5. `ApproxLocation` - 8 edges
6. `DaylightDDC` - 7 edges
7. `call()` - 6 edges
8. `validate()` - 6 edges
9. `connect()` - 5 edges
10. `read_config()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `read_config()` --calls--> `json`  [EXTRACTED]
  macos/daylight-ddc-macos.py →   _Bridges community 4 → community 7_
- `main()` --calls--> `apply()`  [EXTRACTED]
  macos/daylight-ddc-macos.py → macos/daylight-ddc-macos.py  _Bridges community 8 → community 4_
- `main()` --calls--> `argparse`  [EXTRACTED]
  macos/daylight-ddc-macos.py →   _Bridges community 4 → community 5_
- `main()` --calls--> `validate()`  [EXTRACTED]
  service/daylight-ddc.py → service/daylight-ddc.py  _Bridges community 1 → community 5_
- `save()` --calls--> `json`  [EXTRACTED]
  service/daylight-ddc.py →   _Bridges community 1 → community 7_

## Import Cycles
- None detected.

## Communities (10 total, 5 thin omitted)

### Community 0 - "extension.js"
Cohesion: 0.16
Nodes (9): call(), connect(), NAME, PATH, Proxy, DaylightDDC, DaylightToggle, ApproxLocation (+1 more)

### Community 1 - "daylight-ddc.py"
Cohesion: 0.12
Nodes (11): daylight_curve(), ddc(), detect(), local_solar_time(), minute(), natural_target(), save(), solar_schedule() (+3 more)

### Community 2 - "Daylight DDC"
Cohesion: 0.14
Nodes (13): Architecture, Command line, Configuration, Daylight DDC, Features, Install, Linux, Location and weather (+5 more)

### Community 4 - "daylight-ddc-macos.py"
Cohesion: 0.38
Nodes (7): defaults(), log(), main(), read_config(), save(), scheduled_target(), serve()

### Community 6 - "Changelog"
Cohesion: 0.29
Nodes (6): 0.1.0 — 2026-10-06, 0.2.0 — 2026-10-13, Changelog, Known limitations, Known limitations, Unreleased

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Service` connect `Service` to `daylight-ddc.py`, `install.py`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Should `daylight-ddc.py` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Why does `solar_schedule()` connect `daylight-ddc.py` to `Service`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Should `Daylight DDC` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._