"""Scores the ISO/IEC 25010 evaluation (Objective 6) from raw responses.

Implements `docs/ISO25010_Evaluation_Instrument.md` section 7 exactly, and is
written *before* any response is collected. That order is deliberate and worth
stating in Chapter 4: the instrument declares its scoring rules "in advance",
and a scorer committed before the data exists cannot have been tuned to it.
Writing it afterwards would leave no way to demonstrate that it wasn't.

The item map below is the single source of truth. `--emit-template` generates
the response CSV header from it, so the collection file and the analysis cannot
drift apart -- a column renamed in one place is a column renamed in both.

Usage:
    python scripts/score_iso25010.py --emit-template       # write the blank CSV
    python scripts/score_iso25010.py --selfcheck           # item map vs the instrument
    python scripts/score_iso25010.py                       # score docs/iso25010_responses.csv
    python scripts/score_iso25010.py --responses path.csv --json out.json

Every scoring run self-checks the item map against the instrument first: a map
that has drifted produces wrong, plausible figures, so it gates scoring rather
than being a flag someone has to remember.

Exit codes: 0 scored, 1 validation or self-check failure, 2 no usable responses.
"""

from __future__ import annotations

import argparse
import csv
import re
import json
import statistics
import sys
from collections import OrderedDict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_RESPONSES = REPO / "docs" / "iso25010_responses.csv"
INSTRUMENT_DOC = REPO / "docs" / "ISO25010_Evaluation_Instrument.md"

# --------------------------------------------------------------------------
# The instrument, section 5. Role tags are load-bearing: section 2 states that
# "a respondent cannot meaningfully rate a screen they have never been shown",
# so a rating on an item not tagged for the respondent's role is a data-entry
# error, not a data point, and validation rejects it rather than averaging it.
# --------------------------------------------------------------------------
Item = tuple[str, str]  # (item id, role tag: "A", "B" or "AB")

INSTRUMENT: "OrderedDict[str, OrderedDict[str, list[Item]]]" = OrderedDict(
    [
        (
            "Functional Suitability",
            OrderedDict(
                [
                    ("Functional completeness", [("FS1", "AB"), ("FS2", "A"), ("FS3", "B")]),
                    ("Functional correctness", [("FS4", "A"), ("FS5", "A"), ("FS6", "B")]),
                    ("Functional appropriateness", [("FS7", "A"), ("FS8", "A"), ("FS9", "AB")]),
                ]
            ),
        ),
        (
            "Usability",
            OrderedDict(
                [
                    ("Appropriateness recognizability", [("US1", "AB"), ("US2", "A")]),
                    ("Learnability", [("US3", "AB"), ("US4", "AB")]),
                    ("Operability", [("US5", "AB"), ("US6", "AB"), ("US7", "B")]),
                    ("User error protection", [("US8", "AB"), ("US9", "A")]),
                    ("User interface aesthetics", [("US10", "AB")]),
                    ("Accessibility", [("US11", "AB"), ("US12", "AB")]),
                ]
            ),
        ),
        (
            "Reliability",
            OrderedDict(
                [
                    ("Maturity", [("RL1", "AB"), ("RL2", "AB")]),
                    ("Availability", [("RL3", "AB"), ("RL4", "A")]),
                    ("Fault tolerance", [("RL5", "AB"), ("RL6", "B")]),
                    ("Recoverability", [("RL7", "AB"), ("RL8", "AB")]),
                ]
            ),
        ),
    ]
)

# Section 4. Completion is recorded by the facilitator, not self-reported, and
# section 7 requires it be reported alongside the ratings.
TASKS = {
    "A": ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
    "B": ["B1", "B2", "B3", "B4"],
}
TASK_OUTCOMES = {"completed", "completed_with_help", "not_completed", "not_attempted"}

OPEN_PROMPTS = ["OR1", "OR2"]

# Section 7, declared before collection.
BANDS = [
    (4.21, 5.00, "Excellent"),
    (3.41, 4.20, "Very Satisfactory"),
    (2.61, 3.40, "Satisfactory"),
    (1.81, 2.60, "Fair"),
    (1.00, 1.80, "Poor"),
]


def all_items() -> list[Item]:
    return [it for subs in INSTRUMENT.values() for items in subs.values() for it in items]


