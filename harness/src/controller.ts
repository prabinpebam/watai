export interface WorkflowState {
  id: string;
  terminal: boolean;
}

export interface WorkflowTransition {
  from: string[];
  event: string;
  to: string;
  actor: string;
  guards: string[];
  effect: string;
}

export interface WorkflowDefinition {
  schemaVersion: string;
  status: string;
  initial: string;
  states: WorkflowState[];
  guards: string[];
  transitionDefaults: {
    requiredGuards: string[];
    commit: string;
  };
  transitions: WorkflowTransition[];
}

export interface EventEnvelope {
  schemaVersion: string;
  runId: string;
  eventId: string;
  expectedRevision: number;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  eventType: string;
  payloadSha256: string;
}

export interface EffectIntent {
  effectId: string;
  runId: string;
  epoch: number;
  kind: string;
  inputSha256: string;
  sourceSha: string;
  policySha256: string;
  eventId: string;
  providerId?: string;
  model?: string;
  permitId?: string;
  deadline: string;
  status: "pending";
}

export interface EventReceipt {
  eventId: string;
  commandFingerprint: string;
  actor: string;
  actorIdentity: string;
  eventType: string;
  payloadSha256: string;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  from: string;
  to: string;
  revision: number;
  effectId?: string;
  guardEvidence: Record<string, string>;
  permitId?: string;
}

export interface CandidateSnapshot {
  runId: string;
  state: string;
  revision: number;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  events: EventReceipt[];
  outbox: EffectIntent[];
  consumedPermitNonces: string[];
}

