"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const duk = require("./constants");
const Utilities = require("./utilities");
/** Duktape debugger reply. */
var Reply;
(function (Reply) {
    /** Basic reply message. */
    class Message {
        constructor(type) {
            this.type = type;
        }
        toString() { return "toString() not implemented."; }
    }
    Reply.Message = Message;
    /** An error response to a request. */
    class Error extends Message {
        constructor(msg, req) {
            super(req);
            assert(msg.length === 4, "ERR: Invalid message format");
            this.error = msg[1].value;
            this.msg = msg[2].value;
        }
        toString() {
            return `error: ${duk.ErrorMessage[this.error]}, msg: ${this.msg}`;
        }
    }
    Reply.Error = Error;
    /** Basic information on the target (such as Duktape version). */
    class BasicInfo extends Message {
        constructor(msg) {
            super(duk.Request.BasicInfo);
            assert(msg.length === 7, "REP BasicInfo: Invalid message format");
            this.version = msg[1].value;
            this.description = msg[2].value;
            this.targetInfo = msg[3].value;
            this.endian = msg[4].value;
            this.ptrSize = msg[5].value;
        }
        toString() {
            let str = `version: ${this.version}\n`;
            str += `description: ${this.description}\n`;
            str += `target info: ${this.targetInfo}\n`;
            str += `endianness: ${this.endian}\n`;
            str += `pointer size: ${this.ptrSize}`;
            return str;
        }
    }
    Reply.BasicInfo = BasicInfo;
    /** A list of Duktape breakpoint indices and their associated filepaths. */
    class ListBreakpoints extends Message {
        constructor(msg) {
            super(duk.Request.ListBreak);
            assert(msg.length === 2 || ((msg.length - 2) % 2) === 0, "REP ListBreak: Invalid message format");
            this.breakpoints = [];
            for (let i = 1; i < (msg.length - 2); i += 2) {
                this.breakpoints.push({
                    filePath: msg[i].value,
                    line: msg[i + 1].value
                });
            }
        }
        toString() {
            let str = "";
            this.breakpoints.forEach((bp, i) => {
                str += `${i}: (${bp.line}) ${bp.filePath}\n`;
            });
            return str;
        }
    }
    Reply.ListBreakpoints = ListBreakpoints;
    /** The index assigned to the added breakpoint. */
    class AddBreakpoint extends Message {
        constructor(msg) {
            super(duk.Request.AddBreak);
            assert(msg.length === 3, "REP AddBreak: Invalid message format");
            this.index = msg[1].value;
        }
        toString() {
            return `index: ${this.index}`;
        }
    }
    Reply.AddBreakpoint = AddBreakpoint;
    /** Whether the variable was found and its value. */
    class GetVariable extends Message {
        constructor(msg) {
            super(duk.Request.GetVar);
            assert(msg.length === 4, "REP GetVariable: Invalid message format");
            this.found = msg[1].value;
            this.value = msg[2].value;
        }
        toString() {
            return `found: ${this.found}, value: ${this.value}`;
        }
    }
    Reply.GetVariable = GetVariable;
    /** Duktape callstack entries listed from top to bottom. */
    class GetCallstack extends Message {
        constructor(msg) {
            super(duk.Request.GetCallstack);
            assert(msg.length === 2 || ((msg.length - 2) % 4) === 0, "REP GetCallstack: Invalid message format");
            this.callstack = new Utilities.Callstack();
            for (let i = 1; i < (msg.length - 4); i += 4) {
                this.callstack.addLine(msg[i].value, msg[i + 1].value, msg[i + 2].value, msg[i + 3].value);
            }
        }
        toString() {
            return this.callstack.toString();
        }
    }
    Reply.GetCallstack = GetCallstack;
    /** The local variables at the requested stack depth. */
    class GetLocals extends Message {
        constructor(msg) {
            super(duk.Request.GetLocals);
            this.variables = new Array();
            assert(msg.length === 2 || ((msg.length - 2) % 2) === 0, "REP GetLocals: Invalid message format");
            for (let i = 1; i < (msg.length - 2); i += 2) {
                this.variables.push({
                    name: msg[i].value,
                    value: msg[i + 1].value
                });
            }
        }
        toString() {
            let str = "";
            for (const v of this.variables) {
                str += `name: ${v.name}, value: ${v.value}\n`;
            }
            return str;
        }
    }
    Reply.GetLocals = GetLocals;
    /** Whether the evaluation was successful and its result. */
    class Eval extends Message {
        constructor(msg) {
            super(duk.Request.Eval);
            assert(msg.length === 4, "REP Eval: Invalid message format");
            this.success = (msg[1].value === 0);
            this.value = msg[2].value;
        }
        toString() {
            return `success: ${this.success}, value: ${this.value}`;
        }
    }
    Reply.Eval = Eval;
    /** The contents of the entire Duktape heap. */
    class DumpHeap extends Message {
        constructor(msg) {
            super(duk.Request.DumpHeap);
            assert(msg.length >= 2, "REP DumpHeap: Invalid message format");
            this.dump = new Array();
            for (let i = 1; i < (msg.length - 2); i++) {
                this.dump.push(msg[i]);
            }
        }
        toString() {
            let str = "";
            for (const e of this.dump) {
                str += `type: ${e.type}, value: ${e.value}\n`;
            }
            str += `size: ${this.dump.length}`;
            return str;
        }
    }
    Reply.DumpHeap = DumpHeap;
    /** App-specific reply to an app-specific request. */
    class AppRequest extends Message {
        constructor(msg) {
            super(duk.Request.AppRequest);
            assert(msg.length >= 2, "REP AppRequest: Invalid message format");
            this.msg = new Array();
            for (let i = 1; i < (msg.length - 1); i++) {
                this.msg.push(msg[i]);
            }
        }
        toString() {
            let str = "";
            for (const e of this.msg) {
                str += `type: ${e.type}, value: ${e.value}\n`;
            }
            return str;
        }
    }
    Reply.AppRequest = AppRequest;
    /** Heap info for the requested object. */
    class GetHeapObjInfo extends Message {
        constructor(msg) {
            super(duk.Request.GetHeapObjInfo);
            assert(msg.length >= 2, "REP GetHeapObjInfo: Invalid message format");
            // Properties
            this.properties = new Array();
            for (let i = 1; i < (msg.length - 1);) {
                const prop = new Utilities.ObjectProperty();
                prop.flags = msg[i++].value;
                prop.key = msg[i++].value;
                if (prop.isAccessor) {
                    prop.type = undefined;
                    prop.value = undefined;
                    prop.getter = msg[i++].value;
                    prop.setter = msg[i++].value;
                }
                else {
                    prop.type = msg[i].type;
                    prop.value = msg[i].value;
                    i++;
                    prop.getter = undefined;
                    prop.setter = undefined;
                }
                this.properties.push(prop);
            }
            // maxPropDescRange & maxPropEntriesRange
            for (let i = 0; i < this.properties.length; i++) {
                if (this.properties[i].key === "e_next") {
                    const e_next = this.properties[i];
                    this.maxPropEntriesRange = e_next.value;
                    for (let j = 0; j < this.properties.length; j++) {
                        if (this.properties[j].key === "a_size") {
                            const a_size = this.properties[j];
                            this.maxPropDescRange = e_next.value + a_size.value;
                        }
                    }
                }
            }
        }
        toString() {
            let str = "";
            for (const prop of this.properties) {
                str += prop.toString() + "\n";
            }
            return str;
        }
    }
    Reply.GetHeapObjInfo = GetHeapObjInfo;
    /** Description of the requested object property. */
    class GetObjPropDesc extends Message {
        constructor(msg) {
            super(duk.Request.GetObjPropDesc);
            assert(msg.length === 5 || msg.length === 6, "REP GetObjPropDesc: Invalid message format");
            if ((msg.length - 2) >= 3) {
                this.property = new Utilities.ObjectProperty();
                this.property.flags = msg[1].value;
                this.property.key = msg[2].value;
                if (this.property.isAccessor) {
                    this.property.type = undefined;
                    this.property.value = undefined;
                    this.property.getter = msg[3].value;
                    this.property.setter = msg[4].value;
                }
                else {
                    this.property.type = msg[3].type;
                    this.property.value = msg[3].value;
                    this.property.getter = undefined;
                    this.property.setter = undefined;
                }
            }
        }
        toString() {
            return this.property.toString();
        }
    }
    Reply.GetObjPropDesc = GetObjPropDesc;
    /** Desription of the requested range of object properties. */
    class GetObjPropDescRange extends Message {
        constructor(msg) {
            super(duk.Request.GetObjPropDescRange);
            assert(msg.length >= 2, "REP GetObjPropDescRange: Invalid message format");
            this.properties = new Array();
            for (let i = 1; i < msg.length - 1;) {
                if ((msg.length - 1 - i) >= 3) {
                    const prop = new Utilities.ObjectProperty();
                    prop.flags = msg[i++].value;
                    prop.key = msg[i++].value;
                    if (prop.isAccessor) {
                        prop.type = undefined;
                        prop.value = undefined;
                        prop.getter = msg[i++].value;
                        prop.setter = msg[i++].value;
                    }
                    else {
                        prop.type = msg[i].type;
                        prop.value = msg[i].value;
                        i++;
                        prop.getter = undefined;
                        prop.setter = undefined;
                    }
                    this.properties.push(prop);
                }
            }
        }
        toString() {
            let str = "";
            for (const prop of this.properties) {
                str += prop.toString() + "\n";
            }
            return str;
        }
    }
    Reply.GetObjPropDescRange = GetObjPropDescRange;
})(Reply = exports.Reply || (exports.Reply = {}));
//# sourceMappingURL=reply.js.map