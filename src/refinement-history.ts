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

const knownCellIdsByHistoryIndex = new WeakMap<
  RefinementHistoryIndex,
  ReadonlySet<CellId>
>();

interface RefinementHistoryStateDependencies {
  readonly predecessorCommandIdsByCommandId:
    ReadonlyMap<string, readonly string[]>;
  readonly consumerCommandIdsByProducerCommandId:
    ReadonlyMap<string, readonly string[]>;
}

const stateDependenciesByHistoryIndex = new WeakMap<
  RefinementHistoryIndex,
  RefinementHistoryStateDependencies
>();

export function buildRefinementHistoryIndex(
  commands: readonly RefinementSessionCommand[],
  knownCellIds: readonly CellId[]
): RefinementHistoryIndex {
  const knownCells = new Set(knownCellIds);
  const duplicateCheck = new Set<string>();
  for (const command of commands) {
    if (duplicateCheck.has(command.id)) {
      throw new Error(`duplicate refinement command id ${command.id}`);
    }
    duplicateCheck.add(command.id);
  }
  for (const command of commands) {
    for (const cellId of command.createdCellIds) {
      if (!knownCells.has(cellId)) {
        throw new Error(
          `command ${command.id} creates missing cell ${cellId}`
        );
      }
    }
  }

  const commandSnapshots = commands.map(snapshotHistoryCommand);
  const commandById = new Map<string, RefinementSessionCommand>();
  const creatorCommandIdByCellId = new Map<CellId, string>();
  const consumerCommandIdsByCellId = new Map<CellId, string[]>();
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

  const index: RefinementHistoryIndex = Object.freeze({
    commands: Object.freeze(commandSnapshots),
    commandById: readonlyMap(commandById),
    creatorCommandIdByCellId: readonlyMap(
      creatorCommandIdByCellId
    ),
    consumerCommandIdsByCellId: readonlyMap(frozenConsumers),
    commandOrdinalById: readonlyMap(commandOrdinalById)
  });
  knownCellIdsByHistoryIndex.set(index, new Set(knownCells));
  stateDependenciesByHistoryIndex.set(index, stateDependencies);
  return index;
}

