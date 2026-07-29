import type { ElementKind } from "./types.js";
import type { NormalizedTwoToOneCompensation } from "./two-to-one-capability.js";
import type {
  CellId,
  RefinementSessionCellRole,
  RefinementSessionCommand
} from "./refinement-session.js";

export interface RefinementCellGeometrySnapshot {
  readonly originalCellId: CellId;
  readonly kind: ElementKind;
  readonly level: number;
  readonly role: RefinementSessionCellRole;
  readonly points: readonly (readonly number[])[];
}

export interface RefinementSessionReplayOptionsV1 {
  readonly includeTransitions: boolean;
  readonly hexRefinementRatio: 2 | 3;
  readonly hexTwoToOneSelectionMode: "section" | "local";
  readonly hexTwoToOneCompensation: Readonly<NormalizedTwoToOneCompensation>;
  readonly rebuildExistingTransitions: boolean;
  readonly mergeTolerance?: number;
}

export interface RefinementSessionCommandRecipeV1 {
  readonly version: 1;
  readonly selectedCellIds: readonly CellId[];
  readonly selectedCellGeometry: readonly RefinementCellGeometrySnapshot[];
  readonly transitionSupportCellIds: readonly CellId[];
  readonly transitionSupportCellGeometry: readonly RefinementCellGeometrySnapshot[];
  readonly options: RefinementSessionReplayOptionsV1;
}

export function cloneRefinementSessionCommandRecipe(
  recipe: RefinementSessionCommandRecipeV1
): RefinementSessionCommandRecipeV1 {
  return {
    version: 1,
    selectedCellIds: [...recipe.selectedCellIds],
    selectedCellGeometry: recipe.selectedCellGeometry.map(
      cloneRefinementCellGeometrySnapshot
    ),
    transitionSupportCellIds: [...recipe.transitionSupportCellIds],
    transitionSupportCellGeometry:
      recipe.transitionSupportCellGeometry.map(
        cloneRefinementCellGeometrySnapshot
      ),
    options: {
      includeTransitions: recipe.options.includeTransitions,
      hexRefinementRatio: recipe.options.hexRefinementRatio,
      hexTwoToOneSelectionMode:
        recipe.options.hexTwoToOneSelectionMode,
      hexTwoToOneCompensation: {
        mode: recipe.options.hexTwoToOneCompensation.mode,
        maxAddedParentLayers:
          recipe.options.hexTwoToOneCompensation.maxAddedParentLayers,
        maxAddedParentCount:
          recipe.options.hexTwoToOneCompensation.maxAddedParentCount
      },
      rebuildExistingTransitions:
        recipe.options.rebuildExistingTransitions,
      ...(recipe.options.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: recipe.options.mergeTolerance })
    }
  };
}

export function freezeRefinementSessionCommandRecipe(
  recipe: RefinementSessionCommandRecipeV1
): RefinementSessionCommandRecipeV1 {
  const cloned = cloneRefinementSessionCommandRecipe(recipe);
  for (const geometry of [
    ...cloned.selectedCellGeometry,
    ...cloned.transitionSupportCellGeometry
  ]) {
    for (const point of geometry.points) {
      Object.freeze(point);
    }
    Object.freeze(geometry.points);
    Object.freeze(geometry);
  }
  Object.freeze(cloned.selectedCellIds);
  Object.freeze(cloned.selectedCellGeometry);
  Object.freeze(cloned.transitionSupportCellIds);
  Object.freeze(cloned.transitionSupportCellGeometry);
  Object.freeze(cloned.options.hexTwoToOneCompensation);
  Object.freeze(cloned.options);
  return Object.freeze(cloned);
}

export interface RefinementHistoryIndex {
  readonly commands: readonly RefinementSessionCommand[];
  readonly commandById:
    ReadonlyMap<string, RefinementSessionCommand>;
  readonly creatorCommandIdByCellId: ReadonlyMap<CellId, string>;
  readonly consumerCommandIdsByCellId:
    ReadonlyMap<CellId, readonly string[]>;
  readonly commandOrdinalById: ReadonlyMap<string, number>;
}

export interface BuildHistoryClosureInput {
  readonly seedCellIds: readonly CellId[];
  readonly componentCellIds: ReadonlySet<CellId>;
}

