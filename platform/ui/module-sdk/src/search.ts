/**
 * A failed search with a message the user can read and act on, e.g. "Search
 * needs the Models service, which isn't available right now." A provider
 * throws it when it knows better than the shell what went wrong; the shell
 * shows `message` in the provider's group. The original error is `cause`.
 */
export class SearchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SearchError";
  }
}
