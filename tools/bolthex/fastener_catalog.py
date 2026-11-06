"""Versioned, bounded nominal catalog; no CAD imports or standards certification.

Selected data is from bd_warehouse v0.3.0 (Apache-2.0), pinned below. Library
standard labels are not verified editions, GB equivalences or tolerance limits.
All adapter design dimensions remain millimetres, including inch designations.
"""
from __future__ import annotations

import argparse
import csv
from fractions import Fraction
import hashlib
from importlib import metadata
import io
import json
import math
from pathlib import Path

from . import standard_cad as adapter
from .thread_dimensions import dimensions_for


SCHEMA_VERSION = 1
CATALOG_VERSION = '2026-11-06.nominal-bounded.v1'
BACKEND_VERSION = '0.3.0'
SOURCE_COMMIT = '28696f9b4c765c3b0385ccef1d41f45de245e8ad'
SOURCE_REPOSITORY = 'https://github.com/gumyr/bd_warehouse'
MAX_TABLE_BYTES = 128 * 1024
PITCH_MATCH_EPSILON_MM = 1e-9

_TABLES = {
    'hex_head_parameters.csv': '0004b9d7f7dbf7ec054ddc88439e64c293330813915b6e5caf57c7340b501c1c',
    'hex_nut_parameters.csv': 'd43fb52182ea302af0ac9e9ce102c2743abb84060e8f90a16c0e42d90c0388ea',
    'socket_head_cap_parameters.csv': '3b98b4a4bc913ad25afdcef6d9937e2d45909deae8f0e5a68f800b1fc85579c6',
    'domed_cap_nut_parameters.csv': '58e46619c2f57011604413ef90295d39a69dbbdbdb5fd22c8563f7d8476096ed',
}

# Selected literal table fields, not newly inferred standard dimensions. In
# particular ISO4017 M6 k=4.24 is retained as upstream data, not "corrected".
_ROWS = (
    ('hex_bolt', 'iso4017', 'M6-1', 'hex_head_parameters.csv', {'k': '4.24', 's': '10'}),
    ('hex_bolt', 'iso4017', 'M8-1.25', 'hex_head_parameters.csv', {'k': '5.54', 's': '13'}),
    ('hex_nut', 'iso4032', 'M6-1', 'hex_nut_parameters.csv', {'m': '5.2', 's': '10'}),
    ('hex_nut', 'iso4032', 'M8-1.25', 'hex_nut_parameters.csv', {'m': '6.8', 's': '13'}),
    ('socket_bolt', 'iso4762', 'M6-1', 'socket_head_cap_parameters.csv',
     {'dk': '10.22', 'k': '6', 's': '5', 't': '3'}),
    ('socket_bolt', 'asme_b18.3', '1/4-20', 'socket_head_cap_parameters.csv',
     {'dk': '0.375', 'k': '0.2500', 's': '3/16', 't': '0.120'}),
    ('cap_nut', 'din1587', 'M6-1', 'domed_cap_nut_parameters.csv',
     {'dk': '9.5', 'm': '5', 's': '10'}),
)

_LIMITATIONS = (
    'Bounded nominal snapshot, not the complete upstream size range.',
    'Standard labels identify upstream table keys; standards editions are unknown.',
    'No verified GB/ISO/DIN/ASME equivalence or cross-standard substitution.',
    '6g/6H and other tolerance-class limit geometry are not implemented here.',
    'Radial clearance is a separate geometric offset, never a tolerance-class certificate.',
    'A nominal match is not CAD, H8, HM, contact, manufacturing or solver acceptance.',
    'Recorded verification examples apply only to their stated requests and evidence scope.',
)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode('utf-8')).hexdigest()


def _source_url(table):
    return f'{SOURCE_REPOSITORY}/blob/{SOURCE_COMMIT}/src/bd_warehouse/data/{table}'


def _positive(value, name):
    if type(value) not in (int, float) or not 0 < value <= 1e6 or not math.isfinite(value):
        raise ValueError(name + ' must be a bounded positive finite number, not a Boolean')
    return float(value)