def item_role(item_id: str) -> str:
    for iid, role in all_items():
        if iid == item_id:
            return role
    raise KeyError(item_id)


def applies(role_tag: str, group: str) -> bool:
    return group in role_tag


def band(score: float) -> str:
    """Interpretation band. Uses the published boundaries as written.

    The table in section 7 is declared equal-interval but its printed bounds
    leave hairline gaps (4.20 to 4.21). Resolved upward by >= on the lower
    bound so every value in [1.0, 5.0] lands in exactly one band, and a score
    falling in a gap is never silently dropped.
    """
    for lo, _hi, name in BANDS:
        if score >= lo:
            return name
    return BANDS[-1][2]


# --------------------------------------------------------------------------
# Template
# --------------------------------------------------------------------------
def template_header() -> list[str]:
    cols = ["respondent_id", "group"]
    cols += [iid for iid, _ in all_items()]
    cols += [f"task_{t}" for t in TASKS["A"] + TASKS["B"]]
    cols += OPEN_PROMPTS
    return cols


def emit_template(path: Path, force: bool = False) -> int:
    if path.exists() and not force:
        existing = path.read_text(encoding="utf-8").splitlines()
        rows = [r for r in existing[1:] if r.strip()]
        if rows:
            print(f"REFUSED: {path} already holds {len(rows)} response row(s).")
            print("         Emitting the template would destroy collected data.")
            print("         Pass --force only if you intend to discard them.")
            return 1
    with path.open("w", encoding="utf-8", newline="") as fh:
        csv.writer(fh).writerow(template_header())
    print(f"Wrote blank template with {len(template_header())} columns to {path}")
    print("\nFilling it in:")
    print("  respondent_id  A-01, A-02, B-01 ...  (section 8: role and sequence only, never a name)")
    print("  group          A (manager) or B (inspector)")
    print("  FS/US/RL       1-5 integer, or BLANK where the item is not tagged for that role")
    print(f"  task_*         one of: {', '.join(sorted(TASK_OUTCOMES))}")
    print("  OR1, OR2       free text; quote any comma")
    return 0


