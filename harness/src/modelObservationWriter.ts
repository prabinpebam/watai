import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LiveModelRunObservation } from "./modelEvaluation.js";
import { canonical } from "./trust.js";
import { modelEvaluationObservationClaim } from "./trustAuthorities.js";

export async function writePortableModelObservations(
  outputPath: string,
  observations: LiveModelRunObservation[],
): Promise<{ path: string; sha256: string; count: number }> {
  if (observations.length === 0) throw new Error("At least one model observation is required.");
  const identities = new Set<string>();
  for (const observation of observations) {
    const identity = `${observation.evaluationId}:${observation.runId}:${observation.caseId}:${observation.repetition}`;
    if (identities.has(identity)) throw new Error(`Duplicate model observation ${identity}.`);
    identities.add(identity);
  }
  const content = `${observations.map((observation) => canonical(observation)).join("\n")}\n`;
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    path: outputPath,
    sha256: createHash("sha256").update(content).digest("hex"),
    count: observations.length,
  };
}

export async function writeModelObservationClaims(
  outputDirectory: string,
  observations: LiveModelRunObservation[],
): Promise<{ directory: string; count: number }> {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  for (const observation of observations) {
    const claim = modelEvaluationObservationClaim(observation);
    const safeName = `${observation.evaluationId}-${observation.caseId}-${observation.repetition}-${observation.runId}`
      .replace(/[^A-Za-z0-9._-]/g, "_");
    await writeFile(
      resolve(outputDirectory, `${safeName}.json`),
      `${JSON.stringify(claim, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  }
  return { directory: outputDirectory, count: observations.length };
}
