---
tags: [ml-pipeline, stage]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 2: generate_synthetic_data.py

Generates a 150-row synthetic contractor profile table (`data/synthetic/contractor_profiles.csv`) and joins it onto monitoring rows via `contractor_id` (`monitoring_with_contractors.csv`), producing features like `historical_delay_rate`/`reliability_score`/`contractor_spec_*`.

## Why synthetic

There is no real contractor-performance dataset linked to actual PPDO contractors or PhilGEPS procurement records available for this thesis (Chapter 1's declared Data Availability limitation). This stage exercises the join and feature mechanics end-to-end so the modeling pipeline is fully built and demonstrable, without claiming the contractor signal itself is real. See [[../05-Known-Issues/Issue-Synthetic-Contractor-Data]] — this is a limitation to be explicit about, not something to quietly gloss over in the manuscript.

## Run only when raw source data changes

Same cadence as [[Stage1-Preprocess]] — this doesn't need to re-run for ML-methodology-only changes downstream (e.g. [[../02-Decisions/D03-Phase8-Clamp]] didn't touch this stage).