export interface GuardProof {
  guard: string;
  runId: string;
  eventId: string;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  evidenceSha256: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ReleasePermit {
  permitId: string;
  nonce: string;
  phase: "cohort" | "full";
  runId: string;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  manifestSha256: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ActorProof {
  role: string;
  identity: string;
  runId: string;
  eventId: string;
  fencingEpoch: number;
  sourceSha: string;
  policySha256: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface HarnessAuthorities {
  now(): number;
  limits: {
    maxClockSkewMs: number;
    maxGuardProofLifetimeMs: number;
    maxPermitLifetimeMs: number;
    maxEffectLifetimeMs: number;
  };
  verifyActor(proof: ActorProof): boolean;
  verifyGuard(proof: GuardProof): boolean;
  verifyPermit(permit: ReleasePermit): boolean;
}

export interface EventCommand {
  envelope: EventEnvelope;
  actor: string;
  actorProof: ActorProof;
  guardEvidence: Record<string, GuardProof>;
  effectDeadline?: string;
  effectProvider?: { providerId: string; model: string };
  permit?: ReleasePermit;
}

export type ApplyResult = {
  kind: "applied" | "replayed" | "quarantined";
  candidate: CandidateSnapshot;
  receipt: EventReceipt;
};

export type RejectionCode =
  | "ACTOR_MISMATCH"
  | "ACTOR_PROOF_INVALID"
  | "AMBIGUOUS_TRANSITION"
  | "DEFINITION_INVALID"
  | "EFFECT_DEADLINE_REQUIRED"
  | "EFFECT_DEADLINE_INVALID"
  | "EFFECT_PROVIDER_INVALID"
  | "EVENT_ID_CONFLICT"
  | "FENCING_EPOCH_MISMATCH"
  | "GUARD_EVIDENCE_INVALID"
  | "GUARD_EVIDENCE_MISSING"
  | "PERMIT_INVALID"
  | "PERMIT_REQUIRED"
  | "PERMIT_REUSED"
  | "POLICY_MISMATCH"
  | "REVISION_MISMATCH"
  | "RUN_MISMATCH"
  | "SOURCE_MISMATCH"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "TERMINAL_STATE"
  | "TRANSITION_NOT_FOUND";

export class HarnessRejection extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "HarnessRejection";
  }
}

export interface CompiledWorkflow {
  readonly definition: WorkflowDefinition;
  getState(id: string): WorkflowState | undefined;
  getTransition(state: string, event: string): WorkflowTransition | undefined;
}

const transitionKey = (state: string, event: string) => `${state}\u0000${event}`;

const unique = (values: string[]) => [...new Set(values)];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : canonical(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

const commandFingerprint = (command: EventCommand) => canonical({
  envelope: command.envelope,
  actor: command.actor,
  actorIdentity: command.actorProof.identity,
  effectProvider: command.effectProvider,
  permit: command.permit && {
    permitId: command.permit.permitId,
    nonce: command.permit.nonce,
    phase: command.permit.phase,
    runId: command.permit.runId,
    fencingEpoch: command.permit.fencingEpoch,
    sourceSha: command.permit.sourceSha,
    policySha256: command.permit.policySha256,
    manifestSha256: command.permit.manifestSha256,
  },
});

export function compileWorkflow(definition: WorkflowDefinition): CompiledWorkflow {
  definition = deepFreeze(clone(definition));
  if (definition.schemaVersion !== "1.0" || definition.status !== "SPECIFIED") {
    throw new HarnessRejection(
      "SCHEMA_VERSION_UNSUPPORTED",
      `Unsupported workflow ${definition.schemaVersion}/${definition.status}`,
    );
  }

  if (new Set(definition.guards).size !== definition.guards.length) {
    throw new HarnessRejection("DEFINITION_INVALID", "Workflow guards must be unique");
  }
  const declaredGuards = new Set(definition.guards);
  for (const guard of definition.transitionDefaults.requiredGuards) {
    if (!declaredGuards.has(guard)) {
      throw new HarnessRejection(
        "DEFINITION_INVALID",
        `Default transition references unknown guard ${guard}`,
      );
    }
  }

  const states = new Map<string, WorkflowState>();
  for (const state of definition.states) {
    if (!state.id || states.has(state.id)) {
      throw new HarnessRejection(
        "DEFINITION_INVALID",
        `Workflow state IDs must be non-empty and unique: ${state.id}`,
      );
    }
    states.set(state.id, state);
  }

  if (!states.has(definition.initial)) {
    throw new HarnessRejection(
      "DEFINITION_INVALID",
      `Initial state is not declared: ${definition.initial}`,
    );
  }

  const transitions = new Map<string, WorkflowTransition>();
  for (const transition of definition.transitions) {
    if (
      transition.from.length === 0 ||
      !transition.event ||
      !transition.actor ||
      !transition.effect ||
      !states.has(transition.to)
    ) {
      throw new HarnessRejection(
        "DEFINITION_INVALID",
        `Transition ${transition.event || "<unnamed>"} is incomplete`,
      );
    }

    for (const guard of transition.guards) {
      if (!declaredGuards.has(guard)) {
        throw new HarnessRejection(
          "DEFINITION_INVALID",
          `Transition ${transition.event} references unknown guard ${guard}`,
        );
      }
    }

    for (const from of transition.from) {
      if (!states.has(from)) {
        throw new HarnessRejection(
          "DEFINITION_INVALID",
          `Transition ${transition.event} references unknown state ${from}`,
        );
      }
      if (states.get(from)?.terminal) {
        throw new HarnessRejection(
          "DEFINITION_INVALID",
          `Terminal state ${from} cannot have outgoing transitions`,
        );
      }

      const key = transitionKey(from, transition.event);
      if (transitions.has(key)) {
        throw new HarnessRejection(
          "AMBIGUOUS_TRANSITION",
          `Multiple transitions handle ${transition.event} from ${from}`,
        );
      }
      transitions.set(key, transition);
    }
  }

  return Object.freeze({
    definition,
    getState: (id: string) => states.get(id),
    getTransition: (state: string, event: string) => transitions.get(transitionKey(state, event)),
  });
}

export function createCandidate(
  workflow: CompiledWorkflow,
  input: Pick<CandidateSnapshot, "runId" | "fencingEpoch" | "sourceSha" | "policySha256">,
): CandidateSnapshot {
  return {
    ...input,
    state: workflow.definition.initial,
    revision: 0,
    events: [],
    outbox: [],
    consumedPermitNonces: [],
  };
}

function reject(code: RejectionCode, message: string): never {
  throw new HarnessRejection(code, message);
}

function quarantineConflict(
  workflow: CompiledWorkflow,
  candidate: CandidateSnapshot,
  command: EventCommand,
  deadline: string,
): ApplyResult {
  const quarantine = workflow.getState("QUARANTINED");
  const current = workflow.getState(candidate.state);
  if (!quarantine || current?.terminal) {
    reject(
      "EVENT_ID_CONFLICT",
      `Event ${command.envelope.eventId} was reused with different content`,
    );
  }

  const revision = candidate.revision + 1;
  const effectId = `${candidate.runId}:integrity:${command.envelope.eventId}:${revision}`;
  const receipt: EventReceipt = {
    eventId: `integrity:${command.envelope.eventId}:${revision}`,
    commandFingerprint: commandFingerprint(command),
    actor: "controller",
    actorIdentity: "internal-integrity-monitor",
    eventType: "integrity_conflict",
    payloadSha256: command.envelope.payloadSha256,
    fencingEpoch: candidate.fencingEpoch,
    sourceSha: candidate.sourceSha,
    policySha256: candidate.policySha256,
    from: candidate.state,
    to: quarantine.id,
    revision,
    effectId,
    guardEvidence: {},
  };

  return {
    kind: "quarantined",
    receipt,
    candidate: {
      ...candidate,
      state: quarantine.id,
      revision,
      events: [...candidate.events, receipt],
      outbox: [
        ...candidate.outbox,
        {
          effectId,
          runId: candidate.runId,
          epoch: candidate.fencingEpoch,
          kind: "freeze",
          inputSha256: command.envelope.payloadSha256,
          sourceSha: candidate.sourceSha,
          policySha256: candidate.policySha256,
          eventId: command.envelope.eventId,
          deadline,
          status: "pending",
        },
      ],
    },
  };
}

function parseTimestamp(
  value: string,
  label: string,
  code: RejectionCode = "GUARD_EVIDENCE_INVALID",
): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    reject(code, `${label} is not a valid timestamp`);
  }
  return timestamp;
}

