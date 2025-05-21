# TypedJinja

## Project Vision

TypedJinja brings type safety and editor intelligence to Jinja2 templates by allowing developers to annotate available variables and their types (including custom Python types) directly in template files. The tool parses these annotations and generates Python type stubs (`.pyi` files) for each template, enabling Language Server Protocol (LSP) support for completions, hover, and type checking in editors.

### Key Principles

- **Type Annotations in Templates:**
  - Use a special comment block (e.g., `{# @types ... #}`) at the top of Jinja2 templates to declare available variables and their types.
  - Support both built-in and custom Python types, imported from user-defined `.py` files.

- **Stub Generation:**
  - Parse type annotations and generate `.pyi` stubs for each template.
  - Stubs are placed in the same directory as the template file, with the same base name and a `.pyi` extension.
  - No runtime Python modules are generated; this is a static analysis and developer tooling solution only.

- **LSP/Editor Integration:**
  - `.pyi` stubs enable completions, hover, and type checking for template variables in supported editors (VS Code, PyCharm, etc.).
  - LSP implementation may be in TypeScript for best editor compatibility.
  - Editors and type checkers will automatically discover stubs placed next to the template files.

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
   This creates `path/to/template.pyi` in the same directory as your template.

4. **Editor Integration:**
   - Editors and type checkers (e.g., mypy, Pyright, PyCharm) will automatically use `.pyi` stubs placed next to your template files.
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
- **VSCode Extension & LSP Features:**
  - **Completions:** Context-aware completions for variables, attributes, and macro arguments powered by Python stub generation.
  - **Hover Information:** Hover over variables, macros, or includes to see full type signatures and documentation.
  - **Go to Definition:**
    - Jump to variable definitions in your Python types or stubs.
    - Jump to macro definitions (same-file or imported) using Tree-sitter parsing.
    - Jump to included templates via `{% include %}`.
  - **Diagnostics:** Real-time error squiggles for invalid attribute access or calls based on Python reflection.
  - **@types Block Navigation:** Hover and go-to-definition inside the `@types` block, resolving to real Python definitions via Jedi.

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
5. **Advanced LSP: Find References, Rename, Symbols**

## Contributing

Contributions are welcome! Please see `CURSOR_RULES.md` for development guidelines and open an issue or pull request to get started. 

## Packaging & Publishing

- **Build extension:**
  ```sh
  pnpm run compile
  ```
- **Package VSIX:**
  ```sh
  npx vsce package --no-dependencies
  ```
- **Publish to Marketplace:** Update `package.json` with proper `publisher`, `repository`, and `license`, then:
  ```sh
  vsce publish
  ```

## Usage

1. **Annotate Template Context:**
   ```jinja
   {# @types
   from datetime import datetime

   created_at: datetime
   data: dict[str, str]
   #}
   {% from "another_template.jinja" import one_macro %}
   ```

2. **Stub Generation (offline or on save):**
   ```sh
   python -m typedjinja path/to/template.jinja
   ```

3. **Install VSCode Extension:**
   - Download the `.vsix` package from the releases or build locally:
     ```sh
     cd typedjinja-vscode
     pnpm install
     pnpm run compile
     npx vsce package --no-dependencies
     ```
   - In VSCode: `Extensions: Install from VSIX...`, select the generated `typedjinja-vscode-0.0.1.vsix`.

4. **Editor Experience:**
   - Open your `.jinja` file.
   - Completions, hover, go-to-definition, and diagnostics will work out of the box for variables, macros, includes, and types. 