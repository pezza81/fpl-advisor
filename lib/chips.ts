// Shared chip reference data — used by the dashboard's chip-availability
// computation, its "chips explained" modal, the advice prompt's
// chip-recommendation section, and the /guide page, so the explanations
// stay in sync everywhere.

export interface ChipExplanation {
  name: string; // FPL's own identifier: "wildcard" | "freehit" | "bboost" | "3xc"
  label: string;
  description: string;
  whenToUse: string;
  timesPerSeason: string;
  example: string;
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
    timesPerSeason: "2 per season — one usable any time up to a mid-season deadline (usually early January), a second that unlocks right after and lasts through the rest of the season",
    example:
      "Three of your players are from a club with a brutal run of tough fixtures coming up, and two more are injured. Instead of spending several gameweeks and a stack of -4pt hits fixing it player by player, wildcard lets you rebuild all 15 players in one go, completely free.",
  },
  {
    name: "freehit",
    label: "Free Hit",
    description:
      "A one-week wildcard — unlimited free changes, but your squad automatically reverts to how it was as soon as the gameweek ends.",
    whenToUse:
      "Best saved for a single unusual gameweek: a blank gameweek (several of your players have no fixture) or a double gameweek where you want to load up on players with two matches.",
    timesPerSeason: "1 per season",
    example:
      "A blank gameweek where 5 of your 15 players have no fixture at all because their clubs are out on cup duty. Free hit lets you field a full, fixture-proof XI just for that one week, then your normal squad comes straight back for the next gameweek.",
  },
  {
    name: "bboost",
    label: "Bench Boost",
    description: "Your bench players' points count towards your total this gameweek too, not just your starting XI.",
    whenToUse:
      "Best used when your full 15-man squad is fit and starting, ideally in a double gameweek so the bench also benefits from two sets of fixtures.",
    timesPerSeason: "1 per season",
    example:
      "You've just used your wildcard and all 15 players are fit and nailed starters, several of them with two fixtures in a double gameweek. Bench boost banks your bench's points too, worth an extra 15-25+ points in a good week that would otherwise score you nothing.",
  },
  {
    name: "3xc",
    label: "Triple Captain",
    description: "Your captain scores 3x points this gameweek instead of the usual 2x.",
    whenToUse:
      "Best used on a premium, nailed-on player with a great fixture — ideally one playing twice in a double gameweek.",
    timesPerSeason: "1 per season",
    example:
      "Haaland has two fixtures in a double gameweek against two of the league's weakest defences. Instead of the usual 2x on a big haul, triple captain turns it into 3x — a 20-point return becomes 30, all from one player.",
  },
];

export function chipExplanationFor(name: string): ChipExplanation | undefined {
  return CHIP_EXPLANATIONS.find((chip) => chip.name === name);
}