def _parse_query(request):
    if not isinstance(request, dict):
        raise ValueError('Catalog query must be an object')
    if any(key in request for key in ('radial_clearance', 'radial_clearance_mm', 'clearance')):
        raise ValueError('Radial clearance is not a tolerance class or a nominal catalog selector')
    allowed = {'family', 'standard', 'size', 'pitch', 'threads_per_inch', 'units', 'edition', 'tolerance_class'}
    if any(type(key) is not str for key in request) or set(request) - allowed:
        raise ValueError('Unknown catalog fields; mesh, sampling-radius and design overrides are forbidden')
    query = dict(request)
    for name in ('family', 'standard', 'size', 'edition', 'tolerance_class'):
        if name not in query:
            continue
        value = query[name]
        if type(value) is not str or not value.strip() or len(value) > 64:
            raise ValueError(name + ' must be a nonempty bounded string')
        query[name] = value.strip()
    for name in ('family', 'standard'):
        if name in query:
            query[name] = query[name].lower()
    units = query.get('units', 'mm')
    if type(units) is not str or units not in ('mm', 'inch'):
        raise ValueError('units must explicitly be mm or inch')
    query['units'] = units
    pitch_mm = None
    if 'pitch' in query:
        pitch_mm = _positive(query['pitch'], 'pitch') * (25.4 if units == 'inch' else 1.)
    if 'threads_per_inch' in query:
        tpi_pitch = 25.4 / _positive(query['threads_per_inch'], 'threads_per_inch')
        if not math.isfinite(tpi_pitch):
            raise ValueError('threads_per_inch produces a nonfinite linear pitch')
        if pitch_mm is not None and abs(pitch_mm - tpi_pitch) > PITCH_MATCH_EPSILON_MM:
            raise ValueError('pitch and threads_per_inch describe different nominal pitches')
        pitch_mm = tpi_pitch
    return query, pitch_mm


def _examples(family, standard, size):
    request = dict(family=family, standard=standard, size=size, hand='right')
    if family.endswith('bolt'):
        request['length'] = 19.05 if standard == 'asme_b18.3' else 16 if size == 'M8-1.25' else 12
        if family == 'hex_bolt' and size == 'M8-1.25':
            request['hand'] = 'left'
    examples = [dict(request=request,
                     evidence='tools/tests/test_standard_cad_integration.py:StandardCadIntegrationTests.test_real_nominal_design_geometry',
                     record='docs/STANDARD_FASTENER_CAD.md',
                     scope='Recorded bounded CAD regression; not freshly executed by catalog lookup')]
    if family == 'hex_nut' and size == 'M6-1':
        examples.append(dict(request=dict(request, thread_ends='square'),
                             evidence='docs/CAD_MAPPED_FASTENERS.md',
                             scope='Separate square-ended through-thread design; not a tolerance-class variant'))
    if standard == 'asme_b18.3':
        examples.append(dict(request=dict(request), evidence='docs/SOCKET_INCH_AND_PREFLIGHT.md',
                             scope='Recorded 1/4-20 L19.05 right-hand CAD/H8/K/INP case; not all inch sizes or native-HM acceptance'))
    return examples


