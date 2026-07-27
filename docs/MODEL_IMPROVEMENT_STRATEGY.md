# MAAGAP Model Improvement Strategy

## Purpose and Scope

This document is a strategic roadmap for improving the predictive power of the MAAGAP Level 0/Level 1 stacking ensemble beyond its current baseline. It is written to sit alongside the manuscript's Results and Discussion chapter: the baseline numbers below are real, honestly measured, and — per the business-logic correction applied earlier in this project — free of any fabricated or leaked labels. The roadmap treats the current small-sample, class-imbalanced regime not as a flaw to be hidden, but as the expected state of a system whose training population accrues one government fiscal cycle at a time.

**Supersession note:** Sections 1–5 below document the original small-sample baseline (231 train / 99 test rows) as it stood before universal proxy-completion-date recovery. That baseline and its remediation roadmap remain valid reading — the reasoning in Sections 2–4 (threshold tuning, SMOTE, GRU/1D-CNN, continuous retraining) still applies going forward. Section 6 documents what has since changed: a much larger recovered labeled population, a real target-inflation risk that recovery introduced, and the empirical correction applied to address it. Read Section 6 for the current state of the training data and the latest calibrated metrics.

## 1. Current Baseline: What the Numbers Actually Show

The resolved (non-ongoing) project population currently available for supervised training is small by design: routing every project with a missing `Date of Completion` to `data/ready/inference.csv` instead of guessing an outcome for it was the correct call, but it leaves only 231 training rows and 99 test rows with a confirmed RedFlag outcome, of which just 20 and 5 respectively are positive (RedFlag = 1).

| Model | Split | Accuracy | Precision | Recall | F1 | AUC-ROC |
|---|---|---|---|---|---|---|
| Random Forest | OOF (train) | 0.8701 | 0.000 | 0.000 | 0.000 | 0.596 |
| Random Forest | Test | 0.9394 | 0.400 | 0.400 | 0.400 | 0.797 |
| XGBoost | OOF (train) | 0.8355 | 0.091 | 0.100 | 0.095 | 0.518 |
| XGBoost | Test | 0.9091 | 0.000 | 0.000 | 0.000 | 0.835 |
| LSTM | OOF (train) | 0.9219 | 0.000 | 0.000 | 0.000 | 0.475 |
| LSTM | Test | 0.8182 | 0.000 | 0.000 | 0.000 | 0.419 |
| Meta-learner | Test | 0.424 | 0.053 | 0.500 | 0.095 | 0.500 |

Three patterns in this table are diagnostic, not noise:

**High accuracy alongside zero or near-zero recall is exactly what an imbalanced binary classifier does under a default 0.5 decision threshold.** With RedFlag positive rates of 8–9% in train/test, a model that predicts "0" for every row already scores 90%+ accuracy. Random Forest's OOF recall of 0.0 despite an OOF AUC of 0.596 indicates the model is ranking positives somewhat better than chance, but the default threshold is far too conservative for a 1-in-11 event rate — this is a calibration problem as much as a modeling problem (Section 2.1).

**The LSTM's OOF and test AUC (0.475, 0.419) sit at or below the 0.5 "no better than random" line.** With only 3 positive training sequences, this is the expected behavior of a data-hungry recurrent architecture asked to learn from a sample an order of magnitude below what sequence models typically require. This is not a bug in the implementation (dropout, recurrent dropout, and class weighting are all correctly applied — see `train_lstm.py`'s module docstring) — it is the correct, honest output of the correct experiment given the currently available sequence count.

**The meta-learner's test AUC of exactly 0.500 is a direct, mechanical consequence of only 3 positive OOF examples reaching its training set** (64 of 231 resolved train rows had a matching LSTM sequence at all; only 3 of those 64 were positive). A Level 1 model cannot learn a decision boundary from 3 positive points that will generalize — this is not evidence the stacking architecture is wrong, it is evidence the architecture is currently starved of the base-rate volume it needs.

