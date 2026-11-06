/** Presentation only: no thresholds, geometry edits or acceptance decisions. */
const definitions = [
  ["cornerScaledJacobian", "角点 SJ", "8 个角点的最小 det(J) / 三列向量模长之积", ""],
  ["cornerAndCenterScaledJacobian", "角点 + 中心 SJ", "8 个角点与中心，共 9 点的最小缩放 Jacobian", ""],
  ["positiveGaussDetRatio", "Gauss 行列式比", "8 个 Gauss 点的 min(det J) / max(det J)，仅全部为正时定义；不是 SJ", ""],
  ["maxEdgeOverMinEdge", "边长比", "12 条边的最长 / 最短；不等同所有软件的 aspect ratio", ""],
  ["minimumFaceCornerAngleDegrees", "最小面角", "每单元 24 个面角中最小的欧氏夹角", "°"],
  ["maximumFaceCornerAngleDegrees", "最大面角", "每单元 24 个面角中最大的欧氏夹角", "°"],
  ["maximumFaceDiagonalNormalAngleDegrees", "最坏面折角", "每个 Q4 的两条对角线均检查，取三角形法向夹角最大值；非通用厂商 warpage", "°"],
] as const;

type Data = Record<string, unknown>;
function record(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}
function count(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "未提供";
}
export function formatQualityNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未提供";
  if (value === 0) return "0";
  return Math.abs(value) < 1e-4 || Math.abs(value) >= 1e6 ? value.toExponential(4) : String(Number(value.toPrecision(6)));
}
function ids(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return "未提供";
  // Preserve the backend's ordered global IDs, never offset them by PID.
  if (!value.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return "未提供";
  return value.join(", ");
}
export interface QualityRow {
  key: string; label: string; formula: string; minimum: string; maximum: string;
  undefinedCount: string; lowestIDs: string; highestIDs: string;
}
export interface QualitySection {
  title: string; elements: string; sampledInvalid: string; rows: QualityRow[]; references: string[];
}
export function formatJointQualityDiagnostics(value: unknown): QualitySection[] {
  const data = record(value);
  if (!Object.keys(data).length) return [];
  function section(title: string, value: unknown): QualitySection {
    const summary = record(value), metrics = record(summary.metrics);
    const references: string[] = [];
    for (const [key, label] of [["verdictScaledJacobian", "角点 + 中心 SJ"], ["hypermeshGaussDetRatio", "Gauss 行列式比"]] as const) {
      const ref = record(record(summary.referenceComparisons)[key]);
      if (typeof ref.referenceLowerBound === "number" && Number.isFinite(ref.referenceLowerBound)) {
        references.push(`${label} 参照 ${formatQualityNumber(ref.referenceLowerBound)}：低于参照 ${count(ref.belowCount)}；仅提示，非验收门槛`);
      }
    }
    return {title, elements: count(summary.elements), sampledInvalid: count(summary.sampledInvalidElementCount), references,
      rows: definitions.map(([key, label, formula, unit]) => {
        const metric = record(metrics[key]);
        const format = (v: unknown) => formatQualityNumber(v) + (typeof v === "number" && Number.isFinite(v) ? unit : "");
        return {key, label, formula, minimum: format(metric.minimum), maximum: format(metric.maximum),
          undefinedCount: count(metric.undefinedCount), lowestIDs: ids(metric.lowestElementIDs), highestIDs: ids(metric.highestElementIDs)};
      })};
  }
  const sections = [section("整体 · Overall", data.overall)];
  if (Array.isArray(data.regions)) {
    for (const entry of data.regions) {
      const region = record(entry);
      if (!Object.keys(region).length) continue;
      const pid = typeof region.partId === "number" && Number.isSafeInteger(region.partId) && region.partId > 0 ? String(region.partId) : "未提供";
      sections.push(section(`PID ${pid}${typeof region.name === "string" ? ` · ${region.name}` : ""}`, region.metrics));
    }
  }
  return sections;
}
