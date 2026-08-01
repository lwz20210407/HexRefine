# H1 2:1 Stage C1 Component Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-session cloning in replayable H1 2:1 history transactions with a sparse component-scoped overlay while preserving every Stage B quality, conformance, replay, and atomicity guarantee.

**Architecture:** Add explicit internal session state readers/writers, implement a copy-on-write overlay and guarded delta commit, then migrate the Stage B history transaction in four independently green phases. Keep full final conformance temporarily, introduce component-local builds and exact delta counts, and only then replace the full final audit with a cached baseline certificate plus a one-ring incremental proof.

**Tech Stack:** TypeScript ES2022, Node.js `node:test`, immutable command recipes, `Map`/`Set` sparse deltas, existing Hex quality and conformance kernels.

---

## File Map

**Create:**

- `src/refinement-session-state-internal.ts`
  - read/write state contracts;
  - direct real-session adapter;
  - mutable cell type and state-safe primitives.
- `src/refinement-session-overlay-internal.ts`
  - sparse overlay, fork, stats, delta snapshot, guarded commit.
- `src/refinement-transition-context-internal.ts`
  - immutable history rebuild context and component-local active cell ids.
- `src/refinement-conformance-certificate-internal.ts`
  - baseline certificate cache and incremental certificate publication.
- `test/refinement-session-overlay.test.mjs`
  - focused overlay red/green tests and structural locality counters.

**Modify:**

- `src/refinement-session.ts`
  - route history transactions through state access;
  - split option snapshots from active-mesh resolution;
  - use overlay deltas for preview/execution;
  - build component-local planning/audit meshes;
  - compute aggregate counts from active-leaf deltas.
- `src/refinement-history.ts`
  - retain immutable closure inputs needed by the transition context.
- `test/refinement-history.test.mjs`
  - closure/context boundary assertions.
- `test/refinement-kernel-suite.test.mjs`
  - Stage B equivalence, far-field identity, certificate, and public API tests.
- `README.md`
  - describe component-scoped history preview/execution.
- `docs/implementation.md`
  - document overlay ownership, first-certification cost, and fail-closed scope.
- `CHANGELOG.md`
  - record Stage C1 behavior.

## Test Commands

Focused tests compile first because test files import `dist` modules:

```powershell
npm run build
node --test --test-name-pattern="overlay|component-local|conformance certificate" test/refinement-session-overlay.test.mjs test/refinement-kernel-suite.test.mjs
```

Full verification:

```powershell
npm test
npm run pages:build
```

---

### Task 1: Commit the Approved Stage C1 Design and Plan

**Files:**
- Add: `docs/superpowers/specs/2026-08-01-h1-2to1-stage-c-component-overlay-design.md`
- Add: `docs/superpowers/plans/2026-08-01-h1-2to1-stage-c-component-overlay.md`

- [ ] **Step 1: Verify the design is the only uncommitted semantic change**

Run:

```powershell
git status --short
git diff --check
```

Expected: the design and implementation plan are untracked and there are no
whitespace errors.

- [ ] **Step 2: Scan the approved contract anchors**

Run:

```powershell
rg -n "copy-on-write|first history preview|historyEdit|TransitionRebuildContext|no Proxy" docs/superpowers/specs/2026-08-01-h1-2to1-stage-c-component-overlay-design.md
```

Expected: matches in the architecture, baseline, and acceptance sections.

- [ ] **Step 3: Commit the design**

```powershell
git add docs/superpowers/specs/2026-08-01-h1-2to1-stage-c-component-overlay-design.md docs/superpowers/plans/2026-08-01-h1-2to1-stage-c-component-overlay.md
git commit -m "docs(refinement): plan Stage C component overlay"
```

Expected: one documentation commit and a clean semantic diff.

---

### Task 2: Define Explicit Session State Access

**Files:**
- Create: `src/refinement-session-state-internal.ts`
- Modify: `src/refinement-session.ts:83-161`
- Test: `test/refinement-session-overlay.test.mjs`

- [ ] **Step 1: Write a failing direct-state adapter test**

Create `test/refinement-session-overlay.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createHexUnitCubeMesh, createRefinementSession } from "../dist/index.js";
import { createDirectRefinementSessionState } from "../dist/refinement-session-state-internal.js";

test("direct session state reads and writes through explicit accessors", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, (point) =>
    point.map((value) => value.toPrecision(17)).join(",")
  );

  assert.equal(state.nodeCount, 8);
  assert.equal(state.cell("e1")?.active, true);
  const nodeId = state.appendNode([0.5, 0.5, 0.5]);
  assert.equal(nodeId, 9);

  const cell = state.mutableCell("e1");
  cell.hidden = true;
  assert.equal(session.cells.get("e1")?.hidden, true);
});
```

Add focused tests for the active-state invariant boundary. The direct adapter
must keep `activeLeafIds`, `activeLeafIdsByNodeKey`, and
`sortedActiveLeafIdsDirty` consistent as one operation: assert owner lists after
add/remove, reject an unknown cell, treat an inactive removal as an idempotent
no-op, reject a cell with a missing node without changing any collection, and
observe the dirty flag after each effective change (including that idempotent
operations do not dirty it). Use a test cell with a shared node so owner removal
can verify that one owner remains while the other is removed.

```js
test("direct active updates preserve owners and dirty the sorted cache", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const key = (point) => point.map((value) => value.toPrecision(17)).join(",");
  const state = createDirectRefinementSessionState(session, key);
  const firstKey = key(session.nodes[0]);

  session.sortedActiveLeafIdsDirty = false;
  state.removeActiveLeaf("e1");
  assert.deepEqual(state.activeOwnersByNodeKey(firstKey), []);
  assert.equal(session.sortedActiveLeafIdsDirty, true);

  session.sortedActiveLeafIdsDirty = false;
  state.removeActiveLeaf("e1");
  assert.equal(session.sortedActiveLeafIdsDirty, false);
  assert.throws(() => state.removeActiveLeaf("missing"), /unknown refinement cell/);

  state.addActiveLeaf("e1");
  assert.deepEqual(state.activeOwnersByNodeKey(firstKey), ["e1"]);
  assert.equal(session.sortedActiveLeafIdsDirty, true);
  session.sortedActiveLeafIdsDirty = false;
  state.addActiveLeaf("e1");
  assert.equal(session.sortedActiveLeafIdsDirty, false);
});
```

Add a companion malformed-cell case by inserting a temporary cell whose
`element` contains a missing node id. Assert that `addActiveLeaf` throws and
that active ids, every owner list, and `sortedActiveLeafIdsDirty` retain their
pre-call values. For a shared-node fixture, remove one of two active cells and
assert the other owner remains in that node's list.

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```powershell
npm run build
node --test test/refinement-session-overlay.test.mjs
```

