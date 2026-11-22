import test from 'node:test';
import assert from 'node:assert/strict';
import { computePointerCardMetrics } from './cardInteractivity.js';

test('computePointerCardMetrics computes centered and edge coordinates accurately', () => {
  const rect = { left: 100, top: 200, width: 400, height: 200 };

  const center = computePointerCardMetrics(rect, 300, 300);
  assert.equal(center.xPx, 200);
  assert.equal(center.yPx, 100);
  assert.equal(center.xPercent, 50);
  assert.equal(center.yPercent, 50);
  assert.equal(center.tiltX, 0);
  assert.equal(center.tiltY, 0);

  const topRight = computePointerCardMetrics(rect, 500, 200);
  assert.equal(topRight.xPx, 400);
  assert.equal(topRight.yPx, 0);
  assert.equal(topRight.xPercent, 100);
  assert.equal(topRight.yPercent, 0);
  assert.equal(topRight.tiltX, 1.8);
  assert.equal(topRight.tiltY, 1.8);
});

test('computePointerCardMetrics clamps out-of-bounds coordinates safely', () => {
  const rect = { left: 50, top: 50, width: 200, height: 100 };
  const clamped = computePointerCardMetrics(rect, -20, 500);
  assert.equal(clamped.xPx, 0);
  assert.equal(clamped.yPx, 100);
  assert.equal(clamped.xPercent, 0);
  assert.equal(clamped.yPercent, 100);
});
