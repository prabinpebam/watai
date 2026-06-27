import type { ArtifactKind } from './message';

/** A curated, versioned playbook that tells the agent exactly how to do a class of artifact task
 *  well (which preinstalled Python library to use, layout rules, snippets). Selected by keyword
 *  match and injected into the system prompt when the code interpreter is enabled. */
export interface Skill {
  id: string;
  name: string;
  /** One line for matching + the client provenance chip. */
  summary: string;
  /** Lowercase trigger terms ranked against the user's request. */
  keywords: string[];
  /** Artifact kinds this skill produces (icon/UX hint). */
  outputs: ArtifactKind[];
  /** The playbook injected into the system prompt (markdown). */
  body: string;
  version: number;
}
