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

// Get the word under the cursor (full variable name)
function getWordAt(text: string, pos: number): string | null {
  // Find all variable-like words in the line
  const regex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (pos >= start && pos <= end) {
      return match[0];
    }
  }
  return null;
}

// Provide hover info from the .pyi stub (type and docstring)
connection.onHover(
  async (params, _token): Promise<Hover | null> => {
    logToClient('Hover request received');
    const doc = documents.get(params.textDocument.uri);
    if (!doc) {
      logToClient('No document found for hover request');
      return null;
    }

    // Find the corresponding .pyi stub
    const templatePath = url.fileURLToPath(doc.uri);
    const stubPath = templatePath.replace(/\.jinja$/, '.pyi');
    logToClient(`Hover: Template path: ${templatePath}`);
    logToClient(`Hover: Stub path: ${stubPath}`);
    if (!fs.existsSync(stubPath)) {
      logToClient('No .pyi stub found for template (hover)');
      return null;
    }

    // Parse the stub
    const stubContent = fs.readFileSync(stubPath, 'utf8');
    const stubVars = parseStub(stubContent);

    // Get the word under the cursor (improved)
    const pos = params.position;
    const line = doc.getText({
      start: { line: pos.line, character: 0 },
      end: { line: pos.line, character: Number.MAX_SAFE_INTEGER }
    });
    const word = getWordAt(line, pos.character);
    if (!word) {
      logToClient('No variable found under cursor for hover');
      return null;
    }
    const varName = word;
    logToClient(`Hover: Variable under cursor: ${varName}`);

    const info = stubVars[varName];
    if (!info) {
      logToClient(`Hover: No info found for variable: ${varName}`);
      return null;
    }

    // Show type and docstring in hover
    let contents = `\`\`\`python\n${varName}: ${info.type}\n\`\`\``;
    if (info.doc) {
      contents += `\n\n${info.doc}`;
    }
    logToClient(`Hover: Returning hover info for ${varName}`);
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: contents
      }
    };
  }
);

documents.onDidChangeContent(change => {
  validateJinjaDocument(change.document);
});

documents.onDidOpen(e => {
  validateJinjaDocument(e.document);
});

async function validateJinjaDocument(document: TextDocument) {
  const uri = document.uri;
  const diagnostics: Diagnostic[] = [];

  // Only check .jinja files
  if (!uri.endsWith('.jinja')) return;

  // Find the corresponding .pyi stub
  const templatePath = url.fileURLToPath(uri);
  const stubPath = templatePath.replace(/\.jinja$/, '.pyi');
  if (!fs.existsSync(stubPath)) return;

  // Parse the stub
  const stubContent = fs.readFileSync(stubPath, 'utf8');
  const stubVars = parseStub(stubContent);
  const declaredVars = new Set(Object.keys(stubVars));

  // Parse the template for variable usage (simple regex for {{ ... }} and {% ... %})
  const text = document.getText();
  const varUsage = new Set<string>();
  const varRegex = /\{[{%][^}]*?([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(text))) {
    varUsage.add(match[1]);
  }

  // Warn for variables used but not declared in the stub
  for (const used of varUsage) {
    if (!declaredVars.has(used)) {
      // Find all locations of the variable in the text
      let lineNum = 0;
      for (const line of text.split('\n')) {
        let idx = line.indexOf(used);
        while (idx !== -1) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: lineNum, character: idx },
              end: { line: lineNum, character: idx + used.length }
            },
            message: `Variable '${used}' is used in the template but not declared in the stub`,
            source: 'typedjinja'
          });
          idx = line.indexOf(used, idx + 1);
        }
        lineNum++;
      }
    }
  }

  connection.sendDiagnostics({ uri, diagnostics });
}

// Handle revalidation notification from the client
connection.onNotification('typedjinja/revalidate', (uri: string) => {
  const doc = documents.get(uri);
  if (doc) {
    logToClient(`Revalidating diagnostics for ${uri}`);
    validateJinjaDocument(doc);
  } else {
    logToClient(`Document not found for revalidation: ${uri}`);
  }
});

// (Go-to-definition coming next)

documents.listen(connection);
connection.listen(); 