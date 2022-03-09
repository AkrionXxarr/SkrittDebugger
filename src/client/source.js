"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const { Path } = require("./path");
var Source;
(function (Source) {
    /**
     * Holds all the relevant pieces of data for a source file.
     */
    class Data {
        constructor(vsCodePath, duktapePath, lineMap, ast) {
            this.ignoredExceptions = {};
            this.vsCodePath = vsCodePath;
            this.duktapePath = duktapePath;
            this.lineMap = lineMap;
            this.ast = ast;
        }
        /**
         * Given a javascript line, return the typescript line: (js -> ts)
         */
        javascriptToTypescript(jsLine) {
            if (this.lineMap) {
                const mappedLine = this.lineMap.generatedToOriginal(jsLine);
                if (mappedLine) {
                    return {
                        name: path.basename(this.vsCodePath),
                        path: this.vsCodePath,
                        line: mappedLine[0]
                    };
                }
            }
            return {
                name: path.basename(this.duktapePath),
                path: this.duktapePath,
                line: undefined
            };
        }
        /**
         * Given a typescript line, return the javascript line: (ts -> js)
         */
        typescriptToJavascript(tsLine) {
            if (this.lineMap) {
                const mappedLine = this.lineMap.originalToGenerated(tsLine);
                if (mappedLine) {
                    return {
                        name: path.basename(this.duktapePath),
                        path: this.duktapePath,
                        line: mappedLine[0]
                    };
                }
            }
            return {
                name: path.basename(this.vsCodePath),
                path: this.vsCodePath,
                line: undefined
            };
        }
        toString() {
            let str = "";
            str += `VSCode path: ${this.vsCodePath}\n`;
            str += `Duktape path: ${this.duktapePath}\n`;
            str += `${this.lineMap.toString()}\n`;
            return str;
        }
    }
    Source.Data = Data;
    ;
    /**
     * Maps both VSCode and Duktape source paths to the same source data
     */
    class Registry {
        constructor(sourceRoot) {
            this.registry = new Path.Map(sourceRoot);
        }
        push(srcData) {
            if (!srcData.vsCodePath || !srcData.duktapePath)
                throw new Error("Source data must have both paths defined.");
            this.registry.set(srcData.duktapePath, srcData);
        }
        get(filePath) {
            return this.registry.get(filePath);
        }
        delete(filePath) {
            this.registry.delete(filePath);
        }
        toString() {
            let str = "=== Source Registry ===\n\n";
            const mapArray = this.registry.getMapAsArray();
            for (const e of mapArray) {
                const srcData = e.data;
                str += `[srcData]\n` +
                    `    ├─[${srcData.vsCodePath}]\n` +
                    `    └─[${srcData.duktapePath}]\n`;
            }
            return str;
        }
    }
    Source.Registry = Registry;
})(Source = exports.Source || (exports.Source = {}));
//# sourceMappingURL=source.js.map