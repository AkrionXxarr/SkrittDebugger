"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });

const { Path } = require("./path");
const Utilities = require("../duk/utilities");

var Breakpoint;
(function (Breakpoint) {
    let id = 0;
    function getId() {
        return id++;
    }
    Breakpoint.getId = getId;
    class DataRegistry {
        constructor(sourceRoot) {
            this.registry = new Path.Map(sourceRoot);
        }

        get(filePath) {
            return this.registry.get(filePath);
        }

        has(filePath) {
            return this.registry.has(filePath);
        }

        push(bpData) {
            if (!bpData.vsCodePath || !bpData.duktapePath)
                throw new Error("Breakpoint data must have both paths defined.");
            let dataArray = this.registry.get(bpData.duktapePath);
            if (!dataArray) {
                dataArray = [];
                this.registry.set(bpData.duktapePath, dataArray);
            }
            dataArray.push(bpData);
        }

        concat(bpDataArray) {
            if (bpDataArray.length === 0)
                return;
            const e = bpDataArray[0];
            if (!e.vsCodePath || !e.duktapePath)
                throw new Error("Breakpoint data must have both paths defined.");
            let dataArray = this.registry.get(e.duktapePath);
            if (!dataArray) {
                dataArray = [];
                this.registry.set(e.duktapePath, dataArray);
            }
            dataArray.concat(bpDataArray);
        }

        delete(filePath) {
            const bps = this.registry.get(filePath);
            for (const bp of bps) {
                Utilities.BreakpointIndex.remove(bp.dukBpIndex);
                delete bp.dukBpIndex;
            }
            this.registry.delete(filePath);
        }

        toString() {
            const output = ["=== Breakpoint Registry ===\n"];
            const vsCodeBpStr = [];
            const duktapeBpStr = [];
            const bps = [];
            const mapArray = this.registry.getMapAsArray();
            // Iterate the breakpoints by file and format the vsCode breakpoint strings.
            for (const e of mapArray) {
                bps.push(...e.data);
                if (e.data.length === 0)
                    continue;
                // Format vsCode breakpoint strings, sorted by line number.
                const lineSorted = e.data.sort((a, b) => {
                    return a.breakpoint.line - b.breakpoint.line;
                });
                vsCodeBpStr.push(`${e.data[0].vsCodePath}:`);
                for (const bp of lineSorted) {
                    let bpStr = `   (${bp.breakpoint.line} -> ${bp.breakpoint.mappedLine})`;
                    if (bp.breakpoint.conditionData) {
                        if (bp.breakpoint.conditionData.type == "hit") {
                            const hitPayload = bp.breakpoint.conditionData.payload;
                            bpStr += ` [Conditional Hit: ${hitPayload.condition}]`;
                        }
                        else {
                            const conditionalPayload = bp.breakpoint.conditionData.payload;
                            bpStr += ` [Conditional Expression: ${conditionalPayload}]`;
                        }
                    }
                    vsCodeBpStr.push(bpStr);
                }
                vsCodeBpStr.push("");
            }
            // Format the duktape breakpoint strings, sorted by duktape index.
            const dukIndexSorted = bps.sort((a, b) => {
                return a.dukBpIndex.get() - b.dukBpIndex.get();
            });
            for (let i = 0; i < dukIndexSorted.length; i++) {
                const bp = dukIndexSorted[i];
                duktapeBpStr.push(`${i}: (${bp.breakpoint.mappedLine} -> ${bp.breakpoint.line}) ${bp.duktapePath}`);
            }
            output.push("___Duktape Breakpoints (js -> ts)_______");
            output.push(duktapeBpStr.join("\n"));
            output.push("\n");
            output.push("___VS Code Breakpoints (ts -> js)_______");
            output.push(vsCodeBpStr.join("\n"));
            return output.join("\n");
        }
    }
    Breakpoint.DataRegistry = DataRegistry;
})(Breakpoint = exports.Breakpoint || (exports.Breakpoint = {}));
//# sourceMappingURL=breakpoint.js.map