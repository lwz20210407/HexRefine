import test from 'node:test';
import assert from 'node:assert/strict';
import { solveAffineTemplateDomains } from '../dist/two-to-one-affine-domains-internal.js';

const parity = n => { let p=0; while(n){p^=1;n&=n-1;}return p; };
function tables(domains, constraints, predicate) {
  return constraints.map((c,i)=>new Map(domains[c.first].map(a=>[a,new Set(domains[c.second].filter(b=>predicate(a,b,i)))])));
}
function brute(domains, constraints, support) {
  const assignment=[];
  function search(v){
    if(v===domains.length)return [...assignment];
    for(const x of domains[v]){
      assignment[v]=x;
      if(constraints.every((c,i)=>c.first>v||c.second>v||support[i].get(assignment[c.first])?.has(assignment[c.second]))){
        const result=search(v+1);if(result)return result;
      }
    }
    assignment.length=v;return undefined;
  }
  return search(0);
}

test('affine domain solver agrees with exhaustive search on 120 generated systems',()=>{
  let seed=73013;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let run=0;run<120;run++){
    const count=3+random(4),domains=Array.from({length:count},()=>Array.from({length:random(2)?4:2},(_,i)=>11+7*i));
    const constraints=Array.from({length:2+random(9)},()=>({first:random(count),second:random(count)}));
    const masks=constraints.map(c=>[1+random(domains[c.first].length-1),1+random(domains[c.second].length-1),random(2)]);
    const support=tables(domains,constraints,(a,b,i)=>parity(((a-11)/7)&masks[i][0])===(parity(((b-11)/7)&masks[i][1])^masks[i][2]));
    const result=solveAffineTemplateDomains(domains,constraints,support),expected=brute(domains,constraints,support);
    assert.equal(result.kind,expected?'satisfiable':'unsatisfiable',`run ${run}`);
    if(result.kind==='satisfiable')assert.ok(constraints.every((c,i)=>support[i].get(result.solution[c.first]).has(result.solution[c.second])));
    else {
      const core=result.constraintIndices;
      assert.equal(brute(domains,core.map(i=>constraints[i]),core.map(i=>support[i])),undefined,`proof ${run}`);
    }
  }
});

test('affine domain solver handles more than 32 bits and returns a replayable odd-cycle core',()=>{
  const domains=Array.from({length:80},()=>[101,209]);
  const constraints=domains.map((_,i)=>({first:i,second:(i+1)%domains.length}));
  const support=tables(domains,constraints,(a,b,i)=>i===79?a!==b:a===b);
  const result=solveAffineTemplateDomains(domains,constraints,support);
  assert.equal(result.kind,'unsatisfiable');
  assert.deepEqual(result.constraintIndices,Array.from({length:80},(_,i)=>i));
  const consistent=tables(domains,constraints,(a,b)=>a===b);
  const solved=solveAffineTemplateDomains(domains,constraints,consistent);
  assert.equal(solved.kind,'satisfiable');assert.equal(new Set(solved.solution).size,1);
});

test('affine recognition never relaxes a nonlinear support table to its affine hull',()=>{
  const domains=[[0,1,2,3],[0,1,2,3]],constraints=[{first:0,second:1}];
  const nonlinear=tables(domains,constraints,(a,b)=>(a===3)===(b===3));
  assert.equal(solveAffineTemplateDomains(domains,constraints,nonlinear).kind,'unsupported');
  const nonclosed=tables(domains,constraints,(a,b)=>b===[0,1,2,0][a]);
  const result=solveAffineTemplateDomains(domains,constraints,nonclosed);
  assert.equal(result.kind,'unsupported');assert.match(result.reason,/affine hull/);
  assert.equal(solveAffineTemplateDomains([[0,1,2]],[],[]).kind,'unsupported');
});

test('affine domain solver respects singleton domains, self constraints and empty supports',()=>{
  assert.deepEqual(solveAffineTemplateDomains([[9], [8,7]],[],[]),{kind:'satisfiable',solution:[9,8]});
  assert.equal(solveAffineTemplateDomains([[]],[],[]).kind,'unsatisfiable');
  const domains=[[0,1]],constraints=[{first:0,second:0}];
  assert.equal(solveAffineTemplateDomains(domains,constraints,tables(domains,constraints,(a,b)=>a!==b)).kind,'unsatisfiable');
  assert.deepEqual(solveAffineTemplateDomains(domains,constraints,[new Map()]),{kind:'unsatisfiable',constraintIndices:[0]});
});

test('large binary template cycles use sparse parity proofs',()=>{
  const count=30000, domains=Array.from({length:count},()=>[17,31]);
  const constraints=domains.map((_,i)=>({first:i,second:(i+1)%count}));
  const support=tables(domains,constraints,(a,b,i)=>i===count-1?a!==b:a===b);
  const result=solveAffineTemplateDomains(domains,constraints,support);
  assert.equal(result.kind,'unsatisfiable');
  assert.equal(result.constraintIndices.length,count);
});