export interface RefinementHistoryClosure {
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly affectedInputCellIds: readonly CellId[];
  readonly preservedCommandIds: readonly string[];
  /** Affected inputs whose creator lies outside the closure. */
  readonly boundaryCellIds: readonly CellId[];
}

export interface TransitionHistoryComponent {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly collidingTransitionParentIds: readonly CellId[];
  readonly componentCellIds: ReadonlySet<CellId>;
  readonly boundaryCellIds: readonly CellId[];
}

export class RefinementHistoryClosureError extends Error {
  readonly commandIds: readonly string[];
  readonly cellIds: readonly CellId[];

  constructor(
    message: string,
    commandIds: readonly string[],
    cellIds: readonly CellId[]
  ) {
    super(message);
    this.name = "RefinementHistoryClosureError";
    this.commandIds = Object.freeze(stableUnique(commandIds));
    this.cellIds = Object.freeze(stableUnique(cellIds));
  }
}

class ReadonlyMapFacade<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(values: ReadonlyMap<K, V>) {
    this.#values = new Map(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this.#values) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#values[Symbol.iterator]();
  }
}

Object.freeze(ReadonlyMapFacade.prototype);

interface RefinementHistoryStateDependencies {
  readonly activePredecessorCommandIdsByCommandId:
    ReadonlyMap<string, readonly string[]>;
  readonly consumerCommandIdsByProducerCommandId:
    ReadonlyMap<string, readonly string[]>;
}

interface RefinementHistoryPrivateIndex {
  readonly commands: readonly RefinementSessionCommand[];
  readonly commandById:
    Map<string, RefinementSessionCommand>;
  readonly creatorCommandIdByCellId: Map<CellId, string>;
  readonly consumerCommandIdsByCellId:
    Map<CellId, readonly string[]>;
  readonly commandOrdinalById: Map<string, number>;
  readonly stateDependencies: RefinementHistoryStateDependencies;
  readonly knownCellIds: Set<CellId>;
}

const privateIndexByHistoryIndex = new WeakMap<
  RefinementHistoryIndex,
  RefinementHistoryPrivateIndex
>();

export function buildRefinementHistoryIndex(
  commands: readonly RefinementSessionCommand[],
  knownCellIds: readonly CellId[]
): RefinementHistoryIndex {
  assertDenseArray(commands, "commands");
  assertDenseArray(knownCellIds, "knownCellIds");

  const knownCellSnapshots = snapshotCellIdArray(
    knownCellIds,
    "knownCellIds"
  );
  const commandSnapshots: RefinementSessionCommand[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    commandSnapshots.push(snapshotHistoryCommand(
      commands[index],
      index
    ));
  }

  const knownCells = new Set(knownCellSnapshots);
  const duplicateCheck = new Set<string>();
  for (const command of commandSnapshots) {
    if (duplicateCheck.has(command.id)) {
      throw new Error(`duplicate refinement command id ${command.id}`);
    }
    duplicateCheck.add(command.id);
  }
  for (const command of commandSnapshots) {
    for (const cellId of command.createdCellIds) {
      if (!knownCells.has(cellId)) {
        throw new Error(
          `command ${command.id} creates missing cell ${cellId}`
        );
      }
    }
    const createdCellIds = new Set(command.createdCellIds);
    for (const cellId of command.activeCreatedCellIds ?? []) {
      if (!knownCells.has(cellId)) {
        throw new Error(
          `command ${command.id} references missing active created cell ${cellId}`
        );
      }
      if (!createdCellIds.has(cellId)) {
        throw new Error(
          `command ${command.id} active created cell ${cellId} is not listed in createdCellIds`
        );
      }
    }
  }

  const commandById = new Map<string, RefinementSessionCommand>();
  const creatorCommandIdByCellId = new Map<CellId, string>();
  const consumerCommandIdsByCellId =
    new Map<CellId, Set<string>>();
  const commandOrdinalById = new Map<string, number>();

  for (const [ordinal, command] of commandSnapshots.entries()) {
    commandById.set(command.id, command);
    commandOrdinalById.set(command.id, ordinal);
    for (const cellId of command.createdCellIds) {
      const existing = creatorCommandIdByCellId.get(cellId);
      if (existing !== undefined) {
        throw new Error(
          `cell ${cellId} has multiple creators: ${existing}, ${command.id}`
        );
      }
      creatorCommandIdByCellId.set(cellId, command.id);
    }
  }

  for (const command of commandSnapshots) {
    for (const cellId of commandInputCellIds(command)) {
      if (!knownCells.has(cellId)) {
        throw new Error(
          `command ${command.id} references missing cell ${cellId}`
        );
      }
      appendStableUnique(
        consumerCommandIdsByCellId,
        cellId,
        command.id
      );
    }
  }

  assertHistoryCommandOrder(
    creatorCommandIdByCellId,
    consumerCommandIdsByCellId,
    commandOrdinalById
  );
  const stateDependencies = buildHistoryStateDependencies(
    commandSnapshots
  );

  const frozenConsumers = new Map<CellId, readonly string[]>();
  for (const [cellId, commandIds] of consumerCommandIdsByCellId) {
    frozenConsumers.set(cellId, Object.freeze([...commandIds]));
  }

  const publicCommands = Object.freeze([...commandSnapshots]);
  const index: RefinementHistoryIndex = Object.freeze({
    commands: publicCommands,
    commandById: readonlyMap(commandById),
    creatorCommandIdByCellId: readonlyMap(
      creatorCommandIdByCellId
    ),
    consumerCommandIdsByCellId: readonlyMap(frozenConsumers),
    commandOrdinalById: readonlyMap(commandOrdinalById)
  });
  privateIndexByHistoryIndex.set(index, Object.freeze({
    commands: Object.freeze([...commandSnapshots]),
    commandById: new Map(commandById),
    creatorCommandIdByCellId:
      new Map(creatorCommandIdByCellId),
    consumerCommandIdsByCellId:
      cloneFrozenStringArrayMap(frozenConsumers),
    commandOrdinalById: new Map(commandOrdinalById),
    stateDependencies,
    knownCellIds: new Set(knownCells)
  }));
  return index;
}

