"""Run a reviewed rectangular TrueGrid oracle without a graphical file picker.

Development only: HexRefine's production kernel must not call this utility.
Each invocation requires a fresh case directory containing the .tg input.
The conservative command whitelist intentionally excludes arbitrary includes,
system commands, and generators not yet reviewed by this workflow.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import time

ALLOWED = {"xoff", "yoff", "zoff", "block", "bb", "mb", "pb", "endpart", "trbb",
           "merge", "stp", "mof", "lsdyna", "write", "exit", "lct", "lrep"}


def validate_deck(deck: Path):
    """Validate paths and the tested command subset before launching software."""
    deck = deck.resolve(strict=True)
    if not deck.is_file() or deck.suffix.lower() != ".tg":
        raise ValueError("Expected an existing .tg file")
    if not str(deck).isascii() or any(c.isspace() for c in str(deck)):
        raise ValueError("This legacy oracle requires ASCII paths without whitespace")
    text = deck.read_bytes().decode("utf-8", errors="replace")
    commands = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line == "c" or line.startswith("c "):
            continue
        command = line.split()[0].lower().rstrip(";")
        if command not in ALLOWED:
            raise ValueError(f"Unreviewed command: {command}")
        commands.append(line)
    outputs = [line for line in commands if re.match(r"^mof\s", line, re.I)]
    if len(outputs) != 1:
        raise ValueError("Exactly one mof output is required")
    match = re.fullmatch(r"mof\s+([^;\s]+);?", outputs[0], re.I)
    if not match:
        raise ValueError("mof must contain one absolute path and no other commands")
    output = Path(match[1])
    if not output.is_absolute():
        raise ValueError("Relative mof paths are not allowed")
    output = output.resolve()
    if output.parent != deck.parent or output.suffix.lower() != ".k":
        raise ValueError("mof must write a .k in the input case directory")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    if not any(re.fullmatch(r"lsdyna\s+keyword;?", line, re.I) for line in commands):
        raise ValueError("Expected lsdyna keyword output")
    if [line.lower().rstrip(";") for line in commands[-2:]] != ["write", "exit"]:
        raise ValueError("Deck must end with write and exit")
    for name in ("truegrid.log", "truegrid-run.json", "truegrid-session.tg", "tghist", "tsave", "tsave#"):
        if (deck.parent / name).exists():
            raise FileExistsError("Use a fresh case directory; prior oracle artifacts exist")
    return deck, output


def run(deck: Path, executable: Path, timeout: float = 120):
    if os.name != "nt":
        raise RuntimeError("This launcher is verified only on Windows TrueGrid 3.1.3")
    if not 0 < timeout < float("inf"):
        raise ValueError("timeout must be finite and positive")
    deck, output = validate_deck(deck)
    executable = executable.resolve(strict=True)
    session = deck.parent / "truegrid-session.tg"
    command = [str(executable), "i=" + deck.as_posix(), "g=nogui", "s=" + session.as_posix()]
    record = {"command": command, "cwd": str(deck.parent), "output": str(output),
              "input_sha256": hashlib.sha256(deck.read_bytes()).hexdigest(),
              "executable_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
              "mesh_validated": False}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    start = time.monotonic()
    with (deck.parent / "truegrid.log").open("xb") as log:
        process = subprocess.Popen(command, cwd=deck.parent, stdin=subprocess.DEVNULL,
            stdout=log, stderr=subprocess.STDOUT, startupinfo=startup,
            creationflags=subprocess.CREATE_NEW_CONSOLE)
        record["pid"] = process.pid
        try:
            record["exit_code"] = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            record["timed_out"] = True
            process.terminate()
            process.wait(timeout=10)
    record["seconds"] = time.monotonic() - start
    log_text = (deck.parent / "truegrid.log").read_text(errors="replace")
    record["diagnostics"] = [line.strip() for line in log_text.splitlines()
        if re.search(r"warning|error|illegal|requires|cannot|not found", line, re.I)]
    record["output_exists"] = output.is_file()
    has_mesh = False
    if output.is_file():
        data = output.read_bytes()
        record["output_sha256"] = hashlib.sha256(data).hexdigest()
        record["output_bytes"] = len(data)
        cards = {line.strip().upper() for line in data.splitlines() if line.startswith(b"*")}
        has_mesh = {b"*NODE", b"*ELEMENT_SOLID", b"*END"} <= cards
    record["execution_ok"] = record.get("exit_code") == 0 and has_mesh and not record["diagnostics"]
    # A successful process can still emit hanging faces; never mark it mesh-valid here.
    (deck.parent / "truegrid-run.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument("--executable", type=Path, default=Path(r"C:\TrueGrid\tg.exe"))
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    result = run(args.deck, args.executable, args.timeout)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["execution_ok"] else 1)