# --------------------------------------------------------------------------
# Self-check
# --------------------------------------------------------------------------
def selfcheck(doc: Path = INSTRUMENT_DOC) -> int:
    """Re-derives the item map from the instrument's prose and compares it.

    This guards the one failure nobody would notice. Every figure the script
    produces is arithmetic over INSTRUMENT, so a role tag changed in the
    instrument but not here -- or a typo in either -- yields numbers that are
    wrong and entirely plausible. Nothing downstream would catch it: the totals
    still sum, the bands still resolve, the report still renders.

    Section 1 of the instrument promises a third party can reproduce these
    figures from the document and the prototype. That promise holds only while
    the code and the document agree; this makes that checkable rather than
    assumed.
    """
    problems: list[str] = []
    if not doc.exists():
        print(f"SELF-CHECK FAILED: {doc} not found.", file=sys.stderr)
        return 1
    text = doc.read_text(encoding="utf-8")
    try:
        sec5 = text[text.index("## 5. Instrument") : text.index("## 6. Open-response")]
    except ValueError:
        print(
            "SELF-CHECK FAILED: could not locate section 5 between its headings. "
            "The instrument's structure changed; this check needs updating with it.",
            file=sys.stderr,
        )
        return 1

    # Matches:  - **FS1** `[A/B]` The system provides all the functions ...
    doc_items: "OrderedDict[str, str]" = OrderedDict(
        (m.group(1), "".join(sorted(m.group(2).replace("/", ""))))
        for m in re.finditer(r"\*\*([A-Z]{2}\d+)\*\*\s*`\[([AB/]+)\]`", sec5)
    )
    code_items: "OrderedDict[str, str]" = OrderedDict(
        (i, "".join(sorted(r))) for i, r in all_items()
    )

    for iid in sorted(set(doc_items) | set(code_items), key=lambda x: (x[:2], int(x[2:]))):
        d, c = doc_items.get(iid), code_items.get(iid)
        if d is None:
            problems.append(f"{iid} is mapped in this script but does not appear in the instrument")
        elif c is None:
            problems.append(f"{iid} appears in the instrument but is not mapped in this script")
        elif d != c:
            problems.append(f"{iid} role tag: instrument says [{d}], this script says [{c}]")

    if not problems and list(doc_items) != list(code_items):
        problems.append(
            f"item ordering differs: instrument starts {list(doc_items)[:4]}, "
            f"script starts {list(code_items)[:4]}"
        )

    # Sub-characteristic headings are italicised on their own line in section 5.
    doc_subs = [
        re.split(r"—| - ", m.group(1))[0].strip().rstrip(".").strip()
        for m in re.finditer(r"^\*([^*\n]+)\*$", sec5, re.M)
    ]
    code_subs = [name for subs in INSTRUMENT.values() for name in subs]
    dl = [x.lower() for x in doc_subs]
    cl = [x.lower() for x in code_subs]
    for name in code_subs:
        if name.lower() not in dl:
            problems.append(f"sub-characteristic {name!r} is not a heading in the instrument")
    for name in doc_subs:
        if name.lower() not in cl:
            problems.append(f"instrument heading {name!r} is not a sub-characteristic in this script")

    # Section 1 declares the item total independently of section 5's list.
    m = re.search(r"Total: \*\*(\d+) items", text)
    if m and int(m.group(1)) != len(code_items):
        problems.append(
            f"section 1 declares {m.group(1)} items; this script maps {len(code_items)}"
        )

    # The response template must cover every item, task and prompt exactly once.
    hdr = template_header()
    if len(hdr) != len(set(hdr)):
        dupes = sorted({c for c in hdr if hdr.count(c) > 1})
        problems.append(f"template header has duplicate columns: {dupes}")
    expected = 2 + len(code_items) + len(TASKS["A"]) + len(TASKS["B"]) + len(OPEN_PROMPTS)
    if len(hdr) != expected:
        problems.append(f"template header has {len(hdr)} columns, expected {expected}")

    if problems:
        print(f"SELF-CHECK FAILED -- {len(problems)} problem(s):\n", file=sys.stderr)
        for pr in problems:
            print(f"  - {pr}", file=sys.stderr)
        print(
            "\nThe scorer and the instrument disagree. Every figure is arithmetic over "
            "the map in this file, so until they agree the output is wrong in a way "
            "nothing downstream would reveal.",
            file=sys.stderr,
        )
        return 1

    print(f"SELF-CHECK PASSED against {doc.name}:")
    print(f"  {len(code_items)} items, ids and role tags matching, in the same order")
    print(f"  {len(code_subs)} sub-characteristics across {len(INSTRUMENT)} characteristics")
    print(f"  template header: {len(hdr)} columns, no duplicates")
    return 0


# --------------------------------------------------------------------------
# Load and validate
# --------------------------------------------------------------------------
class Response:
    def __init__(self, rid: str, group: str):
        self.rid = rid
        self.group = group
        self.ratings: dict[str, int] = {}
        self.tasks: dict[str, str] = {}
        self.open: dict[str, str] = {}


