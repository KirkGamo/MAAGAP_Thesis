---
tags: [data-model, table]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Table: monitoring_reports

The ML feedback loop — an Inspector's field report, filed through the Inspector portal, intended to eventually feed back into ml-service retraining.

## Key columns

`project_id`, `inspector_id`, `visited_at`, `status_observed` (`project_status` enum), `percent_complete`, `remarks`, `photo_urls`.

## RLS

Managers read all. Inspectors insert and read only their own rows (`inspector_id = auth.uid()`).

## Not yet wired into retraining

As of this writing, this table is a forward-looking feedback mechanism — the training pipeline ([[../MOC-ML-Pipeline]]) still trains against the historical raw workbook data, not against `monitoring_reports` entries filed through the app. Closing that loop (periodically folding real field reports back into the training population) is a natural next step, not yet implemented.
