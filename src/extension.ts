import * as vscode from 'vscode';

// Precompiled patterns (decorator handling kept simple: we only match the definition line itself)
const CLASS_DEF_RE = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/;
const FUNC_DEF_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/;

type SymbolKind = 'class' | 'function' | 'method';

class PythonSymbolCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly uri: vscode.Uri,
    public readonly name: string,
    public readonly kind: SymbolKind
  ) {
    super(range);
  }
}

export class PythonReferenceProvider implements vscode.CodeLensProvider {

  public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    if (token.isCancellationRequested) { return []; }

    const cfg = vscode.workspace.getConfiguration('pythonReferenceCounter');
    const enableForClasses = cfg.get<boolean>('enableForClasses', true);
    const enableForFunctions = cfg.get<boolean>('enableForFunctions', true);

    if (!enableForClasses && !enableForFunctions) { return []; }

    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\n/);

    for (let i = 0; i < lines.length; i++) {
      if (token.isCancellationRequested) { break; }
      const line = lines[i];

      if (enableForClasses) {
        const cm = CLASS_DEF_RE.exec(line);
        if (cm) {
          const name = cm[1];
            const idx = line.indexOf(name);
            lenses.push(new PythonSymbolCodeLens(new vscode.Range(new vscode.Position(i, idx), new vscode.Position(i, idx + name.length)), document.uri, name, 'class'));
            continue; // a line cannot be both class and function
        }
      }

      if (enableForFunctions) {
        const fm = FUNC_DEF_RE.exec(line);
        if (fm) {
          const name = fm[1];
          const idx = line.indexOf(name);
          const isMethod = /^\s+/.test(line); // indentation implies method
          lenses.push(new PythonSymbolCodeLens(new vscode.Range(new vscode.Position(i, idx), new vscode.Position(i, idx + name.length)), document.uri, name, isMethod ? 'method' : 'function'));
        }
      }
    }

    return lenses;
  }

  public async resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
    if (!(codeLens instanceof PythonSymbolCodeLens) || token.isCancellationRequested) { return codeLens; }

    try {
      const cfg = vscode.workspace.getConfiguration('pythonReferenceCounter');
      const showZero = cfg.get<boolean>('showZeroReferences', true);
      const includeDefinition = cfg.get<boolean>('includeDefinition', false);
  const enableFallback = cfg.get<boolean>('enableFallbackWorkspaceScan', true);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        codeLens.uri,
        codeLens.range.start
      ) || [];

      let refs = locations;

      if (codeLens.kind === 'method') {
        refs = await this.filterMethodReferences(refs, codeLens.name, token);
      }

      if (!includeDefinition) {
        refs = refs.filter(loc => !(loc.uri.toString() === codeLens.uri.toString() && loc.range.start.isEqual(codeLens.range.start)));
      }

      // Fallback: Some Python language server setups only return in-file results until a file is opened.
      // If all references are local (or none) and user enabled fallback, perform a lightweight text scan.
      if (enableFallback && !token.isCancellationRequested) {
        const allLocal = refs.length === 0 || refs.every(r => r.uri.toString() === codeLens.uri.toString());
        if (allLocal) {
          try {
            const fallbackRefs = await this.fallbackWorkspaceSearch(codeLens.name, codeLens, includeDefinition, token);
            if (fallbackRefs.length > refs.length) {
              refs = fallbackRefs;
            }
          } catch (e) {
          }
        }
      }

      const count = refs.length;
      if (!showZero && count === 0) { return codeLens; }

      const title = `${count} reference${count === 1 ? '' : 's'}`;
      codeLens.command = {
        title,
        command: 'editor.action.showReferences',
        arguments: [codeLens.uri, codeLens.range.start, refs]
      };
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('Python Reference Counter: resolve error', err);
      }
      codeLens.command = { title: '? references', command: '' };
    }
    return codeLens;
  }

  private async filterMethodReferences(references: vscode.Location[], methodName: string, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const filtered: vscode.Location[] = [];
    const docCache = new Map<string, vscode.TextDocument>();

    for (const ref of references) {
      if (token.isCancellationRequested) { break; }
      try {
        const key = ref.uri.toString();
        let doc = docCache.get(key);
        if (!doc) {
          doc = await vscode.workspace.openTextDocument(ref.uri);
          docCache.set(key, doc);
        }
        const lineText = doc.lineAt(ref.range.start.line).text;
        if (this.isValidMethodReference(lineText, ref.range.start.character, ref.range.end.character, methodName)) {
          filtered.push(ref);
        }
      } catch {
        // If we fail to read a document, conservatively keep the reference
        filtered.push(ref);
      }
    }
    return filtered;
  }

  private isValidMethodReference(lineText: string, startChar: number, endChar: number, methodName: string): boolean {
    const beforeChar = startChar > 0 ? lineText[startChar - 1] : '';
    // Only treat attribute access (object.method) as a call site candidate
    if (beforeChar !== '.') { return false; }

    // Exclude definition lines
    const trimmed = lineText.trimStart();
    if (trimmed.startsWith('def ')) {
      const defMatch = trimmed.match(/^def\s+(\w+)/);
      if (defMatch && defMatch[1] === methodName) { return false; }
    }
    if (trimmed.startsWith('class ')) { return false; }
    return true;
  }

  // Fallback naive workspace-wide text search for symbol occurrences.
  // This is regex-based and does not perform semantic analysis, so it may
  // over-count in comments / strings. Used only when the official provider
  // yields no (or only local) results.
  private async fallbackWorkspaceSearch(name: string, lens: PythonSymbolCodeLens, includeDefinition: boolean, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const results: vscode.Location[] = [];
    const wordPattern = `\\b${name}\\b`;
    const regex = new RegExp(wordPattern, 'g');
    const exclude = '**/{.venv,venv,site-packages,dist,build,__pycache__}/**';
    const include = '**/*.py';
    await new Promise<void>((resolve) => {
      (vscode.workspace as any).findTextInFiles(
        { pattern: name, isRegExp: false },
        { include, exclude },
        (result: { uri: vscode.Uri; ranges: vscode.Range | vscode.Range[] }) => {
          if (token.isCancellationRequested) return;
          const { uri, ranges } = result;
          const rangeArr = Array.isArray(ranges) ? ranges : [ranges];
          vscode.workspace.openTextDocument(uri)
            .then(doc => {
              for (const range of rangeArr) {
                const line = doc.lineAt(range.start.line).text;
                regex.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = regex.exec(line)) !== null) {
                  const start = new vscode.Position(range.start.line, match.index);
                  const end = new vscode.Position(range.start.line, match.index + name.length);
                  // Skip the definition itself (if configured)
                  if (!includeDefinition && uri.toString() === lens.uri.toString() && start.isEqual(lens.range.start)) { continue; }
                  // If lens is a method, enforce '.' before
                  if (lens.kind === 'method') {
                    if (match.index === 0 || line[match.index - 1] !== '.') { continue; }
                  }
                  // For methods, also skip if inside a def line for the same method
                  if (lens.kind === 'method') {
                    const trimmed = line.trimStart();
                    if (trimmed.startsWith('def ') && trimmed.includes(name)) { continue; }
                  }
                  results.push(new vscode.Location(uri, new vscode.Range(start, end)));
                }
              }
            }, () => {
            });
        },
        resolve
      );
    });
    return results;
  }
}


// Entry function called when the extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('Python Reference Counter activated');

  const selector = { language: 'python', scheme: 'file' };
  const provider = new PythonReferenceProvider();
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, provider));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('pythonReferenceCounter')) {
        vscode.commands.executeCommand('vscode.executeCodeLensProvider');
      }
    })
  );
}

// Called when the extension is deactivated
export function deactivate() {
  console.log('Python Reference Counter deactivated');
}