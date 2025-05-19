import re


def parse_types_block(
    template_content: str,
) -> tuple[list[str], dict[str, str], list[str]]:
    """
    Extract import statements, variable type annotations, and optionally docstrings from a Jinja2 template.
    Returns (imports, annotations, malformed_lines).
    - imports: list of import statements
    - annotations: dict of variable name to type string (optionally with docstring as a tuple)
    - malformed_lines: list of lines that could not be parsed
    """
    pattern = re.compile(r"\{#\s*@types(.*?)#\}", re.DOTALL)
    match = pattern.search(template_content)
    if not match:
        return [], {}, []
    block = match.group(1)
    imports: list[str] = []
    annotations: dict[str, str] = {}
    malformed: list[str] = []
    docstring: str | None = None
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue  # Ignore comment lines
        if line.startswith("import ") or line.startswith("from "):
            imports.append(line)
            continue
        if line.startswith('"""') or line.startswith("'''"):
            # Start of a docstring for the next variable
            docstring = line.strip("\"' ")
            continue
        if ":" in line:
            var, type_ = line.split(":", 1)
            var = var.strip()
            type_ = type_.strip()
            # Do NOT strip inline comments from type_
            # If the type contains a colon, it's malformed
            if ":" in type_:
                malformed.append(line)
                continue
            if docstring:
                annotations[var] = f"{type_}  # {docstring}"
                docstring = None
            else:
                annotations[var] = type_
            continue
        malformed.append(line)
    return imports, annotations, malformed
