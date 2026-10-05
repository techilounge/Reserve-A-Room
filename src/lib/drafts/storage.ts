/** `sessionStorage`, or null where the browser blocks it (the property access itself can throw). */
export function browserStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
