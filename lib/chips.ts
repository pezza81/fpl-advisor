// Shared chip reference data — used by the dashboard's chip-availability
// computation, its "chips explained" modal, and the advice prompt's
// chip-recommendation section, so the explanations stay in sync everywhere.

export interface ChipExplanation {
  name: string; // FPL's own identifier: "wildcard" | "freehit" | "bboost" | "3xc"
  label: string;
  description: string;
  whenToUse: string;
}

export const CHIP_LABELS: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

export const CHIP_EXPLANATIONS: ChipExplanation[] = [
  {
    name: "wildcard",
    label: "Wildcard",
    description: "Make unlimited free transfers for one gameweek with no points penalty.",
    whenToUse:
      "Best used when your squad needs a real overhaul — an injury crisis, a bad run of fixtures, or replanning around a new fixture swing. You get two per season.",
  },
  {
    name: "freehit",
    label: "Free Hit",
    description:
      "A one-week wildcard — unlimited free changes, but your squad automatically reverts to how it was as soon as the gameweek ends.",
    whenToUse:
      "Best saved for a single unusual gameweek: a blank gameweek (several of your players have no fixture) or a double gameweek where you want to load up on players with two matches.",
  },
  {
    name: "bboost",
    label: "Bench Boost",
    description: "Your bench players' points count towards your total this gameweek too, not just your starting XI.",
    whenToUse:
      "Best used when your full 15-man squad is fit and starting, ideally in a double gameweek so the bench also benefits from two sets of fixtures.",
  },
  {
    name: "3xc",
    label: "Triple Captain",
    description: "Your captain scores 3x points this gameweek instead of the usual 2x.",
    whenToUse:
      "Best used on a premium, nailed-on player with a great fixture — ideally one playing twice in a double gameweek.",
  },
];

export function chipExplanationFor(name: string): ChipExplanation | undefined {
  return CHIP_EXPLANATIONS.find((chip) => chip.name === name);
}
