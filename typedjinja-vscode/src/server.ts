import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  InitializeResult,
  TextDocumentSyncKind,
  Hover,
  MarkupKind,
  FileChangeType,
  Definition,
  Range,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as url from 'url';
import { spawnSync } from 'child_process';
import * as process from 'process';
import Parser from 'tree-sitter';
import Jinja2 from 'tree-sitter-jinja';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Moved LOG_CHANNEL and logToClient function definition higher
const LOG_CHANNEL = 'typedjinja/log';
function logToClient(msg: string) {
  connection.sendNotification(LOG_CHANNEL, msg);
  connection.console.log(msg);
  console.log('[TypedJinja LSP]', msg);
}

// Read the configured template root from environment
const TEMPLATES_ROOT = process.env.TYPEDJINJA_TEMPLATES_ROOT || '';
logToClient(`[TypedJinja LSP] Templates root directory: ${TEMPLATES_ROOT}`);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Init Tree-sitter for Jinja2
const tsParser = new Parser();
// @ts-ignore: native binding has no TS types, cast to Language
tsParser.setLanguage(Jinja2);

// Extract base expr / partial via Tree-sitter
function getExprAndPartialAttr(
  doc: TextDocument,
  position: { line: number; character: number }
): { expr: string; partial: string; inFnArgs?: boolean } | null {
  const tree = tsParser.parse(doc.getText());
  const point = { row: position.line, column: position.character };
  const node = tree.rootNode.namedDescendantForPosition(point);
  if (!node) return null;
  logToClient(`[Tree-sitter] node at cursor: ${node.type} '${node.text}'`);
  // simple cases; extend with your grammar
  if (node.type === 'variable' || node.type === 'identifier') {
    return { expr: node.text, partial: '', inFnArgs: false };
  }
  // Fallback for attribute access inside a render_expression
  if (node.type === 'render_expression') {
    const lineText = doc.getText({
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: Number.MAX_SAFE_INTEGER }
    });
    const before = lineText.slice(0, position.character);
    const m = before.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
    if (m) {
      const [, obj, part] = m;
      logToClient(`[Fallback] attribute completion for obj='${obj}', partial='${part}'`);
      return { expr: obj, partial: part, inFnArgs: false };
    }
  }
  return null;
}

// Find full word under cursor via Tree-sitter
function getWordAt(
  doc: TextDocument,
  position: { line: number; character: number }
): string | null {
  const tree = tsParser.parse(doc.getText());
  const point = { row: position.line, column: position.character };
  const node = tree.rootNode.namedDescendantForPosition(point);
  if (node && (node.type === 'identifier' || node.type === 'variable')) {
    return node.text;
  }
  return null;
}

// Parse .pyi stub file to get top-level variable names, types, docs
function parseStubFile(pyiPath: string): Record<string, { type: string; doc?: string }> {
  const content = fs.readFileSync(pyiPath, 'utf8');
  const result: Record<string, { type: string; doc?: string }> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\#]+?)(?:\s*#\s*(.*))?$/);
    if (m) {
      result[m[1]] = { type: m[2].trim(), doc: m[3]?.trim() };
    }
  }
  return result;
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  logToClient('TypedJinja LSP server initialized');
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
});

