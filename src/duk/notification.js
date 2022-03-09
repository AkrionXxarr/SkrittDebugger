"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const duk = require("./constants");
/** Duktape debugger notifications. */
var Notification;
(function (Notification) {
    /** Basic notification message. */
    class Message {
        constructor(type) {
            this.type = type;
        }
        toString() { return "toString() not implemented."; }
    }
    Notification.Message = Message;
    /** App-specific notification. */
    class App extends Message {
        constructor(msg) {
            super(duk.Notify.App);
            assert(msg.length >= 3, "NFY App: Invalid message format");
            this.data = new Array();
            for (let i = 2; msg[i].type !== duk.DVal.EOM; i++) {
                this.data.push(msg[i]);
            }
        }
        toString() {
            let str = "";
            for (let i = 0; i < this.data.length; i++) {
                str += `[type: ${duk.DVal[this.data[i].type]}, value: ${this.data[i].value}]`;
                if (i < this.data.length)
                    str += "\n";
            }
            return str;
        }
    }
    Notification.App = App;
    class Detaching extends Message {
        constructor(msg) {
            super(duk.Notify.Detaching);
            assert(msg.length === 4 || msg.length === 5, "NFY Detaching: Invalid message format");
            this.reason = msg[2].value;
            if (msg.length === 5)
                this.message = msg[3].value;
        }
        toString() {
            let str = `reason: ${this.reason}\n`;
            str += `message: ${this.message}\n`;
            return str;
        }
    }
    Notification.Detaching = Detaching;
    class Status extends Message {
        constructor(msg) {
            super(duk.Notify.Status);
            assert(msg.length === 8, "NFY Status: Invalid message format: " + msg.toString());
            this.state = msg[2].value;
            this.fileName = msg[3].value;
            this.funcName = msg[4].value;
            this.lineNumber = msg[5].value;
            this.pc = msg[6].value;
        }
        toString() {
            let str = `state: ${this.state}\n`;
            str += `fileName: ${this.fileName}\n`;
            str += `funcName: ${this.funcName}\n`;
            str += `lineNumber: ${this.lineNumber}\n`;
            str += `pc: ${this.pc}`;
            return str;
        }
    }
    Notification.Status = Status;
    class Throw extends Message {
        constructor(msg) {
            super(duk.Notify.Throw);
            assert(msg.length === 7, "NFY Throw: Invalid message format");
            this.status = msg[2].value;
            this.message = msg[3].value;
            this.fileName = msg[4].value;
            this.lineNumber = msg[5].value;
        }
        toString() {
            let str = `[Duktape] ${this.message}\n`;
            str += `    ├─Throw status: ${duk.ThrowStatus[this.status]}\n`;
            str += `    ├─File: ${this.fileName}\n`;
            str += `    └─Line: ${this.lineNumber}`;
            return str;
        }
    }
    Notification.Throw = Throw;
})(Notification = exports.Notification || (exports.Notification = {}));
//# sourceMappingURL=notification.js.map