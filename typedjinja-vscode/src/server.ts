import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  InitializeResult,
  TextDocumentSyncKind
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

connection.onInitialize((params: InitializeParams): InitializeResult => {
  logToClient('TypedJinja LSP server initialized');
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false
      }
    }
  };
});

// Provide completions from the .pyi stub
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

    // Parse the .pyi stub for variable names
    const stubContent = fs.readFileSync(stubPath, 'utf8');
    const completions: CompletionItem[] = [];
    for (const line of stubContent.split('\n')) {
      const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (match) {
        completions.push({
          label: match[1],
          kind: CompletionItemKind.Variable,
          detail: 'Jinja context variable'
        });
      }
    }
    logToClient(`Returning ${completions.length} completions`);
    return completions;
  }
);

documents.listen(connection);
connection.listen(); 