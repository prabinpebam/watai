/**
 * Wraps/unwraps a per-record data-encryption key (DEK) with a key-encryption-key (KEK).
 * The KEK never leaves its trust boundary: the production adapter delegates wrap/unwrap to
 * Azure Key Vault via Managed Identity; the local adapter uses an app-setting master key.
 * This indirection keeps the envelope-crypto domain pure and unit-testable.
 */
export interface WrappedKey {
  /** base64 of the wrapped DEK. */
  wrapped: string;
  /** Identifies the KEK used, so a rotated KEK can still unwrap old records. */
  kekVersion: string;
}

export interface KeyWrapper {
  wrapKey(dek: Buffer): Promise<WrappedKey>;
  unwrapKey(wrapped: string, kekVersion: string): Promise<Buffer>;
}