// Completions via Python CLI
connection.onCompletion(
  async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    logToClient('Completion request received');
    const doc = documents.get(textDocumentPosition.textDocument.uri);
    if (!doc) {
      logToClient('No document found for completion request');
      return [];
    }
    const templatePath = url.fileURLToPath(doc.uri);
    const stubPath = (() => {
      const path = require('path'),
        dir = path.dirname(templatePath),
        base = path.basename(templatePath, '.jinja');
      return path.join(dir, '__pycache__', base + '.pyi');
    })();
    logToClient(`Template path: ${templatePath}`);
    logToClient(`Stub path: ${stubPath}`);
    if (!fs.existsSync(stubPath)) {
      logToClient('No .pyi stub found for template');
      return [];
    }

    const pos = textDocumentPosition.position;
    const ctx = getExprAndPartialAttr(doc, pos);
    if (!ctx) {
      logToClient('No Tree-sitter context for completions, falling back to top-level variables');
      // Fallback: parse stub for top-level variables
      const stubVars = parseStubFile(stubPath);
      return Object.entries(stubVars).map(([name, info]) => ({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: info.type,
        documentation: info.doc ? { kind: MarkupKind.Markdown, value: info.doc } : undefined,
      }));
    }

    const { expr, partial, inFnArgs } = ctx;
    logToClient(`Expr='${expr}' partial='${partial}' inFnArgs=${inFnArgs}`);
    const pythonExec = process.env.PYTHON_PATH || 'python3';
    const mode = inFnArgs ? 'signature' : 'complete';
    const args = inFnArgs
      ? ['-m', 'typedjinja.lsp_server', mode, stubPath, expr, String(pos.line + 1), String(pos.character)]
      : ['-m', 'typedjinja.lsp_server', mode, stubPath, expr, String(pos.line + 1), String(pos.character)];
    // Debug: log the CLI invocation
    logToClient(`[CLI] Invoking: ${pythonExec} ${mode} stub at expr: ${expr}`);
    logToClient(`[CLI] Args: ${args.join(' ')}`);
    const result = spawnSync(pythonExec, args, { encoding: 'utf8' });
    logToClient(`[CLI] stdout: ${result.stdout}`);
    logToClient(`[CLI] stderr: ${result.stderr}`);
    if (result.error) {
      logToClient(`[ERROR] ${result.error}`);
      return [];
    }
    if (result.stderr) {
      logToClient(`[ERROR] ${result.stderr}`);
    }

    let items: any[];
    try {
      items = JSON.parse(result.stdout);
    } catch (e) {
      logToClient(`[ERROR] Failed to parse completions: ${result.stdout}`);
      return [];
    }

    // Filter by partial prefix if present
    const filtered = partial
      ? items.filter(item => item.name.startsWith(partial))
      : items;
    // Sort: public members before private (leading underscore), then alphabetically
    const sorted = filtered.slice().sort((a, b) => {
      const aPrivate = a.name.startsWith('_');
      const bPrivate = b.name.startsWith('_');
      if (aPrivate !== bPrivate) return aPrivate ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(item => ({
      label: item.name,
      kind: inFnArgs ? CompletionItemKind.Variable : CompletionItemKind.Field,
      detail: item.type ?? undefined,
      documentation: item.docstring
        ? { kind: MarkupKind.Markdown, value: item.docstring }
        : undefined,
      sortText: `${item.name.startsWith('_') ? '1_' : '0_'}${item.name}`
    }));
  }
);

// Utility: Find all macro definitions in a document using Tree-sitter
function findMacroDefinitions(doc: TextDocument): Array<{ name: string; node: any }> {
  const tree = tsParser.parse(doc.getText());
  const macros: Array<{ name: string; node: any }> = [];
  function walk(node: any) {
    if (node.type === 'macro_statement') {
      // Recursively find the identifier child representing the macro name
      function findId(n: any): any {
        if (n.type === 'identifier') return n;
        for (const c of n.namedChildren || []) {
          const found = findId(c);
          if (found) return found;
        }
        return null;
      }
      const idNode = findId(node);
      if (idNode) {
        macros.push({ name: idNode.text, node });
      }
    }
    for (const child of node.namedChildren || []) {
      walk(child);
    }
  }
  walk(tree.rootNode);
  return macros;
}

// Utility: Find macro definition by name in a document
function findMacroDefinitionByName(doc: TextDocument, macroName: string): { node: any } | null {
  const defs = findMacroDefinitions(doc);
  return defs.find(def => def.name === macroName) || null;
}

// Helper to find import statements and called macros
function getDefinitionContext(
  doc: TextDocument,
  position: { line: number; character: number }
): { type: 'macro_call'; name: string; sourceTemplate?: string } | { type: 'include'; target: string } | null {
  const tree = tsParser.parse(doc.getText());
  const point = { row: position.line, column: position.character };
  let node = tree.rootNode.namedDescendantForPosition(point);

  if (!node) return null;

  logToClient(`[Definition] Node at cursor: ${node.type} '${node.text}'`);

  // Include statement jump-to-definition
  if (node.type === 'string_literal' && node.parent?.type === 'include_statement') {
    // literal text includes quotes
    const lit = node.text;
    const target = lit.startsWith('"') || lit.startsWith("'") ? lit.slice(1, -1) : lit;
    logToClient(`[Definition] Found include target: ${target}`);
    return { type: 'include', target };
  }

  // Handle imported macro identifiers in the import statement
  if (node.type === 'identifier') {
    const textAll = doc.getText();
    const importRegex2 = /\{\%\s*from\s*["']([^"']+)["']\s*import\s*([A-Za-z0-9_,\s]+)\s*\%\}/g;
    let m2;
    while ((m2 = importRegex2.exec(textAll)) !== null) {
      const sourceTemplate = m2[1];
      const names = m2[2];
      const importedNames = names.split(',').map(n => n.trim());
      if (importedNames.includes(node.text)) {
        logToClient(`[Definition] Imported macro in import statement: ${node.text} from ${sourceTemplate}`);
        return { type: 'macro_call', name: node.text, sourceTemplate };
      }
    }
  }

  // Check if cursor is on a function_call (potential macro call)
  if (node.type === 'identifier' && node.parent?.type === 'function_call') {
    const macroName = node.text;
    // Look for import statement
    const importRegex = /\{\%\s*from\s*["']([^"']+)["']\s*import\s*([A-Za-z0-9_,\s]+)\%\}/g;
    let match;
    const text = doc.getText();
    while ((match = importRegex.exec(text)) !== null) {
      const sourceTemplate = match[1];
      const importedNames = match[2].split(',').map(name => name.trim());
      if (importedNames.includes(macroName)) {
        logToClient(`[Definition] Found imported macro call: ${macroName} from ${sourceTemplate}`);
        return { type: 'macro_call', name: macroName, sourceTemplate };
      }
    }
    // If not found in imports, check for same-file macro definition
    const macroDef = findMacroDefinitionByName(doc, macroName);
    if (macroDef) {
      logToClient(`[Definition] Found same-file macro definition: ${macroName}`);
      return { type: 'macro_call', name: macroName };
    }
  }
  return null;
}

connection.onDefinition(
  async (params: TextDocumentPositionParams): Promise<Definition | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    logToClient(`[Definition] Request for ${params.textDocument.uri} at L${params.position.line}C${params.position.character}`);
    const context = getDefinitionContext(doc, params.position);

    // Handle include definitions
    if (context?.type === 'include') {
      const rel = context.target;
      if (!TEMPLATES_ROOT) {
        logToClient('[Definition] TEMPLATES_ROOT not set. Cannot resolve include.');
        return null;
      }
      const path = require('path');
      const abs = path.resolve(TEMPLATES_ROOT, rel);
      logToClient(`[Definition] Resolving include path: ${abs}`);
      try {
        fs.accessSync(abs);
      } catch (e) {
        logToClient(`[Definition] Include target not found: ${abs}`);
        return null;
      }
      const uri2 = url.pathToFileURL(abs).toString();
      // Jump to start of file
      return [{ uri: uri2, range: Range.create(0, 0, 0, 0) }];
    }

    if (context?.type === 'macro_call') {
      const macroName = context.name;
      // Imported macro: resolve in imported file
      if (context.sourceTemplate) {
        if (!TEMPLATES_ROOT) {
          logToClient('[Definition] TEMPLATES_ROOT not set. Cannot resolve imported macro.');
          return null;
        }
        const path = require('path');
        const absoluteSourcePath = path.resolve(TEMPLATES_ROOT, context.sourceTemplate);
        logToClient(`[Definition] Looking for macro '${macroName}' in '${absoluteSourcePath}'`);
        let fileText: string;
        try {
          fileText = fs.readFileSync(absoluteSourcePath, 'utf8');
        } catch (e) {
          logToClient(`[Definition ERROR] Failed to read source template: ${e}`);
          return null;
        }
        const tempDoc = TextDocument.create('file://' + absoluteSourcePath, 'jinja', 1, fileText);
        const macroDef = findMacroDefinitionByName(tempDoc, macroName);
        if (macroDef) {
          const node = macroDef.node;
          const start = node.startPosition;
          const end = node.endPosition;
          return [{
            uri: 'file://' + absoluteSourcePath,
            range: Range.create(start.row, start.column, end.row, end.column)
          }];
        }
        return null;
      } else {
        // Same-file macro
        const macroDef = findMacroDefinitionByName(doc, macroName);
        if (macroDef) {
          const node = macroDef.node;
          const start = node.startPosition;
          const end = node.endPosition;
          return [{
            uri: doc.uri,
            range: Range.create(start.row, start.column, end.row, end.column)
          }];
        }
      }
    }
    return null;
  }
);

