/**
 * Fill the positional placeholders (`{0}`, `{1}`, …) of an engine built-in template (see `builtinEntries.ts`) with the argument
 * texts of the `engine` IR op. Arguments that are not a plain identifier / member / number are parenthesised so that a template
 * such as `GetAdditionalLight((uint){1}, {0})` stays correct when the argument is an expression (`a + b`).
 * Templates without placeholders are returned unchanged.
 */
const SIMPLE = /^[A-Za-z0-9_.]+$/;
export function fillEngineTemplate(template: string, args: readonly string[] = []): string {
  return template.replace(/\{(\d+)\}/g, (_m, i: string) => {
    const a = args[Number(i)];
    if (a === undefined) return _m;
    return SIMPLE.test(a) || (/^\(.*\)$/.test(a) && balanced(a)) ? a : `(${a})`;
  });
}

/** True when the leading "(" of `s` closes at the very end (so `(a)+(b)` is NOT considered wrapped). */
function balanced(s: string): boolean {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0 && i < s.length - 1) return false;
  }
  return d === 0;
}