export function buildRefinementHistoryClosure(
  index: RefinementHistoryIndex,
  input: BuildHistoryClosureInput
): RefinementHistoryClosure {
  const privateIndex = privateIndexByHistoryIndex.get(index);
  if (privateIndex === undefined) {
    throw new Error(
      "refinement history index was not built by buildRefinementHistoryIndex"
    );
  }
  const { knownCellIds, stateDependencies } = privateIndex;

  const seedCellIds = stableUnique(input.seedCellIds);
  const missingSeedCellIds = seedCellIds.filter(
    (cellId) => !knownCellIds.has(cellId)
  );
  if (missingSeedCellIds.length > 0) {
    throw new RefinementHistoryClosureError(
      "history closure references missing seed cells",
      [],
      missingSeedCellIds
    );
  }

  const includedCommandIds = new Set<string>();
  const commandWorklist: string[] = [];
  const includeCommandId = (
    commandId: string | undefined
  ): void => {
    if (
      commandId === undefined
      || includedCommandIds.has(commandId)
    ) {
      return;
    }
    includedCommandIds.add(commandId);
    commandWorklist.push(commandId);
  };
  for (const cellId of seedCellIds) {
    includeCommandId(
      privateIndex.creatorCommandIdByCellId.get(cellId)
    );
    for (
      const commandId of
        privateIndex.consumerCommandIdsByCellId.get(cellId) ?? []
    ) {
      includeCommandId(commandId);
    }
  }

  for (
    let worklistIndex = 0;
    worklistIndex < commandWorklist.length;
    worklistIndex += 1
  ) {
    const commandId = commandWorklist[worklistIndex];
    if (commandId === undefined) {
      throw new Error(
        `history closure worklist is sparse at ${worklistIndex}`
      );
    }
    for (
      const predecessorCommandId of
        stateDependencies.activePredecessorCommandIdsByCommandId.get(
          commandId
        ) ?? []
    ) {
      includeCommandId(predecessorCommandId);
    }
    for (
      const consumerCommandId of
        stateDependencies.consumerCommandIdsByProducerCommandId.get(
          commandId
        ) ?? []
    ) {
      includeCommandId(consumerCommandId);
    }
  }

  const includedCommands = privateIndex.commands.filter(
    (command) => includedCommandIds.has(command.id)
  );
  const componentCellIds = new Set(input.componentCellIds);
  const crossingCommandIds: string[] = [];
  const crossingCellIds: CellId[] = [];
  for (const command of includedCommands) {
    const outsideCellIds = affectedCommandCellIds(command).filter(
      (cellId) => !componentCellIds.has(cellId)
    );
    if (outsideCellIds.length > 0) {
      crossingCommandIds.push(command.id);
      crossingCellIds.push(...outsideCellIds);
    }
  }
  if (crossingCommandIds.length > 0) {
    throw new RefinementHistoryClosureError(
      "history closure crosses the component boundary",
      crossingCommandIds,
      crossingCellIds
    );
  }

  const missingRecipeCommandIds = includedCommands
    .filter((command) => command.recipe === undefined)
    .map((command) => command.id);
  if (missingRecipeCommandIds.length > 0) {
    throw new RefinementHistoryClosureError(
      "history closure includes commands without replay recipes",
      missingRecipeCommandIds,
      []
    );
  }

  const affectedInputCellIds = stableUnique(
    includedCommands.flatMap(commandInputCellIds)
  );
  const supportCommandIds = includedCommands
    .filter((command) => !commandHasIncludedPredecessor(
      stateDependencies,
      command.id,
      includedCommandIds
    ))
    .map((command) => command.id);
  const supportCommandIdSet = new Set(supportCommandIds);
  const downstreamCommandIds = includedCommands
    .filter((command) => !supportCommandIdSet.has(command.id))
    .map((command) => command.id);
  const preservedCommandIds = privateIndex.commands
    .filter((command) => !includedCommandIds.has(command.id))
    .map((command) => command.id);
  const boundaryCellIds = affectedInputCellIds.filter((cellId) => {
    const creatorCommandId =
      privateIndex.creatorCommandIdByCellId.get(cellId);
    return creatorCommandId === undefined
      || !includedCommandIds.has(creatorCommandId);
  });

  return Object.freeze({
    supportCommandIds: Object.freeze(supportCommandIds),
    downstreamCommandIds: Object.freeze(downstreamCommandIds),
    affectedInputCellIds: Object.freeze(affectedInputCellIds),
    preservedCommandIds: Object.freeze(preservedCommandIds),
    boundaryCellIds: Object.freeze(boundaryCellIds)
  });
}