def load(path: Path) -> tuple[list[Response], list[str]]:
    """Returns (responses, errors). Validation is strict and never repaired.

    A rating silently coerced or dropped is a figure in Chapter 4 that nobody
    can trace back to a respondent, so every problem is reported and nothing is
    guessed at.
    """
    errors: list[str] = []
    if not path.exists():
        return [], [f"{path} does not exist. Run with --emit-template first."]

    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            return [], [f"{path} is empty -- not even a header row."]
        missing = [c for c in template_header() if c not in reader.fieldnames]
        extra = [c for c in reader.fieldnames if c not in template_header()]
        if missing:
            errors.append(f"header is missing columns: {', '.join(missing)}")
        if extra:
            errors.append(f"header has unknown columns: {', '.join(extra)}")
        if missing:
            return [], errors
        rows = list(reader)

    responses: list[Response] = []
    seen: set[str] = set()
    for n, row in enumerate(rows, start=2):  # row 1 is the header
        rid = (row.get("respondent_id") or "").strip()
        group = (row.get("group") or "").strip().upper()
        if not rid and not group and not any((row.get(i) or "").strip() for i, _ in all_items()):
            continue  # a wholly blank line
        where = f"row {n}"
        if not rid:
            errors.append(f"{where}: respondent_id is blank")
            continue
        if rid in seen:
            errors.append(f"{where}: duplicate respondent_id {rid!r}")
            continue
        seen.add(rid)
        if group not in ("A", "B"):
            errors.append(f"{where} ({rid}): group must be A or B, found {group!r}")
            continue

        r = Response(rid, group)
        for iid, role in all_items():
            raw = (row.get(iid) or "").strip()
            relevant = applies(role, group)
            if raw == "":
                if relevant:
                    errors.append(
                        f"{where} ({rid}): {iid} is blank but is tagged [{role}] "
                        f"and so applies to group {group} -- leave it blank only if "
                        f"the respondent declined, and say so in the write-up"
                    )
                continue
            if not relevant:
                errors.append(
                    f"{where} ({rid}): {iid} is rated {raw!r} but is tagged [{role}], "
                    f"which does not include group {group}. A respondent cannot rate "
                    f"a screen they were never shown (instrument section 2)."
                )
                continue
            try:
                val = int(raw)
            except ValueError:
                errors.append(f"{where} ({rid}): {iid} is {raw!r}, not an integer 1-5")
                continue
            if not 1 <= val <= 5:
                errors.append(f"{where} ({rid}): {iid} is {val}, outside the 1-5 scale")
                continue
            r.ratings[iid] = val

        for t in TASKS["A"] + TASKS["B"]:
            raw = (row.get(f"task_{t}") or "").strip().lower()
            belongs = t in TASKS[group]
            if raw == "":
                continue
            if not belongs:
                errors.append(f"{where} ({rid}): task_{t} recorded, but task {t} is not in group {group}'s set")
                continue
            if raw not in TASK_OUTCOMES:
                errors.append(f"{where} ({rid}): task_{t} is {raw!r}; expected one of {sorted(TASK_OUTCOMES)}")
                continue
            r.tasks[t] = raw

        for p in OPEN_PROMPTS:
            txt = (row.get(p) or "").strip()
            if txt:
                r.open[p] = txt

        responses.append(r)

    return responses, errors


