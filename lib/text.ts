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
