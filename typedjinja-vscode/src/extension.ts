import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as process from 'process';

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


export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Activating TypedJinja extension...');
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let templateRoot = '';
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    // Search for .typedjinja config anywhere in the workspace
    const configFiles = await vscode.workspace.findFiles('**/.typedjinja', '**/node_modules/**', 1);
    if (configFiles.length > 0) {
      const configPath = configFiles[0].fsPath;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const rel = config.templateRoot;
      // First try resolving relative to workspace root
      const byWorkspace = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
      if (fs.existsSync(byWorkspace)) {
        templateRoot = byWorkspace;
      } else {
        // Fallback to directory containing the config file
        templateRoot = path.dirname(configPath);
      }
    }
  }
  // Path to the server module (now inside the extension)
  const serverModule = context.asAbsolutePath(
    path.join('lib', 'server.js')
  );

  // Get Python interpreter path
  const pythonPath = await getPythonInterpreterPath();

  // Server options
  const serverOptions: ServerOptions = {
    run: {
      command: 'node',
      args: [serverModule, '--stdio'],
      options: {
        env: {
          ...process.env,
          TYPEDJINJA_TEMPLATES_ROOT: templateRoot,
          PYTHON_PATH: pythonPath,
        }
      }
    },
    debug: {
      command: 'node',
      args: [serverModule, '--stdio'],
      options: {
        env: {
          ...process.env,
          TYPEDJINJA_TEMPLATES_ROOT: templateRoot,
          PYTHON_PATH: pythonPath,
        }
      }
    }
  };

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'jinja' }],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.jinja'),
        vscode.workspace.createFileSystemWatcher('**/__pycache__/*.pyi'),
      ]
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
          // Diagnostics notification removed
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