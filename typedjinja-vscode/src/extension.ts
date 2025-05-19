import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;
export const outputChannel = vscode.window.createOutputChannel('TypedJinja');

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
}

export function deactivate(): Thenable<void> | undefined {
  outputChannel.appendLine('Deactivating TypedJinja extension...');
  if (!client) {
    return undefined;
  }
  return client.stop();
} 