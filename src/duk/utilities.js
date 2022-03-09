"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const duk = require("./constants");
/**
 * Meant to help track the duktape breakpoint stack.
 *
 * To add an index, use the static create method and hold onto the return value.
 * To remove an index, use the static remove method and pass the index to be removed.
 */
class BreakpointIndex {
    constructor() {
        this.index = BreakpointIndex.bpIndices.length;
        BreakpointIndex.bpIndices.push(this);
    }
    get() {
        return this.index;
    }
    /**
     * Add a breakpoint index.
     */
    static create() {
        return new BreakpointIndex();
    }
    /**
     * Remove a breakpoint index.
     *
     * @param bpIndex The BreakpointIndex to be removed.
     */
    static remove(bpIndex) {
        if (bpIndex.index === undefined)
            throw new Error(`Stale breakpoint index being removed.`);
        const indices = BreakpointIndex.bpIndices;
        indices.splice(bpIndex.index, 1);
        for (let i = 0; i < indices.length; i++) {
            indices[i].index = i;
        }
        delete bpIndex.index;
    }
}
BreakpointIndex.bpIndices = [];
exports.BreakpointIndex = BreakpointIndex;
class ObjectProperty {
    get isAccessor() {
        return (this.flags & duk.PropDescFlags.Accessor) !== 0;
    }
    toString() {
        let str = `flags: ${this.flags}\n`;
        str += `key: ${this.key}\n`;
        if (this.isAccessor) {
            str += `getter: ${(this.getter) ? this.getter.toString() : "null"}\n`;
            str += `setter: ${(this.setter) ? this.setter.toString() : "null"}\n`;
        }
        else {
            str += `value: ${this.value}\n`;
        }
        return str;
    }
}
exports.ObjectProperty = ObjectProperty;
/**
 * Represents a Duktape call stack.
 */
class Callstack {
    constructor() {
        this.callstack = new Array();
    }
    get get() { return this.callstack; }
    get length() { return this.callstack.length; }
    addLine(fileName, funcName, lineNumber, pc) {
        this.callstack.push({
            fileName: fileName,
            funcName: funcName,
            lineNumber: lineNumber,
            pc: pc
        });
    }
    toString() {
        const str = new Array();
        for (let i = 0; i < this.callstack.length; i++) {
            const l = this.callstack[i];
            str.push(`${l.funcName} (${l.fileName}:${l.lineNumber})<${l.pc}>`);
        }
        return str.join("\n");
    }
}
exports.Callstack = Callstack;
/**
 * A functional-style Duktape request builder
 */
