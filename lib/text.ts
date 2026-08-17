// Splits a plain-text response into labeled sections of the form
// "LABEL: body text..." — used to parse Claude's structured-but-plain-English
// replies without asking it to return JSON (which would invite markdown/formatting).
export function splitLabeledSections<T extends string>(
  text: string,
  labels: readonly T[],
): Record<T, string> {
  const result = Object.fromEntries(labels.map((label) => [label, ""])) as Record<T, string>;
  const pattern = new RegExp(`(${labels.join("|")}):`, "g");
  const matches = [...text.matchAll(pattern)];

  matches.forEach((match, index) => {
    const key = match[1] as T;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    result[key] = text.slice(start, end).trim();
  });

  if (!matches.length && labels.length > 0) {
    result[labels[0]] = text.trim();
  }

  return result;
}

// Pulls the first {...} block out of a response and parses it — Claude
// sometimes wraps JSON in a sentence or code fence despite instructions not
// to. Returns null rather than throwing on anything malformed.
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
