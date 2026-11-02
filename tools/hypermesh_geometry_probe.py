"""Bounded diagnostic native-HM surface witnesses, not exact BRep certification."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess


def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
    return digest.hexdigest()


def validate_reference(reference):
    points=reference.get('points')
    if not isinstance(points,list) or not 2<=len(points)<=4096:
        raise ValueError('Require 2..4096 bounded reference points')
    for row in points:
        p=row.get('point')
        if not isinstance(p,(list,tuple)) or len(p)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p):
            raise ValueError('Reference coordinates must be finite numbers')
        distance=row.get('sourceDistance')
        if type(distance) not in (int,float) or not math.isfinite(distance) or distance<0:
            raise ValueError('Invalid source face distance')
        if row.get('role')!='control' and distance>2e-6:
            raise ValueError('An on-surface reference lacks a source CAD witness')
    if not any(p.get('role')=='control' and p['sourceDistance']>.02 for p in points):
        raise ValueError('Require an off-surface control to detect untrimmed-plane false matches')
    if not any(p.get('role')!='control' for p in points):
        raise ValueError('Require on-surface witnesses as well as controls')


def evaluate(reference,text):
    validate_reference(reference)
    records={};complete=False;failures=None;volume=None
    for line in text.splitlines():
        values=line.split()
        if not values:continue
        if values[0]=='volume':
            if volume is not None or len(values)!=2:raise ValueError('Invalid/duplicate volume record')
            volume=float(values[1]);continue
        if values[0]=='complete':
            if failures is not None or len(values)!=4 or values[2]!='failedQueries':raise ValueError('Invalid completion record')
            complete=int(values[1])==len(reference['points']);failures=int(values[3]);continue
        if len(values)!=3:raise ValueError('Invalid native query record')
        index=int(values[0]);distance=float(values[1]);surface=int(values[2])
        if index in records or not 0<=index<len(reference['points']) or not math.isfinite(distance) or distance<0 or surface<1:
            raise ValueError('Invalid/duplicate native distance')
        records[index]=dict(distance=distance,surface=surface)
    if not complete or len(records)!=len(reference['points']) or failures!=0:
        raise ValueError('Native probe did not complete every query')
    if volume is None or not math.isfinite(volume) or volume<=0:
        raise ValueError('Native probe did not measure a positive finite solid volume')
    rows=[dict(reference['points'][i],**record,index=i) for i,record in sorted(records.items())]
    controls=[r for r in rows if r['role']=='control'];surface=[r for r in rows if r['role']!='control']
    maximum=max(r['distance'] for r in surface)
    control_error=max(abs(r['distance']-r['sourceDistance']) for r in controls)
    return dict(schemaVersion=1,purpose='diagnostic-native-cad-probe',nativeVolume=volume,
                surfaceWitnesses=len(surface),maximumSurfaceWitnessDistance=maximum,
                failedSurfaceWitnesses=sum(r['distance']>2e-6 for r in surface),
                controls=len(controls),maximumControlDistanceError=control_error,
                sampledWitnessesPassed=maximum<=2e-6 and control_error<=2e-6,
                witnessLimit=2e-6,exactNativeCadCertified=False,fullModelAcceptance=False,
                worstWitnesses=sorted(rows,key=lambda r:abs(r['distance']-r['sourceDistance']),reverse=True)[:16],
                limitations=['Finite witnesses do not prove global BRep identity.',
                             'A failed closest-point probe can reflect geometry or host query accuracy; calibrate before attributing cause.',
                             'This diagnostic does not change production HM acceptance gates.'])


def make_tcl(database,output,reference):
    validate_reference(reference)
    def encoded(p):return str(Path(p).resolve()).encode('utf-8').hex()
    rows='\n'.join(' '.join(format(v,'.17g') for v in row['point']) for row in reference['points'])
    return '''proc decode {hex} { return [encoding convertfrom utf-8 [binary format H* $hex]] }
set log [open [decode {@OUTPUT@}] w]
if {[catch {
    *readfile [decode {@DATABASE@}]
    *createmark solids 1 all
    set volume 0
    foreach id [hm_getmark solids 1] {set volume [expr {$volume+[hm_getvolumeofsolid solids $id]}]}
    puts $log [list volume $volume]
    *createmark surfaces 1 all
    set surfaces [hm_getmark surfaces 1]
    set i 0
    set failed 0
    foreach row [split {@POINTS@} "\\n"] {
        lassign $row x y z
        set best 1e30
        set owner -1
        foreach sid $surfaces {
            if {[catch {set result [hm_findclosestpointonsurface $x $y $z $sid]}]} {incr failed;continue}
            set d [lindex $result 3]
            if {$d<$best} {set best $d;set owner $sid}
        }
        puts $log [list $i $best $owner]
        incr i
    }
    puts $log [list complete $i failedQueries $failed]
} message]} {puts $log [list error $message]}
close $log
'''.replace('@DATABASE@',encoded(database)).replace('@OUTPUT@',encoded(output)).replace('@POINTS@',rows)


def probe(database,step,reference_file,executable,output,timeout=180):
    if type(timeout) is not int or not 1<=timeout<=600:raise ValueError('Probe timeout must be 1..600 seconds')
    database,step,reference_file,executable,output=map(lambda p:Path(p).resolve(),(database,step,reference_file,executable,output))
    if output.exists() or not output.parent.is_dir():raise ValueError('Require new output directory with existing parent')
    if not executable.is_file() or executable.name.lower()!='hmbatch.exe':raise ValueError('Select installed hmbatch.exe explicitly')
    if database.suffix.lower()!='.hm' or not database.is_file():raise ValueError('Select an existing native HM')
    reference=json.loads(reference_file.read_text());validate_reference(reference)
    if sha(step)!=reference.get('sourceStepSHA256'):raise ValueError('Source CAD hash does not match reference')
    source_hm_hash=sha(database);output.mkdir()
    tcl=output/'probe.tcl';raw=output/'native-distances.txt'
    tcl.write_text(make_tcl(database,raw,reference),encoding='utf-8')
    startup=None
    if hasattr(subprocess,'STARTUPINFO'):
        startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=subprocess.SW_HIDE
    with (output/'host.log').open('w') as log:
        process=subprocess.Popen([str(executable),'-tcl',str(tcl),'-nocommand'],cwd=output,
                                 stdout=log,stderr=subprocess.STDOUT,startupinfo=startup)
        try:process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=log,stderr=subprocess.STDOUT,startupinfo=startup,check=False)
            process.wait();raise RuntimeError('Native CAD probe exceeded bounded host runtime')
    if process.returncode!=0 or not raw.is_file():raise RuntimeError('Native CAD probe failed; retain host log')
    if sha(database)!=source_hm_hash:raise RuntimeError('Read-only probe changed the input HM')
    result=evaluate(reference,raw.read_text())
    result.update(sourceHmSHA256=source_hm_hash,sourceStepSHA256=reference['sourceStepSHA256'],referenceSHA256=sha(reference_file))
    (output/'report.json').write_text(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('database',type=Path);p.add_argument('step',type=Path);p.add_argument('reference',type=Path)
    p.add_argument('output',type=Path);p.add_argument('--hmbatch',type=Path,required=True)
    a=p.parse_args();result=probe(a.database,a.step,a.reference,a.hmbatch,a.output)
    print(json.dumps(result,indent=2));raise SystemExit(0 if result['sampledWitnessesPassed'] else 2)
