"""Comprueba que el entorno tiene todo lo necesario para el proyecto.

Uso:  python scripts/check_env.py
"""

import shutil
import subprocess
import sys

ok = True


def report(name: str, passed: bool, detail: str = "") -> None:
    global ok
    ok &= passed
    mark = "OK " if passed else "FALTA"
    print(f"[{mark}] {name}{' — ' + detail if detail else ''}")


report("Python >= 3.10", sys.version_info >= (3, 10), sys.version.split()[0])

for module in ("pandas", "pytest"):
    try:
        mod = __import__(module)
        report(module, True, getattr(mod, "__version__", ""))
    except ImportError:
        report(module, False, "ejecuta: pip install -r requirements.txt")

for tool in ("ffmpeg", "node", "npm"):
    path = shutil.which(tool)
    version = ""
    if path:
        flag = "-version" if tool == "ffmpeg" else "--version"
        out = subprocess.run([tool, flag], capture_output=True, text=True).stdout
        version = out.splitlines()[0] if out else ""
    report(tool, path is not None, version)

sys.exit(0 if ok else 1)
