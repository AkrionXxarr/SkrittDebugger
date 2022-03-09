"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const vsAdapt = require("vscode-debugadapter");
const duk_const = require("../duk/constants");
class PropertySet {
    constructor(type) {
        this.callChain = "";
        this.classType = duk_const.HObjectClassIDs.None;
        this.type = type;
    }
    toStringTree() {
        const propertySet = new StringBuilder.Tree.Node(this.displayName);
        const propertySetData = new StringBuilder.Tree.Node();
        propertySetData.text = `Call Chain: ${this.callChain}\n`;
        propertySetData.text += `ClassType: ${duk_const.HObjectClassIDs[this.classType]}\n`;
        propertySetData.text += `Pointer: ${(this.heapPtr) ? this.heapPtr.toString() : "undefined"}`;
        if (this.variables && this.variables.length > 0) {
            const propertySetVariables = new StringBuilder.Tree.Node("Variables");
            const variables = new StringBuilder.Tree.Node("");
            for (const variable of this.variables) {
                variables.text += `${variable.name} = ${variable.value}\n`;
            }
            propertySetVariables.Add(variables);
            propertySetData.Add(propertySetVariables);
        }
        propertySet.Add(propertySetData);
        return propertySet;
    }
}
exports.PropertySet = PropertySet;
(function (PropertySet) {
    let Type;
    (function (Type) {
        Type[Type["Scope"] = 0] = "Scope";
        Type[Type["Object"] = 1] = "Object";
        Type[Type["Artificials"] = 2] = "Artificials";
    })(Type = PropertySet.Type || (PropertySet.Type = {}));
    class PtrDict {
    }
    PropertySet.PtrDict = PtrDict;
})(PropertySet = exports.PropertySet || (exports.PropertySet = {}));
class Scope {
    constructor(name, stackFrame, properties) {
        this.name = name;
        this.stackFrame = stackFrame;
        this.properties = properties;
    }
    toStringTree() {
        const scope = new StringBuilder.Tree.Node(`Scope: ${this.name} (${this.handle})\n`);
        scope.text += StringBuilder.Tree.ResolveToString(this.stackFrame.toStringTree());
        return scope;
    }
}
exports.Scope = Scope;
class StackFrame {
    constructor(source, fileName, filePath, functionName, lineNumber, pc, depth, scope) {
        this.source = source;
        this.fileName = fileName;
        this.filePath = filePath;
        this.functionName = functionName;
        this.lineNumber = lineNumber;
        this.pc = pc;
        this.depth = depth;
        this.scope = scope;
    }
    toStringTree() {
        const stackFrame = new StringBuilder.Tree.Node();
        const stackFrameData = new StringBuilder.Tree.Node();
        const className = (this.className === "") ? "" : this.className + ".";
        const funcName = (this.functionName === "") ? "(() => { })" : this.functionName + "()";
        stackFrame.text = className + funcName;
        stackFrameData.text = `Depth: ${this.depth}\n`;
        stackFrameData.text += `File: ${this.filePath}\n`;
        stackFrameData.text += `Line: ${this.lineNumber}`;
        stackFrame.Add(stackFrameData);
        return stackFrame;
    }
    toString() {
        return `handle: ${this.handle}\n`
            + `function: ${this.functionName}\n`
            + `line: ${this.lineNumber}\n`
            + `pc: ${this.pc}\n`
            + `depth: ${this.depth}\n`
            + `class: ${this.className}`;
    }
}
exports.StackFrame = StackFrame;
class SessionState {
    clear() {
        this.paused = undefined;
        this.ptrHandles = new PropertySet.PtrDict();
        this.varHandles = new vsAdapt.Handles();
        this.stackFrames = new vsAdapt.Handles();
        this.scopes = new vsAdapt.Handles();
        this.localScope = undefined;
        this.watchScope = undefined;
    }
    toStringTree() {
        const sessionStateScopes = new StringBuilder.Tree.Node("Scopes");
        const handleMap = this.scopes._handleMap;
        for (const scope of handleMap.values()) {
            const scopeNode = scope.toStringTree();
            const propSetsNode = new StringBuilder.Tree.Node("Property Sets");
            for (const handle in this.ptrHandles) {
                const propSet = this.ptrHandles[handle];
                if (!propSet)
                    propSetsNode.Add(new StringBuilder.Tree.Node(`Propset undefined: ${handle}`));
                else if (!propSet.scope)
                    propSetsNode.Add(new StringBuilder.Tree.Node(`Scope undefined: ${propSet.displayName}`));
                else if (propSet.scope.handle === scope.handle)
                    propSetsNode.Add(propSet.toStringTree());
            }
            if (propSetsNode.children.length > 0)
                scopeNode.Add(propSetsNode);
            sessionStateScopes.Add(scopeNode);
        }
        return sessionStateScopes;
    }
    toString() {
        let sessionState = "=== Session State ===\n\n";
        try {
            sessionState += StringBuilder.Tree.ResolveToString(this.toStringTree());
        }
        catch (err) {
            sessionState += err.toString();
        }
        return sessionState;
    }
}
exports.SessionState = SessionState;
/**
 * String building utilities.
 */
