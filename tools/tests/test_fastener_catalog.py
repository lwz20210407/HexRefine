"""Bounded nominal catalog, real pinned-table evidence and fail-closed semantics."""
import copy
import hashlib
from importlib import metadata
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from tools.bolthex import fastener_catalog as catalog
from tools.bolthex.thread_dimensions import dimensions_for


class NominalCatalogTests(unittest.TestCase):
    def entry(self, **query):
        result = catalog.query_catalog(query)
        self.assertTrue(result['supported'])
        self.assertEqual(len(result['entries']), 1)
        return result['entries'][0]

    def test_m6_metric_data_retains_the_actual_upstream_value_and_provenance(self):
        e = self.entry(family='hex_bolt', standard='iso4017', size='M6-1', pitch=1, units='mm')
        self.assertEqual(e['designThread'], dict(unit='mm', majorDiameterMm=6., pitchMm=1.))
        self.assertEqual(e['nominalDimensionsMm']['headHeightMm'], 4.24)
        self.assertEqual(e['nominalDimensionsMm']['acrossFlatsMm'], 10.)
        self.assertEqual(e['provenance']['selectedRawFields']['iso4017:k'], '4.24')
        self.assertEqual(e['provenance']['commit'], catalog.SOURCE_COMMIT)
        self.assertIn(catalog.SOURCE_COMMIT, e['provenance']['sourceURL'])
        self.assertEqual(e['standardEdition']['status'], 'unknown')

    def test_quarter_twenty_uses_exact_nominal_design_units_not_tpi_or_sampling_radius(self):
        e = self.entry(family='socket_bolt', standard='asme_b18.3', size='1/4-20',
                       units='inch', pitch=.05, threads_per_inch=20)
        self.assertEqual(dimensions_for(dict(size=e['size']), e['designThread']), (6.35, 1.27))
        self.assertEqual(e['threadsPerInch'], 20.)
        self.assertAlmostEqual(e['displayDimensions']['majorDiameter'], .25)
        self.assertAlmostEqual(e['displayDimensions']['pitch'], .05)
        self.assertEqual(e['nominalDimensionsMm']['socketAcrossFlatsMm'], 4.7625)
        self.assertEqual(e['nominalDimensionsMm']['socketDepthMm'], 3.048)
        self.assertEqual(e['nominalDimensionsMm']['headHeightMm'], 6.35)
        self.assertFalse(e['capabilities']['currentQueryGeometryVerified'])
        self.assertTrue(any(x['request']['length'] == 19.05 for x in e['recordedVerificationExamples']))

    def test_asme_can_be_queried_by_mm_pitch_without_relabelling_the_inch_designation(self):
        e = self.entry(family='socket_bolt', standard='asme_b18.3', size='1/4-20', pitch=1.27)
        self.assertEqual(e['designationUnits'], 'inch-TPI')
        self.assertEqual(e['displayDimensions']['units'], 'mm')
        self.assertEqual(e['cadAdapter']['lengthUnit'], 'mm')
        self.assertEqual(e['cadAdapter']['fixedSelectors']['size'], '1/4-20')

    def test_cap_m_is_body_height_not_a_fabricated_overall_height(self):
        e = self.entry(family='cap_nut', standard='din1587', size='M6-1')
        self.assertEqual(e['nominalDimensionsMm']['hexBodyHeightMm'], 5.)
        self.assertEqual(e['nominalDimensionsMm']['domeDiameterMm'], 9.5)
        self.assertNotIn('nutHeightMm', e['nominalDimensionsMm'])
        self.assertNotIn('overallHeightMm', e['nominalDimensionsMm'])

    def test_diameter_label_and_pitch_filter_do_not_guess_another_standard(self):
        e = self.entry(family='hex_nut', standard='iso4032', size='M6', pitch=1.)
        self.assertEqual(e['size'], 'M6-1')
        result = catalog.query_catalog(dict(family='hex_nut', standard='iso4032', size='M6', pitch=.75))
        self.assertFalse(result['supported'])
        self.assertEqual(result['status'], 'outside_snapshot')
        self.assertEqual(result['entries'], [])

    def test_editions_and_tolerance_classes_cannot_be_satisfied_by_nominal_data(self):
        for requirement in (dict(edition='2014'), dict(tolerance_class='6g'),
                            dict(tolerance_class='6H'), dict(edition='2022', tolerance_class='6g/6H')):
            result = catalog.query_catalog(dict(family='hex_bolt', standard='iso4017', size='M6-1', **requirement))
            self.assertEqual(result['status'], 'requirements_not_verified')
            self.assertFalse(result['supported'])
            self.assertTrue(result['nominalDataAvailable'])
            self.assertFalse(result['canPrepareNominalCadRequest'])
            self.assertFalse(result['standardsEditionVerified'])
            self.assertFalse(result['toleranceClassGeometryImplemented'])

    def test_gb_aliases_and_wrong_family_standard_combinations_are_not_invented(self):
        for family, standard in (('hex_bolt', 'GB5783'), ('hex_bolt', 'GB/T 5783'),
                                 ('hex_bolt', 'din931'), ('cap_nut', 'iso4032')):
            with self.subTest(family=family, standard=standard):
                r = catalog.query_catalog(dict(family=family, standard=standard, size='M6-1'))
                self.assertFalse(r['supported'])
                self.assertEqual(r['status'], 'unsupported_standard')
                self.assertFalse(r['gbCrosswalkVerified'])
        self.assertEqual(catalog.query_catalog(dict(family='washer'))['status'], 'unsupported_family')

    def test_unlisted_backend_sizes_are_outside_snapshot_not_asserted_unsupported_by_backend(self):
        r = catalog.query_catalog(dict(family='hex_bolt', standard='iso4017', size='M10-1.5'))
        self.assertEqual(r['status'], 'outside_snapshot')
        r = catalog.query_catalog(dict(family='hex_nut', standard='iso4033', size='M6-1'))
        self.assertEqual(r['status'], 'outside_snapshot')
        matrix = catalog.supported_matrix()
        self.assertEqual(len(matrix), 7)
        row = next(x for x in matrix if x['standard'] == 'iso4033')
        self.assertEqual(row['snapshotSizeKeys'], [])
        self.assertFalse(row['completeBackendSizeRangeEnumerated'])

    def test_multi_match_requires_selection_before_preparing_a_cad_request(self):
        r = catalog.query_catalog(dict(size='M6'))
        self.assertTrue(r['supported'])
        self.assertTrue(r['selectionAmbiguous'])
        self.assertFalse(r['canPrepareNominalCadRequest'])
        one = catalog.query_catalog(dict(family='hex_bolt', standard='iso4017', size='M6'))
        self.assertTrue(one['canPrepareNominalCadRequest'])

    def test_adapter_pin_change_does_not_silently_promote_an_old_snapshot_to_new_cad(self):
        with patch.object(catalog.adapter, 'WAREHOUSE_COMMIT', 'changed-pin'):
            r = catalog.query_catalog(dict(family='hex_bolt', standard='iso4017', size='M6-1'))
        self.assertTrue(r['nominalDataAvailable'])
        self.assertFalse(r['canPrepareNominalCadRequest'])
        self.assertFalse(r['entries'][0]['capabilities']['cadAdapterPinCompatible'])
        self.assertEqual(r['entries'][0]['provenance']['commit'], catalog.SOURCE_COMMIT)

    def test_inputs_and_returned_records_do_not_share_mutable_catalog_state(self):
        request = dict(family='hex_bolt', standard='iso4017', size='M6-1')
        before = copy.deepcopy(request)
        result = catalog.query_catalog(request)
        result['entries'][0]['nominalDimensionsMm']['headHeightMm'] = 999
        result['entries'][0]['provenance']['selectedRawFields']['iso4017:k'] = '999'
        self.assertEqual(request, before)
        self.assertEqual(self.entry(**request)['nominalDimensionsMm']['headHeightMm'], 4.24)

    def test_schema_and_output_are_json_serializable_and_flags_are_explicit(self):
        r = catalog.query_catalog({})
        schema = catalog.response_schema()
        self.assertEqual(set(schema['required']), set(r))
        self.assertFalse(catalog.request_schema()['additionalProperties'])
        self.assertEqual(catalog.catalogue()['snapshotEntries'], 7)
        for value in (r, schema, catalog.request_schema(), catalog.supported_matrix()):
            json.dumps(value, allow_nan=False)
        for entry in r['entries']:
            self.assertEqual(entry['equivalences'], [])
            self.assertFalse(entry['capabilities']['optionalCadRuntimeChecked'])
            self.assertFalse(entry['capabilities']['nativeHmForThisQueryVerified'])

    def test_query_does_not_import_optional_cad_packages(self):
        command = [sys.executable, '-B', '-c',
            "import sys; from tools.bolthex.fastener_catalog import catalogue; "
            "assert len(catalogue()['entries'])==7; "
            "loaded={n.split('.')[0] for n in sys.modules} & {'OCP','build123d','bd_warehouse'}; "
            "assert not loaded, loaded"]
        result = subprocess.run(command, cwd=Path(__file__).resolve().parents[2],
                                capture_output=True, text=True, timeout=20,
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class CatalogGuardTests(unittest.TestCase):
    def test_nonfinite_boolean_nonpositive_and_excessive_numeric_selectors_reject(self):
        for key in ('pitch', 'threads_per_inch'):
            for value in (True, False, 0, -1, math.nan, math.inf, '1', 1e7, 10**1000):
                with self.subTest(key=key, value=str(value)[:50]), self.assertRaises(ValueError):
                    catalog.query_catalog({key: value})
        with self.assertRaisesRegex(ValueError, 'nonfinite linear pitch'):
            catalog.query_catalog({'threads_per_inch': 5e-324})

    def test_wrong_units_unknown_fields_and_radial_clearance_reject(self):
        for query in (None, [], {'units': 'cm'}, {'units': True}, {'unit': 'mm'},
                      {'samplingRadiusMm': 2.794}, {'nodes': []}, {'majorDiameterMm': 6}, {False: 'x'}):
            with self.subTest(query=query), self.assertRaises(ValueError):catalog.query_catalog(query)
        for key in ('radial_clearance', 'radial_clearance_mm', 'clearance'):
            with self.assertRaisesRegex(ValueError, 'not a tolerance class'):
                catalog.query_catalog({key: .01, 'tolerance_class': '6H'})

    def test_bad_strings_and_conflicting_pitch_tpi_reject(self):
        for key in ('family', 'standard', 'size', 'edition', 'tolerance_class'):
            for value in (None, True, 6, '', ' ', 'x'*65):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):catalog.query_catalog({key: value})
        with self.assertRaisesRegex(ValueError, 'different nominal pitches'):
            catalog.query_catalog(dict(pitch=20, threads_per_inch=20, units='mm'))
        r = catalog.query_catalog(dict(standard='asme_b18.3', size='1/4-20', pitch=20, units='mm'))
        self.assertFalse(r['supported'])

    def test_cli_reports_nonmatches_without_success_or_geometry_allocation(self):
        for arguments, expected in ((['query','--family','socket_bolt','--standard','asme_b18.3','--size','1/4-20','--pitch','1.27'],0),
                                    (['query','--standard','GB5783','--size','M6-1'],2),
                                    (['query','--standard','iso4017','--size','M6-1','--tolerance-class','6g'],2)):
            with self.subTest(arguments=arguments), redirect_stdout(io.StringIO()) as output:
                code = catalog.main(arguments)
            self.assertEqual(code, expected)
            result = json.loads(output.getvalue())
            self.assertEqual(result['supported'], expected == 0)