function cloneRefinementCellGeometrySnapshot(
  geometry: RefinementCellGeometrySnapshot
): RefinementCellGeometrySnapshot {
  if (geometry.points.length === 0) {
    throw new Error(
      `geometry for cell ${geometry.originalCellId} must contain at least one point`
    );
  }
  const points = Array.from(geometry.points, (point, pointIndex) => {
    if (point === undefined || point.length === 0) {
      throw new Error(
        `geometry for cell ${geometry.originalCellId} point ${pointIndex + 1} must contain at least one coordinate`
      );
    }
    return Array.from(point, (coordinate, coordinateIndex) => {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          `geometry for cell ${geometry.originalCellId} point ${pointIndex + 1} coordinate ${coordinateIndex + 1} must be finite`
        );
      }
      return coordinate;
    });
  });
  return {
    originalCellId: geometry.originalCellId,
    kind: geometry.kind,
    level: geometry.level,
    role: geometry.role,
    points
  };
}

function snapshotHistoryCommand(
  command: RefinementSessionCommand | undefined,
  index: number
): RefinementSessionCommand {
  if (command === null || typeof command !== "object") {
    throw new Error(`command at index ${index} must be an object`);
  }
  const source = command as unknown as Record<string, unknown>;
  const rawId = source.id;
  const kind = source.kind;
  const hiddenCellIds = source.hiddenCellIds;
  const createdCellIds = source.createdCellIds;
  const activeCreatedCellIds = source.activeCreatedCellIds;
  const reactivatedCellIds = source.reactivatedCellIds;
  const createdNodeIds = source.createdNodeIds;
  const quality = source.quality;
  const twoToOne = source.twoToOne;
  const recipe = source.recipe;

  const id = requireNonemptyString(
    rawId,
    `command at index ${index} id`
  );
  const hiddenCellSnapshots = snapshotCellIdArray(
    hiddenCellIds,
    `command ${id} hiddenCellIds`
  );
  const createdCellSnapshots = snapshotCellIdArray(
    createdCellIds,
    `command ${id} createdCellIds`
  );
  const activeCreatedCellSnapshots =
    activeCreatedCellIds === undefined
      ? undefined
      : snapshotCellIdArray(
          activeCreatedCellIds,
          `command ${id} activeCreatedCellIds`
        );
  const reactivatedCellSnapshots =
    reactivatedCellIds === undefined
      ? undefined
      : snapshotCellIdArray(
          reactivatedCellIds,
          `command ${id} reactivatedCellIds`
        );
  const createdNodeSnapshots = snapshotDenseArray<unknown>(
    createdNodeIds,
    `command ${id} createdNodeIds`
  );

  return Object.freeze({
    id,
    kind: kind as RefinementSessionCommand["kind"],
    hiddenCellIds: Object.freeze(hiddenCellSnapshots),
    createdCellIds: Object.freeze(createdCellSnapshots),
    ...(activeCreatedCellSnapshots === undefined
      ? {}
      : {
          activeCreatedCellIds:
            Object.freeze(activeCreatedCellSnapshots)
        }),
    ...(reactivatedCellSnapshots === undefined
      ? {}
      : {
          reactivatedCellIds:
            Object.freeze(reactivatedCellSnapshots)
        }),
    createdNodeIds: Object.freeze(
      createdNodeSnapshots as number[]
    ),
    ...(quality === undefined
      ? {}
      : {
          quality: cloneAndFreezeHistoryValue(
            quality
          ) as NonNullable<
            RefinementSessionCommand["quality"]
          >
        }),
    ...(twoToOne === undefined
      ? {}
      : {
          twoToOne: cloneAndFreezeHistoryValue(
            twoToOne
          ) as NonNullable<
            RefinementSessionCommand["twoToOne"]
          >
        }),
    ...(recipe === undefined
      ? {}
      : {
          recipe: freezeRefinementSessionCommandRecipe(
            recipe as RefinementSessionCommandRecipeV1
          )
        })
  });
}

