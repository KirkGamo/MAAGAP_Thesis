# MAAGAP — ISO/IEC 25010 Software Quality Evaluation Instrument

**Objective 6:** *Evaluate the prototype's software quality using the ISO/IEC 25010 standard, focusing on sub-characteristics such as Functional Suitability, Usability, and Reliability.*

This document is the evaluation instrument and its administration protocol. It is the artifact Objective 6 is assessed against, and it is designed to be reproducible by a third party: another researcher given this file, the deployed prototype, and the same respondent pool should arrive at comparable figures.

---

## 1. Scope and model

ISO/IEC 25010 defines eight product quality characteristics. This study evaluates **three**, as named in Objective 6, and does not claim to evaluate the remaining five (Performance Efficiency, Compatibility, Security, Maintainability, Portability). That delimitation is deliberate and should be stated in Chapter 4 rather than left implicit — a reader must not infer that an unevaluated characteristic was evaluated and found adequate.

| Characteristic | Sub-characteristics assessed | Items |
|---|---|---|
| Functional Suitability | Functional completeness, functional correctness, functional appropriateness | FS1–FS9 |
| Usability | Appropriateness recognizability, learnability, operability, user error protection, user interface aesthetics, accessibility | US1–US12 |
| Reliability | Maturity, availability, fault tolerance, recoverability | RL1–RL8 |

Total: **29 items**, all 5-point Likert.

## 2. Respondents

MAAGAP presents two distinct role surfaces with different screens and different Supabase row-level-security policies. Evaluating only one would leave half the system unassessed, so both are sampled:

- **Group A — Project managers / planning officers (PPDO).** Use the manager dashboard: portfolio, risk tiers, project detail with SHAP explanation, schedule, optimizer, reports, inspectors.
- **Group B — Field inspectors.** Use the inspector surface: assigned projects, field report submission, visit history.

**Sampling:** purposive, non-probability — the population of staff who actually perform these roles at PPDO Iloilo is small and fixed, so a probability sample is neither available nor meaningful. Report the achieved *n* per group exactly, and do not report a target *n* as though it were achieved.

**Items are role-tagged.** `[A]` manager only, `[B]` inspector only, `[A/B]` both. Respondents rate only the items tagged for their role; a respondent cannot meaningfully rate a screen they have never been shown.

## 3. Administration protocol

Ratings collected without use are opinion about a screenshot, not evaluation of software. Each session therefore runs in this order:

1. **Orientation (5 min).** Purpose of MAAGAP, what is being evaluated, that the system and not the respondent is under assessment, voluntary participation, anonymized reporting.
2. **Guided task walkthrough (20–30 min).** The respondent performs the scripted tasks in §4 on the deployed prototype, unaided except when blocked. The facilitator records task completion and any point at which the respondent needed help — this is evidence in its own right, independent of the ratings.
3. **Instrument (10 min).** Completed immediately after the tasks, while the experience is current.
4. **Open comment.** Two free-text prompts (§6). These frequently explain a score that the numbers alone cannot.

**Facilitator rule:** do not explain away a difficulty during the task phase. A respondent who cannot find the risk explanation is producing the study's most valuable datum. Note it and move on.

## 4. Scripted tasks

### Group A — Manager
- A1. Identify which projects in the portfolio currently require the most urgent attention.
- A2. Open one Critical-tier project and state, in your own words, why the system rates it as it does.
- A3. Find how many projects are at each risk tier.
- A4. Generate an inspector deployment schedule for the coming week.
- A5. Reassign one scheduled visit to a different inspector.
- A6. Determine which optimizer slots have no inspector assigned, and what that costs.
- A7. Locate the validation performance of the prediction models.
- A8. Export or read off the current portfolio for a report.

### Group B — Inspector
- B1. Find the projects assigned to you.
- B2. File a field report for one assigned project, including an observed status.
- B3. File a report for a visit that took place earlier in the week.
- B4. Review the reports you have previously submitted.

## 5. Instrument

**Scale:** 5 = Strongly Agree · 4 = Agree · 3 = Neutral · 2 = Disagree · 1 = Strongly Disagree.

### 5.1 Functional Suitability

*Functional completeness — does it do everything the role requires?*
- **FS1** `[A/B]` The system provides all the functions I need to carry out my part of project monitoring.
- **FS2** `[A]` The information shown about each project is sufficient for me to decide whether it needs intervention.
- **FS3** `[B]` The field report form captures everything I need to record about a site visit.

