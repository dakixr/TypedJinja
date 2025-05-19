# TypedJinja

## Project Vision

TypedJinja brings type safety and editor intelligence to Jinja2 templates by allowing developers to annotate available variables and their types (including custom Python types) directly in template files. The tool parses these annotations and generates Python type stubs (`.pyi` files) for each template, enabling Language Server Protocol (LSP) support for completions, hover, and type checking in editors.

### Key Principles

- **Type Annotations in Templates:**
  - Use a special comment block (e.g., `{# @types ... #}`) at the top of Jinja2 templates to declare available variables and their types.
  - Support both built-in and custom Python types, imported from user-defined `.py` files.

- **Stub Generation:**
  - Parse type annotations and generate `.pyi` stubs for each template.
  - Stubs are placed in a `__pycache__` directory next to the template to avoid polluting the main source tree.
  - No runtime Python modules are generated; this is a static analysis and developer tooling solution only.

- **LSP/Editor Integration:**
  - `.pyi` stubs enable completions, hover, and type checking for template variables in supported editors (VS Code, PyCharm, etc.).
  - LSP implementation may be in TypeScript for best editor compatibility.
  - Users may need to configure their editor or type checker to include `__pycache__` in the search path for stubs.

- **Extensibility:**
  - Designed for easy extension to new types, frameworks, and editor features.

- **Performance:**
  - Uses caching and incremental parsing to keep editor feedback fast.

### Usage

1. **Define Types in Python:**
   ```python
   # mytypes.py
   from typing import TypedDict
   class User(TypedDict):
       name: str
       age: int
   ```

2. **Annotate Template Context:**
   ```jinja
   {# @types
   from mytypes import User
   user: User
   #}
   Hello, {{ user.name }}!
   ```

3. **Generate Stubs:**
   Run the CLI:
   ```sh
   python -m typedjinja path/to/template.jinja
   ```
   This creates `__pycache__/template.pyi` next to your template.

4. **Editor Integration:**
   - Configure your editor or type checker (e.g., mypy, Pyright) to recognize stubs in `__pycache__`.
   - Enjoy completions and type checking for template variables!

### Development Guidelines

- Write clear, well-documented code and tests.
- Prefer Python for core parsing and stub generation; TypeScript for LSP/editor integration.
- Keep the codebase modular: separate parsing, stub generation, and LSP logic.
- Document all annotation syntax and usage in the README.
- Prioritize developer experience: fast feedback, clear errors, and easy onboarding.

## Features

- **Type Annotations in Templates:**
  - Declare available variables and their types (including custom Python types) at the top of your Jinja2 templates using a special comment block.
- **Stub Generation:**
  - Generate Python `.pyi` stubs for each template for static analysis and editor intelligence.
- **LSP Integration:**
  - Get completions, hover, and type checking for template variables in supported editors (VS Code, PyCharm, etc.).
- **Extensible & Fast:**
  - Designed for easy extension and fast feedback in the editor.

## Example

```jinja
{# @types
   from mytypes import User, Item
   user: User
   items: list[Item]
   show_details: bool
#}

<h1>Hello, {{ user.name }}!</h1>
<ul>
  {% for item in items %}
    <li>{{ item.title }}</li>
  {% endfor %}
</ul>
```

## Roadmap

1. **Annotation Syntax & Parser**
2. **Stub Generation**
3. **LSP Plugin for Editor Support**
4. **Documentation & Examples**

## Contributing

Contributions are welcome! Please see `CURSOR_RULES.md` for development guidelines and open an issue or pull request to get started. 