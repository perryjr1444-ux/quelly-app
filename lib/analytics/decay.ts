export type DecayTerm = {
  weightK: number;      // k
  intensity: number;    // I
  area: number;         // dA
  occurredAtSec?: number; // optional for on-demand computation
};

export function lambdaFromHalfLife(halfLifeSec: number): number {
  return Math.log(2) / Math.max(1, halfLifeSec);
}

// On-demand computation:
// C(t) = Σ (k * I * dA * e^(−λ * (t − t_i)))
export function computeDecayedSum(nowSec: number, lambda: number, terms: DecayTerm[]): number {
  let sum = 0;
  for (const t of terms) {
    const ageSec = t.occurredAtSec ? Math.max(0, nowSec - t.occurredAtSec) : 0;
    const decay = Math.exp(-lambda * ageSec);
    sum += t.weightK * t.intensity * t.area * decay;
  }
  return sum;
}

// Streaming/incremental update:
// C(now) = C(prev) * e^(−λ * Δt) + Σ (k * I * dA) for new events
export function advanceDecayedSum(
  prevC: number,
  deltaSec: number,
  lambda: number,
  newTerms: Omit<DecayTerm, 'occurredAtSec'>[]
): number {
  const decayed = prevC * Math.exp(-lambda * Math.max(0, deltaSec));
  const added = newTerms.reduce((acc, t) => acc + (t.weightK * t.intensity * t.area), 0);
  return decayed + added;
}
