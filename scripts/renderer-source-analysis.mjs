import ts from 'typescript';

export function moduleReferences(content, filename = 'module.tsx') {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const references = [];
  const add = (node, runtime = true) => {
    if (node && ts.isStringLiteralLike(node)) references.push({ path: node.text, runtime });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && !clause.name && bindings.elements.every((entry) => entry.isTypeOnly));
      add(node.moduleSpecifier, !typeOnly);
    } else if (ts.isExportDeclaration(node)) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((entry) => entry.isTypeOnly));
      add(node.moduleSpecifier, !typeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, false);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, !node.isTypeOnly);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

/** Callable state members are actions, regardless of their spelling or selector alias. */
export function patternStoreActions(source, checker) {
  const hits = new Set();
  const fromStore = (declaration) => /\/renderer\/stores\//.test(declaration?.getSourceFile().fileName.replaceAll('\\', '/') ?? '');
  const isStore = (node) => {
    const type = checker.getTypeAtLocation(node);
    return Boolean(type.getProperty('getState') && type.getProperty('setState'));
  };
  const isStoreWrite = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'setState' && isStore(node.expression);
    if (ts.isElementAccessExpression(node)) {
      return ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'setState' && isStore(node.expression);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = node.propertyName ?? node.name;
      const owner = node.parent.parent;
      const initializer = ts.isVariableDeclaration(owner) ? owner.initializer : undefined;
      return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === 'setState'
        && initializer && isStore(initializer);
    }
    return false;
  };
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isBindingElement(node)) {
      const target = ts.isBindingElement(node) ? node.name : node;
      const type = checker.getTypeAtLocation(target);
      const isAction = type.getCallSignatures().some((signature) => fromStore(signature.declaration));
      if (isAction || isStoreWrite(node)) hits.add(target.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...hits];
}
