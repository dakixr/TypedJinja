# TypedJinja

Python companion package for the VSCode extension that adds type safety and LSP features to Jinja2 templates by generating Python stub files (`.pyi`).

## Installation

```sh
pip install typedjinja
```

## Usage

### 1. Annotate Types

In your Jinja2 template, declare variables using an `@types` block:
```jinja
{# @types
from mytypes import User
user: User
#}
Hello, {{ user.name }}!
```
Generate a stub:
```sh
python -m typedjinja path/to/sample_template.html
```
This creates `sample_template.pyi` alongside your template.

### 2. Annotate Macros

Use an `@typedmacro` block to define macro signatures:
```jinja
{# @typedmacro
one_macro(name: str = "world")
This macro greets a user.
#}
{% macro one_macro(name = "world") %}
  Hello, {{ name }}!
{% endmacro %}
```
Stub output includes:
```python
def one_macro(name: str = "world"): ...
```

## Examples
Browse `samples/templates`:
- `sample_template.html` for `@types`
- `another_template.html` for `@typedmacro`

## License
MIT 