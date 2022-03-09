"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
/** Maps Base64 to Decimal and Decimal to Base64 */
class Base64 {
    constructor() {
        this.intToChar = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".split("");
        this.charToInt = new Map();
        this.intToChar.forEach((c, i) => {
            this.charToInt.set(c, i);
        });
    }
    toInt(c) { return this.charToInt.get(c); }
    toChar(i) { return this.intToChar[i]; }
}
// For details on how VLQs work:
// https://blogs.msdn.microsoft.com/davidni/2016/03/14/source-maps-under-the-hood-vlq-base64-and-yoda/
/** Variable Length Quantity */
class VLQ extends Base64 {
    constructor() {
        super();
    }
    decode(str) {
        const result = new Array();
        let shift = 0;
        let value = 0;
        for (let i = 0; i < str.length; i++) {
            const int = this.toInt(str[i]);
            if (int === undefined)
                throw new Error(`Invalid character: (${str[i]})`);
            const hasContinuation = (int & 32) === 32;
            value |= ((int & 31) << shift);
            if (hasContinuation) {
                shift += 5;
            }
            else {
                const shouldNegate = (value & 1) === 1;
                value >>= 1;
                result.push((shouldNegate) ? -value : value);
                value = 0;
                shift = 0;
            }
        }
        return result;
    }
}
/** Parses a source map into a more simplified line map. */
class LineMap {
    constructor(mapping, zeroBased = false) {
        this.vlq = new VLQ();
        this.genToOrig = new Map();
        this.origToGen = new Map();
        this.buildMap(mapping, zeroBased);
    }
    buildMap(mapping, zeroBased) {
        const mappedLines = mapping.split(";", -1);
        const start = (zeroBased) ? 0 : 1;
        let genRow = start;
        let origRow = start;
        for (let i = 0; i < mappedLines.length; i++, genRow++) {
            if (mappedLines[i].length === 0)
                continue;
            const segments = mappedLines[i].split(",");
            for (let j = 0; j < segments.length; j++) {
                const data = this.vlq.decode(segments[j]);
                origRow += data[2];
                if (j === 0) {
                    // Associate both rows with each other
                    //   o               g
                    // lineA <-------> lineA
                    this.origToGen.set(origRow, [genRow]);
                    this.genToOrig.set(genRow, [origRow]);
                }
                else {
                    if (data[2] !== 0) {
                        const t = this.origToGen.get(origRow);
                        if (!t)
                            continue;
                        // There's a new origRow to associate with genRow
                        //   o               g
                        // lineA <-------> lineA
                        // lineB ----/
                        t.push(genRow);
                        this.origToGen.set(origRow, t);
                        // Associate back
                        const u = this.genToOrig.get(genRow);
                        if (u) {
                            u.push(origRow);
                            this.genToOrig.set(genRow, u);
                        }
                        else {
                            this.genToOrig.set(genRow, [origRow]);
                        }
                    }
                }
            }
        }
    }
    /** The original line that the generated line maps to: (js -> ts) */
    generatedToOriginal(line) { return this.genToOrig.get(line); }
    /** The generated line that the original line maps to: (ts -> js) */
    originalToGenerated(line) { return this.origToGen.get(line); }
    toString() {
        let str = "";
        str = "==== Generated To Original ====\n";
        str += "(js) -> (ts)\n";
        this.genToOrig.forEach((val, i) => {
            str += `${i} -> [${val.join(", ")}]\n`;
        });
        str += "\n==== Original To Generated ====\n";
        str += "(ts) -> (js)\n";
        this.origToGen.forEach((val, i) => {
            str += `${i} -> [${val.join(", ")}]\n`;
        });
        return str;
    }
}
exports.LineMap = LineMap;
//# sourceMappingURL=vlq.js.map