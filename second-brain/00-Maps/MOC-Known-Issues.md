---
tags: [moc, known-issues]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — Known Issues

Open limitations and caveats, kept visible on purpose so they don't get silently rediscovered or, worse, silently forgotten and misrepresented as resolved. Each is tagged `#open-issue` and links back to the decision or component that produced it.

- [[05-Known-Issues/Issue-Proxy-Date-Dependence|Proxy-date dependence]] — ~94% of the labeled population relies on a recovered, not directly observed, completion date.
- [[05-Known-Issues/Issue-Phase8-Clamp-Artifact|Phase 8 clamp construction artifact]] — 1,260 rows have a RedFlag=0 label that is mechanically forced, not observed.
- [[05-Known-Issues/Issue-LSTM-Low-Precision|LSTM low precision]] — the LSTM base learner is high-recall/low-precision on its own; the meta-learner appears to compensate.
- [[05-Known-Issues/Issue-Synthetic-Contractor-Data|Synthetic contractor data]] — contractor features are active but backed by placeholder data, no real PhilGEPS/PPDO linkage.
- [[05-Known-Issues/Issue-Barangay-Canonicalization|Barangay canonicalization]] — the crosswalk's barangay veto reduces but doesn't eliminate cross-barangay conflation risk.
- [[05-Known-Issues/Issue-Unclassified-Project-Type|Unclassified project type]] — 19.1% of monitoring rows can never be labeled, no defined T_standard.
- [[05-Known-Issues/Issue-Climate-Data-Coverage-Gap|Climate data coverage gap (2025)]] — PAGASA request is capped at Dec 2024; 189 rows (3.66%, split-balanced) keep the coarse wet-season proxy instead of real data.

See [[MOC-Decisions]] for the decisions that created or addressed each of these.
