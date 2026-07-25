import type {
  TwoToOneCapabilityReport,
  TwoToOneCompensationAction,
  TwoToOnePlanningDiagnostic,
  TwoToOnePlanningError,
  TwoToOnePlanningStatus,
  TwoToOneTopologyClass
} from "./two-to-one-capability.js";

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
