# TypedJinja VSCode Extension

LSP support for type-safe Jinja2 templates using TypedJinja.

## Features
- Syntax highlighting for `.jinja` files
- Go to Definition for macros and includes
- Hover for types and documentation

## Installation
- Download the latest `.vsix` from the releases or build it yourself:
  ```sh
  pnpm install
  pnpm run vscode:prepublish
  pnpm dlx vsce package
  ```
- In VSCode, open the Extensions view, click the three dots, and select 'Install from VSIX...'

## Usage
Open any `.jinja` file to activate the extension.

## Contributing
Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/dakixr/TypedJinja).

## License
MIT 