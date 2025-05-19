import re
from typing import Dict


def extract_type_annotations(template_content: str) -> Dict[str, str]:
    """
    Extract variable type annotations from a Jinja2 template.

    Looks for a block like:
    {# @types
       user: User
       items: List[Item]
    #}

    Returns a dict mapping variable names to type strings.
    """
    pattern = re.compile(r"\{#\s*@types(.*?)#\}", re.DOTALL)
    match = pattern.search(template_content)
    if not match:
        return {}
    block = match.group(1)
    annotations = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        var, type_ = line.split(":", 1)
        annotations[var.strip()] = type_.strip()
    return annotations
