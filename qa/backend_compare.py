import json
import os
import subprocess
import sys
import time
from pathlib import Path
import numpy as np

root = Path(os.environ.get('SOURCE_ROOT', Path(__file__).resolve().parent.parent / 'codesim')).resolve()
proc = subprocess.Popen([sys.executable, '-u', '-m', 'codesimpy.api.cli'], cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(root.parent/'backend-compare-stderr.log','w'), text=True)
streams = {}
chunks = 0

def request(i, method):
    global chunks
    proc.stdin.write(json.dumps({'id': i, 'method': method, 'params': {'systemName': 'VSGSMIBSystem', 'parameters': {}, 'options': {}}})+'\n')
    proc.stdin.flush()
    for line in proc.stdout:
        m = json.loads(line)
        if m.get('type') == 'simulation.chunk':
            chunks += 1
            for signal in m['signals']:
                s = streams.setdefault(signal['id'], {'time': [], 'values': []})
                s['time'].extend(signal['time'])
                s['values'].extend(signal['values'])
        if m.get('id') == i:
            assert m['ok'], m
            return m['result']
    raise RuntimeError('Backend exited before response')

try:
    request(1, 'model.load')
    t = time.perf_counter()
    result = request(2, 'simulation.start')
    descriptor = result['descriptor']
    descriptor = descriptor.get('frontendDescriptor', descriptor)
    differences = []
    for signal in descriptor['signals']:
        s = streams[signal['id']]
        for field in ('time', 'values'):
            a, b = np.asarray(s[field]), np.asarray(signal[field])
            if np.array_equal(a, b):
                continue
            d = {'id': signal['id'], 'field': field, 'streamLength':len(a), 'finalLength':len(b)}
            if a.shape == b.shape:
                delta=np.abs(a-b)
                d.update(maxAbsDifference=float(np.max(delta)),allclose1e_9=bool(np.allclose(a,b,atol=1e-9,rtol=1e-9)),firstMismatch=int(np.flatnonzero(delta)[0]))
            differences.append(d)
    report={'chunks':chunks,'signals':len(descriptor['signals']),'pointsPerSignal':len(descriptor['signals'][0]['time']),'seconds':time.perf_counter()-t,'differences':differences}
    Path(__file__).with_name('backend-compare-result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
finally:
    proc.terminate()
    proc.wait(timeout=10)
