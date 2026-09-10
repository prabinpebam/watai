# Trust root provisioning boundary

No active trust root or private key is checked into this repository.

The harness verifier accepts an Ed25519 public-key manifest only when its complete
SHA-256 digest is separately supplied as `WATAI_HARNESS_ROOT_SHA256` outside
candidate and bundle write authority. Issuer keys are
allowlisted by artifact kind, and every claim is domain-separated by root ID,
root epoch and repository identity.

Private signing keys must live in independently managed workload identities or
an external key service. A builder, controller process, candidate worktree, test
fixture or repository secret must not hold them. Test-generated keys under
`harness/src/*.test.ts` are synthetic and have no operational authority.

Activating a root requires a separate H02 policy-evolution run validated by the
previous immutable root. The initial root requires an explicit owner-controlled
bootstrap record; this repository does not create or approve that record itself.