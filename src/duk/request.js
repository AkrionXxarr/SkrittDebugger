"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const ee = require("events");
const duk = require("./constants");
const dukProto = require("./protocol");
const Utilities = require("./utilities");
const { DValue, TValue } = require("./values");

/** Handles the building and sending of requests to Duktape. */
class Request extends ee.EventEmitter {
    constructor(socket) {
        super();
        this.socket = null;
        this.REQ = new Utilities.REQBuilder(32);
        this.parser = new DValue.Message.Parser();
        this.sentRequests = new Array();
        this._basicInfo = this.formSimple(duk.Request.BasicInfo);
        this._triggerStatus = this.formSimple(duk.Request.TriggerStatus);
        this._pause = this.formSimple(duk.Request.Pause);
        this._resume = this.formSimple(duk.Request.Resume);
        this._stepInto = this.formSimple(duk.Request.StepInto);
        this._stepOver = this.formSimple(duk.Request.StepOver);
        this._stepOut = this.formSimple(duk.Request.StepOut);
        this._listBreakpoints = this.formSimple(duk.Request.ListBreak);
        this._callstack = this.formSimple(duk.Request.GetCallstack);
        this._detach = this.formSimple(duk.Request.Detach);
        this._dumpHeap = this.formSimple(duk.Request.DumpHeap);
        this.socket = socket;
        assert(this.socket);
    }
    formSimple(req) {
        return this.REQ.build().writeInt(req).finish();
    }
    send(req, buf) {
        let promise = null;
        if (this.socket) {
            let resolve;
            let reject;
            promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            this.sentRequests.push({
                request: req,
                promise: promise,
                context: {
                    resolve: resolve,
                    reject: reject
                }
            });
            this.socket.write(buf, () => {
                const commTag = "$<red>[$<default>duktape$<red>] <<$<default>";
                // Finished writing
                this.parser.parseRaw(buf);
                this.emit(dukProto.DebugProtocol.Events.commLog, `${commTag} $<default>(${duk.Request[req]}: ${DValue.Message.stringify(this.parser.current())})`);
            });
        }
        return promise;
    }

    /** Returns the current request from the queue */
    current() {
        return this.sentRequests.shift();
    }

    /** Returns whether there are any requests pending */
    pending() {
        return this.sentRequests.length > 0;
    }

    // Simple requests
    //
    basicInfo() { return this.send(duk.Request.BasicInfo, this._basicInfo); }
    triggerStatus() { return this.send(duk.Request.TriggerStatus, this._triggerStatus); }
    pause() { return this.send(duk.Request.Pause, this._pause); }
    resume() { return this.send(duk.Request.Resume, this._resume); }
    stepInto() { return this.send(duk.Request.StepInto, this._stepInto); }
    stepOver() { return this.send(duk.Request.StepOver, this._stepOver); }
    stepOut() { return this.send(duk.Request.StepOut, this._stepOut); }
    listBreakpoints() { return this.send(duk.Request.ListBreak, this._listBreakpoints); }
    getCallstack() { return this.send(duk.Request.GetCallstack, this._callstack); }
    detach() { return this.send(duk.Request.Detach, this._detach); }
    dumpHeap() { return this.send(duk.Request.DumpHeap, this._dumpHeap); }
    
    // Paramaterized requests
    //
    addBreakpoint(file, line) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.AddBreak)
            .writeString(file)
            .writeInt(line)
            .finish();
        return this.send(duk.Request.AddBreak, buf);
    }
    delBreakpoint(i) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.DelBreak)
            .writeInt(i)
            .finish();
        return this.send(duk.Request.DelBreak, buf);
    }
    getVariable(stackLevel, varName) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.GetVar)
            .writeInt(stackLevel)
            .writeString(varName)
            .finish();
        return this.send(duk.Request.GetVar, buf);
    }
    putVariable(stackLevel, varName, tVal) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.PutVar)
            .writeInt(stackLevel)
            .writeTValue(tVal)
            .writeString(varName)
            .finish();
        return this.send(duk.Request.PutVar, buf);
    }
    getLocals(stackLevel) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.GetLocals)
            .writeInt(stackLevel)
            .finish();
        return this.send(duk.Request.GetLocals, buf);
    }
    eval(expr, stackLevel = -1) {
        let buf;
        if (stackLevel !== null) {
            buf = this.REQ.build()
                .writeInt(duk.Request.Eval)
                .writeInt(stackLevel)
                .writeString(expr)
                .finish();
        }
        else {
            buf = this.REQ.build()
                .writeInt(duk.Request.Eval)
                .writeNull()
                .writeString(expr)
                .finish();
        }
        return this.send(duk.Request.Eval, buf);
    }
    appRequest(msg) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.AppRequest)
            .writeTValueMessage(msg)
            .finish();
        return this.send(duk.Request.AppRequest, buf);
    }
    getHeapObjectInfo(ptr, flags = 0) {
        if (!ptr || (!ptr.lo && !ptr.hi)) {
            const buf = undefined;
            return Promise.reject("Pointer is null.");
        }
        const buf = this.REQ.build()
            .writeInt(duk.Request.GetHeapObjInfo)
            .writePointer(ptr)
            .writeInt(flags)
            .finish();
        return this.send(duk.Request.GetHeapObjInfo, buf);
    }
    getObjPropDesc(ptr, propName) {
        const buf = this.REQ.build()
            .writeInt(duk.Request.GetObjPropDesc)
            .writePointer(ptr)
            .writeString(propName)
            .finish();
        return this.send(duk.Request.GetHeapObjInfo, buf);
    }
    getObjPropDescRange(ptr, iStart, iEnd) {
        if (!ptr || (!ptr.lo && !ptr.hi)) {
            throw new Error("Invalid pointer.");
        }
        const buf = this.REQ.build()
            .writeInt(duk.Request.GetObjPropDescRange)
            .writePointer(ptr)
            .writeInt(iStart)
            .writeInt(iEnd)
            .finish();
        return this.send(duk.Request.GetObjPropDescRange, buf);
    }
}
exports.Request = Request;
//# sourceMappingURL=request.js.map