export function buildRefinementHistoryClosure(
  index: RefinementHistoryIndex,
  input: BuildHistoryClosureInput
): RefinementHistoryClosure {
  const knownCellIds = knownCellIdsByHistoryIndex.get(index);
  if (knownCellIds === undefined) {
    throw new Error(
      "refinement history index was not built by buildRefinementHistoryIndex"
    );
  }
  const stateDependencies =
    stateDependenciesByHistoryIndex.get(index);
  if (stateDependencies === undefined) {
    throw new Error(
      "refinement history index has no state dependency graph"
    );
  }

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
  const worklist: string[] = [];
  const enqueueCommandId = (commandId: string | undefined): void => {
    if (
      commandId !== undefined
      && !includedCommandIds.has(commandId)
    ) {
      includedCommandIds.add(commandId);
      worklist.push(commandId);
    }
  };
  for (const cellId of seedCellIds) {
    enqueueCommandId(
      index.creatorCommandIdByCellId.get(cellId)
    );
    for (
      const commandId of
        index.consumerCommandIdsByCellId.get(cellId) ?? []
    ) {
      enqueueCommandId(commandId);
    }
  }

  for (
    let worklistIndex = 0;
    worklistIndex < worklist.length;
    worklistIndex += 1
  ) {
    const commandId = worklist[worklistIndex];
    if (commandId === undefined) {
      throw new Error(
        `history closure worklist is sparse at ${worklistIndex}`
      );
    }
    for (
      const predecessorCommandId of
        stateDependencies.predecessorCommandIdsByCommandId.get(
          commandId
        ) ?? []
    ) {
      enqueueCommandId(predecessorCommandId);
    }
    for (
      const consumerCommandId of
        stateDependencies.consumerCommandIdsByProducerCommandId.get(
          commandId
        ) ?? []
    ) {
      enqueueCommandId(consumerCommandId);
    }
  }

  const includedCommands = sortedCommandIds(
    index,
    includedCommandIds
  ).map((commandId) => requiredHistoryCommand(index, commandId));
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
  const preservedCommandIds = index.commands
    .filter((command) => !includedCommandIds.has(command.id))
    .map((command) => command.id);
  const boundaryCellIds = affectedInputCellIds.filter((cellId) => {
    const creatorCommandId =
      index.creatorCommandIdByCellId.get(cellId);
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
  command: RefinementSessionCommand
): RefinementSessionCommand {
  return Object.freeze({
    id: command.id,
    kind: command.kind,
    hiddenCellIds: Object.freeze([...command.hiddenCellIds]),
    createdCellIds: Object.freeze([...command.createdCellIds]),
    ...(command.activeCreatedCellIds === undefined
      ? {}
      : {
          activeCreatedCellIds: Object.freeze([
            ...command.activeCreatedCellIds
          ])
        }),
    ...(command.reactivatedCellIds === undefined
      ? {}
      : {
          reactivatedCellIds: Object.freeze([
            ...command.reactivatedCellIds
          ])
        }),
    createdNodeIds: Object.freeze([...command.createdNodeIds]),
    ...(command.quality === undefined
      ? {}
      : { quality: cloneAndFreezeHistoryValue(command.quality) }),
    ...(command.twoToOne === undefined
      ? {}
      : {
          twoToOne: cloneAndFreezeHistoryValue(command.twoToOne)
        }),
    ...(command.recipe === undefined
      ? {}
      : {
          recipe: freezeRefinementSessionCommandRecipe(command.recipe)
        })
  });
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

function appendStableUnique(
  map: Map<CellId, string[]>,
  cellId: CellId,
  commandId: string
): void {
  const commandIds = map.get(cellId);
  if (commandIds === undefined) {
    map.set(cellId, [commandId]);
    return;
  }
  if (!commandIds.includes(commandId)) {
    commandIds.push(commandId);
  }
}

function buildHistoryStateDependencies(
  commands: readonly RefinementSessionCommand[]
): RefinementHistoryStateDependencies {
  const currentProducerCommandIdByCellId = new Map<CellId, string>();
  const predecessorCommandIdsByCommandId =
    new Map<string, string[]>();
  const consumerCommandIdsByProducerCommandId =
    new Map<string, string[]>();

  for (const command of commands) {
    for (const cellId of commandInputCellIds(command)) {
      const producerCommandId =
        currentProducerCommandIdByCellId.get(cellId);
      if (producerCommandId === undefined) {
        continue;
      }
      appendCommandDependency(
        predecessorCommandIdsByCommandId,
        command.id,
        producerCommandId
      );
      appendCommandDependency(
        consumerCommandIdsByProducerCommandId,
        producerCommandId,
        command.id
      );
    }
    for (const cellId of stateProducedCellIds(command)) {
      currentProducerCommandIdByCellId.set(cellId, command.id);
    }
  }

  return Object.freeze({
    predecessorCommandIdsByCommandId: freezeCommandDependencyMap(
      predecessorCommandIdsByCommandId
    ),
    consumerCommandIdsByProducerCommandId:
      freezeCommandDependencyMap(
        consumerCommandIdsByProducerCommandId
      )
  });
}

function appendCommandDependency(
  map: Map<string, string[]>,
  commandId: string,
  dependencyCommandId: string
): void {
  const commandIds = map.get(commandId);
  if (commandIds === undefined) {
    map.set(commandId, [dependencyCommandId]);
    return;
  }
  if (!commandIds.includes(dependencyCommandId)) {
    commandIds.push(dependencyCommandId);
  }
}

function freezeCommandDependencyMap(
  map: ReadonlyMap<string, readonly string[]>
): ReadonlyMap<string, readonly string[]> {
  return readonlyMap(new Map(
    [...map].map(([commandId, dependencyCommandIds]) => [
      commandId,
      Object.freeze([...dependencyCommandIds])
    ])
  ));
}

function assertHistoryCommandOrder(
  creatorCommandIdByCellId: ReadonlyMap<CellId, string>,
  consumerCommandIdsByCellId: ReadonlyMap<CellId, readonly string[]>,
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
  return stableUnique([
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? [])
  ]);
}

function stateProducedCellIds(
  command: RefinementSessionCommand
): CellId[] {
  return stableUnique([
    ...command.createdCellIds,
    ...(command.reactivatedCellIds ?? [])
  ]);
}

function affectedCommandCellIds(
  command: RefinementSessionCommand
): CellId[] {
  return stableUnique([
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? []),
    ...command.createdCellIds,
    ...(command.recipe?.selectedCellIds ?? []),
    ...(command.recipe?.transitionSupportCellIds ?? [])
  ]);
}

function sortedCommandIds(
  index: RefinementHistoryIndex,
  commandIds: Iterable<string>
): string[] {
  return [...commandIds].sort((left, right) =>
    requiredCommandOrdinal(index.commandOrdinalById, left)
      - requiredCommandOrdinal(index.commandOrdinalById, right)
  );
}

function requiredHistoryCommand(
  index: RefinementHistoryIndex,
  commandId: string
): RefinementSessionCommand {
  const command = index.commandById.get(commandId);
  if (command === undefined) {
    throw new Error(
      `refinement history index references missing command ${commandId}`
    );
  }
  return command;
}

function commandHasIncludedPredecessor(
  stateDependencies: RefinementHistoryStateDependencies,
  commandId: string,
  includedCommandIds: ReadonlySet<string>
): boolean {
  return (
    stateDependencies.predecessorCommandIdsByCommandId.get(
      commandId
    ) ?? []
  ).some((predecessorCommandId) =>
    includedCommandIds.has(predecessorCommandId)
  );
}

function stableUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}