function verifyActorProof(
  command: EventCommand,
  authorities: HarnessAuthorities,
  now: number,
): void {
  const { actorProof: proof, envelope } = command;
  const issuedAt = parseTimestamp(proof.issuedAt, "actor.issuedAt", "ACTOR_PROOF_INVALID");
  const expiresAt = parseTimestamp(proof.expiresAt, "actor.expiresAt", "ACTOR_PROOF_INVALID");
  const bound =
    proof.role === command.actor &&
    proof.identity.trim().length > 0 &&
    proof.runId === envelope.runId &&
    proof.eventId === envelope.eventId &&
    proof.fencingEpoch === envelope.fencingEpoch &&
    proof.sourceSha === envelope.sourceSha &&
    proof.policySha256 === envelope.policySha256 &&
    proof.signature.trim().length > 0;

  if (
    !bound ||
    issuedAt > now + authorities.limits.maxClockSkewMs ||
    expiresAt <= now ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > authorities.limits.maxGuardProofLifetimeMs ||
    !authorities.verifyActor(proof)
  ) {
    reject("ACTOR_PROOF_INVALID", `Actor proof is invalid or stale: ${command.actor}`);
  }
}

function verifyGuardProof(
  guard: string,
  proof: GuardProof,
  command: EventCommand,
  authorities: HarnessAuthorities,
  now: number,
): void {
  const { envelope } = command;
  const issuedAt = parseTimestamp(proof.issuedAt, `${guard}.issuedAt`);
  const expiresAt = parseTimestamp(proof.expiresAt, `${guard}.expiresAt`);
  const bound =
    proof.guard === guard &&
    proof.runId === envelope.runId &&
    proof.eventId === envelope.eventId &&
    proof.fencingEpoch === envelope.fencingEpoch &&
    proof.sourceSha === envelope.sourceSha &&
    proof.policySha256 === envelope.policySha256 &&
    proof.evidenceSha256.trim().length > 0 &&
    proof.issuer.trim().length > 0 &&
    proof.signature.trim().length > 0;

  if (
    !bound ||
    issuedAt > now + authorities.limits.maxClockSkewMs ||
    expiresAt <= now ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > authorities.limits.maxGuardProofLifetimeMs
  ) {
    reject("GUARD_EVIDENCE_INVALID", `Guard proof is invalid or stale: ${guard}`);
  }
  if (!authorities.verifyGuard(proof)) {
    reject("GUARD_EVIDENCE_INVALID", `Guard proof signature was rejected: ${guard}`);
  }
}

