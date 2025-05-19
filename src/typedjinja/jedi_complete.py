import json
import sys
import traceback

import jedi


def main():
    try:
        code = sys.stdin.read()
        line = int(sys.argv[1])
        column = int(sys.argv[2])
        script = jedi.Script(code, path="fake.py")
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
