import type { FplElement, SquadPlayer } from "./fpl";

const BUY_PREFIX = /^buy\s+/i;
const SELL_PREFIX = /^sell\s+/i;
const PRICE_CLAUSE = /\s+for\s+£\s?\d+(?:\.\d+)?m\b.*$/i;
const HAS_PRICE_CLAUSE = /\s+for\s+£\s?\d+(?:\.\d+)?m\b/i;
const CLAIMED_PRICE = /for\s+£\s?(\d+(?:\.\d+)?)m/i;
const PRICE_TOLERANCE = 0.05; // guards against float rounding, not a real mismatch

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A specific player name ("Bruno Fernandes"), not a generic placeholder
// suggestion ("a nailed-on £6.5m midfielder") — nothing to cross-check
// against bootstrap for the latter.
function looksLikeAPlayerName(value: string): boolean {
  return /[A-Z][a-z]+/.test(value);
}

// The everyday "first name + surname" form (e.g. "Bruno Fernandes") — often
// different from both web_name (FPL's own short display form, "B.Fernandes")
// and the full legal second_name (which can carry extra names, e.g. "Borges
// Fernandes"). This is normally the form Claude's own prose actually uses.
function commonName(element: FplElement): string {
  const lastWord = element.second_name.trim().split(/\s+/).pop() ?? element.second_name;
  return `${element.first_name} ${lastWord}`;
}

function fullName(element: FplElement): string {
  return `${element.first_name} ${element.second_name}`;
}

// Tries web_name first (exact match for the common case — Claude just used
// FPL's own display name, e.g. "Haaland"), then the everyday full-name form,
// then the full legal name as a last resort. This order matters: matching
// only on a bare surname would risk colliding two unrelated players who
// happen to share one (Man Utd's "Bruno Fernandes" vs Spurs' "Fernandes",
// legal name Mateus Fernandes) — going through first name first avoids that.
function findElementByName(elements: FplElement[], name: string): FplElement | undefined {
  const target = normalizeName(name);
  if (!target) return undefined;

  return (
    elements.find((element) => normalizeName(element.web_name) === target) ??
    elements.find((element) => normalizeName(commonName(element)) === target) ??
    elements.find((element) => normalizeName(fullName(element)) === target)
  );
}

// The sale proceeds from a same-response "Sell X" action, if there is one —
// added to bank to get the real budget for the "Buy Y" line, since a
// transfer is normally funded by the player going out.
function findSaleProceeds(actions: string[], squad: SquadPlayer[]): number {
  const sellAction = actions.find((action) => SELL_PREFIX.test(action));
  if (!sellAction) return 0;

  const name = sellAction.replace(SELL_PREFIX, "").trim();
  const target = normalizeName(name);
  const match = squad.find((player) => normalizeName(player.name) === target);
  return match?.price ?? 0;
}

function withCorrectedPrice(action: string, price: number): string {
  return HAS_PRICE_CLAUSE.test(action)
    ? action.replace(/for\s+£\s?\d+(?:\.\d+)?m/i, `for £${price}m`)
    : `${action} for £${price}m`;
}

const NEARBY_PRICE_WINDOW = 30;

// Independently fixes a price mentioned shortly after a player's name in the
// prose — Claude can restate a price inconsistently between its own ACTIONS
// line and its TRANSFER paragraph (e.g. "£6.5m" in one, "£6.0m" in the
// other), so this checks the number actually sitting next to the name in
// the prose rather than trusting the action line's number to also hold true
// there.
function correctPriceNearName(text: string, name: string, correctPrice: number): string {
  const nameIndex = text.indexOf(name);
  if (nameIndex === -1) return text;

  const windowStart = nameIndex + name.length;
  const window = text.slice(windowStart, windowStart + NEARBY_PRICE_WINDOW);
  const match = window.match(/£\s?(\d+(?:\.\d+)?)m/);
  if (!match) return text;

  const nearbyPrice = Number.parseFloat(match[1]);
  if (Math.abs(nearbyPrice - correctPrice) < PRICE_TOLERANCE) return text;

  const fixedWindow = window.replace(match[0], `£${correctPrice}m`);
  return text.slice(0, windowStart) + fixedWindow + text.slice(windowStart + NEARBY_PRICE_WINDOW);
}

export interface TransferValidationResult {
  actions: string[];
  transferText: string;
  corrected: boolean;
}

