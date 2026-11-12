/**
 * Display only (the data is unchanged): the chains' files glue numbers to Hebrew letters
 * ("הומוגני3% 1.5ל") - in RTL that reads as "71.5". Add a space between a digit and a Hebrew letter.
 */
export function displayName(name: string): string {
  return name
    .replace(/([א-ת])(\d)/g, "$1 $2")
    .replace(/(\d%?)([א-ת])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}
