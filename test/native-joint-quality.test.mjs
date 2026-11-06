import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const moduleURL=process.env.HEXREFINE_GUI_BUILD
  ? pathToFileURL(path.join(process.env.HEXREFINE_GUI_BUILD,'native-joint-quality.js'))
  : new URL('../dist/native-joint-quality.js',import.meta.url);
const {formatJointQualityDiagnostics:format,formatQualityNumber:number}=await import(moduleURL.href);
const metric={minimum:.1,maximum:.9,undefinedCount:0,lowestElementIDs:[102,103],highestElementIDs:[207]};
const summary={elements:3,sampledInvalidElementCount:0,metrics:{cornerScaledJacobian:metric,
  cornerAndCenterScaledJacobian:{...metric,minimum:-.2},positiveGaussDetRatio:{...metric,minimum:.72}}};

test('old and absent diagnostic reports retain the legacy display',()=>{
  for(const value of [undefined,null,{},[],false])assert.deepEqual(format(value),[]);
});
test('corner, center and Gauss formulas stay distinct with original global EIDs',()=>{
  const rows=format({overall:summary})[0].rows;
  assert.equal(rows[0].minimum,'0.1');assert.equal(rows[1].minimum,'-0.2');assert.equal(rows[2].minimum,'0.72');
  assert.equal(rows[0].lowestIDs,'102, 103');assert.equal(rows[0].highestIDs,'207');
  assert.match(rows[2].formula,/不是 SJ/);assert.equal(rows.length,7);
});
test('PID summaries use exported IDs without local offsets and do not mutate input',()=>{
  const input={overall:summary,regions:[{partId:4,name:'plate',metrics:summary}]};
  const before=JSON.stringify(input);const sections=format(input);
  assert.equal(sections[1].title,'PID 4 · plate');assert.equal(sections[1].elements,'3');
  assert.equal(sections[1].rows[0].lowestIDs,'102, 103');assert.equal(JSON.stringify(input),before);
});
test('missing, nonfinite and malformed metrics are not converted into zero or a pass',()=>{
  const rows=format({overall:{metrics:{cornerScaledJacobian:{minimum:NaN,maximum:null,lowestElementIDs:[-1]},
    cornerAndCenterScaledJacobian:{minimum:Infinity,highestElementIDs:['1']}}}})[0].rows;
  assert.equal(rows[0].minimum,'未提供');assert.equal(rows[0].maximum,'未提供');
  assert.equal(rows[0].lowestIDs,'未提供');assert.equal(rows[1].highestIDs,'未提供');
  assert.equal(rows[2].undefinedCount,'未提供');assert.equal(number(0),'0');assert.equal(number(1e-8),'1.0000e-8');
});
test('only named reference bands are advisory; historical 0.15 creates no gate',()=>{
  const value={overall:{...summary,referenceComparisons:{verdictScaledJacobian:{referenceLowerBound:.5,belowCount:2},
    hypermeshGaussDetRatio:{referenceLowerBound:.7,belowCount:0}},historicalProjectScreen:{cornerSJFloor:.15}}};
  const section=format(value)[0];assert.equal(section.references.length,2);
  assert.ok(section.references.every(s=>s.includes('非验收门槛')));
  assert.equal(JSON.stringify(section).includes('0.15'),false);
});
test('angle extrema retain degrees, undefined counts and low/high direction',()=>{
  const section=format({overall:{metrics:{maximumFaceDiagonalNormalAngleDegrees:{...metric,minimum:0,maximum:42,undefinedCount:2}}}})[0];
  assert.equal(section.rows[6].minimum,'0°');assert.equal(section.rows[6].maximum,'42°');
  assert.equal(section.rows[6].undefinedCount,'2');assert.equal(section.rows[6].highestIDs,'207');
});
