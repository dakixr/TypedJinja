import argparse
from pathlib import Path

from typedjinja.schema import write_pyi_stub_from_template


def main():
    parser = argparse.ArgumentParser(
        description="Generate .pyi stub from a Jinja template with type annotations."
    )
    parser.add_argument(
        "template",
        type=Path,
        help="Path to the Jinja template file",
    )
    args = parser.parse_args()
    template_path = args.template
    pycache_dir = template_path.parent / "__pycache__"
    pycache_dir.mkdir(exist_ok=True)
    output_path = pycache_dir / (template_path.stem + ".pyi")
    try:
        write_pyi_stub_from_template(template_path, output_path)
        print(f"Stub written to {output_path}")
    except ValueError as e:
        print(f"Error: {e}")
        exit(1)


if __name__ == "__main__":
    main()
