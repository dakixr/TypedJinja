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
    # Use regex to find the @types comment block (supports {# ... #}, {#- ... -#}, etc)
    pattern = re.compile(r"\{#[-+]?\s*@types(.*?)#[-+]?\}", re.DOTALL)
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


def parse_macro_blocks(template_content: str) -> list[dict[str, str | None]]:
    """
    Extract all macro annotation blocks from the template.
    Returns a list of dicts: {name, params, docstring}
    """
    # Use regex to find all @typedmacro comment blocks
    macro_pattern = re.compile(r"\{#[-+]?\s*@typedmacro(.*?)#[-+]?\}", re.DOTALL)
    blocks = macro_pattern.findall(template_content)
    macros = []
    for block in blocks:
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        if not lines:
            continue
        sig_line = lines[0]
        docstring = None
        if len(lines) > 1:
            docstring = " ".join(lines[1:])
        if "(" not in sig_line or not sig_line.endswith(")"):
            continue
        name, rest = sig_line.split("(", 1)
        name = name.strip()
        params = rest[:-1]
        macros.append({"name": name, "params": params, "docstring": docstring})
    return macros
