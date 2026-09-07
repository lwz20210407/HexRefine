import assert from "node:assert/strict";
import test from "node:test";
import {
  createHexUnitCubeMesh, createRefinementSession, checkNoHangingNodes,
  mergeCoincidentNodes, refineSessionPatch, undoRefinementSession, redoRefinementSession
} from "../dist/index.js";
import {
  buildConformanceSpatialIndex,
  auditIncrementalConformance
} from "../dist/refinement-incremental-conformance-internal.js";
import {
  indexedConformanceCertificate, prepareIndexedConformanceBaseline,
  publishIndexedConformanceCertificate
} from "../dist/refinement-conformance-certificate-internal.js";

function cells(mesh, prefix = "c", offset = 0) {
  return mesh.elements.map((element, i) => ({
    id: `${prefix}${i}`, ordinal: offset + i + 1,
    points: element.map((id) => mesh.nodes[id - 1])
  }));
}

function build(selected, all) {
  const nodes = [], elements = [];
  for (const id of selected) {
    const cell = all.get(id);
    assert.ok(cell, id);
    const offset = nodes.length;
    nodes.push(...cell.points.map((point) => [...point]));
    elements.push(cell.points.map((_, i) => offset + i + 1));
  }
  return { cellIds: selected, mesh: mergeCoincidentNodes({ kind: "H1", nodes, elements }, 1e-9) };
}

function fixture(farCount = 0) {
  const original = cells(createHexUnitCubeMesh(2, 1, 1));
  const far = cells(createHexUnitCubeMesh(farCount || 1, 1, 1), "far", 100)
    .slice(0, farCount).map((cell) => ({
      ...cell, points: cell.points.map(([x, y, z]) => [x + 10, y, z])
    }));
  const before = new Map([...original, ...far].map((cell) => [cell.id, cell]));
  const replacement = { ...original[0], id: "new", ordinal: 1000 };
  const after = new Map(before);
  after.delete(original[0].id);
  after.set(replacement.id, replacement);
  return { original, before, after, replacement, index: buildConformanceSpatialIndex(before.values()) };
}

function audit(f, additions = [f.replacement]) {
  return auditIncrementalConformance(
    f.index, [f.original[0]], additions, 1e-9,
    (ids) => build(ids, f.before), (ids) => build(ids, f.after)
  );
}

test("incremental conformance accepts an unchanged partition and ignores disconnected far field", () => {
  const a = audit(fixture());
  const b = audit(fixture(100));
  assert.equal(a.report.ok, true);
  assert.equal(b.report.ok, true);
  assert.deepEqual(a.checkedCellIds, b.checkedCellIds);
  assert.equal(a.requiredInterfaceCount, 1);
});

test("incremental conformance rejects a missing interface even without overlapping faces", () => {
  const f = fixture();
  f.after.delete(f.replacement.id);
  const result = audit(f, []);
  assert.equal(result.report.ok, false);
  assert.match(result.interfaceError, /interface/);
});

test("incremental conformance finds a broken interface through spatial rather than node-id neighbors", () => {
  const f = fixture();
  const childMesh = createHexUnitCubeMesh(2, 2, 2);
  const children = cells(childMesh, "child", 2000).map((cell) => ({
    ...cell, points: cell.points.map(([x, y, z]) => [x / 2, y, z])
  }));
  f.after.delete(f.replacement.id);
  for (const child of children) f.after.set(child.id, child);
  const result = audit(f, children);
  const full = build([...f.after.keys()], f.after).mesh;
  assert.equal(checkNoHangingNodes(full, 1e-9).ok, false);
  assert.equal(result.report.ok, false);
});

test("incremental conformance detects nonmanifold duplicate ownership", () => {
  const f = fixture();
  const duplicate = { ...f.replacement, id: "duplicate", ordinal: 1001 };
  f.after.set(duplicate.id, duplicate);
  assert.equal(audit(f, [f.replacement, duplicate]).report.ok, false);
});

test("incremental spatial updates are persistent across successive replacements", () => {
  const f = fixture(20);
  const first = audit(f);
  assert.equal(first.report.ok, true);
  const next = { ...f.replacement, id: "next", ordinal: 1002 };
  const after = new Map(f.after);
  after.delete(f.replacement.id);
  after.set(next.id, next);
  const second = auditIncrementalConformance(
    first.nextIndex, [f.replacement], [next], 1e-9,
    (ids) => build(ids, f.after), (ids) => build(ids, after)
  );
  assert.equal(second.report.ok, true);
  assert.equal(audit(f).report.ok, true);
});

