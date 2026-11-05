// Reads the next chunk of a streamed response, rejecting if nothing arrives within `ms`.
// The reader is cancelled on failure so a dead connection is released. Racing the read
// against a timer that only rejects keeps the outcome independent of the order in which
// promises settle, so a stall always surfaces as an error.
// Cancel rejects the read that lost the race. That handler is attached up front so the
// rejection is not unhandled once the race has already settled on the stall.
export async function readWithStallTimeout(reader, ms) {
  let timer;
  const pending = reader.read();
  pending.catch(() => {});
  const stalled = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The connection stalled.')), ms);
  });
  try {
    return await Promise.race([pending, stalled]);
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
