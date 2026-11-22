import test from 'node:test';
import assert from 'node:assert/strict';
import {annualTrend} from '../lib/trend.ts';

test('three-point extrapolation fits OLS rather than extending the last change', () => {
 assert.deepEqual(annualTrend([60, 72, 66]), {fitted:[63,66,69],slope:3,projected:72});
 assert.equal(annualTrend([60, 72]), null);
 assert.equal(annualTrend([60, NaN, 66]), null);
});
