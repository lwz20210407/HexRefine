import type {
  AggregateRefinementPlanSummary,
  PlannedTwoToOneHexRefinement,
  RefineOptions,
  RefinementSessionPatchOptions,
  RefinementPlanSummary,
  RefinementPreview,
  RefinementResult,
  TwoToOneCapabilityReport,
  TwoToOneCompensationAction,
  TwoToOneCompensationOptions,
  TwoToOnePlanningDiagnostic,
  TwoToOnePlanningError,
  TwoToOnePlanningErrorDto,
  TwoToOnePlanningStatus,
  TwoToOneTopologyClass,
  planTwoToOneHexRefinement,
  serializeTwoToOnePlanningError
} from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

type PlanningStatusContract = Expect<Equal<
  TwoToOnePlanningStatus,
  "direct" | "compensated"
>>;

type TopologyClassContract = Expect<Equal<
  TwoToOneTopologyClass,
  "structured" | "mapped" | "periodic-ogrid" | "mixed-level" | "unstructured"
>>;

type CapabilityReportFieldsContract = Expect<Equal<
  keyof TwoToOneCapabilityReport,
  | "status"
  | "topologyClass"
  | "originalSelectedCellIds"
  | "effectiveSelectedCellIds"
  | "actions"
  | "affectedComponentCellIds"
  | "preservedFarFieldCellCount"
>>;

type CapabilityReportStatusContract = Expect<Equal<
  TwoToOneCapabilityReport["status"],
  TwoToOnePlanningStatus
>>;

type CapabilityReportTopologyContract = Expect<Equal<
  TwoToOneCapabilityReport["topologyClass"],
  TwoToOneTopologyClass
>>;

type CompensationActionDefaultIdContract = Expect<Equal<
  TwoToOneCompensationAction["addedParentCellIds"],
  number[]
>>;

type CapabilityReportDefaultIdContract = Expect<Equal<
  TwoToOneCapabilityReport["originalSelectedCellIds"],
  number[]
>>;

type PlanningDiagnosticDefaultIdContract = Expect<Equal<
  TwoToOnePlanningDiagnostic["conflictingCellIds"],
  number[]
>>;

type PlanningErrorDefaultIdContract = Expect<Equal<
  TwoToOnePlanningError["diagnostic"],
  TwoToOnePlanningDiagnostic<number>
>>;

type PlanningErrorDtoFieldsContract = Expect<
  TwoToOnePlanningErrorDto extends {
    name: "TwoToOnePlanningError";
    message: string;
    code: TwoToOnePlanningError["code"];
    diagnostic: TwoToOnePlanningDiagnostic<number>;
  }
    ? true
    : false
>;

type PlanningErrorJsonContract = Expect<Equal<
  ReturnType<TwoToOnePlanningError["toJSON"]>,
  TwoToOnePlanningErrorDto<number>
>>;

type PlanningErrorSerializerContract = Expect<
  typeof serializeTwoToOnePlanningError extends (
    error: TwoToOnePlanningError<number>
  ) => TwoToOnePlanningErrorDto<number>
    ? true
    : false
>;

type RefineOptionsCompensationContract = Expect<Equal<
  RefineOptions["hexTwoToOneCompensation"],
  TwoToOneCompensationOptions | undefined
>>;

type SessionOptionsCompensationContract = Expect<Equal<
  RefinementSessionPatchOptions["hexTwoToOneCompensation"],
  TwoToOneCompensationOptions | undefined
>>;

type PlannerReturnContract = Expect<Equal<
  ReturnType<typeof planTwoToOneHexRefinement>,
  PlannedTwoToOneHexRefinement
>>;

type RefinementResultReportContract = Expect<Equal<
  RefinementResult["twoToOne"],
  TwoToOneCapabilityReport<number> | undefined
>>;

declare const preview: RefinementPreview<string>;

if (preview.planMode === "aggregate") {
  const aggregateSummary: AggregateRefinementPlanSummary = preview.summary;
  const compoundKind: "transition-shell-rebuild" = preview.compound.kind;
  const inputElementCount: number = preview.summary.inputElementCount;
  const changedInputElementCount: number = preview.summary.changedInputElementCount;
  const preservedInputElementCount: number = preview.summary.preservedInputElementCount;
  const outputElementCount: number = preview.summary.outputElementCount;
  // @ts-expect-error aggregate previews do not expose per-parent role counts
  preview.summary.selectedElementCount;
  // @ts-expect-error aggregate previews do not expose estimated per-parent output
  preview.summary.estimatedOutputElementCount;
  void [
    compoundKind,
    aggregateSummary,
    inputElementCount,
    changedInputElementCount,
    preservedInputElementCount,
    outputElementCount
  ];
} else {
  const perParentSummary: RefinementPlanSummary = preview.summary;
  const selectedElementCount: number = preview.summary.selectedElementCount;
  const estimatedOutputElementCount: number = preview.summary.estimatedOutputElementCount;
  // @ts-expect-error per-parent previews do not expose aggregate input counts
  preview.summary.inputElementCount;
  // @ts-expect-error per-parent previews do not expose compound rebuild metadata
  preview.compound;
  void [perParentSummary, selectedElementCount, estimatedOutputElementCount];
}
