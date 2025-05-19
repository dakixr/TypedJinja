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
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as url from 'url';
import { spawnSync } from 'child_process';
import * as process from 'process';

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

// Parse class definitions and their attributes from a .pyi stub
function parseClasses(stubContent: string) {
  // Returns: { [className: string]: { [attr: string]: { type: string, doc?: string } } }
  const classes: Record<string, Record<string, { type: string, doc?: string }>> = {};
  const lines = stubContent.split('\n');
  let currentClass: string | null = null;
  let indent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (classMatch) {
      currentClass = classMatch[1];
      classes[currentClass] = {};
      indent = null;
      continue;
    }
    if (currentClass) {
      // Find the indentation of the first attribute
      if (indent === null) {
        const m = line.match(/^(\s+)/);
        if (m) indent = m[1].length;
        else if (line.trim() === '') continue;
        else { currentClass = null; continue; }
      }
      // Only parse lines with the same indent
      if (line.startsWith(' '.repeat(indent))) {
        const attrLine = line.slice(indent);
        const attrMatch = attrLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^\#]+?)(?:\s*#\s*(.*))?$/);
        if (attrMatch) {
          classes[currentClass][attrMatch[1]] = {
            type: attrMatch[2].trim(),
            doc: attrMatch[3]?.trim()
          };
        }
      } else if (line.trim() === '') {
        continue;
      } else {
        currentClass = null;
        indent = null;
      }
    }
  }
  return classes;
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

// Helper: Extract the base expression and partial attribute before the cursor
function getExprAndPartialAttr(line: string, cursor: number): { expr: string, partial: string, inFnArgs?: boolean } | null {
  const before = line.slice(0, cursor);
  // Case 1: member/attribute completion (dot)
  const match = before.match(/([a-zA-Z0-9_\.\)\(\[\]]*)\.([a-zA-Z0-9_]*)$/);
  if (match) {
    return { expr: match[1], partial: match[2] };
  }
  // Case 2: inside function arguments, e.g. foo.bar(|) or foo.bar(arg1, |
  // Find the last open paren before the cursor
  const openIdx = before.lastIndexOf('(');
  if (openIdx !== -1) {
    // Find the function expression before the paren
    const fnExprMatch = before.slice(0, openIdx).match(/([a-zA-Z0-9_\.\)\(\[\]]+)$/);
    if (fnExprMatch) {
      return { expr: fnExprMatch[1], partial: '', inFnArgs: true };
    }
  }
  // Case 3: just a variable/expression (no dot)
  const matchVar = before.match(/([a-zA-Z0-9_\)\(\[\]]+)$/);
  if (matchVar) {
    return { expr: matchVar[1], partial: '' };
  }
  return null;
}

