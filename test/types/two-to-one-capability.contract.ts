import type {
  RefineOptions,
  RefinementResult,
  TwoToOneCapabilityReport,
  TwoToOneCompensationAction,
  TwoToOneCompensationOptions,
  TwoToOnePlanningDiagnostic,
  TwoToOnePlanningError,
  TwoToOnePlanningErrorDto,
  TwoToOnePlanningStatus,
  TwoToOneTopologyClass,
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

type RefinementResultReportContract = Expect<Equal<
  RefinementResult["twoToOne"],
  TwoToOneCapabilityReport<number> | undefined
>>;
