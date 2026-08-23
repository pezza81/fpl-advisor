// Best-effort extraction of a one-line "why" for a gameweek action item,
// pulled straight out of the advice prose Claude already generated (the
// TRANSFER/CAPTAIN/CHIP sections) rather than asking the model for a second,
// separately-structured reason — the ACTIONS section is deliberately terse
// (see app/api/advice/route.ts's prompt), so this is what recovers the
// "why" without changing that contract.

export interface AdviceLike {
  transfer: string;
  captain: string;
  chip: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sentence-level only (not finer clause-splitting): the prose sometimes puts
// an em-dash inside a quoted flag like "Missing Fixture — Knee Injury", and
// splitting on every bare em-dash would tear that apart. A subject's
// justification is picked up below by scanning a short run of sentences
// starting from wherever it's first named, so a compound sentence chained
// with dashes still gets captured as one candidate.
function splitIntoSentences(text: string): string[] {
  // Splits right after a .!? only when it's followed by whitespace or the
  // end of the string — a bare period-scan would also break on decimal
  // points like "£6.5m" ("6." followed directly by "5", no whitespace).
  const parts = text.split(/(?<=[.!?])(?=\s|$)/);
  const sentences = parts.map((s) => s.trim()).filter((s) => s.length > 0);
  return sentences.length > 0 ? sentences : [text.trim()];
}

function countDigits(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

// When the winning sentence mentions the subject partway through rather
// than at the start (e.g. "...and the standout replacement is Bruno
// Fernandes at £6m, whose G+A jumped from 18 to 30"), trims everything
// before the segment the mention actually starts in — otherwise the reason
// leads with unrelated clause about something else entirely.
function focusOnMention(sentence: string, name: string): string {
  const idx = sentence.toLowerCase().indexOf(name.toLowerCase());
  if (idx <= 0) return sentence;
  const before = sentence.slice(0, idx);
  const lastBoundary = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf(":"));
  const start = lastBoundary === -1 ? 0 : lastBoundary + 1;
  return sentence.slice(start).trim();
}

// Strips a leading "Haaland, " / "Haaland is " style subject restatement
// (the action line above already names the player), tidies stray leading
// conjunctions left over from focusOnMention, and truncates at a word
// boundary rather than mid-word.
function condenseReason(sentence: string, playerName: string | undefined): string {
  let text = sentence.replace(/\s+/g, " ").trim();

  if (playerName) {
    text = text.replace(new RegExp(`^${escapeRegExp(playerName)}[,]?\\s*`, "i"), "");
  }
  text = text.replace(/^(and|but|so|because|since|who|whose)\s+/i, "");
  text = text.replace(/[.!?]+$/, "").trim();
  if (text.length === 0) return "";

  text = text.charAt(0).toUpperCase() + text.slice(1);

  const maxLength = 110;
  if (text.length > maxLength) {
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    text = `${(lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim()}…`;
  }
  return text;
}

const TRANSFER_KEYWORDS = /\b(sell|buy|transfer|bring in|drop|swap)\b/i;
const CAPTAIN_KEYWORDS = /\b(captain|vice-captain|armband)\b/i;
const CHIP_KEYWORDS = /\b(wildcard|bench boost|triple captain|free hit|chip|chips)\b/i;

const ACTION_LEAD_VERBS =
  /^(sell|buy|transfer in|transfer out|transfer|bring in|drop|bench|captain|vice-captain|keep|hold|swap)\s+/i;
const ACTION_TRAILING_QUALIFIERS = /\s+(for\s+£|while|this week|instead|as (a )?(vice-)?captain)\b.*$/i;

// A squad player's name always resolves an action's subject directly; this
// covers the other common case — a suggested transfer target who isn't in
// the squad at all (e.g. "Buy Bruno Fernandes") — by stripping the leading
// verb and trailing qualifiers and checking what's left looks like a name.
function extractSubjectPhrase(action: string): string | null {
  const withoutVerb = action.replace(ACTION_LEAD_VERBS, "");
  const withoutQualifier = withoutVerb.replace(ACTION_TRAILING_QUALIFIERS, "");
  const cleaned = withoutQualifier.replace(/^(a|an|the)\s+/i, "").trim();
  return /[A-Z][a-z]+/.test(cleaned) ? cleaned : null;
}

// Picks which advice section is most likely to contain the reasoning for
// this action (by keyword), finds the subject it's about (a squad player
// name, or a suggested transfer target's name), then — starting from the
// sentence that first names that subject — looks a couple of sentences
// ahead (prose often continues via "he/his" rather than repeating the name)
// for the most data-rich one, stopping early if a different named player
// shows up first.
export function extractActionReason(
  action: string,
  advice: AdviceLike,
  squadNames: string[],
): string | null {
  let sourceText: string;
  if (TRANSFER_KEYWORDS.test(action)) sourceText = advice.transfer;
  else if (CAPTAIN_KEYWORDS.test(action)) sourceText = advice.captain;
  else if (CHIP_KEYWORDS.test(action)) sourceText = advice.chip;
  else sourceText = `${advice.transfer} ${advice.captain} ${advice.chip}`;

  if (!sourceText || sourceText.trim().length === 0) return null;

  const lowerAction = action.toLowerCase();
  const mentionedNames = squadNames
    .map((name) => ({ name, index: lowerAction.indexOf(name.toLowerCase()) }))
    .filter((entry) => entry.index !== -1)
    .sort((a, b) => a.index - b.index);
  const subject = mentionedNames[0]?.name ?? extractSubjectPhrase(action) ?? undefined;

  const sentences = splitIntoSentences(sourceText);
  if (sentences.length === 0) return null;

  let pool = sentences;
  if (subject) {
    const anchorIndex = sentences.findIndex((s) => s.toLowerCase().includes(subject.toLowerCase()));
    if (anchorIndex !== -1) {
      const otherNames = squadNames.filter((name) => name.toLowerCase() !== subject.toLowerCase());
      let spanEnd = Math.min(sentences.length, anchorIndex + 3);
      for (let i = anchorIndex + 1; i < spanEnd; i++) {
        if (otherNames.some((name) => sentences[i].toLowerCase().includes(name.toLowerCase()))) {
          spanEnd = i;
          break;
        }
      }
      pool = sentences.slice(anchorIndex, Math.max(spanEnd, anchorIndex + 1));
    }
  }

  const best = [...pool].sort((a, b) => countDigits(b) - countDigits(a))[0] ?? sentences[0];
  const focused = subject ? focusOnMention(best, subject) : best;

  const reason = condenseReason(focused, subject);
  return reason.length > 0 ? reason : null;
}