Expected: FAIL because `refinement-session-state-internal.js` does not exist.

- [ ] **Step 3: Add the state contracts and direct adapter**

Create `src/refinement-session-state-internal.ts` with these concrete contracts:

```ts
import type { Element, ElementKind, Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCellRole,
  RefinementSessionCommand
} from "./refinement-session.js";

export interface MutableRefinementSessionCell {
  id: CellId;
  ordinal: number;
  parentId?: CellId;
  level: number;
  role: RefinementSessionCellRole;
  kind: ElementKind;
  element: Element;
  children: CellId[];
  active: boolean;
  hidden: boolean;
  sourceElementId?: number;
  template?: string;
}

export interface RefinementSessionStateReader {
  readonly baseSession: RefinementSession;
  readonly revision: number;
  readonly kind: ElementKind;
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly sortedActiveLeafIdsDirty: boolean;
  node(nodeId: number): Point | undefined;
  cell(cellId: CellId): RefinementSessionCell | undefined;
  hasActiveLeaf(cellId: CellId): boolean;
  activeLeafIds(): Iterable<CellId>;
  activeOwnersByNodeKey(key: string): readonly CellId[];
  undoCommands(): Iterable<RefinementSessionCommand>;
  redoCommands(): Iterable<RefinementSessionCommand>;
}

export interface RefinementSessionStateWriter extends RefinementSessionStateReader {
  mutableCell(cellId: CellId): MutableRefinementSessionCell;
  appendNode(point: Point): number;
  setCell(cell: MutableRefinementSessionCell): void;
  addActiveLeaf(cellId: CellId): void;
  removeActiveLeaf(cellId: CellId): void;
  allocateCellOrdinal(): number;
  setNextCommandId(value: number): void;
  appendUndoCommand(command: RefinementSessionCommand): void;
  clearRedoCommands(): void;
}

interface MutableSessionShape {
  nodes: Point[];
  cells: Map<CellId, MutableRefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
  sortedActiveLeafIdsDirty: boolean;
}

function mutableSession(session: RefinementSession): MutableSessionShape {
  return session as unknown as MutableSessionShape;
}

function requiredMutableCell(
  session: RefinementSession,
  cellId: CellId
): MutableRefinementSessionCell {
  const cell = mutableSession(session).cells.get(cellId);
  if (cell === undefined) {
    throw new Error(`unknown refinement cell ${cellId}`);
  }
  return cell;
}

export function createDirectRefinementSessionState(
  session: RefinementSession,
  nodeKey: (point: Point) => string
): RefinementSessionStateWriter {
  const mutable = mutableSession(session);
  return {
    baseSession: session,
    get revision() { return session.revision; },
    get kind() { return session.kind; },
    get nodeCount() { return session.nodes.length; },
    get cellCount() { return session.cells.size; },
    get activeLeafCount() { return session.activeLeafIds.size; },
    get nextCommandId() { return session.nextCommandId; },
    get nextCellOrdinal() { return session.nextCellOrdinal; },
    get sortedActiveLeafIdsDirty() { return session.sortedActiveLeafIdsDirty; },
    node: (nodeId) => session.nodes[nodeId - 1],
    cell: (cellId) => session.cells.get(cellId),
    hasActiveLeaf: (cellId) => session.activeLeafIds.has(cellId),
    activeLeafIds: () => session.activeLeafIds,
    activeOwnersByNodeKey: (key) => session.activeLeafIdsByNodeKey.get(key) ?? [],
    undoCommands: () => session.undoStack,
    redoCommands: () => session.redoStack,
    mutableCell: (cellId) => requiredMutableCell(session, cellId),
    appendNode(point) {
      mutable.nodes.push([...point]);
      return mutable.nodes.length;
    },
    setCell(cell) { mutable.cells.set(cell.id, cell); },
    addActiveLeaf(cellId) {
      if (mutable.activeLeafIds.has(cellId)) return;
      const cell = requiredMutableCell(session, cellId);
      const points = cell.element.map((nodeId) => {
        const point = session.nodes[nodeId - 1];
        if (point === undefined) {
          throw new Error(`active cell ${cellId} references missing node ${nodeId}`);
        }
        return point;
      });
      mutable.activeLeafIds.add(cellId);
      mutable.sortedActiveLeafIdsDirty = true;
      for (const point of points) {
        const key = nodeKey(point);
        const owners = mutable.activeLeafIdsByNodeKey.get(key) ?? [];
        mutable.activeLeafIdsByNodeKey.set(key, [...owners, cellId]);
      }
    },
    removeActiveLeaf(cellId) {
      const cell = requiredMutableCell(session, cellId);
      if (!mutable.activeLeafIds.has(cellId)) return;
      const points = cell.element.map((nodeId) => {
        const point = session.nodes[nodeId - 1];
        if (point === undefined) {
          throw new Error(`active cell ${cellId} references missing node ${nodeId}`);
        }
        return point;
      });
      mutable.activeLeafIds.delete(cellId);
      mutable.sortedActiveLeafIdsDirty = true;
      for (const point of points) {
        const key = nodeKey(point);
        const owners = mutable.activeLeafIdsByNodeKey.get(key);
        if (owners === undefined) continue;
        const next = owners.filter((ownerId) => ownerId !== cellId);
        if (next.length === 0) mutable.activeLeafIdsByNodeKey.delete(key);
        else mutable.activeLeafIdsByNodeKey.set(key, next);
      }
    },
    allocateCellOrdinal() {
      const ordinal = mutable.nextCellOrdinal;
      mutable.nextCellOrdinal += 1;
      return ordinal;
    },
    setNextCommandId(value) { mutable.nextCommandId = value; },
    appendUndoCommand(command) { mutable.undoStack.push(command); },
    clearRedoCommands() { mutable.redoStack = []; }
  };
}
```

Move the private mutable-cell interface out of `refinement-session.ts` and import it as a type from the new module. Do not export this module from `src/index.ts`.

- [ ] **Step 4: Run focused tests and type checks**

```powershell
npm run build
node --test test/refinement-session-overlay.test.mjs
npm run typecheck
```

Expected: the direct adapter test passes and root public API type tests remain unchanged.

- [ ] **Step 5: Commit the state boundary**

```powershell
git add src/refinement-session-state-internal.ts src/refinement-session.ts test/refinement-session-overlay.test.mjs
git commit -m "refactor(refinement): centralize session state access"
```

---

### Task 3: Implement Sparse Cell and Node Overlay Reads

**Files:**
- Create: `src/refinement-session-overlay-internal.ts`
- Test: `test/refinement-session-overlay.test.mjs`

- [ ] **Step 1: Write failing first-write and node-tail tests**