def _entry(row, units):
    family, standard, size, table, raw = row
    imperial = standard == 'asme_b18.3'
    if imperial:
        diameter, tpi = size.split('-')
        diameter_mm = float(Fraction(diameter) * Fraction('25.4'))
        pitch_mm = float(Fraction('25.4') / Fraction(tpi))
        design = dict(unit='mm', majorDiameterMm=diameter_mm, pitchMm=pitch_mm)
        diameter_mm, pitch_mm = dimensions_for(dict(size=size), design)
    else:
        diameter_mm, pitch_mm = dimensions_for(dict(size=size))
        design = dict(unit='mm', majorDiameterMm=diameter_mm, pitchMm=pitch_mm)
    scale = Fraction('25.4') if imperial else Fraction(1)
    parameters_mm = {key: float(Fraction(value) * scale) for key, value in raw.items()}
    names = {'k': 'headHeightMm', 'm': 'hexBodyHeightMm' if family == 'cap_nut' else 'nutHeightMm', 't': 'socketDepthMm',
             's': 'socketAcrossFlatsMm' if family == 'socket_bolt' else 'acrossFlatsMm',
             'dk': 'headDiameterMm' if family == 'socket_bolt' else 'domeDiameterMm'}
    dimensions = dict(majorDiameterMm=diameter_mm, pitchMm=pitch_mm,
                      **{names[key]: value for key, value in parameters_mm.items()})
    factor = 25.4 if units == 'inch' else 1.
    source_fields = {'Size': size, **{standard + ':' + k: v for k, v in raw.items()}}
    exposed = family in adapter.FAMILIES and standard in adapter.FAMILIES[family][1]
    pin_compatible = adapter.WAREHOUSE_COMMIT == SOURCE_COMMIT
    return dict(id=family + ':' + standard + ':' + size, family=family, standard=standard,
        size=size, diameterLabel=size.split('-')[0], designationUnits='inch-TPI' if imperial else 'metric-mm',
        designThread=design, nominalDimensionsMm=dimensions, upstreamParametersMm=parameters_mm,
        displayDimensions=dict(units=units, **{key.removesuffix('Mm'): value / factor for key, value in dimensions.items()}),
        threadsPerInch=float(tpi) if imperial else None,
        standardEdition=dict(status='unknown', value=None, verified=False),
        toleranceClass=dict(status='not-implemented', value=None, limitGeometryImplemented=False),
        equivalences=[], gbCrosswalkVerified=False,
        provenance=dict(provider='bd_warehouse', version=BACKEND_VERSION, commit=SOURCE_COMMIT,
            license='Apache-2.0', table=table, tableSHA256=_TABLES[table], sourceURL=_source_url(table),
            sourceUnits='inch' if imperial else 'mm', selectedRawFields=source_fields,
            selectedFieldsSHA256=_digest(source_fields),
            rowHashScope='Selected literal fields; CSV header whitespace stripped for comparison',
            dimensionAuthority='Pinned upstream nominal data, not independently certified standard values'),
        capabilities=dict(nominalLookupAvailable=True, cadAdapterExposed=exposed,
            cadAdapterPinCompatible=pin_compatible, optionalCadRuntimeChecked=False,
            cadGenerationAvailableWithPinnedBackend=exposed and pin_compatible,
            cadGenerationValidationStillRequired=True, currentQueryGeometryVerified=False,
            meshForThisQueryVerified=False, nativeHmForThisQueryVerified=False,
            solverForThisQueryVerified=False, toleranceClassGeometryImplemented=False),
        cadAdapter=dict(api='tools.bolthex.standard_cad.generate', lengthUnit='mm',
            requiredAdditionalFields=['length'] if family.endswith('bolt') else [],
            fixedSelectors=dict(family=family, standard=standard, size=size),
            validationNotes=['Real backend import/Boolean/STEP checks remain mandatory',
                             'Current occupancy probe requires at least three pitches of threaded height']),
        recordedVerificationExamples=_examples(family, standard, size))


def supported_matrix():
    """Distinguish exposed backend standards from this small nominal snapshot."""
    return [dict(family=family, standard=standard, backendClass=class_name,
                 snapshotSizeKeys=[r[2] for r in _ROWS if r[:2] == (family, standard)],
                 snapshotScope='bounded-selected-rows', completeBackendSizeRangeEnumerated=False,
                 adapterPinCompatible=adapter.WAREHOUSE_COMMIT == SOURCE_COMMIT,
                 standardsEditionVerified=False, toleranceClassGeometryImplemented=False,
                 gbCrosswalkVerified=False)
            for family, (class_name, standards) in adapter.FAMILIES.items() for standard in standards]