# --------------------------------------------------------------------------
# Scoring, section 7
# --------------------------------------------------------------------------
def score(responses: list[Response]) -> dict:
    """Section 7, steps 1-4.

    Step 1 is read as: the mean of a sub-characteristic's ITEM means, where each
    item mean is taken across the respondents who rated that item. Pooling every
    rating instead would let an item answered by more respondents dominate its
    own sub-characteristic -- the distortion step 2 explicitly guards against one
    level up, so applying it only at the characteristic level would be
    inconsistent. Both readings are reported for transparency: `pooled_mean`
    carries the alternative.
    """
    out: dict = {"n_total": len(responses), "characteristics": OrderedDict()}
    out["n_by_group"] = {g: sum(1 for r in responses if r.group == g) for g in ("A", "B")}

    char_scores: list[float] = []
    for char, subs in INSTRUMENT.items():
        sub_out: "OrderedDict[str, dict]" = OrderedDict()
        sub_scores: list[float] = []
        for sub, items in subs.items():
            item_rows = []
            pooled: list[int] = []
            groups_rating: set[str] = set()
            for iid, role in items:
                vals = [r.ratings[iid] for r in responses if iid in r.ratings]
                if not vals:
                    item_rows.append({"item": iid, "role": role, "n": 0, "mean": None, "sd": None})
                    continue
                groups_rating.update(r.group for r in responses if iid in r.ratings)
                pooled.extend(vals)
                item_rows.append(
                    {
                        "item": iid,
                        "role": role,
                        "n": len(vals),
                        "mean": round(statistics.fmean(vals), 4),
                        # Sample SD. n-1 is right here: these respondents are a
                        # sample of the staff who hold the role, not the whole of
                        # it. Undefined at n=1, reported as null rather than 0 --
                        # zero would read as perfect agreement among one person.
                        "sd": round(statistics.stdev(vals), 4) if len(vals) > 1 else None,
                    }
                )
            rated = [r for r in item_rows if r["mean"] is not None]
            sub_score = round(statistics.fmean([r["mean"] for r in rated]), 4) if rated else None
            if sub_score is not None:
                sub_scores.append(sub_score)
            sub_out[sub] = {
                "score": sub_score,
                "band": band(sub_score) if sub_score is not None else None,
                "pooled_mean": round(statistics.fmean(pooled), 4) if pooled else None,
                "pooled_sd": round(statistics.stdev(pooled), 4) if len(pooled) > 1 else None,
                "n_ratings": len(pooled),
                # Section 7: "A sub-characteristic rated by only one group must
                # say so." Carried in the data so the write-up cannot omit it.
                "groups": sorted(groups_rating),
                "single_group_only": len(groups_rating) == 1,
                "items": item_rows,
            }
        char_score = round(statistics.fmean(sub_scores), 4) if sub_scores else None
        if char_score is not None:
            char_scores.append(char_score)
        out["characteristics"][char] = {
            "score": char_score,
            "band": band(char_score) if char_score is not None else None,
            "sub_characteristics": sub_out,
        }

    out["overall"] = round(statistics.fmean(char_scores), 4) if char_scores else None
    out["overall_band"] = band(out["overall"]) if out["overall"] is not None else None

    # Lowest-scoring sub-characteristic -- section 7 requires it be named and
    # discussed, so it is computed rather than left to whoever writes the prose.
    flat = [
        (c, s, d["score"])
        for c, cd in out["characteristics"].items()
        for s, d in cd["sub_characteristics"].items()
        if d["score"] is not None
    ]
    out["lowest"] = (
        {"characteristic": flat[0][0], "sub_characteristic": flat[0][1], "score": flat[0][2]}
        if (flat := sorted(flat, key=lambda x: x[2]))
        else None
    )

    # Task completion, reported alongside the ratings and never folded into them.
    tasks: "OrderedDict[str, dict]" = OrderedDict()
    for g in ("A", "B"):
        for t in TASKS[g]:
            rec = [r.tasks[t] for r in responses if t in r.tasks]
            if not rec:
                continue
            tasks[t] = {
                "group": g,
                "n": len(rec),
                **{o: rec.count(o) for o in sorted(TASK_OUTCOMES)},
                "unaided_rate": round(rec.count("completed") / len(rec), 4),
            }
    out["tasks"] = tasks
    out["open_responses"] = [
        {"respondent": r.rid, "group": r.group, **r.open} for r in responses if r.open
    ]
    return out


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------
def fmt(v, nd=2) -> str:
    return "--" if v is None else f"{v:.{nd}f}"


