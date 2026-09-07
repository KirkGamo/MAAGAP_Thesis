"""
MAAGAP — Controlled observation-status vocabulary (D16)
================================================================================
One canonical status vocabulary, shared by the offline pipeline and the live
re-scoring path, plus the flags that preserve what the raw free text was
actually carrying.

WHY THIS EXISTS
------------------------------------------------------------------------------
`preprocess.py`'s STATUS_LOOKUP maps 15 raw spellings and describes itself as
"illustrative of the pattern, not exhaustive", against 278 raw / 238 normalized
distinct STATUS values (Data Audit DQ-3). Everything unmapped passed through as
its own category, so one-hot encoding produced **57 of the trained model's 137
feature columns (42%)** — columns keyed on free text and typos, e.g.

    STATUS_clean_Completed/ 2 Cameras Are Dame During Road Co9Nstructiion ...
    STATUS_clean_Completd/ Distributed

Near-singleton columns like those cannot generalize: an observation whose
wording differs by one character matches none of them. The live path inherited
the damage — `for_bidding` mapped to a column the schema does not contain and
`refunded` was not mapped at all, so both were recorded and could never move a
score.

The replacement is a small, dense vocabulary (6 labels) plus orthogonal boolean
flags mined from the same strings, so the condition detail the free text
carried — damage, non-functionality, not-yet-turned-over — survives the
collapse instead of being discarded with the 57 columns.

WHAT THIS MODULE MUST NOT TOUCH
------------------------------------------------------------------------------
The RedFlag target. `feature_engineering.construct_target_variable()` decides
completion from `STATUS_clean` via COMPLETED_STATUS_SUBSTRINGS, and that logic
stays exactly as it is. This module only changes how status is ENCODED AS A
FEATURE, so the retrain that follows is a controlled comparison: if the labels
moved at the same time, the before/after would be uninterpretable and the
thesis's central variable would be in play without a test. Any later change to
target construction is its own decision note.
"""

from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Canonical vocabulary
# ---------------------------------------------------------------------------
# Aligned with the app's `project_status` enum so a field observation and a
# historical spreadsheet row land in the SAME feature column. "For
# Implementation" has no app equivalent (an inspector cannot report it) but
# exists in the historical data, so it stays a valid canonical label.
STATUS_COMPLETED = "Completed"
STATUS_ONGOING = "On-going"
STATUS_NOT_IMPLEMENTED = "Not Implemented"
STATUS_FOR_BIDDING = "For Bidding"
STATUS_FOR_IMPLEMENTATION = "For Implementation"
STATUS_REFUNDED = "Refunded"
STATUS_UNCLASSIFIED = "Unclassified"

CANONICAL_STATUSES = [
    STATUS_COMPLETED,
    STATUS_ONGOING,
    STATUS_NOT_IMPLEMENTED,
    STATUS_FOR_BIDDING,
    STATUS_FOR_IMPLEMENTATION,
    STATUS_REFUNDED,
    STATUS_UNCLASSIFIED,
]

# The app's enum -> canonical label. This is the mapping that makes the live
# re-score path able to write into the same columns the model was trained on
# (see inference/live_scoring.py). `refunded` appears here for the first time.
APP_STATUS_TO_CANONICAL = {
    "completed": STATUS_COMPLETED,
    "on_going": STATUS_ONGOING,
    "not_yet_implemented": STATUS_NOT_IMPLEMENTED,
    "for_bidding": STATUS_FOR_BIDDING,
    "refunded": STATUS_REFUNDED,
}

# ---------------------------------------------------------------------------
# Rule cascade
# ---------------------------------------------------------------------------
# Ordered: the first pattern to match wins, so the exclusions below are
# checked before the broad "complet" family that would otherwise swallow them.
#
# NEGATIVE guards come first on purpose. "Fund Is Fullly Utilized But The
# Project Still Needs Addtional Funding For Its Building Completion" contains
# "completion" but plainly describes an UNFINISHED project; a naive substring
# rule would label it Completed. These are the cases a keyword heuristic gets
# wrong, so they are handled explicitly rather than left to chance.
_NOT_COMPLETE_GUARDS = [
    r"needs?\s+add?itional",
    r"for\s+its\s+building\s+completion",
    r"not\s+yet\s+complet",
    r"still\s+needs",
]

