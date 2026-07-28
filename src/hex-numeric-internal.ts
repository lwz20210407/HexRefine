export interface ScaledValue {
  mantissa: number;
  exponent: number;
}

export function determinant3(matrix: readonly number[][]): number {
  return materializeScaledValue(determinant3Scaled(matrix));
}

export function determinant3Scaled(
  matrix: readonly number[][]
): ScaledValue {
  const [a, b, c] = matrix;
  return sumScaledValues([
    scaledProduct3(a![0]!, b![1]!, c![2]!),
    scaleScaledValue(scaledProduct3(a![0]!, b![2]!, c![1]!), -1),
    scaleScaledValue(scaledProduct3(b![0]!, a![1]!, c![2]!), -1),
    scaledProduct3(b![0]!, a![2]!, c![1]!),
    scaledProduct3(c![0]!, a![1]!, b![2]!),
    scaleScaledValue(scaledProduct3(c![0]!, a![2]!, b![1]!), -1)
  ]);
}

export function sumScaledValues(
  values: readonly ScaledValue[]
): ScaledValue {
  if (values.some((value) => Number.isNaN(value.mantissa))) {
    return { mantissa: Number.NaN, exponent: 0 };
  }
  const infinities = values.filter(
    (value) => !Number.isFinite(value.mantissa)
  );
  if (infinities.length > 0) {
    const hasPositive = infinities.some((value) => value.mantissa > 0);
    const hasNegative = infinities.some((value) => value.mantissa < 0);
    return {
      mantissa: hasPositive && hasNegative
        ? Number.NaN
        : hasNegative
          ? Number.NEGATIVE_INFINITY
          : Number.POSITIVE_INFINITY,
      exponent: 0
    };
  }
  const finite = values
    .filter((value) => value.mantissa !== 0)
    .slice()
    .sort((first, second) => second.exponent - first.exponent);
  if (finite.length === 0) {
    return { mantissa: 0, exponent: 0 };
  }

  let total = { mantissa: 0, exponent: 0 };
  let index = 0;
  while (index < finite.length) {
    const exponent = finite[index]!.exponent;
    let sum = 0;
    let correction = 0;
    while (index < finite.length && finite[index]!.exponent === exponent) {
      const value = finite[index]!.mantissa;
      const next = sum + value;
      correction += Math.abs(sum) >= Math.abs(value)
        ? (sum - next) + value
        : (value - next) + sum;
      sum = next;
      index += 1;
    }
    total = addScaledValues(
      total,
      normalizeScaledValue(sum + correction, exponent)
    );
  }
  return total;
}

export function scaleScaledValue(
  value: ScaledValue,
  factor: number
): ScaledValue {
  return {
    mantissa: value.mantissa * factor,
    exponent: value.exponent
  };
}

export function materializeScaledValue(value: ScaledValue): number {
  if (value.mantissa === 0 || !Number.isFinite(value.mantissa)) {
    return value.mantissa;
  }
  if (value.exponent > 1023) {
    return value.mantissa < 0
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  }
  if (value.exponent < -1074) {
    return value.mantissa < 0 ? -0 : 0;
  }
  return value.mantissa * (2 ** value.exponent);
}

export function relativeDifferenceRatioScaled(
  reference: ScaledValue,
  candidate: ScaledValue
): number {
  const difference = sumScaledValues([
    candidate,
    scaleScaledValue(reference, -1)
  ]);
  if (reference.mantissa === 0) {
    return difference.mantissa === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  if (
    !Number.isFinite(reference.mantissa)
    || !Number.isFinite(difference.mantissa)
  ) {
    return Number.NaN;
  }
  return Math.abs(materializeScaledValue(normalizeScaledValue(
    difference.mantissa / reference.mantissa,
    difference.exponent - reference.exponent
  )));
}

export function scaledValueSign(value: ScaledValue): number {
  return value.mantissa < 0 || Object.is(value.mantissa, -0) ? -1 : 1;
}

function scaledProduct3(
  first: number,
  second: number,
  third: number
): ScaledValue {
  const values = [first, second, third];
  if (values.some(Number.isNaN)) {
    return { mantissa: Number.NaN, exponent: 0 };
  }
  const hasZero = values.some((value) => value === 0);
  const hasInfinity = values.some((value) => !Number.isFinite(value));
  const sign = values.reduce(
    (product, value) => product * numberSign(value),
    1
  );
  if (hasZero && hasInfinity) {
    return { mantissa: Number.NaN, exponent: 0 };
  }
  if (hasZero) {
    return { mantissa: sign < 0 ? -0 : 0, exponent: 0 };
  }
  if (hasInfinity) {
    return {
      mantissa: sign < 0
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY,
      exponent: 0
    };
  }
  const parts = values.map(scaledValueFromFiniteNumber);
  return normalizeScaledValue(
    parts[0]!.mantissa * parts[1]!.mantissa * parts[2]!.mantissa,
    parts[0]!.exponent + parts[1]!.exponent + parts[2]!.exponent
  );
}

function scaledValueFromFiniteNumber(value: number): ScaledValue {
  if (value === 0) {
    return { mantissa: value, exponent: 0 };
  }
  let exponent = Math.floor(Math.log2(Math.abs(value)));
  if (exponent > 1023) {
    exponent = 1023;
  } else if (exponent < -1074) {
    exponent = -1074;
  }
  return normalizeScaledValue(value / (2 ** exponent), exponent);
}

function normalizeScaledValue(
  mantissa: number,
  exponent: number
): ScaledValue {
  if (mantissa === 0 || !Number.isFinite(mantissa)) {
    return { mantissa, exponent: 0 };
  }
  let normalizedMantissa = mantissa;
  let normalizedExponent = exponent;
  while (Math.abs(normalizedMantissa) >= 2) {
    normalizedMantissa /= 2;
    normalizedExponent += 1;
  }
  while (Math.abs(normalizedMantissa) < 1) {
    normalizedMantissa *= 2;
    normalizedExponent -= 1;
  }
  return {
    mantissa: normalizedMantissa,
    exponent: normalizedExponent
  };
}

function addScaledValues(first: ScaledValue, second: ScaledValue): ScaledValue {
  if (first.mantissa === 0) {
    return second;
  }
  if (second.mantissa === 0) {
    return first;
  }
  const exponent = Math.max(first.exponent, second.exponent);
  const firstAligned = first.mantissa * 2 ** (first.exponent - exponent);
  const secondAligned = second.mantissa * 2 ** (second.exponent - exponent);
  return normalizeScaledValue(firstAligned + secondAligned, exponent);
}

function numberSign(value: number): number {
  return value < 0 || Object.is(value, -0) ? -1 : 1;
}
