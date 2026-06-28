const secretLikePatterns = [
  /sk-[A-Za-z0-9_-]{8,}/i,
  /eyJ[A-Za-z0-9_-]{10,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /DefaultEndpointsProtocol=/i,
  /AccountKey=/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(password|passphrase|secret|token)\s*(is|=|:)\s*\S+/i,
];

/** True when the value looks like a credential/secret that must never be stored as memory. */
export function containsSecretLikeValue(value: string): boolean {
  return secretLikePatterns.some((pattern) => pattern.test(value));
}