function assertDenseArray(
  value: unknown,
  label: string
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(
        `${label} must be dense: missing index ${index}`
      );
    }
  }
}

function snapshotDenseArray<T>(
  value: unknown,
  label: string
): T[] {
  assertDenseArray(value, label);
  const snapshot: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    snapshot.push(value[index] as T);
  }
  return snapshot;
}

function snapshotCellIdArray(
  value: unknown,
  label: string
): CellId[] {
  return snapshotDenseArray<unknown>(value, label).map(
    (cellId, index) => requireNonemptyString(
      cellId,
      `${label}[${index}]`
    )
  );
}

function requireNonemptyString(
  value: unknown,
  label: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function cloneAndFreezeHistoryValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) => cloneAndFreezeHistoryValue(entry))
    ) as T;
  }
  if (value !== null && typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneAndFreezeHistoryValue(entry);
    }
    return Object.freeze(cloned) as T;
  }
  return value;
}

function readonlyMap<K, V>(
  values: ReadonlyMap<K, V>
): ReadonlyMap<K, V> {
  return new ReadonlyMapFacade(values);
}

function cloneFrozenStringArrayMap<K>(
  values: ReadonlyMap<K, readonly string[]>
): Map<K, readonly string[]> {
  const snapshot = new Map<K, readonly string[]>();
  for (const [key, commandIds] of values) {
    snapshot.set(key, Object.freeze([...commandIds]));
  }
  return snapshot;
}

function appendStableUnique<K>(
  map: Map<K, Set<string>>,
  key: K,
  commandId: string
): void {
  let commandIds = map.get(key);
  if (commandIds === undefined) {
    commandIds = new Set<string>();
    map.set(key, commandIds);
  }
  commandIds.add(commandId);
}