function verifyReleasePermit(
  transition: WorkflowTransition,
  candidate: CandidateSnapshot,
  command: EventCommand,
  authorities: HarnessAuthorities,
  now: number,
): ReleasePermit | undefined {
  const phase = transition.effect === "promote"
    ? "cohort"
    : transition.effect === "expand"
      ? "full"
      : undefined;

  if (!phase) return undefined;
  const permit = command.permit;
  if (!permit) {
    reject("PERMIT_REQUIRED", `${transition.effect} requires a signed ${phase} permit`);
  }

  const issuedAt = Date.parse(permit.issuedAt);
  const expiresAt = Date.parse(permit.expiresAt);
  const { envelope } = command;
  const bound =
    permit.phase === phase &&
    permit.runId === envelope.runId &&
    permit.fencingEpoch === envelope.fencingEpoch &&
    permit.sourceSha === envelope.sourceSha &&
    permit.policySha256 === envelope.policySha256 &&
    permit.permitId.trim().length > 0 &&
    permit.nonce.trim().length > 0 &&
    permit.manifestSha256.trim().length > 0 &&
    permit.signature.trim().length > 0;

  if (
    !bound ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now + authorities.limits.maxClockSkewMs ||
    expiresAt <= now ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > authorities.limits.maxPermitLifetimeMs ||
    !authorities.verifyPermit(permit)
  ) {
    reject("PERMIT_INVALID", `Release permit is invalid or stale: ${permit.permitId}`);
  }
  if (candidate.consumedPermitNonces.includes(permit.nonce)) {
    reject("PERMIT_REUSED", `Release permit nonce was already consumed: ${permit.nonce}`);
  }
  return permit;
}

