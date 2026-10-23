import test from 'node:test';
import assert from 'node:assert/strict';
import {createBiasedPowerAxialProfile} from '../dist/axial-profile-internal.js';

test('bounded axial profiles fix endpoints and preserve order at all tested dyadic stations',()=>{
  for(const exponent of [.25,.55,.65,.75,.85,1,2])for(const bias of [-.6,-.3,0,.3,.6]){
    const f=createBiasedPowerAxialProfile(exponent,bias);
    assert.equal(f(0),0);assert.equal(f(1),1);
    for(let i=1;i<=1024;i++)assert.ok(f(i/1024)>f((i-1)/1024));
    for(const invalid of [-1,.5+1,NaN,Infinity])assert.throws(()=>f(invalid),RangeError);
  }
  for(const [p,b] of [[0,0],[-1,0],[Infinity,0],[1,.61],[1,-.61],[1,NaN]])assert.throws(()=>createBiasedPowerAxialProfile(p,b),RangeError);
});