// Enhanced hover for macros (same-file and imported)
connection.onHover(
  async (_params, _token): Promise<Hover | null> => {
    logToClient('Hover request received');
    const doc = documents.get(_params.textDocument.uri);
    if (!doc) {
      logToClient('No document found for hover request');
      return null;
    }
    const word = getWordAt(doc, _params.position);
    if (!word) {
      return null;
    }
    // Check if this is a macro (same-file)
    let macroDef = findMacroDefinitionByName(doc, word);
    let macroDoc = doc;
    // If not found, check if imported
    if (!macroDef) {
      // Look for import statement
      const importRegex = /\{\%\s*from\s*["']([^"']+)["']\s*import\s*([A-Za-z0-9_,\s]+)\%\}/g;
      let match;
      const text = doc.getText();
      while ((match = importRegex.exec(text)) !== null) {
        const sourceTemplate = match[1];
        const importedNames = match[2].split(',').map(name => name.trim());
        if (importedNames.includes(word)) {
          if (!TEMPLATES_ROOT) return null;
          const path = require('path');
          const absoluteSourcePath = path.resolve(TEMPLATES_ROOT, sourceTemplate);
          if (!fs.existsSync(absoluteSourcePath)) return null;
          const fileText = fs.readFileSync(absoluteSourcePath, 'utf8');
          macroDoc = TextDocument.create('file://' + absoluteSourcePath, 'jinja', 1, fileText);
          macroDef = findMacroDefinitionByName(macroDoc, word);
          break;
        }
      }
    }
    if (macroDef) {
      const node = macroDef.node;
      // First, try to extract @typedmacro documentation
      const fullText = macroDoc.getText();
      const tmRegex = /\{\#\s*@typedmacro([\s\S]*?)\#\}/g;
      let tmMatch;
      while ((tmMatch = tmRegex.exec(fullText))) {
        const block = tmMatch[1];
        if (block.includes(`${word}(`)) {
          const lines = block.trim().split(/\r?\n/).map(l => l.trim());
          const signatureLine = lines[0];  // e.g. one_macro(name: str)
          const docLines = lines.slice(1).map(l => l.trim());
          const signature = '```jinja2\n' + `{% macro ${signatureLine} %}` + '\n```';
          const docs = docLines.join('\n');
          const value = signature + (docs ? '\n\n' + docs : '');
          return { contents: { kind: MarkupKind.Markdown, value } };
        }
      }
      // Fallback: extract signature and docstring from AST
      let signature = `{% macro ${word}`;
      // Get arguments if present
      const argsNode = node.namedChildren.find((c: any) => c.type === 'parameters');
      if (argsNode) {
        signature += argsNode.text;
      }
      signature += ' %}';
      // Try to get docstring: first string_literal child
      const docNode = node.namedChildren.find((c: any) => c.type === 'string_literal');
      let docstring = docNode ? docNode.text : '';
      const contents = '```jinja2\n' + signature + '\n```' + (docstring ? '\n\n' + docstring : '');
      return { contents: { kind: MarkupKind.Markdown, value: contents } };
    }
    // Fallback: old hover logic
    const templatePath = url.fileURLToPath(doc.uri);
    const stubPath = (() => {
      const path = require('path'),
        dir = path.dirname(templatePath),
        base = path.basename(templatePath, '.jinja');
      return path.join(dir, '__pycache__', base + '.pyi');
    })();
    logToClient(`Hover stub at: ${stubPath}`);
    if (!fs.existsSync(stubPath)) {
      return null;
    }
    logToClient(`Hover word: ${word}`);
    const pythonExec = process.env.PYTHON_PATH || 'python3';
    const result = spawnSync(
      pythonExec,
      ['-m', 'typedjinja.lsp_server', 'hover', stubPath, word],
      { encoding: 'utf8' }
    );
    if (result.error || result.stderr) {
      logToClient(`[ERROR] ${result.error ?? result.stderr}`);
      return null;
    }
    let info: { type?: string; doc?: string } = {};
    try {
      info = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    if (!info.type) {
      return null;
    }
    const contents =
      '```python\n' + word + ': ' + info.type + '\n```' +
      (info.doc ? '\n\n' + info.doc : '');
    return {
      contents: { kind: MarkupKind.Markdown, value: contents },
    };
  }
);

// Helper to run diagnostics and send results
async function runDiagnostics(doc: TextDocument) {
  if (!doc) return;
  logToClient(`[Diagnostics] Triggered for: ${doc.uri}`);
  const templatePath = url.fileURLToPath(doc.uri);
  logToClient(`[Diagnostics] Template path: ${templatePath}`);
  const stubPath = (() => {
    const path = require('path'),
      dir = path.dirname(templatePath),
      base = path.basename(templatePath, '.jinja');
    return path.join(dir, '__pycache__', base + '.pyi');
  })();
  logToClient(`[Diagnostics] Stub path: ${stubPath}`);
  if (!fs.existsSync(stubPath)) {
    logToClient(`[Diagnostics] No stub found, clearing diagnostics.`);
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }
  const pythonExec = process.env.PYTHON_PATH || 'python3';
  logToClient(`[Diagnostics] Running: ${pythonExec} -m typedjinja.lsp_server diagnostics ...`);
  const result = spawnSync(
    pythonExec,
    ['-m', 'typedjinja.lsp_server', 'diagnostics', stubPath, '', '0', '0', templatePath],
    { encoding: 'utf8' }
  );
  if (result.error) {
    logToClient(`[Diagnostics ERROR] ${result.error}`);
    return;
  }
  logToClient(`[Diagnostics] Raw stdout: ${result.stdout}`);
  logToClient(`[Diagnostics] Raw stderr: ${result.stderr}`);
  let diagnostics = [];
  try {
    diagnostics = JSON.parse(result.stdout);
  } catch (e) {
    logToClient(`[Diagnostics Parse Error] ${result.stdout}`);
    diagnostics = [];
  }
  logToClient(`[Diagnostics] Final diagnostics: ${JSON.stringify(diagnostics)}`);
  connection.sendDiagnostics({
    uri: doc.uri,
    diagnostics: diagnostics.map((d: any) => ({
      message: d.message,
      range: {
        start: { line: d.line, character: d.col },
        end: { line: d.end_line, character: d.end_col },
      },
      severity: 1, // Error
      source: 'typedjinja',
    })),
  });
}

documents.onDidChangeContent(async (change: { document: TextDocument }) => {
  await runDiagnostics(change.document);
});

documents.onDidOpen(async (change: { document: TextDocument }) => {
  await runDiagnostics(change.document);
});

// After runDiagnostics, before documents.listen(connection):
connection.onDidChangeWatchedFiles((params) => {
  logToClient(`[LSP] Watched files changed: ${JSON.stringify(params.changes)}`);
  for (const change of params.changes) {
    // If a stub file was created or changed, re-run diagnostics on the corresponding template
    if ((change.type === FileChangeType.Created || change.type === FileChangeType.Changed) && change.uri.endsWith('.pyi')) {
      const stubFs = url.fileURLToPath(change.uri);
      const path = require('path');
      const cacheDir = path.dirname(stubFs);
      const templateFs = path.join(path.dirname(cacheDir), path.basename(stubFs, '.pyi') + '.jinja');
      const templateUri = url.pathToFileURL(templateFs).toString();
      const doc = documents.get(templateUri);
      if (doc) {
        logToClient(`[Diagnostics] Re-running diagnostics for: ${templateUri}`);
        runDiagnostics(doc);
      }
    }
  }
});

documents.listen(connection);
connection.listen();