export function applyEvent(
  workflow: CompiledWorkflow,
  candidate: CandidateSnapshot,
  command: EventCommand,
  authorities: HarnessAuthorities,
): ApplyResult {
  const { envelope } = command;
  if (envelope.schemaVersion !== workflow.definition.schemaVersion) {
    reject(
      "SCHEMA_VERSION_UNSUPPORTED",
      `Unsupported event schema version ${envelope.schemaVersion}`,
    );
  }
  if (envelope.runId !== candidate.runId) {
    reject("RUN_MISMATCH", `Event run ${envelope.runId} does not match ${candidate.runId}`);
  }
  if (envelope.fencingEpoch !== candidate.fencingEpoch) {
    reject(
      "FENCING_EPOCH_MISMATCH",
      `Event epoch ${envelope.fencingEpoch} does not match ${candidate.fencingEpoch}`,
    );
  }
  if (envelope.sourceSha !== candidate.sourceSha) {
    reject("SOURCE_MISMATCH", "Event source does not match the candidate source");
  }
  if (envelope.policySha256 !== candidate.policySha256) {
    reject("POLICY_MISMATCH", "Event policy does not match the candidate policy");
  }

  const now = authorities.now();
  if (!Number.isFinite(now)) {
    reject("ACTOR_PROOF_INVALID", "Trusted clock returned an invalid timestamp");
  }
  verifyActorProof(command, authorities, now);

  const fingerprint = commandFingerprint(command);
  const prior = candidate.events.find((receipt) => receipt.eventId === envelope.eventId);

  if (prior) {
    if (prior.commandFingerprint === fingerprint) {
      return { kind: "replayed", candidate, receipt: prior };
    }
    const freezeDeadline = new Date(
      now + Math.min(30_000, authorities.limits.maxEffectLifetimeMs),
    ).toISOString();
    return quarantineConflict(workflow, candidate, command, freezeDeadline);
  }

  if (workflow.getState(candidate.state)?.terminal) {
    reject("TERMINAL_STATE", `Candidate is terminal in ${candidate.state}`);
  }
  if (envelope.expectedRevision !== candidate.revision) {
    reject(
      "REVISION_MISMATCH",
      `Expected revision ${envelope.expectedRevision}, current revision ${candidate.revision}`,
    );
  }
  const transition = workflow.getTransition(candidate.state, envelope.eventType);
  if (!transition) {
    reject(
      "TRANSITION_NOT_FOUND",
      `No transition handles ${envelope.eventType} from ${candidate.state}`,
    );
  }
  if (transition.actor !== command.actor) {
    reject(
      "ACTOR_MISMATCH",
      `${command.actor} cannot apply ${envelope.eventType}; expected ${transition.actor}`,
    );
  }

  const requiredGuards = unique([
    ...workflow.definition.transitionDefaults.requiredGuards,
    ...transition.guards,
  ]);
  const missingGuards = requiredGuards.filter((guard) => !command.guardEvidence[guard]);
  if (missingGuards.length > 0) {
    reject(
      "GUARD_EVIDENCE_MISSING",
      `Missing guard evidence: ${missingGuards.join(", ")}`,
    );
  }
  for (const guard of requiredGuards) {
    verifyGuardProof(guard, command.guardEvidence[guard], command, authorities, now);
  }
  if (transition.effect !== "none" && !command.effectDeadline?.trim()) {
    reject(
      "EFFECT_DEADLINE_REQUIRED",
      `Effect ${transition.effect} requires a deadline`,
    );
  }
  if (transition.effect !== "none") {
    const deadline = parseTimestamp(
      command.effectDeadline!,
      "effectDeadline",
      "EFFECT_DEADLINE_INVALID",
    );
    if (deadline <= now || deadline - now > authorities.limits.maxEffectLifetimeMs) {
      reject(
        "EFFECT_DEADLINE_INVALID",
        `Effect ${transition.effect} deadline is stale or exceeds its lifetime ceiling`,
      );
    }
  }
  if (
    transition.effect === "worker" &&
    (!command.effectProvider?.providerId.trim() || !command.effectProvider.model.trim() ||
      command.effectProvider.providerId.includes("*") || command.effectProvider.model.includes("*"))
  ) {
    reject("EFFECT_PROVIDER_INVALID", "Worker effects require an exact provider and model binding.");
  }
  const permit = verifyReleasePermit(transition, candidate, command, authorities, now);

  const revision = candidate.revision + 1;
  const effectId = transition.effect === "none"
    ? undefined
    : `${candidate.runId}:${envelope.eventId}:${candidate.fencingEpoch}:${transition.effect}`;
  const receipt: EventReceipt = {
    eventId: envelope.eventId,
    commandFingerprint: fingerprint,
    actor: command.actor,
    actorIdentity: command.actorProof.identity,
    eventType: envelope.eventType,
    payloadSha256: envelope.payloadSha256,
    fencingEpoch: envelope.fencingEpoch,
    sourceSha: envelope.sourceSha,
    policySha256: envelope.policySha256,
    from: candidate.state,
    to: transition.to,
    revision,
    effectId,
    guardEvidence: Object.fromEntries(
      requiredGuards.map((guard) => [guard, command.guardEvidence[guard].evidenceSha256]),
    ),
    permitId: permit?.permitId,
  };

  const outbox = effectId
    ? [
        ...candidate.outbox,
        {
          effectId,
          runId: candidate.runId,
          epoch: candidate.fencingEpoch,
          kind: transition.effect,
          inputSha256: envelope.payloadSha256,
          sourceSha: envelope.sourceSha,
          policySha256: envelope.policySha256,
          eventId: envelope.eventId,
          providerId: command.effectProvider?.providerId,
          model: command.effectProvider?.model,
          permitId: permit?.permitId,
          deadline: command.effectDeadline!,
          status: "pending" as const,
        },
      ]
    : candidate.outbox;

  return {
    kind: "applied",
    receipt,
    candidate: {
      ...candidate,
      state: transition.to,
      revision,
      events: [...candidate.events, receipt],
      outbox,
      consumedPermitNonces: permit
        ? [...candidate.consumedPermitNonces, permit.nonce]
        : candidate.consumedPermitNonces,
    },
  };
}

export class InMemoryCandidateLedger {
  private current: CandidateSnapshot;

  constructor(initial: CandidateSnapshot) {
    this.current = clone(initial);
  }

  read(): CandidateSnapshot {
    return clone(this.current);
  }

  dispatch(
    workflow: CompiledWorkflow,
    command: EventCommand,
    authorities: HarnessAuthorities,
  ): ApplyResult {
    const expectedRevision = this.current.revision;
    const result = applyEvent(workflow, this.read(), command, authorities);
    if (result.kind !== "replayed") {
      if (this.current.revision !== expectedRevision) {
        reject(
          "REVISION_MISMATCH",
          `CAS expected revision ${expectedRevision}, current revision ${this.current.revision}`,
        );
      }
      this.current = clone(result.candidate);
    }
    return {
      ...result,
      candidate: this.read(),
      receipt: clone(result.receipt),
    };
  }
}