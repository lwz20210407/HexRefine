/** Endpoint-fixed strictly increasing profiles: f'(s) >= 0.4*p*s^(p-1). */
export function createBiasedPowerAxialProfile(exponent:number,bias:number):(station:number)=>number {
  if(!Number.isFinite(exponent)||exponent<=0||!Number.isFinite(bias)||Math.abs(bias)>.6)throw new RangeError("invalid bounded axial profile");
  return station=>{
    if(!Number.isFinite(station)||station<0||station>1)throw new RangeError("axial station must be in [0,1]");
    const t=station**exponent;return t+bias*t*(1-t);
  };
}