// Cross-checks whichever specific player Claude recommended buying against
// the live FPL bootstrap price. The prompt is given accurate current prices
// up front, but a model can still misstate a number in its own prose, price
// a name it wasn't actually shown, or simply be inconsistent between its own
// ACTIONS line and TRANSFER paragraph — this is the backstop that catches
// all three before the user sees a transfer they can't actually make (or a
// price that's simply wrong on screen). Corrects the price in place when the
// same player is still affordable; swaps in the closest affordable
// same-position alternative when the real price busts the budget.
export function validateTransferRecommendation({
  actions,
  transferText,
  squad,
  bank,
  elements,
}: {
  actions: string[];
  transferText: string;
  squad: SquadPlayer[];
  bank: number;
  elements: FplElement[];
}): TransferValidationResult {
  const buyIndex = actions.findIndex((action) => BUY_PREFIX.test(action));
  if (buyIndex === -1) return { actions, transferText, corrected: false };

  const buyAction = actions[buyIndex];
  const rawName = buyAction.replace(BUY_PREFIX, "").replace(PRICE_CLAUSE, "").trim();
  if (!looksLikeAPlayerName(rawName)) {
    return { actions, transferText, corrected: false };
  }

  const element = findElementByName(elements, rawName);
  if (!element) {
    // Couldn't resolve the name against live data at all (hallucinated
    // player, or a name form bootstrap doesn't have) — nothing safe to
    // correct it to, so leave it rather than guess.
    return { actions, transferText, corrected: false };
  }

  const realPrice = Math.round((element.now_cost / 10) * 10) / 10;
  const claimedPriceMatch = buyAction.match(CLAIMED_PRICE);
  const claimedPrice = claimedPriceMatch ? Number.parseFloat(claimedPriceMatch[1]) : null;
  const actionNeedsPriceFix = claimedPrice == null || Math.abs(claimedPrice - realPrice) >= PRICE_TOLERANCE;
  const budget = bank + findSaleProceeds(actions, squad);

  let finalName = rawName;
  let finalPrice = realPrice;
  let correctedActions = actions;
  let correctedTransferText = transferText;
  let corrected = false;

  if (realPrice > budget + PRICE_TOLERANCE) {
    // Real price busts the budget regardless of what Claude claimed — find
    // the closest affordable alternative in the same position (same
    // element_type), preferring the highest price that still fits so the
    // swap stays as close to the original pick's quality tier as the
    // budget allows.
    const squadIds = new Set(squad.map((player) => player.id));
    const alternative = elements
      .filter(
        (candidate) =>
          candidate.element_type === element.element_type &&
          candidate.id !== element.id &&
          !squadIds.has(candidate.id) &&
          candidate.status === "a" &&
          candidate.now_cost / 10 <= budget,
      )
      .sort((a, b) => b.now_cost - a.now_cost)[0];

    if (alternative) {
      finalName = alternative.web_name;
      finalPrice = Math.round((alternative.now_cost / 10) * 10) / 10;

      const nextActions = [...actions];
      nextActions[buyIndex] = `Buy ${finalName} for £${finalPrice}m`;
      correctedActions = nextActions;
      // Best-effort — a no-op if the exact name never appears in the prose
      // (e.g. Claude referred to them a different way), which is a safe
      // fallback either way.
      correctedTransferText = transferText.split(rawName).join(finalName);
      corrected = true;
    } else if (actionNeedsPriceFix) {
      // Nothing else fits the budget either — at least be honest about what
      // this player actually costs.
      const nextActions = [...actions];
      nextActions[buyIndex] = withCorrectedPrice(buyAction, realPrice);
      correctedActions = nextActions;
      corrected = true;
    }
  } else if (actionNeedsPriceFix) {
    // Same player, just quoted at the wrong price (or none at all) — fix it
    // rather than swapping who's recommended.
    const nextActions = [...actions];
    nextActions[buyIndex] = withCorrectedPrice(buyAction, realPrice);
    correctedActions = nextActions;
    corrected = true;
  }

  if (claimedPrice != null && Math.abs(claimedPrice - finalPrice) >= PRICE_TOLERANCE) {
    correctedTransferText = correctedTransferText.replace(
      new RegExp(`£\\s?${claimedPrice}m`, "g"),
      `£${finalPrice}m`,
    );
  }

  const beforeNearbyFix = correctedTransferText;
  correctedTransferText = correctPriceNearName(correctedTransferText, finalName, finalPrice);
  if (correctedTransferText !== beforeNearbyFix) corrected = true;

  return { actions: correctedActions, transferText: correctedTransferText, corrected };
}
