import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { exec } from 'child_process';

let client: LanguageClient;
export const outputChannel = vscode.window.createOutputChannel('TypedJinja');

// Get the Python interpreter path using the Python extension API
async function getPythonInterpreterPath(): Promise<string | null> {
  const pythonExtension = vscode.extensions.getExtension('ms-python.python');
  if (!pythonExtension) {
    vscode.window.showErrorMessage(
      'Python extension is not installed. Install the Python VSCode extension to run this command.'
    );
    outputChannel.appendLine('[Stub Generation Error] Python extension is not installed.');
    return null;
  }
  await pythonExtension.activate();
  // @ts-ignore
  const pythonPath: string | undefined = pythonExtension.exports.settings.getExecutionDetails().execCommand[0];
  if (!pythonPath) {
    vscode.window.showErrorMessage('Could not detect Python interpreter.');
    outputChannel.appendLine('[Stub Generation Error] Could not detect Python interpreter.');
    return null;
  }
  return pythonPath;
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating TypedJinja extension...');
  // Path to the server module (now inside the extension)
  const serverModule = context.asAbsolutePath(
    path.join('lib', 'server.js')
  );

  // Server options
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio }
  };

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'jinja' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.jinja')
    },
    outputChannel
  };

  // Create and start the language client
  client = new LanguageClient(
    'typedjinjaLsp',
    'TypedJinja LSP',
    serverOptions,
    clientOptions
  );

  client.start();
  outputChannel.appendLine('TypedJinja LSP client started.');

  // Listen for log notifications from the server
  client.onNotification('typedjinja/log', (message: string) => {
    outputChannel.appendLine('[LSP] ' + message);
  });

  // Automatic stub generation on save
  vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (document.languageId === 'jinja' && document.uri.scheme === 'file') {
      const jinjaPath = document.uri.fsPath;
      const pythonPath = await getPythonInterpreterPath();
      if (!pythonPath) {
        return;
      }
      outputChannel.appendLine(`Generating stub for: ${jinjaPath} using ${pythonPath}`);
      exec(`"${pythonPath}" -m typedjinja "${jinjaPath}"`, (err, stdout, stderr) => {
        if (err) {
          outputChannel.appendLine(`[Stub Generation Error] ${stderr || err.message}`);
        } else {
          outputChannel.appendLine(`[Stub Generated] ${stdout || 'Success.'}`);
          // Notify the LSP server to revalidate diagnostics
          if (client) {
            client.sendNotification('typedjinja/revalidate', document.uri.toString());
          }
        }
      });
    }
  });
}

export function deactivate(): Thenable<void> | undefined {
  outputChannel.appendLine('Deactivating TypedJinja extension...');
  if (!client) {
    return undefined;
  }
  return client.stop();
} 