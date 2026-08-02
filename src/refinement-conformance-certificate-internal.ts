import type { ConformanceReport } from "./conformance.js";
import type { RefinementSession } from "./refinement-session.js";

export interface RefinementSessionConformanceMetadata {
  readonly tolerance: number;
  readonly coordinateScale: number;
  readonly minimumElementEdgeLength: number;
}

export interface RefinementSessionConformanceCertificate
  extends RefinementSessionConformanceMetadata {
  readonly version: 1;
  readonly session: RefinementSession;
  readonly revision: number;
  readonly nodes: RefinementSession["nodes"];
  readonly cells: RefinementSession["cells"];
  readonly activeLeafIds: RefinementSession["activeLeafIds"];
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
}

const certificatesBySession =
  new WeakMap<RefinementSession, RefinementSessionConformanceCertificate>();
const issuedCertificates = new WeakSet<RefinementSessionConformanceCertificate>();

export function certifyRefinementSessionBaseline(
  session: RefinementSession,
  metadata: RefinementSessionConformanceMetadata
): RefinementSessionConformanceCertificate {
  validateMetadata(metadata);
  const certificate = Object.freeze({
    version: 1 as const,
    session,
    revision: session.revision,
    tolerance: normalizedZero(metadata.tolerance),
    coordinateScale: metadata.coordinateScale,
    minimumElementEdgeLength: metadata.minimumElementEdgeLength,
    nodes: session.nodes,
    cells: session.cells,
    activeLeafIds: session.activeLeafIds,
    nodeCount: session.nodes.length,
    cellCount: session.cells.size,
    activeLeafCount: session.activeLeafIds.size
  });
  issuedCertificates.add(certificate);
  return certificate;
}

export function publishRefinementSessionConformanceCertificate(
  session: RefinementSession,
  certificate: RefinementSessionConformanceCertificate
): void {
  if (!issuedCertificates.has(certificate)) {
    throw new Error("conformance certificate was not issued by this module");
  }
  if (certificate.session !== session || !certificateMatchesCurrentState(certificate)) {
    throw new Error("conformance certificate does not describe the current session state");
  }
  certificatesBySession.set(session, certificate);
}

export function refinementSessionConformanceCertificate(
  session: RefinementSession,
  tolerance: number
): RefinementSessionConformanceCertificate | undefined {
  validateTolerance(tolerance);
  const certificate = currentRefinementSessionConformanceCertificate(session);
  if (
    certificate === undefined
    || certificate.tolerance !== normalizedZero(tolerance)
  ) {
    return undefined;
  }
  return certificate;
}

export function currentRefinementSessionConformanceCertificate(
  session: RefinementSession
): RefinementSessionConformanceCertificate | undefined {
  const certificate = certificatesBySession.get(session);
  if (certificate === undefined) {
    return undefined;
  }
  if (!certificateMatchesCurrentState(certificate)) {
    certificatesBySession.delete(session);
    return undefined;
  }
  return certificate;
}

export function ensureRefinementSessionBaselineConformanceCertificate(
  session: RefinementSession,
  metadata: RefinementSessionConformanceMetadata,
  buildAndCheck: () => ConformanceReport
): RefinementSessionConformanceCertificate {
  validateMetadata(metadata);
  const existing = refinementSessionConformanceCertificate(session, metadata.tolerance);
  if (
    existing !== undefined
    && existing.coordinateScale === metadata.coordinateScale
    && existing.minimumElementEdgeLength === metadata.minimumElementEdgeLength
  ) {
    return existing;
  }

  const report = buildAndCheck();
  if (!report.ok) {
    throw new Error(
      `baseline conformance audit failed with ${report.hanging.length} hanging entities`
    );
  }
  const certificate = certifyRefinementSessionBaseline(session, metadata);
  publishRefinementSessionConformanceCertificate(session, certificate);
  return certificate;
}

function certificateMatchesCurrentState(
  certificate: RefinementSessionConformanceCertificate
): boolean {
  const { session } = certificate;
  return certificate.revision === session.revision
    && certificate.nodes === session.nodes
    && certificate.cells === session.cells
    && certificate.activeLeafIds === session.activeLeafIds
    && certificate.nodeCount === session.nodes.length
    && certificate.cellCount === session.cells.size
    && certificate.activeLeafCount === session.activeLeafIds.size;
}

function validateMetadata(metadata: RefinementSessionConformanceMetadata): void {
  validateTolerance(metadata.tolerance);
  if (!Number.isFinite(metadata.coordinateScale) || metadata.coordinateScale <= 0) {
    throw new Error("coordinateScale must be a positive finite number");
  }
  if (
    !Number.isFinite(metadata.minimumElementEdgeLength)
    || metadata.minimumElementEdgeLength <= 0
  ) {
    throw new Error("minimumElementEdgeLength must be a positive finite number");
  }
}

function validateTolerance(tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("conformance tolerance must be a non-negative finite number");
  }
}

function normalizedZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
