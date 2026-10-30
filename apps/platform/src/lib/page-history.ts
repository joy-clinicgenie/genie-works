/** Keeps the in-app pages visited in this tab, so Back can return to the previous one. */

export function rememberPage(stack: readonly string[], here: string): string[] {
  if (!here.startsWith("/") || here.startsWith("//")) return [...stack];
  if (stack.at(-1) === here) return [...stack];
  if (stack.at(-2) === here) return stack.slice(0, -1);
  return [...stack, here].slice(-40);
}

export function previousPage(stack: readonly string[]): string | null {
  return stack.length > 1 ? stack.at(-2) ?? null : null;
}

/** Main sections are a single path, such as /clients. Back belongs on a page nested under one. */
export function isNestedPage(pathname: string): boolean {
  return pathname.split("/").filter(Boolean).length > 1;
}

export function pageBackTarget(pathname: string, stack: readonly string[]): string | null {
  if (!isNestedPage(pathname)) return null;
  return previousPage(stack);
}