test("incremental spatial queries retain tolerance-matched interface ownership", () => {
  const f = fixture(10);
  const neighbor = f.original[1];
  const shifted = { ...neighbor, points: neighbor.points.map(([x, y, z]) => [x + 2e-10, y, z]) };
  f.before.set(neighbor.id, shifted);
  f.after.set(neighbor.id, shifted);
  f.index = buildConformanceSpatialIndex(f.before.values());
  const result = audit(f);
  assert.equal(result.report.ok, true);
  assert.equal(result.requiredInterfaceCount, 1);
  f.after.delete(f.replacement.id);
  assert.equal(audit(f, []).report.ok, false);
});

test("incremental spatial tree survives bulk removal and insertion without corrupting its baseline", () => {
  const original = cells(createHexUnitCubeMesh(30, 1, 1));
  const before = new Map(original.map((cell) => [cell.id, cell]));
  const replacement = original.map((cell, i) => ({ ...cell, id: `new${i}`, ordinal: 100 + i }));
  const after = new Map(replacement.map((cell) => [cell.id, cell]));
  const index = buildConformanceSpatialIndex(before.values());
  const result = auditIncrementalConformance(index, [...original].reverse(), replacement, 1e-9,
    (ids) => build(ids, before), (ids) => build(ids, after));
  assert.equal(result.report.ok, true);
  const last = { ...replacement[15], id: "last", ordinal: 1000 };
  const final = new Map(after);
  final.delete(replacement[15].id);
  final.set(last.id, last);
  assert.equal(auditIncrementalConformance(result.nextIndex, [replacement[15]], [last], 1e-9,
    (ids) => build(ids, after), (ids) => build(ids, final)).report.ok, true);
  assert.equal(auditIncrementalConformance(index, [], [], 1e-9,
    (ids) => build(ids, before), (ids) => build(ids, before)).report.ok, true);
});

test("incremental baseline publication is deferred and repeated reads reuse its spatial index", () => {
  const mesh = createHexUnitCubeMesh(2, 1, 1);
  const session = createRefinementSession(mesh);
  const metadata = { tolerance: 1e-9, coordinateScale: 1, minimumElementEdgeLength: 0.5 };
  let checks = 0;
  const prepare = () => prepareIndexedConformanceBaseline(session, metadata,
    () => cells(mesh), () => { checks += 1; return checkNoHangingNodes(mesh, 1e-9); });
  const first = prepare();
  assert.equal(indexedConformanceCertificate(session, metadata), undefined);
  publishIndexedConformanceCertificate(session, first);
  assert.strictEqual(prepare(), first);
  assert.equal(checks, 1);
  assert.equal(indexedConformanceCertificate(session, { ...metadata, tolerance: 2e-9 }), undefined);
});

test("incremental baseline failure cannot publish a certificate", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const session = createRefinementSession(mesh);
  const metadata = { tolerance: 1e-9, coordinateScale: 1, minimumElementEdgeLength: 1 };
  assert.throws(() => prepareIndexedConformanceBaseline(session, metadata, () => cells(mesh),
    () => ({ ok: false, hanging: [], unmatchedInteriorBoundaryCount: 1 })), /nonconforming/);
  assert.equal(indexedConformanceCertificate(session, metadata), undefined);
});

test("incremental certificate invalidates through official refine undo and redo", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const metadata = { tolerance: 1e-9, coordinateScale: 1, minimumElementEdgeLength: 1 };
  const session = createRefinementSession(mesh);
  const publish = () => publishIndexedConformanceCertificate(session,
    prepareIndexedConformanceBaseline(session, metadata, () => cells(mesh),
      () => ({ ok: true, hanging: [], unmatchedInteriorBoundaryCount: 0 })));
  publish();
  refineSessionPatch(session, ["e1"], { hexRefinementRatio: 2, includeTransitions: false });
  assert.equal(indexedConformanceCertificate(session, metadata), undefined);
  publish();
  undoRefinementSession(session);
  assert.equal(indexedConformanceCertificate(session, metadata), undefined);
  publish();
  redoRefinementSession(session);
  assert.equal(indexedConformanceCertificate(session, metadata), undefined);
});
