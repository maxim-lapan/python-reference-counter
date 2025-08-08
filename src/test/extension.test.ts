import * as assert from 'assert';
import * as vscode from 'vscode';
import { PythonReferenceProvider } from '../extension';

// NOTE: These tests cover lightweight logic (pattern recognition) without invoking the real reference provider.

suite('PythonReferenceProvider basic parsing', () => {
	const provider = new PythonReferenceProvider();

		function createDoc(text: string): vscode.TextDocument {
		// Use an in-memory document
			return new (class implements vscode.TextDocument {
			uri = vscode.Uri.file('/fake.py');
			fileName = 'fake.py';
			isUntitled = false; languageId = 'python'; version = 1; isDirty = false; isClosed = false;
				encoding = 'utf8';
			eol = vscode.EndOfLine.LF; lineCount = text.split('\n').length;
			save(): Thenable<boolean> { return Promise.resolve(true); }
			lineAt(line: number | vscode.Position): vscode.TextLine { const n = typeof line === 'number' ? line : line.line; const l = text.split('\n')[n]; return { lineNumber: n, text: l, range: new vscode.Range(new vscode.Position(n,0), new vscode.Position(n,l.length)), rangeIncludingLineBreak: new vscode.Range(new vscode.Position(n,0), new vscode.Position(n,l.length)), firstNonWhitespaceCharacterIndex: l.length - l.trimStart().length, isEmptyOrWhitespace: l.trim().length===0 }; }
			offsetAt(pos: vscode.Position): number { const lines = text.split('\n'); let off=0; for (let i=0;i<pos.line;i++){off+=lines[i].length+1;} return off+pos.character; }
			positionAt(offset: number): vscode.Position { const lines=text.split('\n'); let off=0; for (let i=0;i<lines.length;i++){ if (off+lines[i].length>=offset) return new vscode.Position(i, offset-off); off+=lines[i].length+1;} return new vscode.Position(lines.length-1, lines[lines.length-1].length); }
			getText(range?: vscode.Range): string { if (!range) return text; const start = this.offsetAt(range.start); const end = this.offsetAt(range.end); return text.slice(start, end); }
			getWordRangeAtPosition(): vscode.Range | undefined { return undefined; }
			validateRange(r: vscode.Range): vscode.Range { return r; }
			validatePosition(p: vscode.Position): vscode.Position { return p; }
		})();
	}

	test('detects class and function and method lenses', async () => {
		const source = [
			'class A:',
			'    def m(self):',
			'',
			'def top():',
		].join('\n');
		const doc = createDoc(source);
		const lenses = await provider.provideCodeLenses(doc, new vscode.CancellationTokenSource().token);
		assert.strictEqual(lenses.length, 3, 'Should create three lenses');
		const names = lenses.map(l => doc.getText(l.range));
		assert.deepStrictEqual(names.sort(), ['A','m','top'].sort());
	});
});