Append:

```js
import {
  createRefinementSessionOverlay,
  refinementSessionOverlayStats
} from "../dist/refinement-session-overlay-internal.js";

const createTestOverlay = (session) => createRefinementSessionOverlay(session, {
  nodeKey: (point) => point.map((value) => value.toPrecision(17)).join(","),
  cellNodeIds: (cell) => cell.element
});

test("overlay pure reads copy nothing and first write clones one base cell", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(3, 3, 3));
  const overlay = createTestOverlay(session);

  assert.equal(overlay.cell("e14")?.id, "e14");
  assert.deepEqual(refinementSessionOverlayStats(overlay), {
    copiedBaseCellCount: 0,
    createdCellCount: 0,
    appendedNodeCount: 0,
    activeLeafAdditionCount: 0,
    activeLeafRemovalCount: 0,
    copiedNodeOwnerKeyCount: 0,
    referencedBaseCellCount: 1,
    referencedBaseNodeCount: 0
  });

  const mutable = overlay.mutableCell("e14");
  mutable.hidden = true;
  assert.equal(session.cells.get("e14")?.hidden, false);
  assert.strictEqual(overlay.mutableCell("e14"), mutable);
  assert.equal(refinementSessionOverlayStats(overlay).copiedBaseCellCount, 1);
});

test("overlay appends deterministic nodes without copying base points", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const first = overlay.appendNode([0.25, 0.25, 0.25]);
  const second = overlay.appendNode([0.75, 0.75, 0.75]);

  assert.equal(first, session.nodes.length + 1);
  assert.equal(second, session.nodes.length + 2);
  assert.deepEqual(overlay.node(second), [0.75, 0.75, 0.75]);
  assert.strictEqual(overlay.node(1), session.nodes[0]);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="overlay pure reads|overlay appends" test/refinement-session-overlay.test.mjs
```

Expected: FAIL because the overlay module is missing.

- [ ] **Step 3: Implement overlay read precedence and first-write cloning**

Create `src/refinement-session-overlay-internal.ts` with:

```ts
import type { Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCommand
} from "./refinement-session.js";
import type {
  MutableRefinementSessionCell,
  RefinementSessionStateWriter
} from "./refinement-session-state-internal.js";

export interface RefinementSessionOverlayStats {
  copiedBaseCellCount: number;
  createdCellCount: number;
  appendedNodeCount: number;
  activeLeafAdditionCount: number;
  activeLeafRemovalCount: number;
  copiedNodeOwnerKeyCount: number;
  referencedBaseCellCount: number;
  referencedBaseNodeCount: number;
}

interface OverlayStorage {
  cellOverrides: Map<CellId, MutableRefinementSessionCell>;
  createdCells: Map<CellId, MutableRefinementSessionCell>;
  appendedNodes: Point[];
  activeLeafAdditions: Set<CellId>;
  activeLeafRemovals: Set<CellId>;
  ownerOverridesByNodeKey: Map<string, CellId[]>;
  sortedActiveLeafIdsDirty: boolean;
  appendedUndoCommands: RefinementSessionCommand[];
  clearRedo: boolean;
  nextCommandId: number;
  nextCellOrdinal: number;
  referencedBaseCellIds: Set<CellId>;
  referencedBaseNodeIds: Set<number>;
}

export interface RefinementSessionOverlay extends RefinementSessionStateWriter {
  readonly storage: OverlayStorage;
  readonly options: RefinementSessionOverlayOptions;
}

export interface RefinementSessionOverlayOptions {
  readonly nodeKey: (point: Point) => string;
  readonly cellNodeIds: (cell: RefinementSessionCell) => readonly number[];
}

function cloneCell(cell: RefinementSessionCell): MutableRefinementSessionCell {
  return {
    ...cell,
    element: [...cell.element],
    children: [...cell.children]
  };
}

export function createRefinementSessionOverlay(
  baseSession: RefinementSession,
  options: RefinementSessionOverlayOptions
): RefinementSessionOverlay {
  const storage: OverlayStorage = {
    cellOverrides: new Map(),
    createdCells: new Map(),
    appendedNodes: [],
    activeLeafAdditions: new Set(),
    activeLeafRemovals: new Set(),
    ownerOverridesByNodeKey: new Map(),
    sortedActiveLeafIdsDirty: false,
    appendedUndoCommands: [],
    clearRedo: false,
    nextCommandId: baseSession.nextCommandId,
    nextCellOrdinal: baseSession.nextCellOrdinal ?? baseSession.cells.size + 1,
    referencedBaseCellIds: new Set(),
    referencedBaseNodeIds: new Set()
  };
  const overlay: RefinementSessionOverlay = {
    storage,
    options,
    baseSession,
    get revision() { return baseSession.revision; },
    get kind() { return baseSession.kind; },
    get nodeCount() { return baseSession.nodes.length + storage.appendedNodes.length; },
    get cellCount() { return baseSession.cells.size + storage.createdCells.size; },
    get activeLeafCount() {
      return baseSession.activeLeafIds.size
        - storage.activeLeafRemovals.size
        + storage.activeLeafAdditions.size;
    },
    get nextCommandId() { return storage.nextCommandId; },
    get nextCellOrdinal() { return storage.nextCellOrdinal; },
    get sortedActiveLeafIdsDirty() {
      return storage.sortedActiveLeafIdsDirty || baseSession.sortedActiveLeafIdsDirty;
    },
    node(nodeId) {
      if (nodeId <= baseSession.nodes.length) {
        storage.referencedBaseNodeIds.add(nodeId);
        return baseSession.nodes[nodeId - 1];
      }
      return storage.appendedNodes[nodeId - baseSession.nodes.length - 1];
    },
    cell(cellId) {
      const created = storage.createdCells.get(cellId);
      if (created !== undefined) return created;
      const overridden = storage.cellOverrides.get(cellId);
      if (overridden !== undefined) return overridden;
      storage.referencedBaseCellIds.add(cellId);
      return baseSession.cells.get(cellId);
    },
    mutableCell(cellId) {
      const existing = storage.createdCells.get(cellId)
        ?? storage.cellOverrides.get(cellId);
      if (existing !== undefined) return existing;
      const base = baseSession.cells.get(cellId);
      if (base === undefined) throw new Error(`unknown refinement cell ${cellId}`);
      const cloned = cloneCell(base);
      storage.cellOverrides.set(cellId, cloned);
      return cloned;
    },
    appendNode(point) {
      storage.appendedNodes.push([...point]);
      return baseSession.nodes.length + storage.appendedNodes.length;
    },
    setCell(cell) {
      if (baseSession.cells.has(cell.id)) {
        throw new Error(`overlay cannot create duplicate cell ${cell.id}`);
      }
      storage.createdCells.set(cell.id, cell);
    },
    hasActiveLeaf(cellId) {
      if (storage.activeLeafAdditions.has(cellId)) return true;
      if (storage.activeLeafRemovals.has(cellId)) return false;
      return baseSession.activeLeafIds.has(cellId);
    },
    *activeLeafIds() {
      for (const id of baseSession.activeLeafIds) {
        if (!storage.activeLeafRemovals.has(id)) yield id;
      }
      yield* storage.activeLeafAdditions;
    },
    activeOwnersByNodeKey(key) {
      return storage.ownerOverridesByNodeKey.get(key)
        ?? baseSession.activeLeafIdsByNodeKey.get(key)
        ?? [];
    },
    addActiveLeaf() { throw new Error("active overlay updates are not implemented"); },
    removeActiveLeaf() { throw new Error("active overlay updates are not implemented"); },
    allocateCellOrdinal() {
      const value = storage.nextCellOrdinal;
      storage.nextCellOrdinal += 1;
      return value;
    },
    setNextCommandId(value) { storage.nextCommandId = value; },
    *undoCommands() {
      yield* baseSession.undoStack;
      yield* storage.appendedUndoCommands;
    },
    *redoCommands() {
      if (!storage.clearRedo) yield* baseSession.redoStack;
    },
    appendUndoCommand(command) { storage.appendedUndoCommands.push(command); },
    clearRedoCommands() { storage.clearRedo = true; }
  };
  return overlay;
}

export function refinementSessionOverlayStats(
  overlay: RefinementSessionOverlay
): RefinementSessionOverlayStats {
  const storage = overlay.storage;
  return {
    copiedBaseCellCount: storage.cellOverrides.size,
    createdCellCount: storage.createdCells.size,
    appendedNodeCount: storage.appendedNodes.length,
    activeLeafAdditionCount: storage.activeLeafAdditions.size,
    activeLeafRemovalCount: storage.activeLeafRemovals.size,
    copiedNodeOwnerKeyCount: storage.ownerOverridesByNodeKey.size,
    referencedBaseCellCount: storage.referencedBaseCellIds.size,
    referencedBaseNodeCount: storage.referencedBaseNodeIds.size
  };
}
```