class REQBuilder {
    constructor(startSize) {
        this.length = 0;
        this.functions = new REQBuilder.Functions();
        this.finish = () => {
            this.writeByte(duk.DVal.EOM);
            // Trim the buffer if needed
            if (this.buf.length > this.length) {
                const retBuf = new Buffer(this.length);
                this.buf.copy(retBuf, 0, 0, this.length);
                this.buf = retBuf;
            }
            return new Buffer(this.buf);
        };
        this.writeByte = (byte) => {
            this.handleWrite(1, new Uint8Array([byte]));
            return this.functions;
        };
        this.writeUnused = () => {
            return this.writeByte(duk.DVal.Unused);
        };
        this.writeUndefined = () => {
            return this.writeByte(duk.DVal.Undefined);
        };
        this.writeNull = () => {
            return this.writeByte(duk.DVal.Null);
        };
        this.writeBoolean = (bool) => {
            return this.writeByte(bool ? duk.DVal.True : duk.DVal.False);
        };
        this.writeInt = (value) => {
            value = Math.floor(value);
            if (value >= 0 && value < 64) {
                return this.writeByte(duk.DVal.Int6 + value);
            }
            else if (value >= 0 && value < 16384) {
                const hi = duk.DVal.Int14 + (value >> 8);
                const lo = value & 0xff;
                this.handleWrite(2, new Uint8Array([hi, lo]));
            }
            else {
                this.handleWrite(5, new Uint8Array([duk.DVal.Int32].concat(this.intToByteArray(value))));
            }
            return this.functions;
        };
        this.writeNumber = (value) => {
            const t = new Buffer(9);
            t.writeUInt8(duk.DVal.Number, 0);
            t.writeDoubleBE(value, 1);
            this.handleWrite(t.length, t);
            return this.functions;
        };
        this.writeString = (str) => {
            if (str === undefined || str.length < 1) {
                return this.writeUndefined();
            }
            else {
                const strBuf = this.encodeString(str);
                let header = new Array();
                if (str.length < 32) {
                    header.push(duk.DVal.Str5 + str.length);
                }
                else if (str.length < 65536) {
                    const hi = str.length >>> 8;
                    const lo = str.length & 0xff;
                    header.push(duk.DVal.Str16, hi, lo);
                }
                else {
                    header.push(duk.DVal.Str32);
                    header = header.concat(this.intToByteArray(str.length));
                }
                // Copy header into data starting at 0
                // Copy strBuf into data right after the header
                const data = new Buffer(header.length + strBuf.length);
                new Buffer(header).copy(data, 0, 0, header.length);
                strBuf.copy(data, header.length, 0, strBuf.length);
                this.handleWrite(data.length, data);
            }
            return this.functions;
        };
        this.writeBuffer = (buf) => {
            let header = new Array();
            if (buf.length < 65536) {
                const hi = buf.length >>> 8;
                const lo = buf.length & 0xff;
                header.push(duk.DVal.Buf16, hi, lo);
            }
            else {
                header.push(duk.DVal.Buf32);
                header = header.concat(this.intToByteArray(buf.length));
            }
            const data = new Buffer(header.length + buf.length);
            new Buffer(header).copy(data, 0, 0, header.length);
            buf.copy(data, header.length, 0, buf.length);
            this.handleWrite(data.length, data);
            return this.functions;
        };
        this.writeObject = (obj) => {
            let data = new Array(duk.DVal.Object, obj.classID, obj.ptr.size);
            if (obj.ptr.size === 8) {
                data = data.concat(this.intToByteArray(obj.ptr.hi));
            }
            data = data.concat(this.intToByteArray(obj.ptr.lo));
            this.handleWrite(data.length, new Uint8Array(data));
            return this.functions;
        };
        this.writePointer = (ptr) => {
            let data = new Array(duk.DVal.Pointer, ptr.size);
            if (ptr.size === 8) {
                data = data.concat(this.intToByteArray(ptr.hi));
            }
            data = data.concat(this.intToByteArray(ptr.lo));
            this.handleWrite(data.length, new Uint8Array(data));
            return this.functions;
        };
        this.writeTValue = (tVal) => {
            switch (tVal.type) {
                case duk.TVal.Unused:
                    this.writeUnused();
                    break;
                case duk.TVal.Undefined:
                    this.writeUndefined();
                    break;
                case duk.TVal.Null:
                    this.writeNull();
                    break;
                case duk.TVal.Boolean:
                    this.writeBoolean(tVal.value);
                    break;
                case duk.TVal.Number:
                    if (Math.floor(tVal.value) !== tVal.value) {
                        this.writeNumber(tVal.value);
                    }
                    else {
                        this.writeInt(tVal.value);
                    }
                    break;
                case duk.TVal.String:
                    this.writeString(tVal.value);
                    break;
                case duk.TVal.Buffer:
                    this.writeBuffer(tVal.value);
                    break;
                case duk.TVal.Object:
                    this.writeObject(tVal.value);
                    break;
                case duk.TVal.Pointer:
                    this.writePointer(tVal.value);
                    break;
                // Anything else not handled
                default:
                    this.writeUndefined();
            }
            return this.functions;
        };
        this.writeTValueMessage = (msg) => {
            for (const tVal of msg) {
                this.writeTValue(tVal);
            }
            return this.functions;
        };
        this.buf = new Buffer(startSize);
        this.functions.writeByte = this.writeByte;
        this.functions.writeUnused = this.writeUnused;
        this.functions.writeUndefined = this.writeUndefined;
        this.functions.writeNull = this.writeNull;
        this.functions.writeBoolean = this.writeBoolean;
        this.functions.writeInt = this.writeInt;
        this.functions.writeNumber = this.writeNumber;
        this.functions.writeString = this.writeString;
        this.functions.writeBuffer = this.writeBuffer;
        this.functions.writeObject = this.writeObject;
        this.functions.writePointer = this.writePointer;
        this.functions.writeTValue = this.writeTValue;
        this.functions.writeTValueMessage = this.writeTValueMessage;
        this.functions.finish = this.finish;
    }
    build() {
        this.length = 0;
        this.writeByte(duk.DVal.REQ);
        return this.functions;
    }
    handleWrite(writeSize, bytes) {
        const required = this.length + writeSize;
        if (required > this.buf.length) {
            const tBuf = new Buffer(required);
            this.buf.copy(tBuf, 0, 0, this.length);
            this.buf = tBuf;
        }
        for (let i = 0; i < writeSize; i++) {
            this.buf.writeUInt8(bytes[i], this.length++);
        }
    }
    encodeString(str) {
        const len = Buffer.byteLength(str, "utf8");
        const buf = new Buffer(len);
        buf.write(str);
        return buf;
    }
    intToByteArray(val) {
        return [
            val >>> 24,
            (val >>> 16) & 0xff,
            (val >>> 8) & 0xff,
            val & 0xff
        ];
    }
}
exports.REQBuilder = REQBuilder;
(function (REQBuilder) {
    /**
     * This allows REQBuilder to return specific functions, rather then the class instance.
     */
    class Functions {
        constructor() {
            this.writeByte = (byte) => { return undefined; };
            this.writeUnused = () => { return undefined; };
            this.writeUndefined = () => { return undefined; };
            this.writeNull = () => { return undefined; };
            this.writeBoolean = (bool) => { return undefined; };
            this.writeInt = (value) => { return undefined; };
            this.writeNumber = (value) => { return undefined; };
            this.writeString = (str) => { return undefined; };
            this.writeBuffer = (buf) => { return undefined; };
            this.writeObject = (obj) => { return undefined; };
            this.writePointer = (ptr) => { return undefined; };
            this.writeTValue = (tVal) => { return undefined; };
            this.writeTValueMessage = (msg) => { return undefined; };
            this.finish = () => { return undefined; };
        }
    }
    REQBuilder.Functions = Functions;
})(REQBuilder = exports.REQBuilder || (exports.REQBuilder = {}));
//# sourceMappingURL=utilities.js.map