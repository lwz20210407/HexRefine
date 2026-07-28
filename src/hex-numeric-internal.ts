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
  return sumScaledExpansions([
    scaledProductExpansion3(a![0]!, b![1]!, c![2]!),
    negateScaledExpansion(
      scaledProductExpansion3(a![0]!, b![2]!, c![1]!)
    ),
    negateScaledExpansion(
      scaledProductExpansion3(b![0]!, a![1]!, c![2]!)
    ),
    scaledProductExpansion3(b![0]!, a![2]!, c![1]!),
    scaledProductExpansion3(c![0]!, a![1]!, b![2]!),
    negateScaledExpansion(
      scaledProductExpansion3(c![0]!, a![2]!, b![1]!)
    )
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

interface ScaledExpansion {
  components: number[];
  exponent: number;
}

function scaledProductExpansion3(
  first: number,
  second: number,
  third: number
): ScaledExpansion {
  const values = [first, second, third];
  if (values.some(Number.isNaN)) {
    return { components: [Number.NaN], exponent: 0 };
  }
  const hasZero = values.some((value) => value === 0);
  const hasInfinity = values.some((value) => !Number.isFinite(value));
  const sign = values.reduce(
    (product, value) => product * numberSign(value),
    1
  );
  if (hasZero && hasInfinity) {
    return { components: [Number.NaN], exponent: 0 };
  }
  if (hasZero) {
    return { components: [], exponent: 0 };
  }
  if (hasInfinity) {
    return {
      components: [sign < 0
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY],
      exponent: 0
    };
  }
  const parts = values.map(scaledValueFromFiniteNumber);
  const [firstError, firstProduct] = twoProduct(
    parts[0]!.mantissa,
    parts[1]!.mantissa
  );
  const components: number[] = [];
  for (const partial of [firstError, firstProduct]) {
    const [error, product] = twoProduct(partial, parts[2]!.mantissa);
    if (error !== 0) {
      components.push(error);
    }
    if (product !== 0) {
      components.push(product);
    }
  }
  return {
    components: exactExpansionSum(components),
    exponent: parts[0]!.exponent
      + parts[1]!.exponent
      + parts[2]!.exponent
  };
}

function sumScaledExpansions(
  values: readonly ScaledExpansion[]
): ScaledValue {
  const components = values.flatMap((value) => value.components);
  if (components.some(Number.isNaN)) {
    return { mantissa: Number.NaN, exponent: 0 };
  }
  const infinities = components.filter((value) => !Number.isFinite(value));
  if (infinities.length > 0) {
    const hasPositive = infinities.some((value) => value > 0);
    const hasNegative = infinities.some((value) => value < 0);
    return {
      mantissa: hasPositive && hasNegative
        ? Number.NaN
        : hasNegative
          ? Number.NEGATIVE_INFINITY
          : Number.POSITIVE_INFINITY,
      exponent: 0
    };
  }

  const byExponent = new Map<number, number[]>();
  for (const value of values) {
    if (value.components.length === 0) {
      continue;
    }
    const group = byExponent.get(value.exponent) ?? [];
    group.push(...value.components);
    byExponent.set(value.exponent, group);
  }
  const groups = [...byExponent.entries()]
    .sort(([first], [second]) => second - first)
    .map(([exponent, group]) => ({
      exponent,
      components: exactExpansionSum(group)
    }))
    .filter((group) => group.components.length > 0);
  if (groups.length === 0) {
    return { mantissa: 0, exponent: 0 };
  }

  let exponent = groups[0]!.exponent;
  let expansion = groups[0]!.components;
  for (const group of groups.slice(1)) {
    if (expansion.length === 0) {
      exponent = group.exponent;
      expansion = group.components;
      continue;
    }
    const scale = 2 ** (group.exponent - exponent);
    if (scale === 0) {
      continue;
    }
    expansion = exactExpansionSum([
      ...expansion,
      ...group.components.map((component) => component * scale)
    ]);
  }
  const mantissa = expansion.reduce(
    (total, component) => total + component,
    0
  );
  return normalizeScaledValue(mantissa, exponent);
}

function negateScaledExpansion(value: ScaledExpansion): ScaledExpansion {
  return {
    components: value.components.map((component) => -component),
    exponent: value.exponent
  };
}

function exactExpansionSum(values: readonly number[]): number[] {
  let expansion: number[] = [];
  for (const value of [...values].sort(
    (first, second) => Math.abs(first) - Math.abs(second)
  )) {
    expansion = growExpansion(expansion, value);
  }
  return expansion;
}

function growExpansion(
  expansion: readonly number[],
  value: number
): number[] {
  let accumulator = value;
  const result: number[] = [];
  for (const component of expansion) {
    const [error, sum] = twoSum(accumulator, component);
    if (error !== 0) {
      result.push(error);
    }
    accumulator = sum;
  }
  if (accumulator !== 0 || result.length === 0) {
    result.push(accumulator);
  }
  return result;
}

function twoSum(first: number, second: number): [number, number] {
  const sum = first + second;
  const secondVirtual = sum - first;
  const firstVirtual = sum - secondVirtual;
  const secondRoundoff = second - secondVirtual;
  const firstRoundoff = first - firstVirtual;
  return [firstRoundoff + secondRoundoff, sum];
}

function twoProduct(first: number, second: number): [number, number] {
  const product = first * second;
  const splitter = 134217729;
  const firstSplit = splitter * first;
  const firstHigh = firstSplit - (firstSplit - first);
  const firstLow = first - firstHigh;
  const secondSplit = splitter * second;
  const secondHigh = secondSplit - (secondSplit - second);
  const secondLow = second - secondHigh;
  const error = firstLow * secondLow
    - (((product - firstHigh * secondHigh) - firstLow * secondHigh)
      - firstHigh * secondLow);
  return [error, product];
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
