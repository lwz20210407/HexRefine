"""Host-independent adaptation of femssc's four-point tooth section.

Profile vertex construction adapted from src/prepp.py thread(), MIT licensed,
Copyright (c) 2021 Kangyi Cai. See vendor_notices/femssc-LICENSE.txt.
The phase evaluator and validation below are HexRefine additions.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class TrapezoidThreadProfile:
    major_diameter: float
    minor_diameter: float
    pitch: float
    crest_width: float
    handedness: str = 'right'
    starts: int = 1
    phase_length: float = 0.0

    def __post_init__(self):
        for name in ['major_diameter', 'minor_diameter', 'pitch', 'crest_width']:
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 or value > 1e6:
                raise ValueError(name + ' must be finite, positive and bounded')
        if self.major_diameter <= self.minor_diameter:
            raise ValueError('major diameter must exceed minor diameter')
        if self.handedness not in ('left', 'right'):
            raise ValueError('handedness must be left or right')
        if type(self.starts) is not int or not 1 <= self.starts <= 8:
            raise ValueError('starts must be an integer from one to eight')
        if isinstance(self.phase_length, bool) or not math.isfinite(self.phase_length) or abs(self.phase_length) > 1e6:
            raise ValueError('invalid phase_length')
        if self.base_width >= self.pitch:
            raise ValueError('tooth base must be narrower than the pitch')

    @property
    def root_radius(self):
        return self.minor_diameter / 2.0

    @property
    def major_radius(self):
        return self.major_diameter / 2.0

    @property
    def flank_width(self):
        return (self.major_diameter - self.minor_diameter) / 2.0 / math.sqrt(3.0)

    @property
    def base_width(self):
        return 2.0 * self.flank_width + self.crest_width

    @property
    def lead(self):
        return self.starts * self.pitch

    def section_vertices(self):
        root, major, flank = self.root_radius, self.major_radius, self.flank_width
        return [(0.0, root), (-flank, major),
                (-flank - self.crest_width, major), (-self.base_width, root)]

    def radius(self, z, theta_degrees):
        if not math.isfinite(z) or not math.isfinite(theta_degrees) or abs(z / self.pitch) > 1e6 or abs(theta_degrees) > 360e6:
            raise ValueError('profile evaluation coordinates must be finite')
        sign = 1 if self.handedness == 'right' else -1
        q = (-z + sign * self.lead * theta_degrees / 360.0 + self.phase_length) % self.pitch
        depth = self.major_radius - self.root_radius
        if q < self.flank_width:
            return self.root_radius + depth * q / self.flank_width
        if q <= self.flank_width + self.crest_width:
            return self.major_radius
        if q < self.base_width:
            return self.major_radius - depth * (q - self.flank_width - self.crest_width) / self.flank_width
        return self.root_radius