The two temporary active-update errors are intentional at this green step; no production caller uses them yet.

- [ ] **Step 4: Verify GREEN**

```powershell
npm run build
node --test test/refinement-session-overlay.test.mjs
npm run typecheck
```

Expected: all current overlay tests pass.

- [ ] **Step 5: Commit sparse reads**

```powershell
git add src/refinement-session-overlay-internal.ts test/refinement-session-overlay.test.mjs
git commit -m "feat(refinement): add sparse session overlay reads"
```

---

### Task 4: Add Active-Leaf Deltas, Forks, and Guarded Commit

**Files:**
- Modify: `src/refinement-session-overlay-internal.ts`
- Test: `test/refinement-session-overlay.test.mjs`

- [ ] **Step 1: Write failing delta-cancellation, fork, and stale-commit tests**

Append:

```js
import {
  commitRefinementSessionOverlay,
  forkRefinementSessionOverlay,
  snapshotRefinementSessionOverlayDelta
} from "../dist/refinement-session-overlay-internal.js";

test("overlay active-leaf deltas cancel before snapshot", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("e1");
  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  assert.deepEqual(delta.activeLeafAdditions, []);
  assert.deepEqual(delta.activeLeafRemovals, []);
});

test("overlay fork copies only parent delta", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(10, 10, 10));
  const parent = createTestOverlay(session);
  parent.mutableCell("e1").hidden = true;
  const child = forkRefinementSessionOverlay(parent);
  child.mutableCell("e2").hidden = true;
  assert.equal(refinementSessionOverlayStats(child).copiedBaseCellCount, 2);
  assert.equal(session.cells.get("e1")?.hidden, false);
});

test("overlay commit rejects a stale base and commits no partial state", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  overlay.mutableCell("e1").hidden = true;
  session.revision += 1;
  assert.throws(
    () => commitRefinementSessionOverlay(session, snapshotRefinementSessionOverlayDelta(overlay)),
    /stale overlay base revision/
  );
  assert.equal(session.cells.get("e1")?.hidden, false);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="active-leaf deltas|overlay fork|stale base" test/refinement-session-overlay.test.mjs
```

Expected: FAIL because delta/fork/commit exports are missing.

- [ ] **Step 3: Implement active deltas and touched owner-key copies**

Use the exact-node-key callback already required by overlay creation so the
overlay does not duplicate `refinement-session.ts` geometry rules. Production
history callers pass `exactActiveMergeKey` and `(cell) => cell.element`.
Implement both active methods by first validating the cell and every
referenced node, then canceling the opposite set, cloning each touched owner
list once, and adding/removing the id exactly once. Adding an already active
cell and removing a known inactive cell are idempotent no-ops. Reject an
unknown cell, or a missing node before changing any collection. The direct
adapter must use the same validation and owner-index rules, including setting
`sortedActiveLeafIdsDirty` only for effective membership changes.

```ts
function updateOwnerLists(
  overlay: RefinementSessionOverlay,
  cellId: CellId,
  add: boolean
): void {
  const cell = overlay.cell(cellId);
  if (cell === undefined) throw new Error(`unknown refinement cell ${cellId}`);
  for (const nodeId of overlay.options.cellNodeIds(cell)) {
    const point = overlay.node(nodeId);
    if (point === undefined) throw new Error(`cell ${cellId} references missing node ${nodeId}`);
    const key = overlay.options.nodeKey(point);
    const owners = overlay.storage.ownerOverridesByNodeKey.get(key)
      ?? [...overlay.baseSession.activeLeafIdsByNodeKey.get(key) ?? []];
    const next = add
      ? owners.includes(cellId) ? owners : [...owners, cellId]
      : owners.filter((id) => id !== cellId);
    overlay.storage.ownerOverridesByNodeKey.set(key, next);
  }
}
```

- [ ] **Step 4: Implement immutable delta snapshot and fork**

Define `RefinementSessionOverlayDelta` with sorted arrays for overrides, created cells, active additions/removals, owner overrides, appended nodes, history edits, counters, base revision, base collection references, and touched-cell/node fingerprints. Freeze every nested array and object in the snapshot.

Fork by creating a new overlay over the same real base, copying only the parent's sparse storage entries and appended nodes. Preserve deterministic next ids.

- [ ] **Step 5: Implement guarded commit**

Before mutation, verify:

```ts
if (session.revision !== delta.baseRevision) {
  throw new Error("stale overlay base revision");
}
if (
  session.cells !== delta.baseCells
  || session.nodes !== delta.baseNodes
  || session.activeLeafIds !== delta.baseActiveLeafIds
) {
  throw new Error("overlay base collections changed");
}
```