def _installed_tables_available():
    try:
        return metadata.version('bd_warehouse') == catalog.BACKEND_VERSION
    except metadata.PackageNotFoundError:
        return False


@unittest.skipUnless(_installed_tables_available(), 'Optional actual bd_warehouse==0.3.0 tables required')
class ActualPinnedTableTests(unittest.TestCase):
    def test_actual_installed_csv_bytes_and_selected_rows_match_the_pin(self):
        report = catalog.verify_installed_tables()
        self.assertTrue(report['verified'])
        self.assertEqual(len(report['tables']), 4)
        self.assertEqual(report['sourceCommit'], catalog.SOURCE_COMMIT)
        self.assertIn('not CAD runtime', report['scope'])

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'), 'Explicit task scratch required')
    def test_changed_or_oversized_source_table_rejects_before_rows_are_trusted(self):
        source = Path(metadata.distribution('bd_warehouse').locate_file('bd_warehouse/data'))
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root = Path(folder)
            for name in catalog._TABLES:
                (root/name).write_bytes((source/name).read_bytes())
            self.assertTrue(catalog.verify_source_tables(root)['verified'])
            name = next(iter(catalog._TABLES))
            path = root/name
            path.write_bytes(path.read_bytes().replace(b'4.24', b'4.25'))
            with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):catalog.verify_source_tables(root)
            with patch.object(catalog, 'MAX_TABLE_BYTES', 4), self.assertRaisesRegex(ValueError, 'oversized'):
                catalog.verify_source_tables(root)


if __name__ == '__main__':
    unittest.main()
