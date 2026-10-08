/**
 * Plain-language definitions for the technical terms this interface shows.
 *
 * The terms themselves are deliberately not renamed. They appear in the thesis
 * manuscript, and a UI that calls something different from Chapter 3 costs more
 * at a defence than it saves at a desk (decision recorded 2026-10-08 in
 * docs/UI_UX_IMPROVEMENT_PLAN.md). So the precise term stays on screen and the
 * explanation sits beside it, on demand.
 *
 * One dictionary rather than definitions written at each call site: the Models
 * page's glossary and the inline hints on other pages now read from here, so
 * the same term cannot end up explained two different ways. This codebase has
 * already produced one screen that contradicted its own decision record by
 * holding a figure in two places.
 *
 * Audience: PPDO planning officers and non-ML panel members. A definition that
 * needs a second definition to understand it has failed.
 */
export interface GlossaryEntry {
  /** The term exactly as it appears in the interface. */
  term: string;
  /** One or two sentences. Plain enough to read aloud. */
  plain: string;
  /** Optional: why it matters here, when the definition alone leaves the
   * reader asking "so what?". */
  soWhat?: string;
}

export const GLOSSARY = {
  redflag: {
    term: "P(RedFlag)",
    plain:
      "The model's estimated chance that a project will end up significantly delayed, from 0% to 100%.",
    soWhat: "It is the number the risk tiers are cut from, and what the table sorts by.",
  },
  riskTier: {
    term: "Risk tier",
    plain:
      "The delay risk grouped into four bands — Low, Medium, High and Critical — so projects can be ranked without reading a percentage for each one.",
  },
  optimizerSlot: {
    term: "Optimizer slot",
    plain:
      "A numbered position on the inspection roster. The optimizer assigns every visit to a slot, and a real inspector has to be bound to that slot before the visit can reach anyone.",
    soWhat: "Work routed to an empty slot is skipped at deploy time and nobody is sent.",
  },
  solver: {
    term: "Solver",
    plain:
      "The program that builds the week's inspection schedule, choosing which projects to visit and who goes where within the available working days.",
  },
  cluster: {
    term: "Cluster",
    plain:
      "A group of nearby municipalities. The schedule keeps each inspector within a cluster where it can, so a day is not spent travelling between far-apart sites.",
  },
  rescore: {
    term: "Re-score",
    plain:
      "After an inspector files a report, the system recalculates that project's risk using what was observed on site.",
    soWhat: "A report still awaiting re-score has been filed but has not yet changed the risk tier.",
  },
  eventSequence: {
    term: "Monitoring-event sequence",
    plain:
      "The ordered history of site visits for a project. One of the three models needs this history to score a project, and projects with too few visits do not have one.",
  },
  accuracy: {
    term: "Accuracy",
    plain: "How often the model's call was right, across every project it scored.",
  },
  precision: {
    term: "Precision",
    plain: "When it flags a project as at risk, how often it is correct.",
    soWhat: "Low precision wastes inspection trips.",
  },
  recall: {
    term: "Recall",
    plain: "Of the projects genuinely at risk, how many it caught.",
    soWhat: "Low recall means at-risk projects go unvisited.",
  },
  f1: {
    term: "F1",
    plain: "A single score balancing precision and recall, for when one number is needed.",
  },
  aucRoc: {
    term: "AUC-ROC",
    plain:
      "How well the model separates at-risk from not-at-risk across every threshold. 50% is a coin toss, 100% is perfect.",
  },
  mae: {
    term: "MAE (days)",
    plain: "Average error in days when predicting how late a project will run.",
    soWhat: "Only meaningful against the baseline shown beside it.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** The full text of an entry, for a tooltip or an aria-description. */
export function glossary(key: GlossaryKey): GlossaryEntry {
  // Widened from the literal type `as const` produces: entries without a
  // `soWhat` would otherwise make the property inaccessible on the union.
  return GLOSSARY[key];
}

export function glossText(key: GlossaryKey): string {
  const entry = glossary(key);
  return entry.soWhat ? `${entry.plain} ${entry.soWhat}` : entry.plain;
}