def query_catalog(request):
    """Pure JSON-like query. Malformed inputs raise; unsupported scope is explicit.

    Numeric pitch uses `units`; TPI requires `threads_per_inch`. Size may be
    an exact adapter designation (M6-1, 1/4-20) or its diameter label (M6, 1/4).
    Edition/tolerance requirements never succeed on nominal data alone.
    """
    query, pitch_mm = _parse_query(request)
    family, standard = query.get('family'), query.get('standard')
    reasons = []
    if family is not None and family not in adapter.FAMILIES:
        status = 'unsupported_family'
        rows = []
    elif standard is not None and standard not in {
            s for f, (_, standards) in adapter.FAMILIES.items() if family is None or f == family for s in standards}:
        status = 'unsupported_standard'
        rows = []
    else:
        rows = [r for r in _ROWS if (family is None or r[0] == family)
                and (standard is None or r[1] == standard)
                and ('size' not in query or query['size'] in (r[2], r[2].split('-')[0]))]
        status = 'matched' if rows else 'outside_snapshot'
    entries = [_entry(row, query['units']) for row in rows]
    if pitch_mm is not None:
        entries = [entry for entry in entries if abs(entry['designThread']['pitchMm'] - pitch_mm) <= PITCH_MATCH_EPSILON_MM]
        if not entries and status == 'matched':
            status = 'outside_snapshot'
    if status != 'matched':
        reasons.append(dict(code=status, detail='No fallback to a different standard, pitch or family is performed'))
    if 'edition' in query:
        reasons.append(dict(code='standard_edition_unverified', detail='The pinned table does not establish the requested standard edition'))
    if 'tolerance_class' in query:
        reasons.append(dict(code='tolerance_geometry_not_implemented', detail='Radial clearance must not be substituted for a tolerance class'))
    if entries and reasons:
        status = 'requirements_not_verified'
    supported = bool(entries) and not reasons
    return dict(schemaVersion=SCHEMA_VERSION, catalogVersion=CATALOG_VERSION,
        query=query, status=status, supported=supported,
        supportedScope='Bounded nominal lookup only; not generated geometry or standards conformance',
        nominalDataAvailable=bool(entries), requestedRequirementsSatisfied=supported,
        selectionAmbiguous=len(entries) > 1,
        canPrepareNominalCadRequest=supported and len(entries) == 1 and entries[0]['capabilities']['cadGenerationAvailableWithPinnedBackend'],
        entries=entries, reasons=reasons, standardsEditionVerified=False,
        toleranceClassGeometryImplemented=False, gbCrosswalkVerified=False,
        limitations=list(_LIMITATIONS))


def catalogue():
    result = query_catalog({})
    result.update(supportedMatrix=supported_matrix(), snapshotEntries=len(_ROWS),
                  sourceRepository=SOURCE_REPOSITORY, sourceCommit=SOURCE_COMMIT)
    return result


def request_schema():
    """Draft-2020-12 input schema for a caller-owned CLI/GUI form."""
    text = dict(type='string', minLength=1, maxLength=64, pattern=r'.*\S.*')
    number = dict(type='number', exclusiveMinimum=0, maximum=1e6)
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema',
            'title': 'BoundedNominalFastenerCatalogQuery', 'schemaVersion': SCHEMA_VERSION,
            'type': 'object', 'additionalProperties': False,
            'properties': {**{key: dict(text) for key in ('family', 'standard', 'size', 'edition', 'tolerance_class')},
                           'units': {'type': 'string', 'enum': ['mm', 'inch'], 'default': 'mm'},
                           'pitch': dict(number, description='Linear pitch in units, never a TPI count'),
                           'threads_per_inch': dict(number, description='Explicit TPI; must agree with pitch if both are supplied')}}


