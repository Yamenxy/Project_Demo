/** Polls until the condition holds, or fails after the timeout. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Condition not met within ' + String(timeoutMs) + ' ms');
}
