"""Independent implementation of the rounded-profile mathematical construction.

Research reference: sunwhale/thread, commit 582da3d8c9ec5ddc7e7d14aa2e32493b7a768a8c,
external/internal GJB3.1 boundary-layer examples. No upstream program code is
vendored. This reproduces their scalar profile convention, not a GB/GJB claim.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class RoundedResearchThreadProfile:
    major_diameter: float
    pitch: float
    handedness: str = 'right'
    starts: int = 1

    def __post_init__(self):
        if any(not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x) or not 0 < x <= 1e6
               for x in [self.major_diameter, self.pitch]):
            raise ValueError('diameter and pitch must be positive, finite and bounded')
        if self.handedness not in ('left', 'right') or type(self.starts) is not int or not 1 <= self.starts <= 8:
            raise ValueError('invalid handedness or starts')
        if self.root_radius <= 0 or self.root_radius <= .6 * self.major_radius:
            raise ValueError('rounded root must stay outside this bounded O-grid core')

    @property
    def height(self):
        return math.sqrt(3) / 2 * self.pitch

    @property
    def major_radius(self):
        return self.major_diameter / 2

    @property
    def root_radius(self):
        return self.major_radius - .875 * self.height + math.sqrt(3) / 12 * self.pitch

    @property
    def minor_diameter(self):
        return 2 * self.root_radius

    @property
    def female_min_radius(self):
        return self.major_radius - (1 - .125 - 5 / 16) * self.height

    @property
    def lead(self):
        return self.starts * self.pitch

    def _angle(self, z, theta_degrees):
        if not math.isfinite(z) or not math.isfinite(theta_degrees) or abs(z / self.pitch) > 1e6 or abs(theta_degrees) > 360e6:
            raise ValueError('evaluation coordinates must be finite')
        sign = 1 if self.handedness == 'right' else -1
        phase = (2 * math.pi * z / self.pitch - sign * self.starts * math.radians(theta_degrees)) % (2 * math.pi)
        return min(phase, 2 * math.pi - phase)

    def radius(self, z, theta_degrees):
        phi = self._angle(z, theta_degrees)
        rho = math.sqrt(3) / 12 * self.pitch
        join = math.sqrt(3) * math.pi * rho / self.pitch
        baseline = self.major_radius - .875 * self.height
        if phi <= join:
            distance = self.pitch * phi / (2 * math.pi)
            return baseline + 2 * rho - math.sqrt(max(0, rho * rho - distance * distance))
        if phi <= .875 * math.pi:
            return baseline + self.height * phi / math.pi
        return self.major_radius

    def internal_radius(self, z, theta_degrees):
        phi = self._angle(z, theta_degrees)
        rho = math.sqrt(3) / 24 * self.pitch
        if phi <= 5 / 16 * math.pi:
            return self.female_min_radius
        if phi <= math.pi * (1 - math.sqrt(3) * rho / self.pitch):
            return self.major_radius - .875 * self.height + self.height * phi / math.pi
        distance = self.pitch * (math.pi - phi) / (2 * math.pi)
        return self.major_radius + .125 * self.height - 2 * rho + math.sqrt(max(0, rho * rho - distance * distance))
