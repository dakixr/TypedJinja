import json
import os
import sys
import traceback

import jedi


def main():
    try:
        code = sys.stdin.read()
        line = int(sys.argv[1])
        column = int(sys.argv[2])
        script = jedi.Script(code, path="fake.py")
        if os.environ.get("TYPEDJINJA_SIGNATURE_HELP") == "1":
            # Signature help mode
            sigs = script.get_signatures(line, column)
            if sigs:
                sig = sigs[0]
                params = [
                    {
                        "name": p.name,
                        "kind": getattr(p, "kind", ""),
                        "default": getattr(p, "get_default", lambda: None)()
                        if hasattr(p, "get_default")
                        else None,
                        "annotation": getattr(p, "annotation_string", lambda: "")()
                        if hasattr(p, "annotation_string")
                        else "",
                        "docstring": sig.docstring(),
                    }
                    for p in sig.params
                ]
                print(json.dumps(params))
            else:
                print(json.dumps([]))
        else:
            completions = script.complete(line, column)
            print(
                json.dumps(
                    [
                        {"name": c.name, "type": c.type, "docstring": c.docstring()}
                        for c in completions
                    ]
                )
            )
    except Exception:
        print("JEDI_ERROR:" + traceback.format_exc(), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