function buildHistoryStateDependencies(
  commands: readonly RefinementSessionCommand[]
): RefinementHistoryStateDependencies {
  const currentActiveProducerCommandIdByCellId =
    new Map<CellId, string>();
  const activePredecessorCommandIdsByCommandId =
    new Map<string, Set<string>>();
  const consumerCommandIdsByProducerCommandId =
    new Map<string, Set<string>>();

  for (const command of commands) {
    for (
      const cellId of
        uniqueInInputOrder(command.hiddenCellIds)
    ) {
      // A hide depends on and consumes the cell's current active version.
      const producerCommandId =
        currentActiveProducerCommandIdByCellId.get(cellId);
      if (producerCommandId !== undefined) {
        appendCommandDependency(
          activePredecessorCommandIdsByCommandId,
          command.id,
          producerCommandId
        );
        appendCommandDependency(
          consumerCommandIdsByProducerCommandId,
          producerCommandId,
          command.id
        );
      }
      currentActiveProducerCommandIdByCellId.delete(cellId);
    }
    for (
      const cellId of
        uniqueInInputOrder(command.reactivatedCellIds ?? [])
    ) {
      // Reactivation starts a new seed-visible active version; it does
      // not depend on the cell's prior identity creator.
      currentActiveProducerCommandIdByCellId.set(
        cellId,
        command.id
      );
    }
    for (
      const cellId of
        uniqueInInputOrder(command.createdCellIds)
    ) {
      currentActiveProducerCommandIdByCellId.set(
        cellId,
        command.id
      );
    }
  }

  return Object.freeze({
    activePredecessorCommandIdsByCommandId:
      freezeCommandDependencyMap(
        activePredecessorCommandIdsByCommandId
      ),
    consumerCommandIdsByProducerCommandId:
      freezeCommandDependencyMap(
        consumerCommandIdsByProducerCommandId
      )
  });
}

function appendCommandDependency(
  map: Map<string, Set<string>>,
  commandId: string,
  dependencyCommandId: string
): void {
  if (commandId === dependencyCommandId) {
    return;
  }
  appendStableUnique(map, commandId, dependencyCommandId);
}

function freezeCommandDependencyMap(
  map: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, readonly string[]> {
  const snapshot = new Map<string, readonly string[]>();
  for (const [commandId, dependencyCommandIds] of map) {
    snapshot.set(
      commandId,
      Object.freeze([...dependencyCommandIds])
    );
  }
  return snapshot;
}

function assertHistoryCommandOrder(
  creatorCommandIdByCellId: ReadonlyMap<CellId, string>,
  consumerCommandIdsByCellId:
    ReadonlyMap<CellId, ReadonlySet<string>>,
  commandOrdinalById: ReadonlyMap<string, number>
): void {
  for (
    const [cellId, consumerCommandIds] of
      consumerCommandIdsByCellId
  ) {
    const creatorCommandId = creatorCommandIdByCellId.get(cellId);
    if (creatorCommandId === undefined) {
      continue;
    }
    const creatorOrdinal = requiredCommandOrdinal(
      commandOrdinalById,
      creatorCommandId
    );
    for (const consumerCommandId of consumerCommandIds) {
      const consumerOrdinal = requiredCommandOrdinal(
        commandOrdinalById,
        consumerCommandId
      );
      if (creatorOrdinal >= consumerOrdinal) {
        throw new Error(
          `command ${consumerCommandId} consumes cell ${cellId} before creator ${creatorCommandId}`
        );
      }
    }
  }
}

function requiredCommandOrdinal(
  commandOrdinalById: ReadonlyMap<string, number>,
  commandId: string
): number {
  const ordinal = commandOrdinalById.get(commandId);
  if (ordinal === undefined) {
    throw new Error(
      `refinement command ${commandId} has no history ordinal`
    );
  }
  return ordinal;
}

function commandInputCellIds(
  command: RefinementSessionCommand
): CellId[] {
  return uniqueInInputOrder([
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? [])
  ]);
}

function affectedCommandCellIds(
  command: RefinementSessionCommand
): CellId[] {
  return uniqueInInputOrder([
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? []),
    ...command.createdCellIds,
    ...(command.recipe?.selectedCellIds ?? []),
    ...(command.recipe?.transitionSupportCellIds ?? [])
  ]);
}

function commandHasIncludedPredecessor(
  stateDependencies: RefinementHistoryStateDependencies,
  commandId: string,
  includedCommandIds: ReadonlySet<string>
): boolean {
  return (
    stateDependencies.activePredecessorCommandIdsByCommandId.get(
      commandId
    ) ?? []
  ).some((predecessorCommandId) =>
    includedCommandIds.has(predecessorCommandId)
  );
}

function uniqueInInputOrder<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function stableUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}
