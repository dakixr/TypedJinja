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
  Diagnostic,
  DiagnosticSeverity,
  Location,
  Position,
  Range
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';

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

// Parse .pyi lines like: var: type  # doc
function parseStub(stubContent: string) {
  const result: Record<string, { type: string, doc?: string }> = {};
  for (const line of stubContent.split('\n')) {
    // Match: var: type  # docstring
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^\#]+?)(?:\s*#\s*(.*))?$/);
    if (match) {
      result[match[1]] = {
        type: match[2].trim(),
        doc: match[3]?.trim()
      };
    }
  }
  return result;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  logToClient('TypedJinja LSP server initialized');
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false
      },
      hoverProvider: true,
      definitionProvider: true,
      // diagnostics will be sent via connection.sendDiagnostics
    }
  };
});

// Provide completions from the .pyi stub (with type and docstring)
connection.onCompletion(
  async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    logToClient('Completion request received');
    const doc = documents.get(textDocumentPosition.textDocument.uri);
    if (!doc) {
      logToClient('No document found for completion request');
      return [];
    }

    // Find the corresponding .pyi stub
    const templatePath = url.fileURLToPath(doc.uri);
    const stubPath = templatePath.replace(/\.jinja$/, '.pyi');
    logToClient(`Template path: ${templatePath}`);
    logToClient(`Stub path: ${stubPath}`);
    if (!fs.existsSync(stubPath)) {
      logToClient('No .pyi stub found for template');
      return [];
    }

    // Parse the .pyi stub for variable names, types, and docstrings
    const stubContent = fs.readFileSync(stubPath, 'utf8');
    const stubVars = parseStub(stubContent);
    const completions: CompletionItem[] = [];
    for (const [varName, info] of Object.entries(stubVars)) {
      completions.push({
        label: varName,
        kind: CompletionItemKind.Variable,
        detail: info.type,
        documentation: info.doc ? { kind: MarkupKind.Markdown, value: info.doc } : undefined
      });
    }
    logToClient(`Returning ${completions.length} completions`);
    return completions;
  }
);

// (Hover, diagnostics, and go-to-definition coming next)

documents.listen(connection);
connection.listen(); 