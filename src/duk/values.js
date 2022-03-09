"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const duk = require("./constants");
/** Represents a Duktape tagged value */
class TValue {
    get type() { return this._type; }
    get value() { return this._value; }
    constructor(type, value) {
        this._type = type;
        this._value = value;
    }
    static Unused() { return new TValue(duk.TVal.Unused, undefined); }
    static Undefined() { return new TValue(duk.TVal.Undefined, undefined); }
    static Null() { return new TValue(duk.TVal.Null, null); }
    static Boolean(value) { return new TValue(duk.TVal.Boolean, value); }
    static Number(value) { return new TValue(duk.TVal.Number, value); }
    static String(value) { return new TValue(duk.TVal.String, value); }
    static Buffer(value) { return new TValue(duk.TVal.Buffer, value); }
    static Object(classID, ptr) {
        return new TValue(duk.TVal.Object, new TValue.ObjectData(classID, ptr));
    }
    static Pointer(ptr) {
        return new TValue(duk.TVal.Pointer, ptr);
    }
    static LightFunc(value) {
        return new TValue(duk.TVal.Lightfunc, value);
    }
}
exports.TValue = TValue;
(function (TValue) {
    class ObjectData {
        constructor(classID, ptr) {
            this.classID = classID;
            this.ptr = ptr;
        }
        toString() {
            return `{ class: ${duk.HObjectClassNames[this.classID]}, ptr: ${this.ptr.toString()} }`;
        }
    }
    TValue.ObjectData = ObjectData;
    class PointerData {
        constructor(size, lo, hi) {
            assert(size === 4 || size === 8);
            this.size = size;
            this.lo = lo;
            this.hi = hi;
        }
        isNull() {
            return this.size === 0;
        }
        toString() {
            return this.size === 4 ? `0x${this.toHex(this.lo)}`
                : `0x${this.toHex(this.hi)}${this.toHex(this.lo)}`;
        }
        toHex(value) {
            const hex = value.toString(16);
            let padding = "";
            for (let i = 0; i < 8 - hex.length; i++)
                padding += '0';
            return padding + hex;
        }
    }
    TValue.PointerData = PointerData;
    class LightFuncData {
        constructor(flags, ptr) {
            this.flags = flags;
            this.ptr = ptr;
        }
        toString() {
            return `{ flags: ${this.flags}, ptr: ${this.ptr.toString()} }`;
        }
    }
    TValue.LightFuncData = LightFuncData;
})(TValue = exports.TValue || (exports.TValue = {}));
/** Represents a Duktape debugger dvalue */
class DValue {
    get type() { return this._type; }
    get value() { return this._value; }
    constructor(type, value) {
        this._type = type;
        this._value = value;
    }
}
exports.DValue = DValue;
(function (DValue) {
    let Message;
    (function (Message) {
        /** Converts a dvalue message into a string represantion of its contents. */
        function stringify(msg) {
            let str = "";
            for (const e of msg) {
                switch (e.type) {
                    case duk.DVal.EOM:
                        str += "$<blue>EOM$<default>";
                        break;
                    case duk.DVal.REQ:
                        str += "$<blue>REQ $<default>";
                        break;
                    case duk.DVal.REP:
                        str += "$<blue>REP $<default>";
                        break;
                    case duk.DVal.ERR:
                        str += "$<blue>ERR $<default>";
                        break;
                    case duk.DVal.NFY:
                        str += "$<blue>NFY $<default>";
                        break;
                    default:
                        {
                            if (DValue.isBuffer(e.type)) {
                                const buf = e.value;
                                const bufStr = new Array();
                                buf.forEach(val => {
                                    bufStr.push(`0x${val.toString(16)}`);
                                });
                                str += `<$<blue>${duk.DVal[e.type]}$<default>: ${bufStr.join(", ")}> `;
                            }
                            else {
                                str += `<$<blue>${duk.DVal[e.type]}$<default>: ${String(e.value)}> `;
                            }
                        }
                }
            }
            return str;
        }
        Message.stringify = stringify;
        /** Parses a raw byte buffer into a dvalue message. */
        class Parser {
            constructor() {
                this.completedMessages = new Array();
                this.activeMessage = new Array();
                this.unparsedData = new Buffer(0);
                this.index = 0;
            }
            current() {
                return this.completedMessages.shift();
            }
            parseRaw(raw) {
                if (raw.length === 0)
                    return;
                this.appendBuffer(raw);
                this.index = 0;
                let pushedMessage = false;
                /** Build a string from the unparsedData buffer. */
                const toString = (len) => {
                    const arr = new Array(len);
                    for (let j = 0; j < len; j++) {
                        arr[j] = this.unparsedData[this.index + j];
                    }
                    this.index += len;
                    return String.fromCharCode.apply(String, arr);
                };
                /** Build a buffer from the unparsedData buffer */
                const toBuffer = (len) => {
                    const tBuf = new Buffer(len);
                    this.unparsedData.copy(tBuf, 0, this.index, this.index + len);
                    this.index += len;
                    return tBuf;
                };
                /** Build a pointer from the unparsedData buffer */
                const toPointer = (size) => {
                    let lo = 0;
                    let hi = 0;
                    assert(size === 4 || size === 8, `Pointer size not valid: ${size}`);
                    if (size === 8) {
                        hi = this.unparsedData.readUInt32BE(this.index);
                        this.index += 4;
                    }
                    lo = this.unparsedData.readUInt32BE(this.index);
                    this.index += 4;
                    return new TValue.PointerData(size, lo, hi);
                };
                const notEnoughBytes = (n) => {
                    if ((this.unparsedData.length - this.index) > n)
                        return false;
                    return true;
                };
                const push = (type, value) => {
                    this.activeMessage.push(new DValue(type, value));
                    pushedMessage = true;
                };
                // this.index is increased by IB + Data
                //
                // The logic behind the index is to only increment it when a data chunk
                // has been successfully parsed, IB (Initial Byte) included.
                //
                // For example: IB indicates a number (double), so there should be
                // at least 8 bytes following the IB in order to parse the double. It's only after
                // a successful parse that the index is bumped up by 9 (1 for the IB, 8 for the double)
                //
                // Waiting until after a successful parse preserves the IB for the next parse attempt
                // when more data is (hopefully) available.
                do {
                    pushedMessage = false;
                    const IB = this.unparsedData[this.index];
                    if (IB >= duk.DVal.Int14) {
                        /* 0xc0 - 0xff
                        *  int_lg: 0 to 16383
                        *
                        *  op       int
                        *  /\/---------------\
                        *  11xx xxxx xxxx xxxx
                        */
                        if (notEnoughBytes(1))
                            continue;
                        push(duk.DVal.Int14, ((IB - duk.DVal.Int14) << 8) | this.unparsedData[this.index + 1]);
                        this.index += 2;
                        continue;
                    }
                    else if (IB >= duk.DVal.Int6) {
                        /* 0x80 - 0xbf
                        *  int_sm: 0 to 63
                        *
                        *  op  int
                        *  /\/-----\
                        *  10xx xxxx
                        */
                        push(duk.DVal.Int6, (IB - duk.DVal.Int6));
                        this.index++;
                        continue;
                    }
                    else if (IB >= duk.DVal.Str5) {
                        /* 0x60 - 0x7f
                        *  str_len: 0 to 31
                        *
                        *  op   len
                        *  /-\/----\
                        *  011x xxxx
                        */
                        const len = IB - duk.DVal.Str5;
                        if (notEnoughBytes(len))
                            continue;
                        this.index++;
                        push(duk.DVal.Str5, toString(len));
                        continue;
                    }
                    // IB < 0x60
                    switch (IB) {
                        case duk.DVal.EOM:
                            push(IB, IB);
                            this.completedMessages.push(this.activeMessage);
                            this.activeMessage = new Array();
                            this.index++;
                            break;
                        case duk.DVal.REQ:
                        case duk.DVal.REP:
                        case duk.DVal.ERR:
                        case duk.DVal.NFY:
                            push(IB, IB);
                            this.index++;
                            break;
                        case duk.DVal.Int32:
                            if (notEnoughBytes(4))
                                break;
                            push(duk.DVal.Int32, this.unparsedData.readInt32BE(this.index + 1));
                            this.index += 5;
                            break;
                        case duk.DVal.Number:
                            if (notEnoughBytes(8))
                                break;
                            push(duk.DVal.Number, this.unparsedData.readDoubleBE(this.index + 1));
                            this.index += 9;
                            break;
                        case duk.DVal.Str16:
                            {
                                if (notEnoughBytes(2))
                                    break;
                                const len = this.unparsedData.readUInt16BE(this.index + 1);
                                if (notEnoughBytes(len + 2))
                                    break;
                                this.index += 3;
                                push(duk.DVal.Str16, toString(len));
                            }
                            break;
                        case duk.DVal.Str32:
                            {
                                if (notEnoughBytes(4))
                                    break;
                                const len = this.unparsedData.readUInt32BE(this.index + 1);
                                if (notEnoughBytes(len + 4))
                                    break;
                                this.index += 5;
                                push(duk.DVal.Str32, toString(len));
                            }
                            break;
                        case duk.DVal.Buf16:
                            {
                                if (notEnoughBytes(2))
                                    break;
                                const len = this.unparsedData.readUInt16BE(this.index + 1);
                                if (notEnoughBytes(len + 2))
                                    break;
                                this.index += 3;
                                push(duk.DVal.Buf16, toBuffer(len));
                            }
                            break;
                        case duk.DVal.Buf32:
                            {
                                if (notEnoughBytes(4))
                                    break;
                                const len = this.unparsedData.readUInt32BE(this.index + 1);
                                if (notEnoughBytes(len + 4))
                                    break;
                                this.index += 5;
                                push(duk.DVal.Buf32, toBuffer(len));
                            }
                            break;
                        case duk.DVal.Unused:
                            push(IB, undefined);
                            this.index++;
                            break;
                        case duk.DVal.Undefined:
                            push(IB, undefined);
                            this.index++;
                            break;
                        case duk.DVal.Null:
                            push(IB, null);
                            this.index++;
                            break;
                        case duk.DVal.True:
                            push(IB, true);
                            this.index++;
                            break;
                        case duk.DVal.False:
                            push(IB, false);
                            this.index++;
                            break;
                        case duk.DVal.Object:
                            {
                                if (notEnoughBytes(2))
                                    break;
                                const cls = this.unparsedData[this.index + 1];
                                const size = this.unparsedData[this.index + 2];
                                if (notEnoughBytes(size + 2))
                                    break;
                                this.index += 3;
                                push(duk.DVal.Object, new TValue.ObjectData(cls, toPointer(size)));
                            }
                            break;
                        case duk.DVal.Pointer:
                            {
                                if (notEnoughBytes(1))
                                    break;
                                const size = this.unparsedData[this.index + 1];
                                if (notEnoughBytes(size + 1))
                                    break;
                                this.index += 2;
                                push(duk.DVal.Pointer, toPointer(size));
                            }
                            break;
                        case duk.DVal.Lightfunc:
                            {
                                if (notEnoughBytes(3))
                                    break;
                                const flags = this.unparsedData.readUInt16BE(this.index + 1);
                                const size = this.unparsedData[this.index + 3];
                                if (notEnoughBytes(size + 3))
                                    break;
                                this.index += 4;
                                push(duk.DVal.Lightfunc, new TValue.LightFuncData(flags, toPointer(size)));
                            }
                            break;
                        case duk.DVal.HeapPtr:
                            {
                                if (notEnoughBytes(1))
                                    break;
                                const size = this.unparsedData[this.index + 1];
                                if (notEnoughBytes(size + 1))
                                    break;
                                this.index += 2;
                                push(duk.DVal.HeapPtr, toPointer(size));
                            }
                            break;
                    }
                } while (pushedMessage && this.index < this.unparsedData.length);
            }
            appendBuffer(buf) {
                const newBuf = new Buffer((this.unparsedData.length - this.index) + buf.length);
                this.unparsedData.copy(newBuf, 0, this.index, this.unparsedData.length);
                buf.copy(newBuf, (this.unparsedData.length - this.index), 0, buf.length);
                this.unparsedData = newBuf;
            }
        }
        Message.Parser = Parser;
    })(Message = DValue.Message || (DValue.Message = {}));
    /** Check if type is any of the DVal number types */
    function isNumber(type) {
        return (type === duk.DVal.Int6) ||
            (type === duk.DVal.Int14) ||
            (type === duk.DVal.Int32) ||
            (type === duk.DVal.Number);
    }
    DValue.isNumber = isNumber;
    /** Check if type is any of the DVal string types */
    function isString(type) {
        return (type === duk.DVal.Str5) ||
            (type === duk.DVal.Str16) ||
            (type === duk.DVal.Str32);
    }
    DValue.isString = isString;
    /** Check if type is any of the DVal buffer types */
    function isBuffer(type) {
        return (type === duk.DVal.Buf16) || (type === duk.DVal.Buf32);
    }
    DValue.isBuffer = isBuffer;
    function isBoolean(type) {
        return (type === duk.DVal.True || type === duk.DVal.False);
    }
    DValue.isBoolean = isBoolean;
})(DValue = exports.DValue || (exports.DValue = {}));
//# sourceMappingURL=values.js.map