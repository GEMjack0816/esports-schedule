export const SUBMISSION_REQUEST_POLICY = {
  maxBodyBytes: 10_000,
  // The public JSON form is small; never occupy a function until its platform timeout.
  maxBodyReadMs: 5_000,
  // Includes empty chunks: byte limits alone do not bound fragmented-stream CPU work.
  // One-byte fragmentation of the entire allowed body still fits comfortably.
  maxBodyChunks: 20_000,
} as const;
