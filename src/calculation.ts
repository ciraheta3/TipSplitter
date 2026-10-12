/** Money is integer cents; weights use 100 integer units per share. */
export const WEIGHT_SCALE = 100;

export type PayoutMode = 'exact-cent' | 'whole-dollar';

export interface Participant {
  id: string;
  weightUnits: number;
}

export interface Payout {
  id: string;
  cents: number;
}

export interface Reconciliation {
  allocatedCents: number;
  /** Collected minus allocated: positive is unassigned, negative is overpaid. */
  remainderCents: number;
}

export interface Distribution extends Reconciliation {
  poolCents: number;
  totalWeightUnits: number;
  payouts: Payout[];
  status: 'allocated' | 'no-positive-weight';
}

function requireNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer.`);
  }
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return Number(value);
}

/** Parse decimal text directly, without rounding a floating-point dollar value. */
function parseHundredths(input: string, label: string): number {
  const text = input.trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) {
    throw new RangeError(`${label} must be nonnegative decimal text with at most two decimal places.`);
  }
  const [whole, fraction = ''] = text.split('.');
  return safeNumber(BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0')), label);
}

/** Empty cash/credit fields preserve the prototype's zero-input behavior. */
export function parseTipInput(input: string, label = 'Tips'): number {
  return input.trim() === '' ? 0 : parseHundredths(input, label);
}

export function parseWeightInput(input: string): number {
  return parseHundredths(input, 'Weight');
}

export function sumTipCents(cashCents: number, creditCents: number): number {
  requireNonnegativeInteger(cashCents, 'Cash tips');
  requireNonnegativeInteger(creditCents, 'Credit tips');
  return safeNumber(BigInt(cashCents) + BigInt(creditCents), 'Total tips');
}

/** Reconcile even overpayments without hiding their sign or changing payouts. */
export function reconcilePayouts(poolCents: number, payoutsCents: readonly number[]): Reconciliation {
  requireNonnegativeInteger(poolCents, 'Tip pool');
  const allocated = payoutsCents.reduce((sum, cents) => {
    requireNonnegativeInteger(cents, 'Payout');
    return sum + BigInt(cents);
  }, 0n);
  return {
    allocatedCents: safeNumber(allocated, 'Allocated tips'),
    remainderCents: safeNumber(BigInt(poolCents) - allocated, 'Remainder'),
  };
}

/** Floor each proportional share; residual money stays explicitly unassigned. */
export function distributeTips(
  poolCents: number,
  participants: readonly Participant[],
  mode: PayoutMode = 'exact-cent',
): Distribution {
  requireNonnegativeInteger(poolCents, 'Tip pool');
  if (mode !== 'exact-cent' && mode !== 'whole-dollar') {
    throw new RangeError('Unknown payout mode.');
  }
  const ids = new Set<string>();
  const totalWeight = participants.reduce((sum, participant) => {
    if (typeof participant.id !== 'string' || !participant.id.trim() || ids.has(participant.id)) {
      throw new RangeError('Participant IDs must be nonempty and unique.');
    }
    ids.add(participant.id);
    requireNonnegativeInteger(participant.weightUnits, 'Weight units');
    return sum + BigInt(participant.weightUnits);
  }, 0n);
  const totalWeightUnits = safeNumber(totalWeight, 'Total weight units');
  const quantum = mode === 'whole-dollar' ? 100n : 1n;
  const payouts = participants.map(({ id, weightUnits }) => ({
    id,
    // BigInt also protects intermediate products beyond Number's safe range.
    cents: totalWeight === 0n ? 0 : Number(
      (BigInt(poolCents) * BigInt(weightUnits) / (totalWeight * quantum)) * quantum,
    ),
  }));
  return {
    poolCents,
    totalWeightUnits,
    payouts,
    status: totalWeight === 0n ? 'no-positive-weight' : 'allocated',
    ...reconcilePayouts(poolCents, payouts.map(payout => payout.cents)),
  };
}

/** Format without converting cents to fractional floating-point dollars. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Cents must be a safe integer.');
  }
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