def report(s: dict, source: Path) -> str:
    L: list[str] = []
    a, b = s["n_by_group"]["A"], s["n_by_group"]["B"]
    L.append("# ISO/IEC 25010 Evaluation — Results")
    L.append("")
    try:
        rel = source.resolve().relative_to(REPO).as_posix()
    except ValueError:
        rel = source.name
    L.append(f"Computed by `scripts/score_iso25010.py` from `{rel}`.")
    L.append(f"Achieved **n = {s['n_total']}** (Group A managers: {a}; Group B inspectors: {b}).")
    L.append("")
    L.append(
        "This is a purposive, non-probability sample of a small fixed population. "
        "Every mean below describes these respondents; none of them estimates a "
        "wider population, and none should be read as generalizable."
    )
    L.append("")

    L.append("## Characteristic scores")
    L.append("")
    L.append("| Characteristic | Score | Interpretation |")
    L.append("|---|---|---|")
    for c, d in s["characteristics"].items():
        L.append(f"| {c} | {fmt(d['score'])} | {d['band'] or '--'} |")
    L.append("")
    L.append(
        f"**Overall: {fmt(s['overall'])} ({s['overall_band'] or '--'})** — reported only "
        "alongside the three characteristics above, never in place of them."
    )
    L.append("")

    L.append("## Sub-characteristic detail")
    L.append("")
    L.append("| Characteristic | Sub-characteristic | Score | Band | Pooled SD | Ratings | Groups |")
    L.append("|---|---|---|---|---|---|---|")
    for c, cd in s["characteristics"].items():
        for sub, d in cd["sub_characteristics"].items():
            flag = " ⚠" if d["single_group_only"] else ""
            L.append(
                f"| {c} | {sub} | {fmt(d['score'])} | {d['band'] or '--'} | "
                f"{fmt(d['pooled_sd'])} | {d['n_ratings']} | {'+'.join(d['groups']) or '--'}{flag} |"
            )
    L.append("")
    singles = [
        (c, sub)
        for c, cd in s["characteristics"].items()
        for sub, d in cd["sub_characteristics"].items()
        if d["single_group_only"]
    ]
    if singles:
        L.append(
            "⚠ Rated by one group only, which must be stated wherever the score appears: "
            + "; ".join(f"{sub} ({c})" for c, sub in singles)
        )
        L.append("")

    if s["lowest"]:
        lo = s["lowest"]
        L.append(
            f"**Lowest-scoring sub-characteristic: {lo['sub_characteristic']} "
            f"({lo['characteristic']}) at {fmt(lo['score'])}.** Section 7 requires this be "
            "discussed rather than noted. An evaluation that surfaces no weakness has "
            "usually measured politeness rather than quality."
        )
        L.append("")

    L.append("## Item detail")
    L.append("")
    L.append("| Item | Role | n | Mean | SD |")
    L.append("|---|---|---|---|---|")
    for cd in s["characteristics"].values():
        for d in cd["sub_characteristics"].values():
            for it in d["items"]:
                L.append(
                    f"| {it['item']} | [{it['role']}] | {it['n']} | "
                    f"{fmt(it['mean'])} | {fmt(it['sd'])} |"
                )
    L.append("")

    if s["tasks"]:
        L.append("## Task completion (facilitator-recorded, §4)")
        L.append("")
        L.append("| Task | Group | n | Unaided | With help | Not completed | Unaided rate |")
        L.append("|---|---|---|---|---|---|---|")
        for t, d in s["tasks"].items():
            L.append(
                f"| {t} | {d['group']} | {d['n']} | {d['completed']} | "
                f"{d['completed_with_help']} | {d['not_completed']} | {d['unaided_rate']:.0%} |"
            )
        L.append("")
        strained = [t for t, d in s["tasks"].items() if d["unaided_rate"] < 0.7]
        if strained:
            L.append(
                "Tasks completed unaided by fewer than 70% of respondents: "
                + ", ".join(strained)
                + ". Where these coincide with a high Usability rating, report the "
                "disagreement rather than resolving it in the ratings' favour."
            )
            L.append("")

    if s["open_responses"]:
        L.append("## Open responses")
        L.append("")
        for o in s["open_responses"]:
            L.append(f"**{o['respondent']}** (Group {o['group']})")
            for p in OPEN_PROMPTS:
                if o.get(p):
                    L.append(f"- *{p}:* {o[p]}")
            L.append("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--responses", type=Path, default=DEFAULT_RESPONSES)
    ap.add_argument("--emit-template", action="store_true", help="write the blank response CSV and exit")
    ap.add_argument("--selfcheck", action="store_true",
                    help="verify the item map still matches the instrument, then exit")
    ap.add_argument("--force", action="store_true", help="with --emit-template, overwrite rows that exist")
    ap.add_argument("--json", type=Path, help="also write the full result as JSON")
    ap.add_argument("--out", type=Path, help="write the markdown report here instead of stdout")
    args = ap.parse_args()

    if args.selfcheck:
        return selfcheck()

    if args.emit_template:
        return emit_template(args.responses, force=args.force)

    # Gated, not opt-in. A drifted map yields plausible, wrong figures, so a
    # flag someone has to remember to pass is the wrong shape for this check.
    if selfcheck() != 0:
        return 1
    print()

    responses, errors = load(args.responses)
    if errors:
        print(f"VALIDATION FAILED -- {len(errors)} problem(s); nothing was scored.\n", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print(
            "\nNothing is coerced or dropped on purpose: a repaired rating is a "
            "figure nobody can trace to a respondent.",
            file=sys.stderr,
        )
        return 1
    if not responses:
        print(f"No responses in {args.responses} yet. Objective 6 is blocked on PPDO respondents, not on this script.")
        return 2

    s = score(responses)
    text = report(s, args.responses)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
        print(f"Report written to {args.out}")
    else:
        print(text)
    if args.json:
        args.json.write_text(json.dumps(s, indent=2), encoding="utf-8")
        print(f"\nJSON written to {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
