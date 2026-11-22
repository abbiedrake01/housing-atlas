/** OLS on three equally spaced annual observations, evaluated one year ahead. */
export function annualTrend(values: readonly number[]) {
 if (values.length !== 3 || values.some(v => !Number.isFinite(v))) return null;
 const mean = (values[0] + values[1] + values[2]) / 3;
 const slope = (values[2] - values[0]) / 2;
 return { fitted: [mean - slope, mean, mean + slope], slope, projected: mean + 2 * slope };
}