_RULES: list[tuple[str, str]] = [
    # Refunds first: money returned outranks whatever physical state is named.
    (r"refund", STATUS_REFUNDED),
    # Explicit non-completion. The stem is deliberately short ("not imp")
    # because the source data misspells this constantly -- "Not Impelemnted",
    # "Not Impleted", "Not Implemeted" all appear, and each was previously
    # its own one-hot column.
    (r"not\s*(yet\s*)?imp", STATUS_NOT_IMPLEMENTED),
    # Procurement stages, which the raw sheet records in the same column as
    # physical status: pre-award.
    (r"for\s*bidding|philgeps|procurement|^\s*bidding", STATUS_FOR_BIDDING),
    # Post-award but not yet started.
    (
        r"for\s*implementation|to\s*be\s*implemented|contract\s*signing|for\s*delivery",
        STATUS_FOR_IMPLEMENTATION,
    ),
    (r"on\s*-?\s*going|ongoing|continuing", STATUS_ONGOING),
    # The completed family last: broadest, and only reached once the more
    # specific states above have had their chance. `com[pl]{2}et` absorbs the
    # transposition typos ("comlpeted") alongside the correct spelling, and
    # the stem covers "completd", "complete/", "100% completed-...".
    (r"com[pl]{2}et", STATUS_COMPLETED),
    (r"distributed|turn(ed)?\s*over|functional|fuctional", STATUS_COMPLETED),
]

# ---------------------------------------------------------------------------
# Condition flags
# ---------------------------------------------------------------------------
# What the free text carried beyond the bare status. These generalize in a way
# the one-hots never could: a phrase never seen at train time still sets the
# right flag as long as it uses any of these stems. Deliberately few and
# orthogonal -- each answers a different question about the delivered asset.
STATUS_FLAGS: dict[str, str] = {
    # Physically damaged, stolen, or otherwise not serviceable.
    "status_has_damage": r"damag|stolen|unservic|out\s*of\s*order|non\s*-?\s*fu[nc]",
    # Delivered but not yet handed to the beneficiary/LGU.
    "status_not_turned_over": r"not\s*yet\s*turn|not\s*yet\s*install|for\s*repair|under\s*repair",
    # Some units work, others don't -- a partial delivery.
    "status_partially_functional": r"some\s+(are|of|have|parts)|few\s+are|remaining|except\s+for",
}

_COMPILED_GUARDS = [re.compile(p, re.IGNORECASE) for p in _NOT_COMPLETE_GUARDS]
_COMPILED_RULES = [(re.compile(p, re.IGNORECASE), label) for p, label in _RULES]
_COMPILED_FLAGS = {name: re.compile(p, re.IGNORECASE) for name, p in STATUS_FLAGS.items()}


def canonicalize_status(raw: Optional[str]) -> tuple[str, str]:
    """Collapses one raw/`STATUS_clean` string to a canonical label.

    Returns (canonical_label, source) where source is "rule" when a pattern
    matched and "unclassified" when nothing did -- the same provenance
    convention `project_type_source` uses (D12), so every row's evidentiary
    basis stays auditable end to end. Abstains rather than guessing: an
    unrecognized status becomes Unclassified, not a silent Completed.
    """
    if raw is None:
        return STATUS_UNCLASSIFIED, "unclassified"

    text = str(raw).strip()
    if not text or text.lower() in {"nan", "none", "unknown"}:
        return STATUS_UNCLASSIFIED, "unclassified"

    blocked_from_completed = any(guard.search(text) for guard in _COMPILED_GUARDS)

    for pattern, label in _COMPILED_RULES:
        if pattern.search(text):
            if label == STATUS_COMPLETED and blocked_from_completed:
                # Names completion but explicitly describes unfinished work.
                return STATUS_ONGOING, "rule"
            return label, "rule"

    return STATUS_UNCLASSIFIED, "unclassified"


def status_flags(raw: Optional[str]) -> dict[str, bool]:
    """The condition detail the canonical label deliberately drops."""
    text = "" if raw is None else str(raw)
    return {name: bool(pattern.search(text)) for name, pattern in _COMPILED_FLAGS.items()}


def canonical_from_app_status(app_status: str) -> str:
    """The live path's entry point: an inspector's reported enum value ->
    the canonical label the trained schema encodes."""
    return APP_STATUS_TO_CANONICAL.get(app_status, STATUS_UNCLASSIFIED)
