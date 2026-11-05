"""Explicit, unit-aware CAD transfer budgets, distinct from mesh validity.

Vendor documentation motivates scale/feature-based budgets; the numerical
engineering defaults below are this project's choices, not vendor standards.
Source-math integrity, topology, detJ and discrete-volume preservation are
outside this policy and must not be relaxed by selecting a CAD profile.
"""
from dataclasses import dataclass
import math


REFERENCES = (
    'https://2022.help.altair.com/2022/hwdesktop/hm/topics/panels/help022.htm',
    'https://docs.software.vt.edu/abaqusv2025/English/SIMACAEKERRefMap/simaker-c-partmgnpyc.htm',
    'https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_msh/msh_auto_defeat.html',
)

DISTANCE_METRICS = (
    'maximumSurfaceDistance', 'maximumBoundaryNodeControlDistance',
    'maximumSourceFaceDistance', 'maximumControlDistanceError',
    'maximumReverseDistance', 'maximumReverseEdgeDistance',
)


def _positive(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise ValueError(name+' must be a positive finite millimeter value')


@dataclass(frozen=True)
class CadAccuracyPolicy:
    profile: str = 'strict-cad-regression'
    target_size_mm: float | None = None
    critical_target_size_mm: float | None = None
    minimum_functional_gap_mm: float | None = None
    minimum_root_radius_mm: float | None = None
    units: str = 'mm'

    def __post_init__(self):
        if self.profile not in ('strict-cad-regression', 'engineering-cad-transfer'):
            raise ValueError('Unknown CAD accuracy profile')
        if self.units != 'mm':
            raise ValueError('CAD policy requires explicit millimeters; convert units before use')
        for name in ('target_size_mm', 'critical_target_size_mm',
                     'minimum_functional_gap_mm', 'minimum_root_radius_mm'):
            value = getattr(self, name)
            if value is not None:
                _positive(value, name)
        if self.profile == 'engineering-cad-transfer' and self.target_size_mm is None:
            raise ValueError('Engineering CAD policy requires the declared local target size')
        if self.profile == 'strict-cad-regression' and any(getattr(self, name) is not None for name in
                ('target_size_mm', 'critical_target_size_mm', 'minimum_functional_gap_mm', 'minimum_root_radius_mm')):
            raise ValueError('Strict CAD regression does not consume engineering size/feature budgets')

    @classmethod
    def engineering(cls, target_size_mm, **kwargs):
        return cls('engineering-cad-transfer', target_size_mm=target_size_mm, **kwargs)

    def distance_budget_mm(self, *, critical=False, local_target_size_mm=None):
        if type(critical) is not bool:
            raise ValueError('Critical-region flag must be boolean')
        if local_target_size_mm is not None:
            _positive(local_target_size_mm, 'local_target_size_mm')
        if self.profile == 'strict-cad-regression':
            return 2e-6
        size = local_target_size_mm
        if size is None:
            size = self.critical_target_size_mm if critical and self.critical_target_size_mm is not None else self.target_size_mm
        elif critical and self.critical_target_size_mm is not None:
            size=min(size,self.critical_target_size_mm)
        budgets = [.0005 if critical else .001, .01*size]
        if critical:
            if self.minimum_functional_gap_mm is not None:
                budgets.append(.05*self.minimum_functional_gap_mm)
            if self.minimum_root_radius_mm is not None:
                budgets.append(.01*self.minimum_root_radius_mm)
        return min(budgets)

    def carrier_limits(self, *, all_surfaces_critical=True):
        if type(all_surfaces_critical) is not bool:
            raise ValueError('All-surfaces-critical flag must be boolean')
        distance = self.distance_budget_mm(critical=all_surfaces_critical)
        limits = dict.fromkeys(DISTANCE_METRICS, distance)
        limits.update(
            # Rechecking immutable SOURCE evidence is not a candidate tolerance.
            maximumSourceReferenceError=2e-6,
            maximumCadBoundsDifference=1e-5 if self.profile == 'strict-cad-regression' else distance,
            relativeStepBrepVolumeError=1e-7 if self.profile == 'strict-cad-regression' else 1e-4)
        return limits

    def manifest(self, *, all_surfaces_critical=True):
        return dict(schemaVersion=1, policyVersion='2026-11-05-v1', profile=self.profile,
            units=self.units, declaredTargetSizeMm=self.target_size_mm,
            criticalTargetSizeMm=self.critical_target_size_mm,
            minimumFunctionalGapMm=self.minimum_functional_gap_mm,
            minimumRootRadiusMm=self.minimum_root_radius_mm,
            allSurfacesTreatedAsCritical=all_surfaces_critical,
            limits=self.carrier_limits(all_surfaces_critical=all_surfaces_critical),
            numericalLimitsAreProjectChoicesNotVendorMandates=True,
            declaredTargetSizeIsNotTheShortestIncidentalMeshEdge=True,
            sourceMathAndMeshValidityGatesUnchanged=True,
            matingContactOrManufacturingConformityCertified=False,
            primaryDocumentation=list(REFERENCES))
