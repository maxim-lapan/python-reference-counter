## Python Reference Counter

Light‑weight CodeLens provider that shows how many times a Python function / method / class is referenced in your workspace (PyCharm style). Click the indicator to open the built‑in references panel and navigate.

### ✨ Features
* Function / method / class reference counting (per symbol line)
* Fast: initial pass only does regex scan; expensive reference resolution deferred until CodeLens is revealed
* Smarter method filtering: excludes definitions and class headers; only counts real attribute calls like `obj.method(...)`
* Independent enable/disable toggles for classes and functions
* Optional inclusion of the definition itself in the count
* Optionally hide CodeLens when count is zero

### ⚙️ Settings
All settings are under `pythonReferenceCounter` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pythonReferenceCounter.showZeroReferences` | boolean | `true` | Show CodeLens even for zero references |
| `pythonReferenceCounter.includeDefinition` | boolean | `false` | Count the definition line itself |
| `pythonReferenceCounter.enableForClasses` | boolean | `true` | Enable CodeLens for `class` definitions |
| `pythonReferenceCounter.enableForFunctions` | boolean | `true` | Enable CodeLens for `def` (functions + methods) |
| `pythonReferenceCounter.enableFallbackWorkspaceScan` | boolean | `true` | If the language server only returns in-file results, perform a naive full-workspace text search as a fallback (may over-count) |

### 📦 Requirements
* VS Code >= 1.102.0
* Python files in a workspace folder (no external index needed)

### 🚀 Usage
1. Install the extension
2. Open a Python file
3. Hover near a function / class line or scroll it into view – a CodeLens like `3 references` appears
4. Click the lens to open the references panel
5. Adjust behavior via Settings > Extensions > Python Reference Counter

### 🧠 How It Works (Brief)
1. Provide phase: cheap regex finds candidate `class` / `def` lines and creates placeholder CodeLens objects
2. Resolve phase: when a lens becomes visible, executes built‑in `vscode.executeReferenceProvider` and post‑filters method references so only true call sites (preceded by `.`) remain
3. Definition filtering & zero‑count hiding applied per user settings

### 📌 Limitations / Notes
* Static analysis only—dynamic usages via `getattr`, reflection, metaprogramming not detected
* Method detection relies on indentation + dot call heuristic; very unusual formatting may reduce accuracy
* Multi‑line signatures with decorators are supported (basic pattern)

### 🗒️ Changelog
See [CHANGELOG.md](./CHANGELOG.md) — current version: 1.0.0

### 🤝 Contributing
Issues & PRs welcome: open an issue describing improvement or inaccuracy with a minimal reproduction.

### 🧪 Testing
Run lint + compile:
```bash
npm install
npm test
```

### License
MIT

Enjoy coding! 🎉
