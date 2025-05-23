# TypedJinja VSCode Extension

A lightweight Python type system for Jinja2 templates with LSP features.

## Prerequisites
- The Python package `typedjinja` must be installed in your Python environment:
  ```sh
  pip install typedjinja
  ```

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
Open any `.jinja` or `.html` file to activate the extension.

## Development Workflow

To set up and work on the extension locally:

1. Clone the repository and navigate to the extension folder:
   ```sh
   git clone https://github.com/dakixr/TypedJinja.git
   cd TypedJinja/typedjinja-vscode
   ```
2. Install Node.js dependencies:
   ```sh
   pnpm install
   ```
3. Compile or watch the TypeScript source:
   - For a one-time compile:
     ```sh
     pnpm run compile
     ```
   - For continuous compilation (recommended):
     ```sh
     pnpm run watch
     ```
4. Open the folder in VSCode and start the Extension Development Host (press `F5`).
5. After development, build and package the VSIX:
   ```sh
   pnpm run vscode:prepublish
   pnpm dlx vsce package
   ```

## Contributing
Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/dakixr/TypedJinja).

## License
MIT 