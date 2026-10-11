/** Shared fixed-field formatting; IDs and coordinates have different zero rules. */
export function fixedInteger(value:number,width:number,label:string):string {
  if(!Number.isSafeInteger(value)||value<=0)throw new Error(`LS-DYNA ${label} must be a positive integer`);
  const text=String(value);
  if(text.length>width)throw new Error(`LS-DYNA ${label} ${value} exceeds the ${width}-column field`);
  return text.padStart(width);
}

export function fixedFloat(value:number,width:number,precision=8,format="scientific"):string {
  if(!Number.isFinite(value))throw new Error(`LS-DYNA coordinate must be finite, got ${value}`);
  if(format==="compact")for(let digits=17;digits>=1;digits--){
    const text=Number(value.toPrecision(digits)).toString();if(text.length<=width)return text.padStart(width);
  }
  for(let digits=precision;digits>=1;digits--){const text=value.toExponential(digits);if(text.length<=width)return text.padStart(width);}
  throw new Error(`LS-DYNA coordinate ${value} exceeds the ${width}-column field`);
}
