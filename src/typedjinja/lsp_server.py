#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

import jedi


def parse_stub(stub: str) -> dict[str, dict[str, str | None]]:
    out = {}
    for line in stub.splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^#]+?)(?:\s*#\s*(.*))?$", line)
        if m:
            name, typ, doc = m.group(1), m.group(2).strip(), m.group(3)
            out[name] = {"type": typ, "doc": doc.strip() if doc else None}
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["complete", "signature", "hover"])
    p.add_argument("stub")
    p.add_argument("expr")
    p.add_argument("line", type=int, nargs="?", default=0)
    p.add_argument("column", type=int, nargs="?", default=0)
    args = p.parse_args()

    stub_path = Path(args.stub)
    stub = stub_path.read_text()

    if args.mode == "hover":
        info = parse_stub(stub).get(args.expr, {})
        print(json.dumps(info))
        return

    imports = [l for l in stub.splitlines() if l.startswith(("import ", "from "))]
    vars_ = [
        l.split("#")[0].strip()
        for l in stub.splitlines()
        if ":" in l and not l.startswith(("import", "from"))
    ]

    code = "\n".join(
        imports
        + vars_
        + [
            f"__typedjinja_target__ = {args.expr}{'.' if args.mode=='complete' else '('}"
        ]
    )
    # Compute cursor position at end of generated code
    code_lines = code.split("\n")
    line_num = len(code_lines)
    col_num = len(code_lines[-1])
    script = jedi.Script(code, path=str(stub_path))

    try:
        if args.mode == "signature":
            sigs = script.get_signatures(line_num, col_num)
            res = []
            if sigs:
                sig = sigs[0]
                for p in sig.params:
                    default = getattr(p, "get_default", lambda: None)()
                    ann = getattr(p, "annotation_string", lambda: "")()
                    res.append(
                        {
                            "name": p.name,
                            "kind": getattr(p, "kind", ""),
                            "default": default,
                            "annotation": ann,
                            "docstring": sig.docstring(),
                        }
                    )
            print(json.dumps(res))
        else:
            comps = script.complete(line_num, col_num)
            print(
                json.dumps(
                    [
                        {"name": c.name, "type": c.type, "docstring": c.docstring()}
                        for c in comps
                    ]
                )
            )
    except Exception:
        print("[]")


if __name__ == "__main__":
    main()
