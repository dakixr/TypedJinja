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

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const LOG_CHANNEL = 'typedjinja/log';
function logToClient(msg: string) {
  connection.sendNotification(LOG_CHANNEL, msg);
  connection.console.log(msg);
  console.log('[TypedJinja LSP]', msg);
}

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
      logToClient('No Tree-sitter context for completions');
      return [];
    }

    const { expr, partial, inFnArgs } = ctx;
    logToClient(`Expr='${expr}' partial='${partial}' inFnArgs=${inFnArgs}`);
    const pythonExec = process.env.PYTHON_PATH || 'python3';
    const mode = inFnArgs ? 'signature' : 'complete';
    const args = inFnArgs
      ? ['-m', 'typedjinja.lsp_server', mode, stubPath, expr, String(pos.line + 1), String(pos.character)]
      : ['-m', 'typedjinja.lsp_server', mode, stubPath, expr, String(pos.line + 1), String(pos.character)];
    const result = spawnSync(pythonExec, args, { encoding: 'utf8' });

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

    return items
      .filter(item => !partial || item.name.startsWith(partial))
      .map(item => ({
        label: item.name,
        kind: inFnArgs ? CompletionItemKind.Variable : CompletionItemKind.Field,
        detail: item.type ?? undefined,
        documentation: item.docstring
          ? { kind: MarkupKind.Markdown, value: item.docstring }
          : undefined,
      }));
  }
);

// Hover via Python CLI
connection.onHover(
  async (_params, _token): Promise<Hover | null> => {
    logToClient('Hover request received');
    const doc = documents.get(_params.textDocument.uri);
    if (!doc) {
      logToClient('No document found for hover request');
      return null;
    }
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

    const word = getWordAt(doc, _params.position);
    if (!word) {
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

documents.listen(connection);
connection.listen();
