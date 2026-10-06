// Exact quarter-note units. Native MuseScore fractions are whole-note units.
export type Fraction = Readonly<{ n: number; d: number }>;
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : Math.abs(a); }
export function fraction(n: number, d = 1): Fraction {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) throw new Error('Invalid musical fraction.');
  const divisor = gcd(n, d);
  return { n: n / divisor * Math.sign(d), d: Math.abs(d / divisor) };
}
export const ZERO = fraction(0);
export const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
export const compare = (a: Fraction, b: Fraction) => a.n * b.d - b.n * a.d;
export const value = (a: Fraction) => a.n / a.d;
export const key = (a: Fraction) => `${a.n}/${a.d}`;
export function fromString(text: string): Fraction {
  const match = /^\s*(-?\d+)(?:\/(\d+))?\s*$/.exec(text);
  if (!match) throw new Error(`Invalid musical fraction: ${text}`);
  return fraction(Number(match[1]), Number(match[2] || 1));
}
export const nativeFraction = (text: string) => mul(fromString(text), fraction(4));
