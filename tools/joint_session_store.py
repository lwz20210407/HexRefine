"""Atomic local job records and an OS-held output-directory lease."""
import hashlib,json,os,time
from pathlib import Path


def sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
    return digest.hexdigest()


def write_record(path,data):
    temporary=path.with_suffix('.partial')
    with temporary.open('w',encoding='utf8') as stream:
        json.dump(data,stream,allow_nan=False);stream.flush();os.fsync(stream.fileno())
    for attempt in range(8):
        try:temporary.replace(path);return
        except PermissionError as exc:
            if getattr(exc,'winerror',None) not in (5,32,33) or attempt==7:raise
            time.sleep(min(.005*2**attempt,.05))


class OutputLease:
    def __init__(self,directory):
        self.stream=(directory/'.joint-host.lock').open('a+b')
        try:
            if self.stream.seek(0,2)==0:self.stream.write(b'0');self.stream.flush()
            self.stream.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.stream.close();raise RuntimeError('Joint output directory is already owned by another service')

    def close(self):
        if self.stream.closed:return
        try:
            self.stream.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(),msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(self.stream,fcntl.LOCK_UN)
        finally:self.stream.close()
