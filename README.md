# TypedJinja

**Type-safe Jinja2 templates with editor intelligence**

TypedJinja brings type safety and smart editor features to Jinja2 templates by allowing you to annotate available variables and their types directly in your templates. It parses these annotations, generates type stubs or schemas, and provides Language Server Protocol (LSP) support for completions, hover, and type checking in your favorite editors.

## Features

- **Type Annotations in Templates:**
  - Declare available variables and their types (including custom Python types) at the top of your Jinja2 templates using a special comment block.
- **Schema/Stub Generation:**
  - Generate JSON Schema, TypeScript declaration files, or Python stubs for each template.
- **LSP Integration:**
  - Get completions, hover, and type checking for template variables in supported editors (VS Code, etc.).
- **Extensible & Fast:**
  - Designed for easy extension and fast feedback in the editor.

## Example

```jinja
{# @types
   user: User
   items: List[Item]
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
2. **Schema/Stub Generation**
3. **LSP Plugin for Editor Support**
4. **Documentation & Examples**

## Contributing

Contributions are welcome! Please see `CURSOR_RULES.md` for development guidelines and open an issue or pull request to get started. 