---
tags: [decision, feature-engineering, data-quality, modeling]
status: active
created: 2026-09-08
updated: 2026-09-08
---

# D16: Observed Status as a Controlled Vocabulary, Replacing Percent Complete

## Context

Two problems met in the same place: what a field inspector is asked to record,
and how status is encoded as a model feature.

**1. Percent complete is subjective.** The inspector report form asked for a
"% complete" figure. A percentage judged by eye at a job site is an
unvalidated estimate — there is no rubric, no inter-rater check, and no way to
audit it afterwards; two inspectors at the same site can differ by twenty
points, and "60% complete" means something different for a water system than
for a training seminar. It was also inert: `percent_complete` is not in the
trained feature schema (see `live_scoring.py`'s scope note), so it cost field
effort and produced no signal.

**2. Status was encoded from raw free text.** `preprocess.py`'s
`STATUS_LOOKUP` maps 15 raw spellings and describes itself as "illustrative of
the pattern, not exhaustive", against **278 raw / 238 normalized distinct
STATUS values** (Data Audit DQ-3). Everything unmapped passed through as its
own category and was one-hot encoded, so:

- `train.csv` carried **237** `STATUS_clean_*` columns;
- **57 of the trained model's 137 features (42%)** were status one-hots;
- those included near-singleton columns keyed on typos, e.g.
  `STATUS_clean_Completd/ Distributed` and
  `STATUS_clean_Completed/ 2 Cameras Are Dame During Road Co9Nstructiion Project And The Remaining Are Functional`.

Columns like that cannot generalize: an observation whose wording differs by a
character matches none of them. The live re-score path inherited the damage —
`live_scoring.STATUS_TO_COLUMN_SUFFIX` mapped `for_bidding` to a column the
trained schema never contained, and had no entry for `refunded` at all, so
both kinds of field observation were recorded and then silently unable to move
a score. That is the same class of silent failure as the `projects` RLS
no-op fixed alongside this (see the reporting-loop work).

## Decision

Observed status becomes the objective primitive the loop feeds back, encoded
from one controlled vocabulary shared by the offline pipeline and the live
path; percent complete is removed from capture.

1. **`ml-service/data_pipeline/status_vocabulary.py`** — seven canonical
   labels (Completed, On-going, Not Implemented, For Bidding, For
   Implementation, Refunded, Unclassified), aligned with the app's
   `project_status` enum so a spreadsheet row and a field observation land in
   the same column. `refunded` is mapped for the first time.
2. **An ordered rule cascade with negative guards**, following D12's
   rule → abstain pattern and recording provenance in `status_source`
   (`rule` / `unclassified`) exactly as `project_type_source` does. The guards
   are load-bearing: *"Fund Is Fullly Utilized But The Project Still Needs
   Addtional Funding For Its Building Completion"* contains "completion" but
   plainly describes unfinished work, and a naive `complet` substring rule —
   which is what the pipeline uses elsewhere — labels it Completed. It now
   resolves to On-going.
3. **Condition flags instead of discarded nuance.** The free text carried real
   information, so three orthogonal booleans (`status_has_damage`,
   `status_not_turned_over`, `status_partially_functional`) are mined from the
   same strings. These generalize to wording never seen at train time, which
   the 237 one-hots could not.
4. **The RedFlag target was held fixed.** `construct_target_variable()` still
   decides completion from `STATUS_clean` via `COMPLETED_STATUS_SUBSTRINGS`,
   unchanged, and runs at Step 6 before this encoding at Step 9. Changing the
   label and the features in the same retrain would make the comparison
   uninterpretable and put the thesis's central variable in play without a
   controlled test.
5. **Capture form**: the "% complete" input is removed; observed status (with
   the visit's own date and time) is what the inspector records.

## Rule coverage

96.9% of monitoring rows resolve by rule; 3.1% abstain as Unclassified, of
which 189 rows (2.15% of the total) are empty STATUS cells and therefore
unclassifiable in principle. The residue is exotic typos and vocabulary
('Competed', 'Og-Going', 'Dumpsite Closed', 'Returned To Ipg'). Rule-chasing
stopped there deliberately: tuning further risks fitting this snapshot's noise,
and abstention is auditable in a way a wrong guess is not. A confidence-gated
classifier for that ~1% is the D12-style follow-up if it ever matters.

## Effect on the model

Verified controlled comparison — the target checkpoint is **identical** before
and after (labeled 5884/8277, 1159 clamped, train 4119 / test 1765, meta-learner
training set 1,451 rows), so only the encoding moved.

| Model | accuracy | precision | recall | F1 | AUC-ROC |
|---|---|---|---|---|---|
| Random Forest | 0.849 → **0.827** | 0.883 → 0.851 | 0.829 → 0.821 | 0.855 → 0.836 | 0.914 → 0.907 |
| XGBoost | 0.924 → **0.923** | 0.952 → 0.953 | 0.904 → 0.902 | 0.928 → 0.927 | 0.976 → 0.976 |
| LSTM | 0.600 → **0.612** | 0.503 → 0.512 | 0.880 → 0.868 | 0.641 → 0.644 | 0.715 → 0.716 |
| Meta-learner | 0.895 → **0.886** | 0.865 → 0.848 | 0.876 → 0.876 | 0.871 → 0.862 | 0.959 → 0.957 |

Feature columns **137 → 87** (−50); status columns **57 → 4** canonical plus 3
flags.

**This outcome was predicted in writing before the retrain was run** (see
`REPORTING_LOOP_IMPROVEMENT_PLAN.md` §6.4). Near-singleton one-hots keyed on
typo strings are exactly what a tree ensemble memorizes, so some of the prior
accuracy was identifier-like fitting rather than learned structure. The loss is
concentrated in Random Forest (−0.023), the learner least able to regularize
it away; XGBoost is flat (−0.001) and the meta-learner is within the
run-to-run noise this stack has always shown (−0.008, AUC −0.002). A model
that generalizes to unseen status wording, on 36% fewer features, at that cost
is the better and more defensible result.

## Consequences

- A field observation of `for_bidding` can now move a score — its column
  exists in the trained schema for the first time. `refunded` still cannot:
  only 2 rows in the training population, so zero-variance selection drops it,
  and `_update_status_columns` leaves the encoding unchanged and says so. That
  is the honest outcome — the model has no learned representation of that
  state — not a bug to paper over.
- Supabase reseeded 2026-09-08: 2,393 rows, live tiers Low 628 / Medium 19 /
  High 4 / Critical 17 (was Low 614 / Medium 26 / High 9 / Critical 19).
- Pre-D16 artifacts are preserved at `ml-service/artifacts_pre_d16/` for
  rollback and for reproducing the comparison above.
- The methodology report's headline metrics move and must be regenerated.

## Alternatives rejected

- **Keeping percent complete and adding it as a feature.** It would import the
  estimator's judgment as measurement, and nothing in the system calibrates it.
- **Extending `STATUS_LOOKUP` by hand to all 238 values.** Fixes this snapshot
  and nothing else; the next export brings new spellings, and the one-hot
  sparsity problem remains.
- **Changing target construction at the same time**, to use the canonical
  labels for completion detection too. Tempting and probably correct
  eventually, but it would confound this comparison. Its own decision, later.

## See also

- [[D12-Project-Type-Classifier]] — the rule → classifier → abstain cascade and
  the `*_source` provenance convention this follows.
- [[D15-Currency-Coercion-Magnitude-Suffix]] — the previous "a feature column
  was quietly wrong" finding.