*Functional correctness — are its outputs right?*
- **FS4** `[A]` The risk tier the system assigns to a project agrees with my own judgement of that project.
- **FS5** `[A]` The project details shown (amounts, locations, status, dates) match the records I know to be correct.
- **FS6** `[B]` After I submit a report, the project's status is updated correctly.

*Functional appropriateness — do the functions fit the actual task?*
- **FS7** `[A]` The four risk tiers (Low, Medium, High, Critical) are a useful way to prioritize projects.
- **FS8** `[A]` The generated inspector schedule is a realistic starting point for the coming week's deployment.
- **FS9** `[A/B]` The system fits the way monitoring work is actually done in this office.

### 5.2 Usability

*Appropriateness recognizability*
- **US1** `[A/B]` It was clear what this system is for the first time I saw it.
- **US2** `[A]` I could tell at a glance which projects needed attention.

*Learnability*
- **US3** `[A/B]` I was able to learn to use this system without extensive training.
- **US4** `[A/B]` I would be able to show a colleague how to use it.

*Operability*
- **US5** `[A/B]` The system was easy to operate and control.
- **US6** `[A/B]` I could find what I was looking for without excessive searching.
- **US7** `[B]` Submitting a field report took a reasonable amount of effort.

*User error protection*
- **US8** `[A/B]` The system made it difficult for me to make a serious mistake.
- **US9** `[A]` Before an action that replaces existing work, the system made the consequence clear.

*User interface aesthetics*
- **US10** `[A/B]` The interface is pleasant and professional in appearance.

*Accessibility*
- **US11** `[A/B]` Text, figures, and colours were easy for me to read.
- **US12** `[A/B]` I could use the system comfortably on the device I normally work with.

### 5.3 Reliability

*Maturity*
- **RL1** `[A/B]` The system behaved consistently throughout my session.
- **RL2** `[A/B]` I did not encounter errors or unexpected behaviour.

*Availability*
- **RL3** `[A/B]` The system was available whenever I tried to use it.
- **RL4** `[A]` Pages and data loaded within a reasonable time.

*Fault tolerance*
- **RL5** `[A/B]` When something went wrong, the system kept working rather than becoming unusable.
- **RL6** `[B]` The system handled a poor or interrupted network connection without losing my work.

*Recoverability*
- **RL7** `[A/B]` When an error occurred, I could recover and continue without losing work.
- **RL8** `[A/B]` The system explained what had gone wrong in terms I could understand.

## 6. Open-response prompts

- **OR1.** What was the single most difficult thing about using this system?
- **OR2.** What would you need this system to do before you would rely on it in your actual work?

## 7. Scoring and interpretation

1. **Sub-characteristic score** = mean of its items, across all respondents who rated them.
2. **Characteristic score** = mean of its sub-characteristic scores (equal weighting, so a sub-characteristic carrying more items does not dominate).
3. **Overall score** = mean of the three characteristic scores.
4. Report **mean and standard deviation** for every level, and the **n** contributing to each. A sub-characteristic rated by only one group must say so.

**Interpretation scale** (equal-interval, declared before collection):

| Range | Interpretation |
|---|---|
| 4.21 – 5.00 | Excellent |
| 3.41 – 4.20 | Very Satisfactory |
| 2.61 – 3.40 | Satisfactory |
| 1.81 – 2.60 | Fair |
| 1.00 – 1.80 | Poor |

**Reporting rules, fixed in advance:**

- Report the achieved *n*. With a small purposive sample, a mean is a description of those respondents, not an estimate of a population — say so rather than implying generalizability.
- Report task-completion observations from §4 alongside the ratings. Where they disagree — respondents rating Usability highly while having needed help to complete a task — report the disagreement rather than resolving it in the ratings' favour.
- Report the lowest-scoring sub-characteristic explicitly and discuss it. An evaluation that surfaces no weakness has usually measured politeness rather than quality.
- Do not aggregate the three characteristics into a single headline figure without also showing the three separately.

## 8. Consent and data handling

Verbal informed consent, recorded by the facilitator: purpose, voluntary participation, right to stop at any point, anonymized reporting, and that the system rather than the respondent is being evaluated. Responses are identified by role and sequence number only (`A-01`, `B-03`); no names, positions, or identifying detail appear in stored responses or in the thesis.

Raw responses are committed to `docs/iso25010_responses.csv` so that every figure in Chapter 4 can be recomputed from them.