// Helper: Run jedi and get completions for the target
function getJediCompletions(stubContent: string, expression: string, cursorLine: number, cursorCol: number): any[] {
  // Compose the code as before
  const lines = stubContent.split('\n');
  const importLines = lines.filter(l => l.trim().startsWith('import') || l.trim().startsWith('from '));
  const varLines = lines.filter(l => l.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/));
  const varDecls = varLines.map(l => l.split('#')[0].trim());
  // For member completions, append a dot and set the cursor after the dot
  const code = [
    ...importLines,
    ...varDecls,
    `__typedjinja_completion_target__ = ${expression}.`
  ].join('\n');
  const codeLines = code.split('\n');
  const lineCount = codeLines.length; // 1-based for Jedi
  const col = codeLines[lineCount - 1].length; // after the dot

  // Call the Python script as a module using -m
  const jediModule = 'typedjinja.jedi_complete';
  const pythonExec = process.env.TYPEDJINJA_PYTHON_PATH || 'python3';
  const result = spawnSync(pythonExec, ['-m', jediModule, String(lineCount), String(col)], { input: code, encoding: 'utf8' });

  if (result.error) {
    logToClient(`[ERROR] Jedi error: ${result.error}`);
    return [];
  }
  if (result.stderr) {
    logToClient(`[ERROR] Jedi stderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    logToClient(`[ERROR] Failed to parse Jedi output: ${result.stdout}`);
    return [];
  }
}

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
    const stubPath = (() => {
      const path = require('path');
      const dir = path.dirname(templatePath);
      const base = path.basename(templatePath, '.jinja');
      return path.join(dir, '__pycache__', base + '.pyi');
    })();
    logToClient(`Template path: ${templatePath}`);
    logToClient(`Stub path: ${stubPath}`);
    if (!fs.existsSync(stubPath)) {
      logToClient('No .pyi stub found for template');
      return [];
    }

    // Parse the .pyi stub for variable names, types, and docstrings
    const stubContent = fs.readFileSync(stubPath, 'utf8');
    logToClient('Stub content loaded');
    const stubVars = parseStub(stubContent);
    logToClient('Parsed stubVars: ' + JSON.stringify(stubVars));
    const stubClasses = parseClasses(stubContent);
    logToClient('Parsed stubClasses: ' + JSON.stringify(stubClasses));

    // Get the current line and character
    const pos = textDocumentPosition.position;
    const lineText = doc.getText({
      start: { line: pos.line, character: 0 },
      end: { line: pos.line, character: Number.MAX_SAFE_INTEGER }
    });
    const cursor = pos.character;
    logToClient(`Line text: '${lineText}'`);
    logToClient(`Cursor position: ${cursor}`);

    // Enhanced: Try to extract base expression and partial attribute
    const exprAndPartial = getExprAndPartialAttr(lineText, cursor);
    if (exprAndPartial) {
      const { expr, partial, inFnArgs } = exprAndPartial;
      logToClient(`Detected completion for expr: '${expr}', partial: '${partial}', inFnArgs: ${inFnArgs}`);
      // If in function args, ask Jedi for argument completions
      if (inFnArgs) {
        // Compose code for Jedi: put cursor inside the function call
        const lines = stubContent.split('\n');
        const importLines = lines.filter(l => l.trim().startsWith('import') || l.trim().startsWith('from '));
        const varLines = lines.filter(l => l.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/));
        const varDecls = varLines.map(l => l.split('#')[0].trim());
        // Place the cursor inside the function call
        const code = [
          ...importLines,
          ...varDecls,
          `__typedjinja_completion_target__ = ${expr}(`
        ].join('\n');
        const codeLines = code.split('\n');
        const lineCount = codeLines.length;
        const col = codeLines[lineCount - 1].length; // after the '('
        const jediModule = 'typedjinja.jedi_complete';
        const pythonExec = process.env.TYPEDJINJA_PYTHON_PATH || 'python3';
        const env = { ...process.env, TYPEDJINJA_SIGNATURE_HELP: '1' };
        const result = spawnSync(pythonExec, ['-m', jediModule, String(lineCount), String(col)], { input: code, encoding: 'utf8', env });
        if (result.error) {
          logToClient(`[ERROR] Jedi error: ${result.error}`);
          return [];
        }
        if (result.stderr) {
          logToClient(`[ERROR] Jedi stderr: ${result.stderr}`);
        }
        let params = [];
        try {
          params = JSON.parse(result.stdout);
        } catch (e) {
          logToClient(`[ERROR] Failed to parse Jedi output: ${result.stdout}`);
          return [];
        }
        // Show function parameters as completion items
        return params.map((param: any) => ({
          label: param.name + (param.annotation ? `: ${param.annotation}` : ''),
          kind: CompletionItemKind.Variable,
          detail: param.default ? `default=${param.default}` : undefined,
          documentation: param.docstring ? { kind: MarkupKind.Markdown, value: param.docstring } : undefined
        }));
      }
      // Default: member/attribute completion
      const completions = getJediCompletions(stubContent, expr, 0, 0); // line/col handled in helper
      logToClient(`Jedi completions: ${JSON.stringify(completions)}`);
      const filtered = partial
        ? completions.filter(item => item.name.startsWith(partial))
        : completions;
      return filtered.map(item => ({
        label: item.name,
        kind: CompletionItemKind.Field,
        documentation: item.docstring ? { kind: MarkupKind.Markdown, value: item.docstring } : undefined
      }));
    }

    // Default: top-level variable completions
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
    const stubPath = (() => {
      const path = require('path');
      const dir = path.dirname(templatePath);
      const base = path.basename(templatePath, '.jinja');
      return path.join(dir, '__pycache__', base + '.pyi');
    })();
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


documents.listen(connection);
connection.listen(); 