Validate all touched fingerprints and standard `Array`/`Map`/`Set` prototypes. Prepare cloned points, cells, owner lists, active membership, and stack edits before applying them. Then install the prepared nodes, cells, active-leaf set, owner lists, and sorted-active cache invalidation as one atomic active-state update; append the command, clear redo, update counters, and increment revision once. Do not call direct `addActiveLeaf`/`removeActiveLeaf` during commit after preparing the owner lists, or the owner transition will be applied twice.

- [ ] **Step 6: Verify GREEN and failure atomicity**

```powershell
npm run build
node --test test/refinement-session-overlay.test.mjs
npm run typecheck
```

Expected: active cancellation, fork locality, stale rejection, and existing tests pass.

- [ ] **Step 7: Commit overlay mutation support**

```powershell
git add src/refinement-session-overlay-internal.ts test/refinement-session-overlay.test.mjs
git commit -m "feat(refinement): commit sparse session overlay deltas"
```

---

### Task 5: Route History Mutation Primitives Through State Access

**Files:**
- Modify: `src/refinement-session.ts:1812-1886, 3355-3402, 5496-5549, 5610-5653`
- Modify: `src/refinement-session-state-internal.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Add a failing no-direct-mutation source contract**

Add a test that reads `src/refinement-session.ts` and asserts the history reversal function body uses `state.mutableCell`, `state.addActiveLeaf`, and `state.removeActiveLeaf` and contains no assignment through `requiredCell(session, ...)`.

```js
test("history reversal mutates through explicit session state access", () => {
  const source = readFileSync(resolve("src/refinement-session.ts"), "utf8");
  const body = source.match(/function reverseRefinementHistoryCommands[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(body, /state\.mutableCell/);
  assert.match(body, /state\.addActiveLeaf/);
  assert.doesNotMatch(body, /requiredCell\(session/);
});
```

Import `readFileSync` from `node:fs` if it is not already imported.

- [ ] **Step 2: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="history reversal mutates through" test/refinement-kernel-suite.test.mjs
```

Expected: FAIL because the existing function mutates cells directly.

- [ ] **Step 3: Change mutation helpers to writer-based implementations**

Use this signature:

```ts
function reverseRefinementHistoryCommands(
  state: RefinementSessionStateWriter,
  commands: readonly RefinementSessionCommand[],
  commandOrdinalById: ReadonlyMap<string, number>
): void
```

Replace each cell write with:

```ts
const cell = state.mutableCell(cellId);
cell.active = false;
cell.hidden = true;
state.removeActiveLeaf(cellId);
```

Add state-reader variants of hierarchy validation so they resolve cells through `state.cell()` and active status through `state.hasActiveLeaf()`.

- [ ] **Step 4: Adapt real-session callers through the direct adapter**

Ordinary undo/redo and direct patch application must call
`createDirectRefinementSessionState(session, exactActiveMergeKey)`. Preserve
existing public return values and revision increments. Do not migrate unrelated
mesh algorithms.

- [ ] **Step 5: Verify GREEN and run all history tests**

```powershell
npm run build
node --test test/refinement-history.test.mjs test/refinement-session-overlay.test.mjs
node --test --test-name-pattern="undo|redo|history transaction" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass with identical commands and active leaves.

- [ ] **Step 6: Commit the writer refactor**

```powershell
git add src/refinement-session.ts src/refinement-session-state-internal.ts test/refinement-kernel-suite.test.mjs
git commit -m "refactor(refinement): isolate history state mutation"
```

---

### Task 6: Migrate Stage B History Planning to the Overlay

**Files:**
- Modify: `src/refinement-session.ts:1903-2915, 4609-4660`
- Modify: `src/refinement-session-overlay-internal.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write failing preview-isolation and plan-delta tests**

Extend the existing Stage B fixture setup and assert:

```js
test("history transaction preview returns a sparse delta and preserves the base", () => {
  const fixture = createConsumedSupportHistoryFixture();
  const beforeCells = fixture.session.cells;
  const beforeNodes = fixture.session.nodes;
  const beforeLeaves = [...fixture.session.activeLeafIds];

  const plan = planRefinementSessionHistoryTransaction(
    fixture.session,
    [fixture.boundaryCellId],
    fixture.resolvedOptions,
    fixture.faceResolution
  );

  assert.ok(plan.delta);
  assert.equal("finalSession" in plan, false);
  assert.strictEqual(fixture.session.cells, beforeCells);
  assert.strictEqual(fixture.session.nodes, beforeNodes);
  assert.deepEqual([...fixture.session.activeLeafIds], beforeLeaves);
});
```

Place this test below `createConsumedSupportHistoryFixture()` or rely on the
function declaration's hoisting. The fixture already returns `boundaryCellId`,
`resolvedOptions`, and `faceResolution` required by the planner.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run build
node --test --test-name-pattern="returns a sparse delta" test/refinement-kernel-suite.test.mjs
```

Expected: FAIL because plans still return `finalSession`.

- [ ] **Step 3: Change the internal transaction plan shape**

```ts
export interface RefinementSessionHistoryTransactionPlan {
  readonly historyClosure: RefinementHistoryClosure;
  readonly command: RefinementSessionCommand;
  readonly delta: RefinementSessionOverlayDelta;
  readonly overlayStats: Readonly<RefinementSessionOverlayStats>;
  readonly preview: RefinementPreview<CellId>;
}
```

Create one main overlay after history closure discovery. Use a fork for preliminary collision reversal and another fork for the current-request checkpoint. Every reversal, shell rebuild, downstream replay, and current request must receive a state writer.

- [ ] **Step 4: Keep the full final audit temporarily through an overlay reader**

Add a private active-mesh builder overload that consumes `RefinementSessionStateReader` and explicit active ids. Use it to run the existing full final `checkNoHangingNodes()` gate without materializing a session clone.

- [ ] **Step 5: Commit only after every audit passes**

In execution, replace:

```ts
replaceRefinementSessionState(session, transaction.finalSession);
```

with:

```ts
commitRefinementSessionOverlay(session, transaction.delta);
```

Preview returns `transaction.preview` and discards the delta.

- [ ] **Step 6: Verify GREEN and exact Stage B behavior**

```powershell
npm run build
node --test --test-name-pattern="history transaction|transition-shell rebuilding|three nested|undo|redo|replay" test/refinement-kernel-suite.test.mjs
npm run typecheck
```

Expected: all selected Stage B tests pass and the new delta test passes.

- [ ] **Step 7: Commit history overlay migration**

```powershell
git add src/refinement-session.ts src/refinement-session-overlay-internal.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): plan history rebuilds on sparse overlays"
```

---

### Task 7: Prove C1b Output Equivalence and Far-Field Identity

**Files:**
- Modify: `test/refinement-kernel-suite.test.mjs`
- Modify: `test/refinement-session-overlay.test.mjs`

- [ ] **Step 1: Add a deterministic preview/execution/rerun equivalence test**

Create three identical fixtures with `createConsumedSupportHistoryFixture()`.
Preview the first and execute the other two independently. Existing Stage B
tests retain serialized command-script replay coverage; this test compares
aggregate preview data, command recipe, active state, and flat active mesh:

```js
const previewFixture = createConsumedSupportHistoryFixture();
const executionFixture = createConsumedSupportHistoryFixture();
const rerunFixture = createConsumedSupportHistoryFixture();

const requestOptions = (fixture) => ({
  hexRefinementRatio: 2,
  hexTwoToOneSelectionMode: "local",
  includeTransitions: true,
  mergeTolerance: 1e-9,
  activeBuild: fixture.resolvedOptions.activeBuild
});

const preview = previewSessionPatch(
  previewFixture.session,
  [previewFixture.boundaryCellId],
  requestOptions(previewFixture)
);
const command = refineSessionPatch(
  executionFixture.session,
  [executionFixture.boundaryCellId],
  requestOptions(executionFixture)
);
const rerunCommand = refineSessionPatch(
  rerunFixture.session,
  [rerunFixture.boundaryCellId],
  requestOptions(rerunFixture)
);

assert.deepEqual(command.recipe, rerunCommand.recipe);
assert.deepEqual(command.quality, preview.quality);
assert.deepEqual(command.twoToOne, preview.twoToOne);
assert.deepEqual(
  snapshotActiveRefinementState(executionFixture.session),
  snapshotActiveRefinementState(rerunFixture.session)
);
assert.deepEqual(
  buildActiveMesh(executionFixture.session),
  buildActiveMesh(rerunFixture.session)
);
```

- [ ] **Step 2: Add far-field object-identity assertions**

For the existing disjoint-component history fixture, retain references to all cells in the untouched component before execution and assert strict identity afterward:

```js
for (const [cellId, cell] of untouchedCells) {
  assert.strictEqual(session.cells.get(cellId), cell);
}
```

- [ ] **Step 3: Add preview no-mutation assertions**

Assert strict identity for `nodes`, `cells`, `activeLeafIds`, `activeLeafIdsByNodeKey`, `undoStack`, and `redoStack` before and after preview. Also compare revision and next-id counters.

- [ ] **Step 4: Run focused and full tests**

```powershell
npm run build
node --test --test-name-pattern="output equivalence|far-field object identity|preview preserves" test/refinement-kernel-suite.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit equivalence guards**

```powershell
git add test/refinement-kernel-suite.test.mjs test/refinement-session-overlay.test.mjs
git commit -m "test(refinement): lock overlay transaction equivalence"
```

---

### Task 8: Add the Baseline Conformance Certificate Cache

**Files:**
- Create: `src/refinement-conformance-certificate-internal.ts`
- Test: `test/refinement-session-overlay.test.mjs`

- [ ] **Step 1: Write failing cache and invalidation tests**

```js
import {
  certifyRefinementSessionBaseline,
  refinementSessionConformanceCertificate,
  publishRefinementSessionConformanceCertificate
} from "../dist/refinement-conformance-certificate-internal.js";

test("conformance certificate is revision and tolerance scoped", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 2, 2));
  const certificate = certifyRefinementSessionBaseline(session, {
    tolerance: 1e-9,
    coordinateScale: 1,
    minimumElementEdgeLength: 0.5
  });
  publishRefinementSessionConformanceCertificate(session, certificate);
  assert.strictEqual(
    refinementSessionConformanceCertificate(session, 1e-9),
    certificate
  );
  session.revision += 1;
  assert.equal(refinementSessionConformanceCertificate(session, 1e-9), undefined);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="conformance certificate is revision" test/refinement-session-overlay.test.mjs
```

Expected: FAIL because the certificate module is missing.

- [ ] **Step 3: Implement immutable certificate storage**

Create a private WeakMap and these types:

```ts
export interface RefinementSessionConformanceCertificate {
  readonly version: 1;
  readonly session: RefinementSession;
  readonly revision: number;
  readonly tolerance: number;
  readonly coordinateScale: number;
  readonly minimumElementEdgeLength: number;
  readonly nodes: RefinementSession["nodes"];
  readonly cells: RefinementSession["cells"];
  readonly activeLeafIds: RefinementSession["activeLeafIds"];
}
```

Lookup must require exact session, revision, tolerance, collection references, and recorded collection lengths. Publication accepts only a certificate for the current state.

- [ ] **Step 4: Add a one-time full-audit wrapper**

The wrapper takes an injected `buildAndCheck` callback. It returns an existing matching certificate without invoking the callback; otherwise it invokes the callback once, rejects a failing report, and publishes the baseline certificate.

- [ ] **Step 5: Verify GREEN**

```powershell
npm run build
node --test test/refinement-session-overlay.test.mjs
npm run typecheck
```

Expected: cache, tolerance mismatch, revision mismatch, and collection replacement tests pass.

- [ ] **Step 6: Commit baseline certification**

```powershell
git add src/refinement-conformance-certificate-internal.ts test/refinement-session-overlay.test.mjs
git commit -m "feat(refinement): cache conforming session baselines"
```

---

### Task 9: Split Scalar Option Resolution from Mesh Construction

**Files:**
- Modify: `src/refinement-session.ts:1657-1810`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Add a failing getter-once test for the split path**

Use the existing read-once option carrier helpers. Trigger an eligible nested history rebuild without supplying `activeBuild`, then assert every option getter is read exactly once and preview succeeds.

- [ ] **Step 2: Verify RED after introducing a temporary split call**

First change the history entry to call the not-yet-existing `snapshotSessionPatchOptions()`, build, and run the focused test. Expected: TypeScript fails with the missing function. This proves the new path is exercised.

- [ ] **Step 3: Extract the scalar snapshot**

Create:

```ts
interface SessionPatchOptionSnapshot {
  readonly includeTransitions: boolean;
  readonly hexRefinementRatio: 2 | 3;
  readonly hexTwoToOneSelectionMode: "section" | "local";
  readonly rebuildExistingTransitions: boolean;
  readonly transitionSupportCellIds: readonly CellId[];
  readonly requestedMergeTolerance?: number;
  readonly normalizedTwoToOneCompensation?: Readonly<NormalizedTwoToOneCompensation>;
  readonly suppliedActiveBuild?: ActiveMeshBuildResult;
}
```

Move all descriptor snapshots and compensation normalization into `snapshotSessionPatchOptions()`. Do not build or validate an active mesh there.

- [ ] **Step 4: Add route-specific geometry resolution**

`resolveSessionPatchGeometry()` uses, in order:

1. trusted supplied active build metadata;
2. matching conformance certificate metadata;
3. the existing full active build and geometry measurement.

Return the effective merge and face tolerances with the option snapshot.

- [ ] **Step 5: Run all option and active-build tests**

```powershell
npm run build
node --test --test-name-pattern="getter|activeBuild|merge tolerance|geometry resolution" test/refinement-kernel-suite.test.mjs
npm run typecheck
```

Expected: read-once, stale build, tolerance, and compensation tests pass.

- [ ] **Step 6: Commit option separation**

```powershell
git add src/refinement-session.ts test/refinement-kernel-suite.test.mjs
git commit -m "refactor(refinement): separate patch options from mesh builds"
```

---

### Task 10: Build an Immutable Transition Rebuild Context

**Files:**
- Create: `src/refinement-transition-context-internal.ts`
- Modify: `src/refinement-history.ts`
- Modify: `src/refinement-session.ts:2251-2445`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write a failing context-boundary test**

Expose the context on the internal transaction plan, then use the existing
consumed-support fixture:

```js
test("transition rebuild context is immutable and closure scoped", () => {
  const fixture = createConsumedSupportHistoryFixture();
  const plan = planRefinementSessionHistoryTransaction(
    fixture.session,
    [fixture.boundaryCellId],
    fixture.resolvedOptions,
    fixture.faceResolution
  );
  const context = plan.context;

  assert.ok(context.activeComponentCellIds.length > 0);
  assert.ok(context.boundaryCellIds.length > 0);
  assert.deepEqual(context.supportCommandIds, plan.historyClosure.supportCommandIds);
  assert.deepEqual(context.downstreamCommandIds, plan.historyClosure.downstreamCommandIds);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.boundaryFaces), true);
  assert.equal(
    context.activeComponentCellIds.every((cellId) => fixture.session.cells.has(cellId)),
    true
  );
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="transition rebuild context" test/refinement-kernel-suite.test.mjs
```

Expected: FAIL because the context builder is missing.

- [ ] **Step 3: Implement and freeze the context**

Create the exact interface from the approved spec. Build stable sorted arrays for selected, support, ancestors, active component, referenced nodes, support/downstream commands, and boundary cells. Snapshot boundary faces as node ids plus copied point arrays and owner cell ids. Deep-freeze all arrays.

Add the context to the internal plan shape:

```ts
export interface RefinementSessionHistoryTransactionPlan {
  readonly historyClosure: RefinementHistoryClosure;
  readonly context: TransitionRebuildContext;
  readonly command: RefinementSessionCommand;
  readonly delta: RefinementSessionOverlayDelta;
  readonly overlayStats: Readonly<RefinementSessionOverlayStats>;
  readonly preview: RefinementPreview<CellId>;
}
```

- [ ] **Step 4: Preserve crossing-command rejection**

If any closure command references a cell outside the component that is required by its replay recipe, throw the existing `RefinementHistoryClosureError("history closure crosses the component boundary")`. Do not split commands in C1.

- [ ] **Step 5: Verify GREEN and deterministic ordering**

```powershell
npm run build
node --test --test-name-pattern="transition rebuild context|history closure" test/refinement-kernel-suite.test.mjs test/refinement-history.test.mjs
```

Expected: context and all existing closure tests pass independent of seed order.

- [ ] **Step 6: Commit context construction**

```powershell
git add src/refinement-transition-context-internal.ts src/refinement-history.ts src/refinement-session.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): capture component rebuild contexts"
```

---

### Task 11: Add Component-Local Active Mesh Construction

**Files:**
- Modify: `src/refinement-session.ts:386-720, 2251-2915`
- Modify: `src/refinement-transition-context-internal.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write a failing fixed-component/far-field scaling test**

Run the same nested history request in a small component and in the same component plus a much larger disconnected far field. Import the internal transaction planner and compare:

```js
assert.equal(largePlan.localBuild.mesh.elements.length, smallPlan.localBuild.mesh.elements.length);
assert.deepEqual(largePlan.overlayStats, smallPlan.overlayStats);
assert.equal(largePlan.preview.summary.changedInputElementCount, smallPlan.preview.summary.changedInputElementCount);
```

- [ ] **Step 2: Verify RED**

Expected: FAIL because the transaction plan exposes no component-local build and overlay read counters grow through the full final build.

- [ ] **Step 3: Generalize the active builder to a state reader**

Extract a private builder that accepts:

```ts
function buildActiveMeshForStateCellIdsWithMap(
  state: RefinementSessionStateReader,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  geometryResolution: ActiveMeshGeometryResolution
): ActiveMeshBuildResult
```

Resolve cells with `state.cell()` and nodes with `state.node()`. Allocate mapping arrays from the maximum ordinal among the local cells rather than `session.cells.size`.

- [ ] **Step 4: Build only context cells plus one boundary ring**

Sort ids by cell ordinal and pass `context.activeComponentCellIds` plus `context.boundaryCellIds`. Reuse certified global geometry resolution and the exact effective tolerance. Include element-to-cell maps and reverse node groups required by the planner.

- [ ] **Step 5: Remove full final mesh construction for preview counts**

Use the canceled delta sets:

```ts
const outputElementCount = inputElementCount
  - delta.activeLeafRemovals.length
  + delta.activeLeafAdditions.length;
```

Keep the temporary full final conformance audit until Task 12.

- [ ] **Step 6: Verify GREEN and full history behavior**

```powershell
npm run build
node --test --test-name-pattern="far-field scaling|history transaction|transition-shell rebuilding" test/refinement-kernel-suite.test.mjs
npm run typecheck
```

Expected: local build and overlay counts are constant across far-field sizes.

- [ ] **Step 7: Commit component-local builds**

```powershell
git add src/refinement-session.ts src/refinement-transition-context-internal.ts test/refinement-kernel-suite.test.mjs
git commit -m "perf(refinement): scope history builds to affected components"
```

---

### Task 12: Replace Full Final Audit with Incremental Conformance Proof

**Files:**
- Modify: `src/refinement-conformance-certificate-internal.ts`
- Modify: `src/refinement-session.ts:2740-2838`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write failing local and boundary hanging tests**

Add one fixture that injects a missing transition inside the component and one that corrupts an interface to the boundary ring. Both must reject with `TWO_TO_ONE_CONFORMANCE`. Assert no certificate is published and the base session is unchanged.

- [ ] **Step 2: Write a failing certificate-reuse test**

Inject a baseline audit counter. Preview twice on one revision; the first call increments once, the second does not. Execute the request, then assert the published next-revision certificate avoids a new full baseline on the next nested request.

- [ ] **Step 3: Verify RED**

```powershell
npm run build
node --test --test-name-pattern="incremental conformance|certificate reuse|boundary ring" test/refinement-kernel-suite.test.mjs
```

Expected: FAIL because history transactions still run a full final audit and publish no next certificate.

- [ ] **Step 4: Implement the local proof**

Build a local mesh from:

```ts
const checkedCellIds = stableCellIds([
  ...delta.activeLeafAdditions,
  ...context.boundaryCellIds,
  ...activeFaceNeighborsOfChangedCells
]);
```

Run `checkNoHangingNodes()` with the certified tolerance. Additionally compare every stored boundary face partition to the final overlay partition, rejecting missing, extra, or ambiguous ownership.

- [ ] **Step 5: Publish a derived next-revision certificate**

Only after guarded delta commit succeeds, publish a certificate with the new revision, same global geometry resolution and tolerance, and the real session's current collection references/counts.

- [ ] **Step 6: Remove the temporary full final audit**

Delete the history-path `buildActiveMeshWithMap(working)` and full `checkNoHangingNodes(finalActive.mesh, ...)` call. Retain full baseline creation when no certificate exists.

- [ ] **Step 7: Verify GREEN**

```powershell
npm run build
node --test --test-name-pattern="conformance|history transaction|transition-shell rebuilding" test/refinement-kernel-suite.test.mjs
npm test
```

Expected: full suite passes, local defects are rejected, and repeated certified history requests do not rescan the far field.

- [ ] **Step 8: Commit incremental conformance**

```powershell
git add src/refinement-conformance-certificate-internal.ts src/refinement-session.ts test/refinement-kernel-suite.test.mjs
git commit -m "perf(refinement): certify component-local conformance"
```

---

### Task 13: Close Atomicity, Invalidation, and Locality Gaps

**Files:**
- Modify: `test/refinement-session-overlay.test.mjs`
- Modify: `test/refinement-kernel-suite.test.mjs`
- Modify: `src/refinement-session-overlay-internal.ts`
- Modify: `src/refinement-conformance-certificate-internal.ts`

- [ ] **Step 1: Add an atomic snapshot helper**

Snapshot nodes and point values, cell entries and object references, active leaves, owner index, command stacks and object references, next ids, revision, enumerable extras, and certificate identity.

- [ ] **Step 2: Inject each precommit failure**

Cover stale revision, replaced collection reference, touched-cell connectivity mutation, touched-node coordinate mutation, invalid owner index, nonstandard Map/Set/Array storage, quality rejection, and local conformance rejection. Compare every snapshot field after failure.

- [ ] **Step 3: Add official invalidation tests**

Create a certificate, then call ordinary refine, undo, redo, and command replay. Assert the old certificate is not returned for the new revision. Add merge-tolerance mismatch and collection replacement tests.

- [ ] **Step 4: Add a 2-size structural locality guard**

Use one fixed affected component embedded in two far-field sizes. Assert equality of copied cells, created cells, appended nodes, active deltas, owner-key copies, and referenced base cells after context completion. Do not assert wall-clock time.

- [ ] **Step 5: Run all tests**

```powershell
npm test
```

Expected: every test passes with zero skipped Stage C1 tests.

- [ ] **Step 6: Commit closure guards**

```powershell
git add src/refinement-session-overlay-internal.ts src/refinement-conformance-certificate-internal.ts test/refinement-session-overlay.test.mjs test/refinement-kernel-suite.test.mjs
git commit -m "test(refinement): close component overlay guarantees"
```

---

### Task 14: Document, Build, and Prepare the Stage C1 Commit Stack

**Files:**
- Modify: `README.md`
- Modify: `docs/implementation.md`
- Modify: `CHANGELOG.md`
- Regenerate: `examples/browser/hexrefine-standalone.html`

- [ ] **Step 1: Update public documentation**

Document these exact facts:

- replayable history rebuild preview/execution use a sparse component overlay;
- first certification may scan the full active mesh;
- successful forward edits derive the next certificate locally;
- direct ordinary refinement may still build a full active mesh;
- unsupported topology and crossing commands remain explicit rejections;
- public APIs and mesh-only K behavior are unchanged.

- [ ] **Step 2: Update implementation documentation**

Add the state-access, overlay delta, transition context, baseline certificate, local proof, and guarded commit sequence. State that external mutation obtained by casting away the read-only session contract is unsupported.

- [ ] **Step 3: Regenerate standalone artifacts**

```powershell
npm run standalone:build
```

Expected: the generated standalone runtime matches `dist`.

- [ ] **Step 4: Run complete verification**

```powershell
npm test
npm run pages:build
git diff --check
```

Expected: all tests, types, build, standalone, examples, and Pages preparation pass.

- [ ] **Step 5: Confirm clone removal and scope boundaries**

```powershell
rg -n "cloneRefinementSession\(" src/refinement-session.ts
rg -n "arbitrary|unsupported|first certification|component overlay" README.md docs/implementation.md
```

Expected: no history preview/execution call site uses `cloneRefinementSession()`; any remaining call is outside the Stage C1 history route and documented.

- [ ] **Step 6: Commit documentation and generated runtime**

```powershell
git add README.md docs/implementation.md CHANGELOG.md examples/browser/hexrefine-standalone.html
git commit -m "docs(refinement): describe component-scoped history planning"
```

- [ ] **Step 7: Review the commit stack**

```powershell
git log --oneline origin/main..HEAD
git diff --stat codex/h1-2to1-stage-b-history...HEAD
git status --short --branch
```

Expected: focused C1 commits after the Stage B baseline, no unrelated files, and no semantic working-tree changes.

- [ ] **Step 8: Push the Stage C branch as a backup**

```powershell
git push -u fork codex/h1-2to1-stage-c-overlay
```

Expected: the remote branch is created. Do not open an upstream Stage C PR until the Stage A and Stage B dependency order is agreed with the maintainer.

---

## Final Acceptance Checklist

- [ ] Full test and type-check suite passes.
- [ ] Browser standalone and Pages builds pass.
- [ ] History preview/execution no longer call full-session clone.
- [ ] Preview mutates no base data or reference.
- [ ] Execution retains far-field cell object identity.
- [ ] Structural overlay counts remain constant as far field grows.
- [ ] First full certification cost is documented and measured separately.
- [ ] Later certified transactions use component-local build and conformance.
- [ ] Exact Stage B undo/redo/replay output remains unchanged.
- [ ] Unsupported topology/history remains an atomic structured rejection.
- [ ] No Proxy, proprietary runtime, Python helper, or public API break is introduced.
