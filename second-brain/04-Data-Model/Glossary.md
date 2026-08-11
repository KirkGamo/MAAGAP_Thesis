---
tags: [data-model, glossary, reference]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Glossary

Domain and project-specific vocabulary — terms that mean something precise here and would be ambiguous without this note.

- **PPA** — Program/Project/Activity, PPDO's unit of a fundable, trackable government project.
- **PPDO** — Provincial Planning and Development Office (Iloilo Province), the stakeholder this system serves.
- **D_start** — the resolved project start date used in target construction: `DATE RELEASED`, falling back to `DATE MONITORED` when the direct value is missing/unparseable. See [[../02-Decisions/D01-Proxy-Completion-Dates]].
- **T_standard** — the expected duration for a project's type: 365 days (Infrastructure), 182 days (Non-Infrastructure). Undefined (and therefore unlabelable) for `Unclassified` — see [[../05-Known-Issues/Issue-Unclassified-Project-Type]].
- **T_actual** — `Date of Completion − D_start`, the observed/recovered duration.
- **RedFlag** — the binary slippage label: 1 if `T_actual > T_standard` and no weather/environmental extension was recorded in REMARKS, else 0.
- **NegativeSlippage_pct** — `(T_actual − T_standard) / T_standard × 100`, the same signal expressed as a percentage overrun.
- **Proxy completion date** — a completion date recovered from another real recorded event (latest monitoring visit or linked liquidation submission) when no direct `Date of Completion` exists, used only when STATUS confirms completion. See [[../02-Decisions/D01-Proxy-Completion-Dates]].
- **Phase 7 lag correction** — the empirical median-lag subtraction applied to every proxy date to correct its systematic late bias. See [[../02-Decisions/D02-Phase7-Lag-Correction]].
- **Phase 8 clamp** — the narrow fix pinning a lag-corrected proxy date at `D_start + 1 day` when the correction alone (not the raw data) pushed it non-credible. See [[../02-Decisions/D03-Phase8-Clamp]].
- **project_key** — the entity-resolution join key linking a project's Fund Transfer, Liquidation, and Monitoring rows together. See [[../03-ML-Pipeline/Stage1-Preprocess]].
- **Level 0 / Level 1** — the stacking ensemble's two layers: Level 0 = Random Forest, XGBoost, LSTM (base learners); Level 1 = Multinomial Logistic Regression (meta-learner), trained on Level 0's out-of-fold probabilities.
- **OOF (out-of-fold)** — predictions made on a fold a model did NOT train on during cross-validation; used to avoid leaking in-sample confidence into the meta-learner. See [[../02-Decisions/D07-No-Third-Validation-Split]].
- **Risk tier** — the four-bucket discretization of the meta-learner's `P(RedFlag=1)`: Low (0.0–0.3), Medium (0.3–0.7), High (0.7–0.9), Critical (0.9–1.0).
