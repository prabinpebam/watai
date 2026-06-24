/** A minted, short-lived, blob-scoped SAS grant. */
export interface SasGrant {
  url: string;
  expiresAt: string;
}

/**
 * Port for minting scoped, least-privilege, short-lived SAS tokens. The real adapter
 * uses Azure Storage; the API never hands storage account keys to the client.
 */
export interface SasMinter {
  mint(args: {
    blobPath: string;
    op: 'read' | 'write';
    contentType?: string;
    ttlSeconds: number;
  }): Promise<SasGrant>;
}
