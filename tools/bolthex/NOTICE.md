# Recovery provenance

This directory contains a user-authorized local reconstruction of the supplied
BoltHex 1.0.0 Python mesh-generation modules. The original product notice is
preserved in `version.py`: `(c) 2026 BoltHex`.

The modules were decompiled from Python 3.13 bytecode, corrected against that
bytecode, and compared with the original default executable output and a
224-case catalogue matrix. The packaged transformation is limited to relative
imports and Python AST formatting. See `RECOVERY_PROVENANCE.json`.

This is the recovered Python kernel, requiring NumPy. It is not the independent
TypeScript generator in `src/threaded-solid.ts`, and it is not a completed port
of the original Qt GUI. There is no dependency on the original executable,
embedded bytecode, TrueGrid or MATLAB at generation time.

The supplied license key and private authorization details are not included.
Do not remove original notices or infer unrestricted redistribution rights
from bytecode readability or availability of dependency source code.
