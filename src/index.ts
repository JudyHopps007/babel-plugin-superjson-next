import { NodePath, PluginObj, PluginPass } from '@babel/core';
import { addNamed as addNamedImport } from '@babel/helper-module-imports';
import {
  callExpression,
  ClassDeclaration,
  classExpression,
  ExportNamedDeclaration,
  Expression, FunctionDeclaration,
  functionExpression, isClassDeclaration, isExportDefaultDeclaration, isExportNamedDeclaration,
  isFunctionDeclaration, isFunctionExpression, isIdentifier,
  isVariableDeclaration, variableDeclaration, variableDeclarator,
} from '@babel/types';
import * as nodePath from 'path';

function functionDeclarationToExpression(declaration: FunctionDeclaration) {
  return functionExpression(
    declaration.id,
    declaration.params,
    declaration.body,
    declaration.generator,
    declaration.async
  );
}

function classDeclarationToExpression(declaration: ClassDeclaration) {
  return classExpression(
    declaration.id,
    declaration.superClass,
    declaration.body,
    declaration.decorators
  );
}

function getFileName(state: PluginPass) {
  const { filename, cwd } = state;

  if (!filename) {
    return undefined;
  }

  if (cwd && filename.startsWith(cwd)) {
    return filename.slice(cwd.length);
  }

  return filename;
}

const functionsToReplace = ['getServerSideProps', 'getStaticProps'];

function transformPropGetters(
  path: NodePath<ExportNamedDeclaration>,
  transform: (v: Expression) => Expression
) {
  const { node } = path;

  if (isFunctionDeclaration(node.declaration)) {
    const { id: functionId } = node.declaration;
    if (!functionId) {
      return;
    }

    if (!functionsToReplace.includes(functionId.name)) {
      return;
    }

    node.declaration = variableDeclaration('const', [
      variableDeclarator(
        functionId,
        transform(functionDeclarationToExpression(node.declaration))
      ),
    ]);

    return;
  }

  if (isVariableDeclaration(node.declaration)) {
    node.declaration.declarations.forEach((declaration) => {
      if (
        isIdentifier(declaration.id) &&
        functionsToReplace.includes(declaration.id.name) &&
        declaration.init
      ) {
        declaration.init = transform(declaration.init);
      }
    });
  }
}

function addWithSuperJSONPropsImport(path: NodePath<any>) {
  return addNamedImport(
    path,
    'withSuperJSONProps',
    'babel-plugin-superjson-next/tools'
  );
}

function addWithSuperJSONPageImport(path: NodePath<any>) {
  return addNamedImport(
    path,
    'withSuperJSONPage',
    'babel-plugin-superjson-next/tools'
  );
}

function wrapExportDefaultDeclaration(path: NodePath<any>) {
  function wrapInHOC(expr: Expression): Expression {
    return callExpression(addWithSuperJSONPageImport(path), [expr]);
  }

  const { node } = path;

  if (isIdentifier(node.declaration)) {
    node.declaration = wrapInHOC(node.declaration);
  }

  if (isFunctionExpression(node.declaration)) {
    node.declaration = wrapInHOC(node.declaration);
  }

  if (
    isFunctionDeclaration(node.declaration) ||
    isClassDeclaration(node.declaration)
  ) {
    if (node.declaration.id) {
      path.insertBefore(node.declaration);
      node.declaration = wrapInHOC(node.declaration.id);
    } else {
      if (isFunctionDeclaration(node.declaration)) {
        node.declaration = wrapInHOC(
          functionDeclarationToExpression(node.declaration)
        );
      } else {
        node.declaration = wrapInHOC(
          classDeclarationToExpression(node.declaration)
        );
      }
    }
  }
}

const filesToSkip = ([] as string[]).concat(
  ...['_app', '_document', '_error'].map((name) => [
    name + '.js',
    name + '.jsx',
    name + '.ts',
    name + '.tsx',
  ])
);

function shouldBeSkipped(filePath: string) {
  if (!filePath.includes('pages' + nodePath.sep)) {
    return true;
  }
  if (filePath.includes('pages' + nodePath.sep + 'api')) {
    return true;
  }
  return filesToSkip.some((fileToSkip) => filePath.includes(fileToSkip));
}

function superJsonWithNext(): PluginObj {
  return {
    name: 'add superjson to pages with prop getters',
    visitor: {
      Program(path, state) {
        const filePath =
          getFileName(state) ?? nodePath.join('pages', 'Default.js');

        if (shouldBeSkipped(filePath)) {
          return;
        }

        const body = path.get('body');

        body
          .filter((path) => isExportNamedDeclaration(path))
          .forEach((path) => {
            transformPropGetters(
              path as NodePath<ExportNamedDeclaration>,
              (decl) => {
                return callExpression(addWithSuperJSONPropsImport(path), [
                  decl,
                ]);
              }
            );
          });

        const exportDefaultDeclaration = body.find((path) =>
          isExportDefaultDeclaration(path)
        );
        if (!exportDefaultDeclaration) {
          return;
        }

        wrapExportDefaultDeclaration(exportDefaultDeclaration);
      },
    },
  };
}

export default superJsonWithNext;
