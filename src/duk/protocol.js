"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const net = require("net");
const ee = require("events");
const duk = require("./constants");
const { Request: REQ } = require("./request");
const { Reply: REP } = require("./reply");
const { Notification: NFY } = require("./notification");
const { DValue, TValue } = require("./values");
const protocolVersion = 2;
/** Handles communication with Duktape. */
class DebugProtocol extends ee.EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.timeoutHandle = null;
        this.numOfReads = 0;
        this.bytesRead = 0;
        this._state = 0 /* Disconnected */;
    }
    get request() { return this._request; }
    /** The state of the protocol */
    get state() { return this._state; }
    /** The paused or running state of Duktape */
    get duktapeState() { return this._duktapeState; }
    /** Basic information on Duktape */
    get basicInfo() { return this._basicInfo; }
    /** The status Duktape responded with on attach */
    get initStatus() { return this._initStatus; }
    get isPaused() { return this.duktapeState === duk.StatusState.Paused; }
    /** Attempt to connect and attach with Duktape */
    attach(ip, port, debuggerVersion) {
        this.log(`Connecting to Duktape on (${ip}:${port})...`);
        if (this._state !== 0 /* Disconnected */) {
            this.log("Already connected or connecting.");
            return;
        }
        this.debuggerVersion = debuggerVersion;
        this.socket = new net.Socket();
        this._state = 1 /* Connecting */;
        // Socket events ---
        this.socket.on("data", (buf) => {
            if (this._state === 2 /* Handshake */) {
                this.handleHandshake(buf);
                return;
            }
            else if (this.state === 0 /* Disconnected */) {
                return;
            }
            this.numOfReads++;
            this.bytesRead += buf.length;
            this.response.parseRaw(buf);
            this.dispatch();
        });
        this.socket.on("close", () => {
            this.log("Socket closed.");
            this.disconnect();
        });
        this.socket.on("error", (err) => {
            this.error(err.toString());
            this.disconnect();
        });
        this.socket.on("timeout", () => {
            this.disconnect();
        });
        this.socket.once("connect", (event) => {
            this.log("Connected, waiting for handshake...");
            this._request = new REQ(this.socket);
            this.response = new DValue.Message.Parser();
            this._state = 2 /* Handshake */;
            this._initStatus = undefined;
            this.timeoutHandle = setTimeout(() => {
                this.error(`Timed out on handshake. Something is listening on ${ip}:${port} but not responding.`);
                this.disconnect();
            }, 5000);
            // Request events ---
            this.request.on(DebugProtocol.Events.commLog, (msg) => {
                this.commLog(msg);
            });
            // ---
        });
        // ---
        this.socket.connect(port, ip);
    }
    /** Disconnect from Duktape (does not try to const Duktape detach) */
    disconnect() {
        if (this.state === 0 /* Disconnected */)
            return;
        if (this.state === 1 /* Connecting */)
            this.log("Aborting connection attempt.");
        else
            this.log("Disconnecting.");
        this._state = 0 /* Disconnected */;
        this.socket.end();
        this.socket.destroy();
        this.socket = null;
        this._request = null;
        this.response = null;
        this.emit(DebugProtocol.Events.detached);
    }
    /** Dispatches all parsed messages */
    dispatch() {
        const commTag = "$<magenta>[$<default>duktape$<magenta>] >>$<default>";
        let msg = this.response.current();
        if (msg) {
            this.debugLog(`Recieved ${this.bytesRead} bytes across ${this.numOfReads} ${(this.numOfReads === 1) ? "reads" : "read"}.`);
            this.bytesRead = 0;
            this.numOfReads = 0;
            this.debugLog("========== Dispatching Messages ==========");
        }
        while (msg !== undefined) {
            switch (msg[0].type) {
                ////////////////////
                // Reply 
                //
                case duk.DVal.REP:
                    {
                        this.commLog(`${commTag} $<default>` + DValue.Message.stringify(msg));
                        const curReq = this.request.current();
                        switch (curReq.request) {
                            case duk.Request.BasicInfo:
                                curReq.context.resolve(new REP.BasicInfo(msg));
                                break;
                            case duk.Request.ListBreak:
                                curReq.context.resolve(new REP.ListBreakpoints(msg));
                                break;
                            case duk.Request.AddBreak:
                                curReq.context.resolve(new REP.AddBreakpoint(msg));
                                break;
                            case duk.Request.GetVar:
                                curReq.context.resolve(new REP.GetVariable(msg));
                                break;
                            case duk.Request.GetCallstack:
                                curReq.context.resolve(new REP.GetCallstack(msg));
                                break;
                            case duk.Request.GetLocals:
                                curReq.context.resolve(new REP.GetLocals(msg));
                                break;
                            case duk.Request.Eval:
                                curReq.context.resolve(new REP.Eval(msg));
                                break;
                            case duk.Request.DumpHeap:
                                curReq.context.resolve(new REP.DumpHeap(msg));
                                break;
                            case duk.Request.AppRequest:
                                curReq.context.resolve(new REP.AppRequest(msg));
                                break;
                            case duk.Request.GetHeapObjInfo:
                                curReq.context.resolve(new REP.GetHeapObjInfo(msg));
                                break;
                            case duk.Request.GetObjPropDesc:
                                curReq.context.resolve(new REP.GetObjPropDesc(msg));
                                break;
                            case duk.Request.GetObjPropDescRange:
                                curReq.context.resolve(new REP.GetObjPropDescRange(msg));
                                break;
                            default:
                                curReq.context.resolve();
                                break;
                        }
                    }
                    break;
                ///////////////////
                // Error
                //
                case duk.DVal.ERR:
                    {
                        this.commLog(`${commTag} $<default>` + DValue.Message.stringify(msg));
                        const curReq = this.request.current();
                        curReq.context.reject(new REP.Error(msg, curReq.request));
                    }
                    break;
                ///////////////////
                // Notify
                //
                case duk.DVal.NFY:
                    {
                        this.commLog(`${commTag} $<default>` + DValue.Message.stringify(msg));
                        switch (msg[1].value) {
                            case duk.Notify.Status:
                                {
                                    const nfy = new NFY.Status(msg);
                                    // const the protocol handle the status before anyone else gets to
                                    if (this.state === 4 /* InitialStatus */) {
                                        this._state = 5 /* Connected */;
                                        this.debugLog("Initial status recieved.");
                                        this._initStatus = nfy;
                                        this._duktapeState = this._initStatus.state;
                                        this.log("Attached and ready!");
                                        this.emit(DebugProtocol.Events.attached);
                                    }
                                    else if (this.state !== 5 /* Connected */) {
                                        this.debugLog("Not properly connected yet, ignoring notification.");
                                    }
                                    else {
                                        this._duktapeState = nfy.state;
                                        this.emit(DebugProtocol.Events.notify, nfy);
                                    }
                                }
                                break;
                            case duk.Notify.Throw:
                                this.emit(DebugProtocol.Events.notify, new NFY.Throw(msg));
                                break;
                            case duk.Notify.Detaching:
                                this.emit(DebugProtocol.Events.notify, new NFY.Detaching(msg));
                                break;
                            case duk.Notify.App:
                                this.emit(DebugProtocol.Events.notify, new NFY.App(msg));
                                break;
                        }
                    }
                    break;
            }
            if (this.state === 0 /* Disconnected */)
                return;
            msg = this.response.current();
        }
    }
    handleHandshake(buf) {
        // It's possible for the status notification to piggyback the handshake.
        // But we request Duktape for its status after verifying the protocol version
        // so it's alright to ignore this extra data.
        this.debugLog("Shaking hands...");
        this._state = 3 /* Verification */;
        let unframed;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 0x0a) {
                this.debugLog("Unframed message extracted.");
                unframed = buf.slice(0, i).toString("utf8");
                const framed = buf.slice(i + 1, buf.length);
                if (framed.length > 0) {
                    this.debugLog("Framed data came with the unframed data, adding to parser.");
                    this.response.parseRaw(framed);
                }
                break;
            }
        }
        if (parseInt(unframed.split(" ")[0]) === protocolVersion) {
            // This function will send the debugger version to the target
            // and listen for a response indicating whether or not it's compatible.
            const validateDebuggerVersion = () => {
                this.debugLog("Sending debugger version to target for validation.");
                const numbers = this.debuggerVersion.split(".");
                const major = parseInt(numbers[0]);
                const minor = parseInt(numbers[1]);
                const patch = parseInt(numbers[2]);
                return this.request.appRequest([
                    TValue.String("ValidateVersion"),
                    TValue.Number(major),
                    TValue.Number(minor),
                    TValue.Number(patch)
                ])
                    .catch((err) => {
                    return Promise.reject(err.toString());
                })
                    .then((rep) => {
                    const compatible = rep.msg[0];
                    if (!DValue.isBoolean(compatible.type))
                        return Promise.reject(`Invalid response format. Expected a boolean, got: ${duk.DVal[compatible.type]}.`);
                    if (!compatible.value)
                        return Promise.reject("Incompatible Version");
                    return Promise.resolve();
                });
            };
            const requestBasicInfo = () => {
                this.debugLog("Requesting basic info...");
                this.request.basicInfo().then((rep) => {
                    this._state = 4 /* InitialStatus */;
                    this.debugLog("Basic info recieved.");
                    this._basicInfo = rep;
                    this.debugLog("Requesting initial status...");
                    this.request.triggerStatus();
                });
            };
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
            this.log("Handshake verified.");
            this.debugLog("Protocol version verified.");
            if (this.debuggerVersion) {
                validateDebuggerVersion()
                    .then(() => {
                    this.log("Version validated.");
                    requestBasicInfo();
                })
                    .catch((errorMsg) => {
                    this.error(errorMsg);
                    this.log("Failed version validation.");
                    this.disconnect();
                    return;
                });
            }
            else {
                requestBasicInfo();
            }
        }
        else {
            this.log("Protocol version invalid.");
            this.disconnect();
        }
    }
    log(msg) {
        this.emit(DebugProtocol.Events.log, msg);
    }
    debugLog(msg) {
        this.emit(DebugProtocol.Events.debugLog, msg);
    }
    commLog(msg) {
        this.emit(DebugProtocol.Events.commLog, msg);
    }
    error(msg) {
        this.emit(DebugProtocol.Events.error, msg);
    }
}
exports.DebugProtocol = DebugProtocol;
(function (DebugProtocol) {
    let Events;
    (function (Events) {
        Events.attached = "duk_proto_onAttach";
        Events.detached = "duk_proto_onDetach";
        Events.notify = "duk_proto_onNotify";
        Events.log = "duk_proto_log";
        Events.debugLog = "duk_proto_debugLog";
        Events.commLog = "duk_proto_commLog";
        Events.error = "duk_proto_error";
    })(Events = DebugProtocol.Events || (DebugProtocol.Events = {}));
})(DebugProtocol = exports.DebugProtocol || (exports.DebugProtocol = {}));
//# sourceMappingURL=protocol.js.map