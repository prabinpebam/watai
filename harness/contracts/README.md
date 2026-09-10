# External authority bundle

Operational authority is read from a directory outside the repository named by
`WATAI_HARNESS_AUTHORITY_DIR`:

```text
<authority-dir>/
  trust-root.json
  claims/
    <one signed claim per file>.json
```

`WATAI_HARNESS_ROOT_SHA256` is the lowercase SHA-256 of the canonical root
manifest and must be pinned by owner-controlled configuration separate from the
bundle and outside candidate write access. The loader resolves physical paths and
rejects a bundle, root or claim that traverses a symlink/junction into the
repository or escapes the authority directory.
The root contains public keys only. Private keys belong in independent workload
identities or a key service and must never be passed to the controller, broker,
tool sandbox, repository, CI artifact, or model context.

Every claim uses the domain-separated signing bytes returned by
`claimSigningBytes()` in `harness/src/trust.ts`. Claims are repository, root ID,
root epoch, issuer, kind, time-window and payload bound. Invalid or expired claims
do not degrade to ambient login or unsigned operation.

An authorization grant can use `billing.kind: "subscription"` with zero USD only
when request/token ceilings are positive and the independent `agent-provider` and
`budget-reservation` capability attestations prove that subscription path. A
logged-in CLI session is not such an attestation.

After a clean commit, run `npm run harness:authority-inputs` to produce the exact
root digest inputs and the unsigned H01 observation hash. The command never
generates a key, signs a claim, or grants authority; those remain an independent
owner-controlled ceremony.