var StringBuilder;
(function (StringBuilder) {
    /**
     * Builds a stingified tree.
     */
    class Tree {
        /**
         * Resolve a node tree into a string.
         *
         * @param {Tree.Node} root The root node of the tree to be resolved.
         */
        static ResolveToString(root) {
            const lines = Tree.ParseNode(root);
            return lines.join('\n');
        }
        /**
         * Parse a node of the node tree.
         *
         * @param {Tree.Node} node The node to parse.
         */
        static ParseNode(node) {
            if (!node)
                return [];
            const style = node.style || Tree.basicStyle;
            let lines = [];
            // Add the root of the current depth to the array of lines.
            lines.push(node.text);
            // Walk through all sub nodes and recursively parse them.
            for (let i = 0; i < node.children.length; i++) {
                const subLines = Tree.ParseNode(node.children[i]);
                // Depending on the state of subnodes and the current index,
                // build the either the starting line, middle lines, or ending line.
                const newLine = style.newLine || Tree.basicStyle.newLine;
                if (i == 0 && (i + 1 < node.children.length)) {
                    // Start line
                    const start = style.start || Tree.basicStyle.start;
                    Tree.BuildSubLines(lines, subLines, start, newLine);
                }
                else if (i + 1 < node.children.length) {
                    // Middle line
                    const middle = style.middle || Tree.basicStyle.middle;
                    Tree.BuildSubLines(lines, subLines, middle, newLine);
                }
                else {
                    // End line
                    const end = style.end || Tree.basicStyle.end;
                    Tree.BuildSubLines(lines, subLines, end, newLine);
                    // Place a gap between the end of one group and start of another.
                    //lines.push(end.gap);
                }
            }
            return lines;
        }
        /**
         * Add sub lines to the resolved lines.
         *
         * @param {string[]} lines The resolved lines that will eventually be returned.
         * @param {string[]} subLines The lines part of this sub node.
         * @param {Tree.Style.Data} style The style to use for fields and gaps.
         * @param {Tree.Style.NewLine} newLineStyle The style to use for multi-line nodes.
         */
        static BuildSubLines(lines, subLines, style, newLineStyle) {
            const firstSubLine = subLines[0].split('\n');
            if (firstSubLine.length > 1) {
                // This string has multiple lines.
                lines.push(style.field + newLineStyle.start);
                for (let i = 0; i < firstSubLine.length; i++) {
                    lines.push(style.gap + newLineStyle.middle + firstSubLine[i]);
                }
                lines.push(style.gap + newLineStyle.end);
            }
            else {
                // This string is one line.
                lines.push(style.field + firstSubLine[0]);
            }
            // Handle the remaining sub lines
            for (let i = 1; i < subLines.length; i++) {
                lines.push(style.gap + subLines[i]);
            }
        }
    }
    /** A basic style that's defaulted to if no other styles are provided. */
    Tree.basicStyle = {
        start: { field: " \\__", gap: " |  " },
        middle: { field: " |__", gap: " |  " },
        end: { field: " \\__", gap: "    " },
        newLine: { start: "._", middle: "| ", end: "o" }
    };
    StringBuilder.Tree = Tree;
    (function (Tree) {
        /** A tree node that holds a string and an array of sub nodes. */
        class Node {
            /**
             * @param {string} text The text associated with this tree node.
             * @param {Tree.Style} style The style to use with this node's children.
             */
            constructor(text = "", style = Tree.basicStyle) {
                this.children = [];
                this.text = text;
                this.style = style;
            }
            /** Add to this node's children. */
            Add(...items) {
                this.children.push(...items);
            }
        }
        Tree.Node = Node;
    })(Tree = StringBuilder.Tree || (StringBuilder.Tree = {}));
})(StringBuilder = exports.StringBuilder || (exports.StringBuilder = {}));
function buildValidBreakpointLines(srcData) {
    return new ValidBPLineBuilder(srcData).build();
}
exports.buildValidBreakpointLines = buildValidBreakpointLines;
class ValidBPLineBuilder {
    constructor(srcData) {
        this.delint = (node) => {
            // Depth-first recursion.
            ts.forEachChild(node, this.delint);
            this.syntaxStatement(node);
        };
        this.srcData = srcData;
    }
    build() {
        this.allValidLines = new Array(this.srcData.ast.getLineAndCharacterOfPosition(this.srcData.ast.getEnd()).line + 1);
        this.allValidLines.forEach(e => { e = false; });
        this.delint(this.srcData.ast);
        return this.allValidLines;
    }
    syntaxStatement(node) {
        switch (node.kind) {
            case ts.SyntaxKind.BreakStatement:
            case ts.SyntaxKind.ContinueStatement:
            case ts.SyntaxKind.DebuggerStatement:
            case ts.SyntaxKind.DoStatement:
            case ts.SyntaxKind.EmptyStatement:
            case ts.SyntaxKind.ExpressionStatement:
            case ts.SyntaxKind.ForInStatement:
            case ts.SyntaxKind.ForOfStatement:
            case ts.SyntaxKind.ForStatement:
            case ts.SyntaxKind.IfStatement:
            case ts.SyntaxKind.LabeledStatement:
            case ts.SyntaxKind.ReturnStatement:
            case ts.SyntaxKind.SwitchStatement:
            case ts.SyntaxKind.ThrowStatement:
            case ts.SyntaxKind.TryStatement:
            case ts.SyntaxKind.VariableStatement:
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.WithStatement:
                this.allValidLines[this.srcData.ast.getLineAndCharacterOfPosition(node.getStart(this.srcData.ast)).line] = true;
                break;
        }
    }
}
//# sourceMappingURL=utilities.js.map