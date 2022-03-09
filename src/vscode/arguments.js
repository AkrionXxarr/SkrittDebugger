"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
class CommonArguments {
    constructor() {
        /** The version of the debugger. */
        this.version = undefined;
        /** The root of all source files */
        this.sourceRoot = undefined;
        /** Automatically stop target after launch. If not specified, target does not stop. */
        this.stopOnEntry = undefined;
        /** Validate the debugger version with the target. */
        this.validateVersion = undefined;
        /** Whether the debugger supports adding cached breakpoints. */
        this.supportsCachedBreakpoints = undefined;
        /** Sets debug log level */
        this.debugLogLevel = undefined;
        /** Add __artificial and __prototype nodes to local variables */
        this.showDebugVariables = undefined;
    }
}
// This interface should always match the schema found in the node-debug extension manifest.
class AttachRequestArguments extends CommonArguments {
    constructor() {
        super(...arguments);
        /** The debug port to attach to. */
        this.port = undefined;
        /** The TCP/IP address of the port (remote addresses only supported for node >= 5.0). */
        this.address = undefined;
        /** VS Code's root directory. */
        this.localRoot = undefined;
    }
}
exports.AttachRequestArguments = AttachRequestArguments;
function checkMissingAttachArguments(args) {
    let str = "";
    let checkProp = (property) => {
        if (args[property] === undefined)
            str += `${property}\n`;
    };
    const t = new AttachRequestArguments();
    for (const key in t) {
        checkProp(key);
    }
    return (str.length > 0) ? str : undefined;
}
exports.checkMissingAttachArguments = checkMissingAttachArguments;
//# sourceMappingURL=arguments.js.map