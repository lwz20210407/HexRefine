"""Standard-library Python job bridge to the native TypeScript/Node mesh kernel.

No MATLAB/TrueGrid/Python mesh kernel. An exclusively created job directory owns
all intermediates; only a completed, verified child run is published as result/.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import threading


class NativeMeshJob:
    def __init__(self, repository, node, request, job_directory):
        self.repository = Path(repository).resolve(strict=True)
        self.node = Path(node).resolve(strict=True)
        script = self.repository / "scripts" / "generate-concentric-circle.mjs"
        if not script.is_file() or not (self.repository / "dist" / "index.js").is_file():
            raise ValueError("Build the native repository before starting a mesh job")
        if (not isinstance(request, dict) or type(request.get("schemaVersion")) is not int
                or request.get("schemaVersion") != 1 or set(request) != {"schemaVersion", "parameters"}):
            raise ValueError("Expected a version-1 native concentric request")
        encoded = json.dumps(request, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 65536:
            raise ValueError("Request exceeds64KiB")
        destination = Path(job_directory).absolute()
        self.directory = destination.parent.resolve(strict=True) / destination.name
        self.directory.mkdir(exist_ok=False)
        self._work = self.directory / "working"
        self._lock = threading.Lock()
        self._cancel_requested = False
        self._state = {"schemaVersion": 1, "status": "running", "stage": "starting", "progress": None,
                       "output": None, "error": None, "cleanupWarning": None}
        (self.directory / "request.json").write_bytes(encoded)
        self._persist()
        env = {**os.environ, "HEXREFINE_PROGRESS_JSONL": "1", "TEMP": str(self.directory), "TMP": str(self.directory)}
        try:
            self._process = subprocess.Popen(
                [str(self.node), str(script), str(self.directory / "request.json"), str(self._work)],
                cwd=self.directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except Exception as exc:
            self._state.update(status="failed", error=str(exc))
            self._persist()
            raise
        self._thread = threading.Thread(target=self._monitor, name="hexrefine-native-job", daemon=False)
        self._thread.start()

    def _persist(self):
        temporary = self.directory / "status.json.partial"
        temporary.write_text(json.dumps(self._state, ensure_ascii=True, indent=2), encoding="utf-8")
        temporary.replace(self.directory / "status.json")

    def snapshot(self):
        with self._lock:
            return copy.deepcopy(self._state)

    def wait(self, timeout=None):
        self._thread.join(timeout)
        return self.snapshot()

    def cancel(self):
        with self._lock:
            if self._state["status"] != "running":
                return False
            self._cancel_requested = True
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
            return True

    def _cleanup_work(self):
        # Only files from our own exclusive child destination may be removed.
        if not self._work.exists():
            return
        if self._work.is_symlink() or self._work.resolve().parent != self.directory:
            raise RuntimeError("Unsafe job staging path; left untouched")
        allowed = {"mesh.k.partial", "mesh.k", "motif.k", "report.json"}
        entries = list(self._work.iterdir())
        if any(p.name not in allowed or not p.is_file() or p.is_symlink() for p in entries):
            raise RuntimeError("Unexpected staging contents; left untouched")
        for entry in entries:
            entry.unlink()
        self._work.rmdir()

    def _monitor(self):
        terminal = None
        failure = None
        try:
            with (self.directory / "events.jsonl").open("x", encoding="utf-8") as events:
                for line in self._process.stdout:
                    if len(line) > 65536:
                        raise RuntimeError("Oversized native event")
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        raise RuntimeError("Invalid native JSON event")
                    if not isinstance(event, dict):
                        raise RuntimeError("Native event must be an object")
                    events.write(json.dumps(event, ensure_ascii=True) + "\n")
                    events.flush()
                    if event.get("type") == "progress" and event.get("schemaVersion") == 1:
                        with self._lock:
                            self._state.update(stage=event["stage"], progress=event)
                            self._persist()
                    elif "ok" in event:
                        terminal = event
                code = self._process.wait()
                if code or not terminal or terminal.get("ok") is not True:
                    failure = terminal.get("error", "Native process failed without a success result") if terminal else "Native process failed without a success result"
        except Exception as exc:
            failure = str(exc)
            self._process.terminate()
            self._process.wait()
        finally:
            self._process.stdout.close()
        with self._lock:
            if self._cancel_requested:
                self._state.update(status="cancelled", stage="cancelled", progress=None)
            elif failure:
                self._state.update(status="failed", stage="failed", error=failure, progress=None)
            else:
                try:
                    report = json.loads((self._work / "report.json").read_text(encoding="utf-8"))
                    if (not report["readback"]["allRecordsVerified"] or report["readback"]["sha256"] != terminal["sha256"]
                            or (self._work / "mesh.k").stat().st_size != report["readback"]["bytes"]):
                        raise RuntimeError("Incomplete native output certificate")
                    destination = self.directory / "result"
                    if destination.exists() or destination.is_symlink():
                        raise RuntimeError("Refusing to overwrite job result")
                    self._work.rename(destination)
                    self._state.update(status="succeeded", stage="complete", output=str(destination), result={**terminal, "output": str(destination)})
                except Exception as exc:
                    self._state.update(status="failed", stage="failed", error=str(exc), progress=None)
            if self._state["status"] != "succeeded":
                try:
                    self._cleanup_work()
                except Exception as exc:
                    self._state["cleanupWarning"] = str(exc)
            self._persist()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--job-directory", required=True)
    args = parser.parse_args()
    request_file = Path(args.request)
    if request_file.stat().st_size > 65536:
        raise ValueError("Request exceeds64KiB")
    request = json.loads(request_file.read_text(encoding="utf-8-sig"))
    job = NativeMeshJob(args.repository, args.node, request, args.job_directory)
    try:
        result = job.wait()
    except KeyboardInterrupt:
        job.cancel()
        result = job.wait()
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
