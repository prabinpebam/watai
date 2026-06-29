/** Minimal credentials an embedder needs to call the inference endpoint.
 *  `DecryptedCredentials` satisfies this structurally, so callers can pass it directly. */
export interface EmbedCredentials {
  baseUrl: string;
  key: string;
}

/**
 * Produces a vector embedding for a piece of text. Implementations are model-pinned via `model`,
 * which is stamped onto stored records (`embeddingModel`) so a model change can be detected and
 * backfilled. Credentials are supplied per call because they are resolved per user.
 */
export interface Embedder {
  readonly model: string;
  embed(creds: EmbedCredentials, text: string): Promise<number[]>;
}
