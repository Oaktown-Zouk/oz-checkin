import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRetryAfterStatus, retryDelayMs } from "./retry.js";

describe("shouldRetryAfterStatus", () => {
  it("retries a 429 within the attempt budget", () => {
    assert.equal(shouldRetryAfterStatus(429, 0), true);
    assert.equal(shouldRetryAfterStatus(429, 2), true);
  });
  it("stops retrying once the attempt budget is exhausted", () => {
    assert.equal(shouldRetryAfterStatus(429, 3), false);
    assert.equal(shouldRetryAfterStatus(429, 4), false);
  });
  it("never retries a non-429 status, regardless of attempt count", () => {
    assert.equal(shouldRetryAfterStatus(500, 0), false);
    assert.equal(shouldRetryAfterStatus(422, 0), false);
    assert.equal(shouldRetryAfterStatus(200, 0), false);
  });
  it("honors a custom maxAttempts", () => {
    assert.equal(shouldRetryAfterStatus(429, 1, 1), false);
    assert.equal(shouldRetryAfterStatus(429, 0, 1), true);
  });
});

describe("retryDelayMs", () => {
  it("backs off linearly starting at 1 second", () => {
    assert.equal(retryDelayMs(0), 1000);
    assert.equal(retryDelayMs(1), 2000);
    assert.equal(retryDelayMs(2), 3000);
  });
});
