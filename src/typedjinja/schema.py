from pathlib import Path

from typedjinja.parser import parse_types_block


def generate_pyi_stub(imports: list[str], annotations: dict[str, str]) -> str:
    """
    Generate a .pyi stub string from import statements and type annotations.
    """
    lines = []
    if imports:
        lines.extend(imports)
        lines.append("")
    for var, type_ in annotations.items():
        lines.append(f"{var}: {type_}")
    return "\n".join(lines) + "\n"


def write_pyi_stub_from_template(
    template_path: str | Path, pyi_path: str | Path
) -> None:
    """
    Parse a Jinja template file, extract type annotations, and write a .pyi stub file.
    Raises ValueError if there are malformed lines in the types block.
    """
    template_path = Path(template_path)
    pyi_path = Path(pyi_path)
    content = template_path.read_text(encoding="utf-8")
    imports, annotations, malformed = parse_types_block(content)
    if malformed:
        raise ValueError(f"Malformed type annotation lines: {malformed}")
    stub = generate_pyi_stub(imports, annotations)
    pyi_path.write_text(stub, encoding="utf-8")
