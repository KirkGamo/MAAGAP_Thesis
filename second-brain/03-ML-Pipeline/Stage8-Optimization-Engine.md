---
tags: [ml-pipeline, stage, optimization, objective-4]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 8: optimization_engine.py

Objective 4 of the thesis: turns the Level 1 meta-learner's risk scores into an actionable weekly PPDO field-inspector deployment schedule via a constrained integer program, solved with PuLP.

## Why it scores inference.csv, not test.csv

`test.csv` holds *resolved* projects with a known outcome — there's nothing to "reallocate resources" toward for a project that already finished. `inference.csv` holds the currently *ongoing* population, which is the live data PPDO stakeholders actually need monitored. No prior script scored the trained artifacts against `inference.csv`, so `score_ongoing_projects()` adds that missing step, reusing the exact same feature-matrix/scaling/meta-learner logic already validated in the training scripts.

## LP formulation, briefly

Sets: inspectors (I), workdays Mon–Fri (D), High/Critical-risk ongoing projects (P), geographic clusters (C). Binary decision variables: `x[i,p,d]` (inspector i visits project p on day d), `y[i,d,c]` (inspector i assigned to cluster c on day d), `z[i,c]` (inspector i visits cluster c at all that week). Objective: maximize risk-weighted coverage minus a travel-friction penalty on cluster-sprawl. Constraints: each project visited at most once/week, daily/weekly capacity caps per inspector, at most one cluster per inspector per day (the actual mechanism enforcing travel coherence), and `z[i,c] >= y[i,d,c]` so a cluster counts toward the penalty as soon as it's touched once that week.

## Flagged approximation, not verified GIS

`MUNICIPALITY_CLUSTERS` (the "neighboring municipality" groupings used for the travel-friction constraint) is a reasonable first-pass proxy built from Iloilo's commonly recognized sub-regional geography — NOT sourced from an authoritative PSGC/GIS boundary-adjacency dataset or real road-network distances. Treat it the way `fetch_psa_data.py`'s `PRICES_DATASET_ID` is treated: a clearly-flagged placeholder for a domain expert to refine before operational use, not validated ground truth.

## Coverage caveat

Same root cause as the meta-learner's small test-set count — only ongoing projects with both a scoreable tabular row and a matching LSTM sequence get a full score; the rest are excluded from the output with a logged count, not silently scored inconsistently.