def response_schema():
    """Query envelope schema; nested provenance remains an inspectable object."""
    fields = {
        'schemaVersion': {'const': SCHEMA_VERSION}, 'catalogVersion': {'const': CATALOG_VERSION},
        'query': request_schema(),
        'status': {'enum': ['matched', 'outside_snapshot', 'unsupported_family',
                            'unsupported_standard', 'requirements_not_verified']},
        **{key: {'type': 'boolean'} for key in ('supported', 'nominalDataAvailable',
            'requestedRequirementsSatisfied', 'selectionAmbiguous', 'canPrepareNominalCadRequest')},
        'supportedScope': {'type': 'string'},
        **{key: {'const': False} for key in ('standardsEditionVerified',
            'toleranceClassGeometryImplemented', 'gbCrosswalkVerified')},
        'entries': {'type': 'array', 'maxItems': len(_ROWS), 'items': {
            'type': 'object', 'required': ['id', 'family', 'standard', 'size', 'designThread',
                'nominalDimensionsMm', 'displayDimensions', 'provenance', 'capabilities', 'standardEdition', 'toleranceClass'],
            'properties': {'designThread': {'type': 'object', 'additionalProperties': False,
                'required': ['unit', 'majorDiameterMm', 'pitchMm'],
                'properties': {'unit': {'const': 'mm'}, 'majorDiameterMm': {'type': 'number', 'exclusiveMinimum': 0},
                               'pitchMm': {'type': 'number', 'exclusiveMinimum': 0}}}}}},
        'reasons': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
            'required': ['code', 'detail'], 'properties': {'code': {'type': 'string'}, 'detail': {'type': 'string'}}}},
        'limitations': {'type': 'array', 'items': {'type': 'string'}},
    }
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema',
            'title': 'BoundedNominalFastenerCatalogResponse', 'type': 'object',
            'additionalProperties': False, 'required': list(fields), 'properties': fields}


def verify_source_tables(data_directory):
    """Read-only verification of four exact pinned CSVs, without CAD imports."""
    root = Path(data_directory).resolve()
    verified = []
    for table, expected in _TABLES.items():
        path = root / table
        if not path.is_file() or not 0 < path.stat().st_size <= MAX_TABLE_BYTES:
            raise ValueError('Missing or oversized source table: ' + table)
        with path.open('rb') as stream:
            raw = stream.read(MAX_TABLE_BYTES + 1)
        if len(raw) > MAX_TABLE_BYTES or hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('Pinned source table SHA256 mismatch: ' + table)
        reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        rows = {row['Size']: {key.strip(): value.strip() for key, value in row.items()} for row in reader}
        for _, standard, size, filename, values in _ROWS:
            if filename == table and any(rows.get(size, {}).get(standard + ':' + key) != value for key, value in values.items()):
                raise ValueError('Pinned selected nominal fields differ: ' + table + ':' + size)
        verified.append(dict(table=table, sha256=expected, bytes=len(raw)))
    return dict(schemaVersion=SCHEMA_VERSION, catalogVersion=CATALOG_VERSION,
                verified=True, tables=verified, sourceCommit=SOURCE_COMMIT,
                scope='Exact pinned CSV bytes and selected rows only; not CAD runtime, standards edition or tolerance certification')


def verify_installed_tables():
    distribution = metadata.distribution('bd_warehouse')
    if distribution.version != BACKEND_VERSION:
        raise ValueError('Require bd_warehouse==0.3.0 for this snapshot')
    return verify_source_tables(distribution.locate_file('bd_warehouse/data'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('schema'); commands.add_parser('list'); commands.add_parser('matrix')
    query = commands.add_parser('query')
    for name in ('family', 'standard', 'size', 'units', 'edition', 'tolerance_class'):
        query.add_argument('--' + name.replace('_', '-'))
    query.add_argument('--pitch', type=float); query.add_argument('--threads-per-inch', type=float)
    verify = commands.add_parser('verify-tables')
    verify.add_argument('directory', nargs='?')
    args = parser.parse_args(argv)
    if args.command == 'schema':
        result = dict(schemaVersion=SCHEMA_VERSION, catalogVersion=CATALOG_VERSION,
                      request=request_schema(), response=response_schema())
    elif args.command == 'list':
        result = catalogue()
    elif args.command == 'matrix':
        result = dict(schemaVersion=SCHEMA_VERSION, catalogVersion=CATALOG_VERSION, matrix=supported_matrix())
    elif args.command == 'verify-tables':
        result = verify_source_tables(args.directory) if args.directory is not None else verify_installed_tables()
    else:
        result = query_catalog({key: value for key, value in vars(args).items() if key != 'command' and value is not None})
    print(json.dumps(result, indent=2, allow_nan=False))
    return 2 if args.command == 'query' and not result['supported'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
