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

// Extract base expr/partial via Python LSP context
function getExprAndPartialAttr(
  doc: TextDocument,
  position: { line: number; character: number }
): { expr: string; partial: string; inFnArgs?: boolean } | null {
  const templatePath = url.fileURLToPath(doc.uri);
  const pythonExec = process.env.PYTHON_PATH || 'python3';
  const args = [
    '-m',
    'typedjinja.lsp_server',
    'context',
    templatePath,
    String(position.line + 1),
    String(position.character),
  ];
  logToClient(`[Context] Invoking: ${pythonExec} ${args.join(' ')}`);
  const result = spawnSync(pythonExec, args, { encoding: 'utf8' });
  if (result.error || result.stderr) {
    logToClient(`[Context ERROR] ${result.error ?? result.stderr}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    logToClient(`[Context Parse ERROR] ${result.stdout}`);
    return null;
  }
}

// Find full word under cursor via regex
function getWordAt(
  doc: TextDocument,
  position: { line: number; character: number }
): string | null {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line, character: Number.MAX_SAFE_INTEGER }
  });

  // Iterate from the character at the position outwards to find word boundaries
  let start = position.character;
  let end = position.character;

  // Check if cursor is on a word character to begin with
  if (start > 0 && !/[A-Za-z0-9_]/.test(lineText[start -1])){
    // if cursor is at the beginning of a word, test char at position.character
    if(!/[A-Za-z0-9_]/.test(lineText[start])){
        return null;
    }
  } else if (start > 0 && !/[A-Za-z0-9_]/.test(lineText[start])) {
    // If cursor is not on a word character (e.g. whitespace, symbol), check one char back
    // This helps when cursor is immediately after a word
    if (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1])) {
        start--; // Move to the last character of the potential word
        end = start;
    } else {
        return null; // Not on or immediately after a word character
    }
  }

  // Expand left
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1])) {
    start--;
  }

  // Expand right
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end])) {
    end++;
  }

  const word = lineText.slice(start, end);
  return word && word.length > 0 ? word : null;
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
      logToClient('No context for completions, falling back to top-level variables');
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

// Utility: Lookup a macro definition by name via Python LSP CLI
function findMacroDefinitionByName(doc: TextDocument, macroName: string): { node: any } | null {
  const templatePath = url.fileURLToPath(doc.uri);
  const pythonExec = process.env.PYTHON_PATH || 'python3';
  const result = spawnSync(
    pythonExec,
    ['-m', 'typedjinja.lsp_server', 'find_macro_definition', templatePath, macroName],
    { encoding: 'utf8' }
  );
  if (result.error || result.stderr) {
    logToClient(`[MacroDef ERROR] ${result.error ?? result.stderr}`);
    return null;
  }
  let def;
  try {
    def = JSON.parse(result.stdout);
  } catch (e) {
    logToClient(`[MacroDef Parse ERROR] ${result.stdout}`);
    return null;
  }
  if (!def.file_path) {
    return null;
  }
  const node = {
    startPosition: { row: def.line, column: def.col },
    endPosition: { row: def.line, column: def.col },
    filePath: def.file_path,
  };
  return { node };
}

// Helper: Determine context for definitions by regex matching include or macro calls
function getDefinitionContext(
  doc: TextDocument,
  position: { line: number; character: number }
): { type: 'macro_call'; name: string; sourceTemplate?: string } | { type: 'include'; target: string } | null {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line, character: Number.MAX_SAFE_INTEGER }
  });
  
  // Include statement detection - Updated logic
  const includeRegex = /\{\%\s*include\s*['"]([^'"]+)['"]\s*\%\}/g; // Match globally on the line
  let match;
  while ((match = includeRegex.exec(lineText)) !== null) {
    const includeKeywordPart = match[0].match(/\{\%\s*include\s*/)?.[0];
    const closingTagPart = match[0].match(/\s*\%\}/)?.[0];
    if (!includeKeywordPart || !closingTagPart) continue;

    // Find the start and end of the filename within the full match
    // The filename is in match[1]. We need its position within match[0].
    const fullMatch = match[0];
    const filename = match[1];
    const filenameStartIndexInFullMatch = fullMatch.indexOf(filename, includeKeywordPart.length);
    if (filenameStartIndexInFullMatch === -1) continue;

    const filenameStartCol = match.index + filenameStartIndexInFullMatch;
    const filenameEndCol = filenameStartCol + filename.length;

    // Check if the cursor position is within the filename
    if (position.character >= filenameStartCol && position.character <= filenameEndCol) {
      return { type: 'include', target: filename };
    }
  }

  // Macro call detection (original logic, ensure `before` is defined if used here)
  const before = lineText.slice(0, position.character); 
  const callMatch = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\($/);
  if (callMatch) {
    const name = callMatch[1];
    // Check for imported macros
    const textAll = doc.getText();
    const importRegex = /\{\%\s*from\s*['"]([^'"]+)['"]\s*import\s*([A-Za-z0-9_,\s]+)\s*\%\}/g;
    let m;
    while ((m = importRegex.exec(textAll)) !== null) {
      const sourceTemplate = m[1];
      const names = m[2].split(',').map(n => n.trim());
      if (names.includes(name)) {
        return { type: 'macro_call', name, sourceTemplate };
      }
    }
    // Same-file macro
    return { type: 'macro_call', name };
  }
  return null;
}

connection.onDefinition(
  async (params: TextDocumentPositionParams): Promise<Definition | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    logToClient(`[Definition] Request for ${params.textDocument.uri} at L${params.position.line}C${params.position.character}`);
    const wordAtCursor = getWordAt(doc, params.position); // Get word for broader checks
    logToClient(`[Definition Debug WordAtCursor] '${wordAtCursor}'`);

    // 1. Handle @types block definitions (Jedi-based)
    const fullDocText = doc.getText();
    const docLines = fullDocText.split(/\r?\n/);
    const typesBlockStartLine = docLines.findIndex(l => l.match(/\{\#\s*@types/));
    const typesBlockEndLine = typesBlockStartLine >= 0 ? docLines.findIndex((l,i) => i > typesBlockStartLine && l.match(/#\}/)) : -1;

    if (typesBlockStartLine >= 0 && typesBlockEndLine >= typesBlockStartLine && 
        params.position.line >= typesBlockStartLine && params.position.line <= typesBlockEndLine) {
      const lineText = docLines[params.position.line];
      // Use wordAtCursor if it's on the current line and matches, otherwise try to extract from line again.
      // This is to ensure we use the precise word from the @types block context.
      let currentWordInTypesBlock = wordAtCursor;
      if (!currentWordInTypesBlock || docLines[params.position.line].indexOf(currentWordInTypesBlock) === -1) {
        const idMatch = /[A-Za-z_][A-Za-z0-9_]*/g;
        let m;
        while ((m = idMatch.exec(lineText))) {
            const [extractedWord] = m;
            const col = m.index;
            if (params.position.character >= col && params.position.character <= col + extractedWord.length) {
                currentWordInTypesBlock = extractedWord;
                break;
            }
        }
      }
      
      if (currentWordInTypesBlock) {
        logToClient(`[Definition @types] Word: '${currentWordInTypesBlock}'`);
        const templatePath = url.fileURLToPath(doc.uri);
        const stubPath = (() => {
          const p = require('path');
          const dir = p.dirname(templatePath);
          const base = p.basename(templatePath, '.jinja');
          return p.join(dir, '__pycache__', base + '.pyi');
        })();
        if (fs.existsSync(stubPath)) {
          const pythonExec = process.env.PYTHON_PATH || 'python3';
          const result = spawnSync(
            pythonExec,
            ['-m', 'typedjinja.lsp_server', 'definition', stubPath, currentWordInTypesBlock],
            { encoding: 'utf8' }
          );
          if (result.error) {
            logToClient(`[Definition @types ERROR] ${result.error}`);
          } else if (result.stderr) {
            logToClient(`[Definition @types STDERR] ${result.stderr}`);
          } else {
            try {
              const defs: any[] = JSON.parse(result.stdout);
              logToClient(`[Definition @types Result] ${JSON.stringify(defs)}`);
              const locs = defs.map(d => ({
                uri: url.pathToFileURL(d.file_path).toString(),
                range: Range.create(d.line, d.col, d.end_line, d.end_col),
              }));
              if (locs.length > 0) return locs;
            } catch (e) {
              logToClient(`[Definition @types Parse ERROR] ${result.stdout}`);
            }
          }
        }
      }
    } // End @types block handling

    // 2. Handle include statements and macro calls/imports
    const context = getDefinitionContext(doc, params.position);
    logToClient(`[Definition Debug Context] ${JSON.stringify(context)}`);

    // Handle include definitions
    if (context?.type === 'include') {
      const rel = context.target;
      if (!TEMPLATES_ROOT) {
        logToClient('[Definition Include] TEMPLATES_ROOT not set. Cannot resolve include.');
        return null;
      }
      const path = require('path');
      const abs = path.resolve(TEMPLATES_ROOT, rel);
      logToClient(`[Definition Include] Resolving include path: ${abs}`);
      try {
        fs.accessSync(abs);
        const uri2 = url.pathToFileURL(abs).toString();
        return [{ uri: uri2, range: Range.create(0, 0, 0, 0) }];
      } catch (e) {
        logToClient(`[Definition Include] Target not found: ${abs}`);
        return null;
      }
    }

    // Handle macro definitions (from call sites via getDefinitionContext)
    if (context?.type === 'macro_call') {
      const macroName = context.name;
      const sourceTemplate = context.sourceTemplate;
      logToClient(`[Definition MacroCall] Name: '${macroName}', Source: '${sourceTemplate || 'current file'}'`);
      let targetDoc = doc;
      let targetUri = doc.uri;
      let targetTemplateFsPath = url.fileURLToPath(doc.uri);

      if (sourceTemplate) { // Imported macro
        if (!TEMPLATES_ROOT) {
          logToClient('[Definition MacroCallImport] TEMPLATES_ROOT not set.');
          return null;
        }
        const path = require('path');
        targetTemplateFsPath = path.resolve(TEMPLATES_ROOT, sourceTemplate);
        logToClient(`[Definition MacroCallImport] Absolute source path: ${targetTemplateFsPath}`);
        try {
          const fileText = fs.readFileSync(targetTemplateFsPath, 'utf8');
          targetDoc = TextDocument.create(url.pathToFileURL(targetTemplateFsPath).toString(), 'jinja', 1, fileText);
          targetUri = targetDoc.uri;
        } catch (e) {
          logToClient(`[Definition MacroCallImport ERROR] Failed to read source template: ${e}`);
          return null;
        }
      }
      
      const macroDef = findMacroDefinitionByName(targetDoc, macroName);
      if (macroDef?.node) {
        const { startPosition, endPosition } = macroDef.node;
        return [{
          uri: targetUri,
          range: Range.create(startPosition.row, startPosition.column, endPosition.row, endPosition.column)
        }];
      }
      logToClient(`[Definition MacroCall] Macro '${macroName}' not found by findMacroDefinitionByName.`);
      return null;
    }

    // Fallback: If getDefinitionContext didn't find a macro call (e.g., cursor on import statement)
    // try to find definition for wordAtCursor if it's an imported macro name.
    if (wordAtCursor) {
      logToClient(`[Definition Fallback] Checking if '${wordAtCursor}' is an imported macro name.`);
      const importRegex = /\{\%\s*from\s*['"]([^'"]+)['"]\s*import\s*([A-Za-z0-9_,\s]+)\s*\%\}/g;
      let m;
      let sourceFileForImportedWord: string | undefined;

      while ((m = importRegex.exec(fullDocText)) !== null) {
        const sourceFile = m[1];
        const importedNames = m[2].split(',').map(n => n.trim());
        if (importedNames.includes(wordAtCursor)) {
          sourceFileForImportedWord = sourceFile;
          break;
        }
      }

      if (sourceFileForImportedWord) {
        logToClient(`[Definition FallbackImport] '${wordAtCursor}' is imported from '${sourceFileForImportedWord}'.`);
        if (!TEMPLATES_ROOT) {
          logToClient('[Definition FallbackImport] TEMPLATES_ROOT not set.');
          return null;
        }
        const path = require('path');
        const targetTemplateFsPath = path.resolve(TEMPLATES_ROOT, sourceFileForImportedWord);
        logToClient(`[Definition FallbackImport] Absolute source path: ${targetTemplateFsPath}`);
        let targetDoc;
        let targetUri;
        try {
          const fileText = fs.readFileSync(targetTemplateFsPath, 'utf8');
          targetUri = url.pathToFileURL(targetTemplateFsPath).toString();
          targetDoc = TextDocument.create(targetUri, 'jinja', 1, fileText);
        } catch (e) {
          logToClient(`[Definition FallbackImport ERROR] Failed to read source template: ${e}`);
          return null;
        }
        
        const macroDef = findMacroDefinitionByName(targetDoc, wordAtCursor);
        if (macroDef?.node) {
          const { startPosition, endPosition } = macroDef.node;
          return [{
            uri: targetUri,
            range: Range.create(startPosition.row, startPosition.column, endPosition.row, endPosition.column)
          }];
        }
        logToClient(`[Definition FallbackImport] Macro '${wordAtCursor}' not found in '${sourceFileForImportedWord}'.`);
      }
    }

    logToClient(`[Definition] No definition found for '${wordAtCursor || 'cursor position'}'.`);
    return null;
  }
);

// Enhanced hover for macros (same-file and imported)
connection.onHover(
  async (_params, _token): Promise<Hover | null> => {
    const doc = documents.get(_params.textDocument.uri);
    if (!doc) return null;

    const pythonExec = process.env.PYTHON_PATH || 'python3';
    const word = getWordAt(doc, _params.position);
    logToClient(`[Hover Debug Word] '${word}'`);
    if (!word) return null;

    const templatePath = url.fileURLToPath(doc.uri);
    let result;
    let info: { type?: string; doc?: string } = {};

    const defContext = getDefinitionContext(doc, _params.position); // For actual call sites
    logToClient(`[Hover Debug DefContext] ${JSON.stringify(defContext)}`);

    let performedImportedMacroHover = false;

    // Priority 1: Hovering on an actual macro call site identified by getDefinitionContext
    if (defContext?.type === 'macro_call' && defContext.name === word && defContext.sourceTemplate) {
      if (!TEMPLATES_ROOT) {
        logToClient('[HoverImportedMacroCall] TEMPLATES_ROOT not set. Cannot resolve imported macro hover.');
      } else {
        const path = require('path');
        const absoluteSourcePath = path.resolve(TEMPLATES_ROOT, defContext.sourceTemplate);
        logToClient(`[HoverImportedMacroCall] Looking for macro '${word}' in source '${absoluteSourcePath}'`);
        const args = ['-m', 'typedjinja.lsp_server', 'hover_macro', absoluteSourcePath, word];
        logToClient(`[HoverImportedMacroCall] Invoking: ${pythonExec} ${args.join(' ')}`);
        result = spawnSync(pythonExec, args, { encoding: 'utf8' });
        if (result.error || result.stderr) {
          logToClient(`[HoverImportedMacroCall ERROR] ${result.error ?? result.stderr}`);
        } else {
          try {
            info = JSON.parse(result.stdout);
            performedImportedMacroHover = true;
          } catch {
            logToClient(`[HoverImportedMacroCall Parse ERROR] ${result.stdout}`);
          }
        }
      }
    }
    
    // Priority 2: If not a call site, or call site failed, check if the word itself is an imported macro name anywhere
    if (!performedImportedMacroHover) {
      const textAll = doc.getText();
      const importRegex = /\{\%\s*from\s*['"]([^'"]+)['"]\s*import\s*([A-Za-z0-9_,\s]+)\s*\%\}/g;
      let m;
      let sourceTemplateForWord: string | undefined;
      let matchedImportedName: string | undefined;

      while ((m = importRegex.exec(textAll)) !== null) {
        const currentSourceTemplate = m[1];
        const importedNames = m[2].split(',').map(n => n.trim());
        if (importedNames.includes(word)) {
          sourceTemplateForWord = currentSourceTemplate;
          matchedImportedName = word; // The word itself is the imported name
          break;
        }
      }

      if (sourceTemplateForWord && matchedImportedName) {
        if (!TEMPLATES_ROOT) {
          logToClient('[HoverImportedName] TEMPLATES_ROOT not set. Cannot resolve imported macro hover.');
        } else {
          const path = require('path');
          const absoluteSourcePath = path.resolve(TEMPLATES_ROOT, sourceTemplateForWord);
          logToClient(`[HoverImportedName] Word '${matchedImportedName}' is imported from '${absoluteSourcePath}'`);
          const args = ['-m', 'typedjinja.lsp_server', 'hover_macro', absoluteSourcePath, matchedImportedName];
          logToClient(`[HoverImportedName] Invoking: ${pythonExec} ${args.join(' ')}`);
          result = spawnSync(pythonExec, args, { encoding: 'utf8' });
          if (result.error || result.stderr) {
            logToClient(`[HoverImportedName ERROR] ${result.error ?? result.stderr}`);
          } else {
            try {
              info = JSON.parse(result.stdout);
              performedImportedMacroHover = true;
            } catch {
              logToClient(`[HoverImportedName Parse ERROR] ${result.stdout}`);
            }
          }
        }
      }
    }

    // Priority 3: Default hover (stub, then current file for non-imported macro)
    if (!performedImportedMacroHover) {
      const stubPath = (() => {
        const path = require('path');
        const dir = path.dirname(templatePath);
        const base = path.basename(templatePath, '.jinja');
        return path.join(dir, '__pycache__', base + '.pyi');
      })();
      // Only proceed if stubPath exists, otherwise, no info for default hover.
      if (fs.existsSync(stubPath)) { 
        const line = _params.position?.line ?? 0;
        const character = _params.position?.character ?? 0;
        const args = ['-m', 'typedjinja.lsp_server', 'hover', stubPath, word, String(line), String(character), templatePath];
        logToClient(`[HoverDefault] Invoking: ${pythonExec} ${args.join(' ')}`);
        result = spawnSync(pythonExec, args, { encoding: 'utf8' });
        if (result.error || result.stderr) {
          logToClient(`[HoverDefault ERROR] ${result.error ?? result.stderr}`);
        } else {
          try {
            info = JSON.parse(result.stdout);
          } catch {
            logToClient(`[HoverDefault Parse ERROR] ${result.stdout}`);
          }
        }
      } else {
        logToClient(`[HoverDefault] Stub path ${stubPath} does not exist. Skipping default hover.`);
      }
    }

    if (!info.type) {
        logToClient(`[Hover Result] No type information found for '${word}'. Final info: ${JSON.stringify(info)}`);
        return null;
    }
    const contents = '```python\n' + word + ': ' + info.type + '\n```' + (info.doc ? '\n\n' + info.doc : '');
    return { contents: { kind: MarkupKind.Markdown, value: contents } };
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