**The academic framing that follows from this is important and worth stating plainly in the Results chapter:** the ensemble's current numbers are a valid, reproducible measurement of what a leakage-free pipeline yields on the currently resolved PPDO project history — not a failure of design. The remediation paths below are about growing and rebalancing the training signal available to an already-correct pipeline, not about redesigning the pipeline itself.

## 2. Algorithmic Adjustments (Tabular Learners: Random Forest, XGBoost)

### 2.1 Class weighting (already partially applied — extend and tune)

Both tree models already use imbalance-aware weighting (`class_weight="balanced"` for Random Forest; `scale_pos_weight` computed from the train split's imbalance ratio for XGBoost). The first, lowest-risk improvement is not to add a new technique but to **tune the decision threshold** used to convert probability to a binary prediction. The 0.5 default threshold used in `evaluate()` is arbitrary for an imbalanced problem; a threshold chosen to maximize F1 or to hit a target recall (e.g., "catch at least 80% of true RedFlag projects, accept the resulting false-positive rate") on a validation fold would likely move Random Forest's OOF recall off 0.0 without retraining anything. This should be implemented as a `--threshold` parameter (or a small threshold-sweep utility) added to `train_trees.py`, selected via the OOF predictions already being generated — never the test set, to avoid leaking test-set information into a modeling choice.

### 2.2 SMOTE (Synthetic Minority Over-sampling Technique)

SMOTE synthesizes new minority-class (RedFlag = 1) training examples by interpolating between real positive examples and their nearest same-class neighbors in feature space. Applied inside each StratifiedKFold training fold (never across the train/test boundary, and never inside the OOF validation fold itself — SMOTE must only touch the training partition of each fold to avoid leaking synthetic-but-derived information into validation), this could meaningfully help Random Forest and XGBoost, whose feature space is fully engineered/tabular and well-suited to nearest-neighbor interpolation.

Caveat that must be stated honestly if implemented: with only 20 positive training examples, SMOTE's k-nearest-neighbor step (default k=5) is operating on a genuinely small neighborhood, and interpolated points risk simply restating variations on the same ~20 real government projects rather than adding new information. SMOTE is a reasonable next experiment, not a guaranteed fix — it should be reported as such, with a before/after OOF comparison, rather than presented as having "solved" the imbalance.

### 2.3 Focal loss

Focal loss down-weights the gradient contribution of easy, already-well-classified examples (the abundant RedFlag = 0 majority) and concentrates learning signal on hard, misclassified examples (the rare RedFlag = 1 minority) — mechanically, it multiplies the standard cross-entropy loss by `(1 - p_t)^gamma`, so confidently-correct predictions contribute almost nothing to the gradient. This is more directly applicable to **XGBoost**, which supports custom objective functions, than to Random Forest, whose splitting criterion (Gini impurity) does not have a loss-function hook in the same way. A focal-loss-style custom objective for XGBoost is a reasonable Phase 6 experiment; it is not proposed for Random Forest.

### 2.4 Priority ordering

Given implementation cost versus expected benefit at the current sample size, threshold tuning (2.1) should be attempted first — it requires no retraining and no new dependency. SMOTE (2.2) is the second priority, since it directly targets the training-set scarcity. Focal loss (2.3) is worth prototyping for XGBoost specifically but is the lowest priority of the three, since scale_pos_weight is already doing a related job.

## 3. Architecture Simplification (Sequential Learner: LSTM → GRU or 1D-CNN)

### 3.1 Why the current LSTM is likely over-specified for 64 training sequences

An LSTM cell maintains separate input, forget, output, and cell-state gates — four internal weight matrices per layer. A GRU (Gated Recurrent Unit) collapses this to two gates (reset and update), roughly two-thirds the parameter count of an equivalently-sized LSTM layer for the same `units` value. On a dataset with 64 training sequences and 3 positive examples, every parameter the network does not need to represent is a parameter it can use to memorize noise instead. Reducing parameter count is the single most direct lever available for reducing overfitting risk on a dataset this size, ahead of any additional regularization.

**Recommendation:** replace `layers.LSTM(32, dropout=0.2, recurrent_dropout=0.2)` in `train_lstm.py`'s `build_lstm_model()` with `layers.GRU(32, dropout=0.2, recurrent_dropout=0.2)` (or a smaller unit count, e.g. 16, given the sample size) as a like-for-like architectural swap — the rest of the model (Masking layer, Dense(16)/Dropout(0.3)/Dense(1) head, compile settings) needs no change. This is a low-risk, easily-reversible experiment: run both architectures through the existing OOF pipeline and compare AUC-ROC directly.

### 3.2 1D-CNN as a lower-variance alternative

A 1D convolutional layer over the timestep axis (`Conv1D` with a small kernel, e.g. size 2–3, followed by global pooling) makes a different, and for this problem plausibly more appropriate, assumption than either recurrent architecture: instead of modeling long-range sequential dependency across the full release → liquidation → monitoring-visit event chain, it looks for local patterns within short windows of adjacent events (e.g., "a release immediately followed by a monitoring visit with no liquidation in between" as a 2-3 event local pattern). Given that MAAGAP's per-project sequences are short (a handful of lifecycle events, not a long time series), a 1D-CNN's inductive bias toward short local patterns may be a better fit than a recurrent architecture's bias toward long-range dependency — and a Conv1D layer has no recurrent connections at all, which further reduces the parameter count and training instability risk relative to both LSTM and GRU.

**Recommendation:** prototype a small `Conv1D(filters=16, kernel_size=2, activation="relu") → GlobalMaxPooling1D() → Dense(16, activation="relu") → Dropout(0.3) → Dense(1, sigmoid)` model as a second alternative alongside the GRU swap, evaluated through the same OOF harness, before committing to either as the manuscript's final sequential base learner. Note that `Masking` is not supported directly upstream of `Conv1D` in Keras in the same way it is for recurrent layers; the padding sentinel (`PAD_VALUE = -1.0`) would need to be handled either by pre-trimming sequences to their real length per-project (ragged-to-fixed via truncation rather than padding) or via a custom masking-aware pooling step, since `GlobalMaxPooling1D` would otherwise be influenced by padding values unless they are excluded.

### 3.3 What NOT to do

Do not increase LSTM depth, width, or remove dropout to try to "let the model learn more" — this is the opposite of what a 64-sequence, 3-positive training set can support, and would very likely raise training-set fit while degrading OOF/test generalization further. The direction for Phase 6 is smaller and simpler, not larger.

## 4. Continuous Learning: Why Time, Not Just Technique, Resolves the Baseline

Sections 2 and 3 describe how to extract more signal from the *current* resolved population. This section addresses the more fundamental constraint: the resolved population itself is small because a large share of PPDO's most recent projects (2023–2026) are still ongoing and have not yet reached a completion date. This is not a data quality defect — it is the correct, current state of an active government project portfolio — but it means the single most impactful lever available to this system over time is simply **the calendar**.

As 2023–2026 projects complete (whether on schedule or with a documented Negative Slippage), each one moves from `data/ready/inference.csv` into the resolved training population with a real, non-fabricated RedFlag outcome. This has three compounding effects worth stating explicitly for the Results/Discussion and Recommendations chapters:

1. **The positive-class count grows monotonically as ongoing projects resolve**, directly relaxing the class-imbalance constraint that currently limits every technique in Sections 2–3. A dataset with 40 positive examples instead of 20 makes SMOTE's neighbor interpolation more trustworthy, makes threshold tuning more stable across folds, and — most importantly for Section 3 — is what would eventually justify a recurrent architecture's higher parameter count in the first place.

2. **Continuous/periodic retraining should be built into the system's operational design from the start**, not treated as a future nice-to-have. A practical cadence: re-run the full Level 0 → Level 1 training pipeline (`train_trees.py` → `train_lstm.py` → `train_meta_learner.py`) once per fiscal quarter, each time re-partitioning `data/ready/` fresh from the then-current monitoring data so newly-resolved projects flow into train/test and newly-ongoing projects flow into `inference.csv`. This keeps the "live" risk scores shown on the Next.js dashboard current, and gives the manuscript a defensible answer to "how does this system stay accurate over time?" — it does not stay static; it is designed to improve as PPDO's own project history accumulates.

3. **This reframes the current baseline's honest weakness as the system's core academic contribution.** A framework that manufactures confident-looking numbers on 20 positive examples would be less defensible under panel scrutiny than one that documents, with real measured numbers, exactly how much labeled history is currently available, why that constrains achievable performance today, and what concrete, monitorable trajectory (more resolved projects per quarter → better-calibrated thresholds → viable SMOTE/GRU experiments → eventually a production-grade ensemble) closes that gap. This document, together with the metrics table in Section 1, is intended to be that trajectory made explicit and falsifiable — each proposal above has a stated success criterion (an OOF/test AUC or recall comparison), so a future retraining run can confirm or refute it rather than merely asserting improvement.

## 5. Summary of Recommended Next Steps (in priority order)

1. Add OOF-selected threshold tuning to `train_trees.py` (no new dependency, immediate).
2. Prototype SMOTE inside the existing StratifiedKFold loop for Random Forest and XGBoost, compared against the current OOF baseline.
3. Swap the LSTM's recurrent layer for a GRU of equal or smaller size, compared against the current LSTM OOF/test AUC.
4. Prototype a 1D-CNN sequential learner as a second, lower-variance alternative to compare against both LSTM and GRU.
5. Establish a quarterly (or more frequent, if project throughput warrants) retraining cadence as a standing operational process, not a one-time model artifact — this is the change with the largest expected long-run impact on every metric in Section 1.

## 6. Universal Data Recovery and Empirical Lag Correction for Bureaucratic Delay

### 6.1 The recovery: why 231/99 grew to thousands

A second, distinct data-quality finding narrowed the scope of the routing rule in Sections 1–5. Across the entire monitoring sheet (not just the 2023–2026 cohort), 8,164 of 8,677 rows (94%) have a blank `Date of Completion` cell — but the overwhelming majority of those rows' `STATUS` field reads some variant of "Completed"/"Completed/Functional." A blank completion-date cell on a project PPDO's own STATUS field says is finished is a data-*entry* gap, not evidence the project is still running. Treating every blank date as "ongoing," as Sections 1–5's baseline did, was correct in spirit (never fabricate an outcome) but over-broad in practice (it discarded resolvable real history).

`feature_engineering.py`'s `construct_target_variable()` now recovers a completion date for these rows using only real, independently-recorded PPDO events — never a synthesized or statistically-sampled date: for a row with a blank completion date whose STATUS confirms Completed/Functional, the latest of that project's own `DATE MONITORED` value or its linked Liquidation Report Con `Date Submitted` (via the Step 3 crosswalk) is used as a **proxy completion date**. Rows that are genuinely On-going, Not Implemented, For Bidding, or have an unmapped/missing STATUS are still routed to `inference.csv` exactly as under the original correction — this recovery only ever fires when STATUS itself confirms completion.

### 6.2 The target-inflation risk this recovery introduced

The proxy date is, by construction, the *last administrative touchpoint* PPDO's records contain for a project — not the true physical completion date. Administrative paperwork (a monitoring visit, a liquidation submission) commonly trails the day a project actually finished by weeks or months. Using the proxy date uncorrected therefore produces a systematically **late** estimate of completion, which mechanically inflates `T_actual` and, in turn, the RedFlag positive rate for every proxy-recovered row.

This was not a hypothetical concern — it was measured directly. Directly-observed rows (a real `Date of Completion` on file) show a RedFlag positive rate of **7.6%** (n=330), consistent with the original Sections 1–5 baseline. Proxy-recovered rows, before any correction, showed a RedFlag positive rate of **82.3%** — an order of magnitude higher, and not a credible reflection of true project performance. Left uncorrected, this would have taught every downstream model that "having a recorded monitoring visit or liquidation submission" is itself a strong predictor of delay, when in fact it is largely an artifact of how the proxy date is constructed.

### 6.3 The empirical lag correction

Rather than accept that inflation as a documented but unaddressed limitation, `feature_engineering.py` now calibrates and removes the typical bias directly. `compute_empirical_lag_days()` isolates every row that has **both** a directly-observed `Date of Completion` and a computable proxy date (424 rows in the current dataset — large enough to calibrate against, and a superset of the 330 rows used for the Section 1 baseline, since this calibration set does not require a resolvable `project_type`) and computes the **median** of `(proxy_date − direct_date)` in days across that set. Median, not mean, is used because the lag distribution has a long right tail (a small number of projects liquidated years after completion — the calibration set's maximum lag was 3,125 days) that would pull a mean-based correction too far.

**The measured median lag is 288.5 days** (calibration set: n=424; mean 435.3 days, std 472.2 days, min −539 days, max 3,125 days). Every proxy date used to recover an otherwise-unresolved row is now shifted back by this median lag before being used as that row's completion date. The eligibility check that determines whether a proxy date is usable at all (it must fall after the project's start date, or it would imply a non-positive duration) is applied to this **corrected** date, so a small number of short-duration projects that were recoverable under the raw proxy date correctly fall back to "unresolved" once the lag correction is applied, rather than being forced through with an implausible negative-duration label.

### 6.4 Effect of the correction, measured

The correction meaningfully reduced, but did not fully eliminate, the gap between directly-observed and proxy-recovered RedFlag rates:

| Subset | RedFlag positive rate | n |
|---|---|---|
| Directly-observed (`Date of Completion` on file) | 7.6% | 330 |
| Proxy-recovered, uncorrected (raw proxy date) | 82.3% | 4,991 |
| Proxy-recovered, lag-corrected (median − 288.5 days) | 69.5% | 3,871 |

The residual gap (7.6% vs. 69.5%) should be read honestly, not glossed over: a median-based correction removes the *typical* bias across the calibration population, not each individual project's specific lag, so some inflation necessarily remains. It is also plausible — and worth stating explicitly for the Results and Discussion chapter — that projects requiring more monitoring visits or a more complex liquidation trail are not purely random with respect to delay; some genuine correlation between "needed more paperwork" and "was actually delayed" may be real, not purely an artifact. The lag correction addresses the *measurement* bias (the proxy date is dated later than the true event), not any potential *selection* bias in which projects have a recoverable proxy date at all. Both should be named as limitations in the manuscript rather than only the first.

### 6.5 Calibrated retraining results

With the lag-corrected labels, the full Level 0 → Level 1 stack was retrained end-to-end (train/test: 2,941 / 1,260 rows, 1,900 / 817 positive):

| Model | Split | Accuracy | Precision | Recall | F1 | AUC-ROC |
|---|---|---|---|---|---|---|
| Random Forest | OOF (train) | 0.794 | 0.866 | 0.806 | 0.835 | 0.875 |
| Random Forest | Test | 0.811 | 0.887 | 0.813 | 0.848 | 0.885 |
| XGBoost | OOF (train) | 0.895 | 0.958 | 0.876 | 0.915 | 0.955 |
| XGBoost | Test | 0.882 | 0.951 | 0.862 | 0.904 | 0.951 |
| LSTM | OOF (train) | 0.546 | 0.783 | 0.349 | 0.483 | 0.664 |
| LSTM | Test | 0.563 | 0.847 | 0.370 | 0.515 | 0.680 |
| Meta-learner | Test | 0.804 | 0.926 | 0.746 | 0.827 | 0.906 |

Compared against the uncorrected Phase 6 run (meta-learner test AUC 0.939), the lag-corrected meta-learner AUC is slightly lower (0.906) — this is the expected and *correct* direction for the number to move: some of the uncorrected run's apparent separability was the proxy-date bias itself, not genuine predictive signal, so a calibrated number that is a little lower but methodologically sounder is the right trade to report, not a regression to explain away. The Level 1 risk-tier distribution on the test set now spans all four Chapter 3 tiers (Low 182, Medium 69, High 41, Critical 161) rather than collapsing to a single tier, consistent with the pre-correction run.

The LSTM's OOF/test AUC (0.664 / 0.680) remains the weakest of the three base learners, consistent with Section 3's diagnosis that its recurrent architecture is likely over-parameterized for this task regardless of sample size — the GRU/1D-CNN experiments proposed in Section 3 remain the recommended next step for that specific model, independent of the data-recovery work in this section.
