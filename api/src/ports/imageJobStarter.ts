/** A queued image-generation job (one image per job). */
export interface ImageJob {
  imageId: string;
  userId: string;
}

/**
 * Enqueues image-generation jobs to a durable queue; a queue-triggered worker processes them
 * independently of the client (so closing the app cannot interrupt generation). Unit tests inject
 * a fake.
 */
export interface ImageJobStarter {
  start(job: ImageJob): Promise<void>;
}
