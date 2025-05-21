#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

import jedi

from typedjinja.parser import parse_macro_blocks, parse_types_block


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
    p.add_argument(
        "mode",
        choices=[
            "complete",
            "signature",
            "hover",
            "diagnostics",
            "find_macro_definition",
            "definition",
        ],
    )
    p.add_argument("path_or_stub")
    p.add_argument("expr_or_macro_name", nargs="?")
    p.add_argument("line", type=int, nargs="?", default=0)
    p.add_argument("column", type=int, nargs="?", default=0)
    p.add_argument("template_file_path", nargs="?")
    args = p.parse_args()

    if args.mode == "find_macro_definition":
        template_to_scan = args.path_or_stub
        macro_to_find = args.expr_or_macro_name
        definition_location = {}
        try:
            content = Path(template_to_scan).read_text(encoding="utf-8")
            macros = parse_macro_blocks(content)
            for macro in macros:
                if macro.get("name") == macro_to_find:
                    macro_def_pattern = re.compile(
                        r"\{\%\s*macro\s+" + re.escape(macro_to_find) + r"\s*\(",
                        re.MULTILINE,
                    )
                    match = macro_def_pattern.search(content)
                    if match:
                        start_offset = match.start()
                        line = content[:start_offset].count("\n")
                        col = start_offset - (content.rfind("\n", 0, start_offset) + 1)
                        definition_location = {
                            "file_path": template_to_scan,
                            "line": line,
                            "col": col,
                        }
                        break
        except Exception as e:
            pass
        print(json.dumps(definition_location))
        return

    if args.mode == "definition":
        # Use Jedi to find definitions of a name in the stub context
        stub_path = Path(args.path_or_stub)
        stub = stub_path.read_text(encoding="utf-8")
        name = args.expr_or_macro_name
        # Build code for Jedi: imports + stub vars + assignment
        imports_from_stub = [
            l for l in stub.splitlines() if l.startswith(("import ", "from "))
        ]
        vars_from_stub = [
            l.split("#")[0].strip()
            for l in stub.splitlines()
            if ":" in l and not l.startswith(("import", "from"))
        ]
        code_for_jedi = "\n".join(
            imports_from_stub + vars_from_stub + [f"__typedjinja_target__ = {name}"]
        )
        code_lines = code_for_jedi.split("\n")
        line_num = len(code_lines)
        col_num = len(code_lines[-1])
        script = jedi.Script(code_for_jedi, path=str(stub_path))
        definitions: list[dict[str, int | str]] = []
        stub_resolved = stub_path.resolve()
        try:
            defs = script.goto(line_num, col_num)
            for d in defs:
                if not d.module_path:
                    continue
                module_path = Path(d.module_path).resolve()
                # Skip definitions in the stub file itself
                if module_path == stub_resolved:
                    continue
                start_line = d.line - 1 if d.line else 0
                start_col = d.column
                end_col = start_col + len(d.name or "")
                definitions.append(
                    {
                        "file_path": str(d.module_path),
                        "line": start_line,
                        "col": start_col,
                        "end_line": start_line,
                        "end_col": end_col,
                    }
                )
        except Exception:
            pass
        # Return only Jedi-based definitions (no stub fallbacks)
        print(json.dumps(definitions))
        return

    stub_path = Path(args.path_or_stub)
    stub = stub_path.read_text()

    if args.mode == "hover":
        info = parse_stub(stub).get(args.expr_or_macro_name, {})
        if not info or not info.get("type"):
            derived_template_path = stub_path.parent.parent / f"{stub_path.stem}.jinja"
            template_for_macros = (
                Path(args.template_file_path)
                if args.template_file_path and Path(args.template_file_path).exists()
                else derived_template_path
            )

            try:
                template_content = template_for_macros.read_text(encoding="utf-8")
            except Exception:
                template_content = ""
            macros = parse_macro_blocks(template_content)
            for macro in macros:
                if macro.get("name") == args.expr_or_macro_name:
                    params = macro.get("params") or ""
                    doc = macro.get("docstring") or ""
                    info = {"type": f"{args.expr_or_macro_name}({params})", "doc": doc}
                    break
        print(json.dumps(info))
        return

    if args.mode == "diagnostics":
        template_to_diagnose = Path(args.template_file_path or args.path_or_stub)
        content = template_to_diagnose.read_text(encoding="utf-8")
        imports, annotations, malformed = parse_types_block(content)
        diagnostics = []
        pattern = re.compile(
            r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)"
        )
        for m in pattern.finditer(content):
            var, attr = m.group(1), m.group(2)
            if var not in annotations:
                continue
            var_type = annotations[var].split("#", 1)[0].strip()
            ns: dict[str, object] = {}
            for imp in imports:
                try:
                    exec(imp, ns)
                except Exception:
                    pass
            try:
                typ_obj = eval(var_type, ns)
            except Exception:
                continue
            if not hasattr(typ_obj, attr):
                start_offset = m.start(0)
                end_offset = m.end(0)
                if end_offset < len(content) and content[end_offset] == "(":
                    close = content.find(")", end_offset)
                    if close != -1:
                        end_offset = close + 1
                start_line = content[:start_offset].count("\n")
                start_col = start_offset - (content.rfind("\n", 0, start_offset) + 1)
                end_line = content[:end_offset].count("\n")
                end_col = end_offset - (content.rfind("\n", 0, end_offset) + 1)
                diagnostics.append(
                    {
                        "message": f"Type '{var_type}' has no attribute '{attr}'",
                        "line": start_line,
                        "col": start_col,
                        "end_line": end_line,
                        "end_col": end_col,
                    }
                )
        print(json.dumps(diagnostics))
        return

    expr_text = args.expr_or_macro_name

    imports_from_stub = [
        l for l in stub.splitlines() if l.startswith(("import ", "from "))
    ]
    vars_from_stub = [
        l.split("#")[0].strip()
        for l in stub.splitlines()
        if ":" in l and not l.startswith(("import", "from"))
    ]

    code_for_jedi = "\n".join(
        imports_from_stub
        + vars_from_stub
        + [
            f"__typedjinja_target__ = {expr_text}{'.' if args.mode=='complete' else '('}"
        ]
    )
    code_lines = code_for_jedi.split("\n")
    line_num = len(code_lines)
    col_num = len(code_lines[-1])
    script = jedi.Script(code_for_jedi, path=str(stub_path))

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
