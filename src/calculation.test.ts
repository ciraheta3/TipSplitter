import { describe, expect, it } from 'vitest';
import type { Participant, PayoutMode } from './calculation';
import {
  distributeTips,
  formatCents,
  parseTipInput,
  parseWeightInput,
  reconcilePayouts,
  sumTipCents,
} from './calculation';

const participants = (weights: number[]): Participant[] => weights.map((weightUnits, index) => ({
  id: `employee-${index}`,
  weightUnits,
}));

describe('weighted distribution', () => {
  const team = participants([parseWeightInput('100'), parseWeightInput('50')]);

  it('floors $100.00 with weights 100:50 to cents and records the residual penny', () => {
    const result = distributeTips(10_000, team);
    expect(result.payouts).toEqual([
      { id: 'employee-0', cents: 6666 },
      { id: 'employee-1', cents: 3333 },
    ]);
    expect(result).toMatchObject({ allocatedCents: 9999, remainderCents: 1, status: 'allocated' });
  });

  it('does not turn two cents into three cents or silently award residual pennies', () => {
    const result = distributeTips(2, participants([10_000, 10_000, 10_000]));
    expect(result.payouts.map(payout => payout.cents)).toEqual([0, 0, 0]);
    expect(result.allocatedCents).toBe(0);
    expect(result.remainderCents).toBe(2);
  });

  it('floors $100.00 with weights 100:50 to $66 and $33, leaving $1', () => {
    const result = distributeTips(10_000, team, 'whole-dollar');
    expect(result.payouts.map(payout => payout.cents)).toEqual([6600, 3300]);
    expect(result.allocatedCents).toBe(9900);
    expect(result.remainderCents).toBe(100);
  });

  it('keeps an empty or zero-total-weight pool entirely unassigned', () => {
    for (const roster of [[], participants([0, 0])]) {
      const result = distributeTips(1234, roster);
      expect(result).toMatchObject({
        allocatedCents: 0, remainderCents: 1234, totalWeightUnits: 0, status: 'no-positive-weight',
      });
      expect(result.payouts.every(payout => payout.cents === 0)).toBe(true);
    }
  });

  it('supports zero individual weights, fractional shares, and a zero pool', () => {
    const roster = participants(['0', '0.25', '0.75'].map(parseWeightInput));
    expect(distributeTips(100, roster).payouts.map(payout => payout.cents)).toEqual([0, 25, 75]);
    expect(distributeTips(0, roster)).toMatchObject({ allocatedCents: 0, remainderCents: 0 });
  });

  it('handles products beyond the safe-number range without losing cents', () => {
    const result = distributeTips(Number.MAX_SAFE_INTEGER, participants([1, 2]));
    expect(result.payouts.map(payout => payout.cents)).toEqual([3002399751580330, 6004799503160660]);
    expect(result.remainderCents).toBe(1);
    expect(distributeTips(Number.MAX_SAFE_INTEGER, participants([Number.MAX_SAFE_INTEGER]))
      .payouts[0].cents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('conserves the original pool across small pools, uneven teams, and both modes', () => {
    const rosters = [[], [0, 0], [1], [1, 1, 1], [0, 1, 100], [123, 457, 89], [1, Number.MAX_SAFE_INTEGER - 1]];
    const modes: PayoutMode[] = ['exact-cent', 'whole-dollar'];
    for (const weights of rosters) {
      for (const mode of modes) {
        for (const pool of [0, 1, 2, 3, 99, 100, 101, 10_000, Number.MAX_SAFE_INTEGER]) {
          const result = distributeTips(pool, participants(weights), mode);
          const allocated = result.payouts.reduce((sum, payout) => sum + BigInt(payout.cents), 0n);
          expect(allocated + BigInt(result.remainderCents)).toBe(BigInt(pool));
          expect(result.allocatedCents).toBe(Number(allocated));
          expect(result.remainderCents).toBeGreaterThanOrEqual(0);
          for (const payout of result.payouts) {
            expect(Number.isSafeInteger(payout.cents)).toBe(true);
            expect(payout.cents).toBeGreaterThanOrEqual(0);
            if (mode === 'whole-dollar') expect(payout.cents % 100).toBe(0);
          }
        }
      }
    }
  });

  it('preserves participant order and does not mutate the roster', () => {
    const roster = Object.freeze([
      Object.freeze({ id: 'example-a', weightUnits: 1 }),
      Object.freeze({ id: 'example-b', weightUnits: 2 }),
    ]);
    expect(distributeTips(300, roster).payouts).toEqual([
      { id: 'example-a', cents: 100 }, { id: 'example-b', cents: 200 },
    ]);
  });

  const invalidNumbers = [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];
  it.each(invalidNumbers)('rejects invalid pool cents %s', value => {
    expect(() => distributeTips(value, team)).toThrow(RangeError);
  });
  it.each(invalidNumbers)('rejects invalid weight units %s', value => {
    expect(() => distributeTips(100, participants([1, value]))).toThrow(RangeError);
  });
  it('rejects malformed runtime values, duplicate IDs, and unknown modes', () => {
    expect(() => distributeTips('100' as unknown as number, team)).toThrow(RangeError);
    expect(() => distributeTips(100, participants(['1' as unknown as number]))).toThrow(RangeError);
    expect(() => distributeTips(100, [{ id: '', weightUnits: 1 }])).toThrow(RangeError);
    expect(() => distributeTips(100, [team[0], team[0]])).toThrow(RangeError);
    expect(() => distributeTips(100, team, 'nearest' as PayoutMode)).toThrow(RangeError);
  });
  it('rejects a total weight beyond the supported safe-integer range', () => {
    expect(() => distributeTips(1, participants([Number.MAX_SAFE_INTEGER, 1]))).toThrow(RangeError);
  });
});

describe('decimal input boundaries', () => {
  it.each([
    ['', 0], ['  ', 0], ['0', 0], ['1.15', 115], ['0.29', 29], ['.02', 2],
    ['1.', 100], ['001.2', 120], [' 12.34 ', 1234], ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('parses tip text %j as %s cents without floating-point rounding', (text, expected) => {
    expect(parseTipInput(text)).toBe(expected);
  });

  it.each(['-1', '-0.01', 'NaN', 'Infinity', '-Infinity', 'abc', '1x', '1e2', '1,000', '1.001', '.', '+1', '90071992547409.92'])(
    'rejects invalid money and weight text %j', text => {
      expect(() => parseTipInput(text)).toThrow(RangeError);
      expect(() => parseWeightInput(text)).toThrow(RangeError);
    });

  it('scales weights by 100 and rejects an empty weight instead of assuming zero', () => {
    expect(parseWeightInput('100')).toBe(10_000);
    expect(parseWeightInput('0.01')).toBe(1);
    expect(parseWeightInput('0')).toBe(0);
    expect(() => parseWeightInput('')).toThrow(RangeError);
  });

  it('sums cash and credit only after each is parsed into cents', () => {
    expect(sumTipCents(parseTipInput('0.10'), parseTipInput('0.20'))).toBe(30);
    expect(sumTipCents(parseTipInput('1.15'), parseTipInput('0.29'))).toBe(144);
    expect(() => sumTipCents(-1, 2)).toThrow(RangeError);
    expect(() => sumTipCents(1, NaN)).toThrow(RangeError);
    expect(() => sumTipCents(Infinity, 1)).toThrow(RangeError);
    expect(() => sumTipCents(0.1, 1)).toThrow(RangeError);
    expect(() => sumTipCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});

describe('signed reconciliation and presentation', () => {
  it('retains positive, zero, and negative reconciliation without modifying payouts', () => {
    expect(reconcilePayouts(100, [])).toEqual({ allocatedCents: 0, remainderCents: 100 });
    expect(reconcilePayouts(100, [60, 40])).toEqual({ allocatedCents: 100, remainderCents: 0 });
    expect(reconcilePayouts(2, [1, 1, 1])).toEqual({ allocatedCents: 3, remainderCents: -1 });
    expect(reconcilePayouts(0, [Number.MAX_SAFE_INTEGER])).toEqual({
      allocatedCents: Number.MAX_SAFE_INTEGER, remainderCents: -Number.MAX_SAFE_INTEGER,
    });
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid ledger inputs %s', value => {
    expect(() => reconcilePayouts(value, [])).toThrow(RangeError);
    expect(() => reconcilePayouts(100, [value])).toThrow(RangeError);
  });
  it('rejects an allocated total outside the supported safe-integer range', () => {
    expect(() => reconcilePayouts(0, [Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });

  it.each([[0, '0.00'], [2, '0.02'], [-1, '-0.01'], [100, '1.00'], [Number.MAX_SAFE_INTEGER, '90071992547409.91']])(
    'formats %s cents exactly as %s', (cents, expected) => {
      expect(formatCents(cents)).toBe(expected);
    });
  it('does not format invalid cents into a plausible amount', () => {
    expect(() => formatCents(NaN)).toThrow(RangeError);
    expect(() => formatCents(0.1)).toThrow(RangeError);
  });
});
