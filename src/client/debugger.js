"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });

const fs = require("fs");
const os = require("os");
const _path = require("path");
const ts = require("typescript");

const Logger = require("../logger");
const vsAdapt = require("vscode-debugadapter");

const client_util = require("./utilities");
const { Source } = require("./source");
const { Breakpoint } = require("./breakpoint");
const { Path } = require("./path");
const VLQ = require("./vlq");
const { Rejection } = require("./rejection");

const code_args = require("../vscode/arguments");

const { Reply: REP } = require("../duk/reply");
const { DValue, TValue } = require("../duk/values");
const { DebugProtocol } = require("../duk/protocol");
const duk_util = require("../duk/utilities");
const duk_const = require("../duk/constants");

/**
 * The core of the debugger implementation.
 *
 * This class handles all the communication between the VSCode debug session
 * and the Duktape debug protocol.
 */
class DebugClient extends vsAdapt.DebugSession {
    constructor() {
        super();

        this.sessionState = new client_util.SessionState();
        this.updatedSources = new Array();
        this.stopReason = "debugger";
        this.throwData = undefined;
        this.lastThrow = undefined;
        this.sourceRoot = undefined;
        this.ignoreNextPause = false;
        this.handlingSourceLoadedNotify = 0;

        this.logger = new Logger.Logger(this);
        this.logger.setLogLevel(DebugClient.LogLevel.minimum);

        Channels.general.log = this.logger.createChannel("", DebugClient.LogLevel.minimum, this.stdoutLog);
        Channels.general.debug = this.logger.createChannel("", DebugClient.LogLevel.debug, this.consoleLog);
        Channels.general.error = this.logger.createChannel("<Error> ", DebugClient.LogLevel.minimum, this.stderrLog);
        Channels.general.exception = this.logger.createChannel("!! Debugger threw an exception\n", DebugClient.LogLevel.minimum, this.exceptionLog);
        Channels.session.log = this.logger.createChannel("(Session) ", DebugClient.LogLevel.minimum, this.stdoutLog);
        Channels.session.debug = this.logger.createChannel("(Session) ", DebugClient.LogLevel.debug, this.consoleLog);
        Channels.client.log = this.logger.createChannel("(Client) ", DebugClient.LogLevel.minimum, this.stdoutLog, "$<blue>");
        Channels.client.debug = this.logger.createChannel("(Client) ", DebugClient.LogLevel.debug, this.consoleLog, "$<green>");
        Channels.client.warn = this.logger.createChannel("(Client) [Warning] ", DebugClient.LogLevel.warnings, this.consoleLog);
        Channels.client.error = this.logger.createChannel("(Client) <Error> ", DebugClient.LogLevel.minimum, this.stderrLog);
        Channels.protocol.log = this.logger.createChannel("(Protocol) ", DebugClient.LogLevel.minimum, this.stdoutLog, "$<blue>");
        Channels.protocol.debug = this.logger.createChannel("(Protocol) ", DebugClient.LogLevel.debug, this.consoleLog, "$<white>");
        Channels.protocol.comm = this.logger.createChannel("(Protocol) ", DebugClient.LogLevel.commTraffic, this.stdoutLog, "$<cyan>");
        Channels.protocol.error = this.logger.createChannel("(Protocol) <Error> ", DebugClient.LogLevel.minimum, this.stderrLog);

        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
        this.initialize();
    }

    /**
     * Create a debug protocol and defines all the event handlers.
     */
    initialize() {
        this.initializing = true;
        this.protocol = new DebugProtocol();

        // Protocol detatched handler
        this.protocol.once(DebugProtocol.Events.detached, () => {
            Channels.client.debug("Protocol reports Duktape detached.");
            this.sendEvent(new vsAdapt.TerminatedEvent());
            delete this.protocol;
        });

        // Duktape notification handler
        this.protocol.on(DebugProtocol.Events.notify, (nfy) => {
            switch (nfy.type) {
                case duk_const.Notify.App:
                    this.handleAppNotification(nfy);
                    break;
                case duk_const.Notify.Detaching:
                    Channels.client.debug("Detaching notification.");
                    break;
                case duk_const.Notify.Status:
                    this.handleStatusNotification(nfy);
                    break;
                case duk_const.Notify.Throw:
                    this.handleThrowNotification(nfy);
                    break;
                default:
                    Channels.client.debug(nfy.toString());
                    break;
            }
        });

        // Protocol log handlers
        this.protocol.on(DebugProtocol.Events.log, (msg) => Channels.protocol.log(msg));
        this.protocol.on(DebugProtocol.Events.debugLog, (msg) => Channels.protocol.debug(msg));
        this.protocol.on(DebugProtocol.Events.commLog, (msg) => Channels.protocol.comm(msg));
        this.protocol.on(DebugProtocol.Events.error, (msg) => Channels.protocol.error(msg));

        process.on("unhandledRejection", (err) => {
            if (!err)
                Channels.general.exception("Undefined error.");
            else
                Channels.general.exception(err.stack || err.toString());
        });

        process.on("uncaughtException", (err) => {
            if (!err)
                Channels.general.exception("Undefined error.");
            else
                Channels.general.exception(err.stack || err.toString());
        });
    }

    /////////////////////////////////////////////////
    // VSCode debug session methods
    //

    /**
     * Defines what the debugger can and can not do.
     *
     * This is the very first request to be sent when the user starts debugging.
     */
    initializeRequest(res, args) {
        // Skritt, becasue why not?
        Channels.general.log("  ___________           .__  __    __   ", " /   _____/  | _________|__|/  |__/  |_ ", " \\_____  \\|  |/ /\\_  __ \\  \\   __\\   __\\", " /        \\    <  |  | \\/  ||  |  |  |  ", "/_______  /__|_ \\ |__|  |__||__|  |__|  ", "        \\/     \\/                       ");
        Channels.session.debug("Initializing...");

        res.body.supportsConfigurationDoneRequest = true;
        res.body.supportsFunctionBreakpoints = false;
        res.body.supportsEvaluateForHovers = false;
        res.body.supportsStepBack = false;
        res.body.supportsRestartRequest = true;
        res.body.supportsRestartFrame = false;
        res.body.supportsExceptionInfoRequest = false;
        res.body.supportsConditionalBreakpoints = true;
        res.body.supportsHitConditionalBreakpoints = true;
        res.body.supportsLogPoints = false;
        res.body.supportsDelayedStackTraceLoading = false;

        this.sendResponse(res);
    }

    /**
     * Called when the debugger is attempting to disconnect from the VSCode side.
     */
    disconnectRequest(res, args) {
        Channels.session.debug("Requesting disconnect...");
        if (!this.protocol) {
            Channels.client.debug("Protocol already disconnected.");
            this.sendResponse(res);
            return;
        }

        // 1. Get a list of breakpoints from Duktape.
        // 2. Remove the breakpoints.
        // 3. Attempt to let Duktape detach itself before timing out.
        // 4. Instruct the protocol to disconnect.
        // 5. Respond to the session.
        this.removeAllTargetBreakpoints()
            .then(() => {
            const timeout = setTimeout(() => {
                clearTimeout(timeout);

                // At this point, if the detach was successful, the protocol should have been deleted.
                if (!this.protocol) {
                    Channels.client.debug("The protocol detached before responding to the request.");
                    this.sendResponse(res);
                    return;
                }

                Channels.client.debug("Detach failed. Forcibly disconnecting protocol...");
                this.protocol.disconnect();
                this.sendResponse(res);
                Channels.client.debug("Session informed.");
            }, 1000);

            Channels.client.debug("Attempting to detach...");
            this.protocol.request.detach()
                .then(() => {
                if (this.protocol.state === 0 /* Disconnected */)
                    return;

                Channels.client.debug("Detach successful, disconnecting protocol...");
                this.protocol.disconnect();
                this.sendResponse(res);
                Channels.client.debug("Session informed.");
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        })
            .catch((err) => {
            this.throwIfBad(err);
            this.sendRequestFailed(res, err.toString());
        });
    }

    /**
     * Called when the launch.json request type is "launch".
     *
     * This is not supported.
     */
    launchRequest(res, args) {
        throw new Error("Launch not supported.");
    }

    /**
     * Called when the launch.json request type is "attach".
     *
     * Takes care of the attach arguments as well as getting the duktape protocol
     * attached to the runtime. On successful attach both the client and the target
     * are cleaned up before sending an initialized event to the session.
     */
    attachRequest(res, args) {
        this.logger.setLogLevel(args.debugLogLevel);
        Channels.session.debug("Requesting attach...");
        Channels.client.debug("Checking for missing arguments...");

        const missingArgs = code_args.checkMissingAttachArguments(args);
        if (missingArgs) {
            Channels.general.error("Arguments missing from launch.json:", missingArgs);
            this.sendErrorResponse(res, 0, "Attach failed: Arguments missing from launch.json");
            return;
        }

        if (args.localRoot === "") {
            this.sendRequestFailed(res, "Must specify a local root.");
            return;
        }

        this.protocol.once(DebugProtocol.Events.attached, () => {
            Channels.client.debug("Protocol reports Duktape attached.");
            this.sessionState.clear();
            // Make sure Duktape's breakpoint list is clear
            this.removeAllTargetBreakpoints()
                .then(() => {
                this.sendResponse(res);
                this.sendEvent(new vsAdapt.InitializedEvent());
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
                Channels.client.debug("Error encountered before initialization could finish, terminating...");
                this.sendEvent(new vsAdapt.TerminatedEvent());
            });
        });

        Channels.general.log(`Version: $<green>${args.version}`);
        this.attachArgs = args;
        args.localRoot = Path.normalize(args.localRoot);
        args.sourceRoot = Path.normalize(args.sourceRoot);

        Channels.client.debug("Resolving source root...");
        if (!args.sourceRoot || args.sourceRoot.length < 1) {
            Channels.client.log(`No source root defined, setting source root to local root:`, args.localRoot);
            this.sourceRoot = args.localRoot;
        }
        else if (args.sourceRoot.split(_path.sep).length === 1) {
            Channels.client.log(`Scanning up from local root for first occurance of "${args.sourceRoot}" directory...`);

            const builtPath = [];
            for (const segment of args.localRoot.split("/")) {
                builtPath.push(segment);
                if (segment === args.sourceRoot) {
                    this.sourceRoot = Path.normalize(builtPath.join("/"));
                    Channels.client.log(`Directory found, setting source root:`, `[${args.localRoot}] -> [${this.sourceRoot}]`);
                    break;
                }
            }

            if (!this.sourceRoot) {
                Channels.client.error(`Could not find "${args.sourceRoot}" in local root directory:`);
                Channels.general.log(args.localRoot);
                this.sendRequestFailed(res, "Couldn't initialize source root.");
                this.sendEvent(new vsAdapt.TerminatedEvent());
                return;
            }
        }
        else {
            Channels.client.log(`Setting source root to user-defined path:`, args.sourceRoot);
            this.sourceRoot = args.sourceRoot;
        }

        this.sourceRegistry = new Source.Registry(this.sourceRoot);
        this.bpRegistry = new Breakpoint.DataRegistry(this.sourceRoot);
        this.unverifiedBreakpoints = new Path.Map(this.sourceRoot);
        this.protocol.attach(args.address, args.port, (args.validateVersion) ? args.version : undefined);
    }

    /**
     * Called when the user issues a restart request.
     *
     * This is not supported.
     */
    restartRequest(res, args) {
        Channels.session.debug("Requesting restart...");
        Channels.client.debug("Not currently handling restart requests.");
        this.sendResponse(res);
    }

    /**
     * Called when the debugger attaches and there are breakpoints set, or when
     * the user adds or removes a breakpoint.
     */
    setBreakPointsRequest(res, args) {
        Channels.session.debug("Requesting set breakpoints...");

        const filePath = Path.normalize(args.source.path);
        let srcData = this.sourceRegistry.get(filePath);
        // A (hopefully temporary) workaround to args.source.name coming in undefined
        if (!args.source.name)
            args.source.name = _path.basename(args.source.path);

        if (!srcData) {
            Channels.client.debug("Requesting source data from Duktape...");

            this.requestSourceData(filePath)
                .then((rep) => {
                srcData = rep;
                handleAddBreakpoints.call(this);
            })
                .catch((err) => {
                this.throwIfBad(err);
                const unverified = [];
                res.body = {
                    breakpoints: []
                };

                for (let i = 0; i < args.breakpoints.length; i++) {
                    const bp = new vsAdapt.Breakpoint(false, args.breakpoints[i].line);

                    bp.message = (this.attachArgs.supportsCachedBreakpoints)
                        ? "Cached for loading when source becomes available."
                        : "Source map not available.";
                    bp.id = Breakpoint.getId();
                    bp.verified = false;

                    res.body.breakpoints.push(bp);
                    unverified.push({
                        srcBp: args.breakpoints[i],
                        bp: bp
                    });
                }

                if (!this.attachArgs.supportsCachedBreakpoints) {
                    Channels.client.error(`Unable to set breakpoints for: ${args.source.name}`);
                    Channels.client.log(`Source may not yet be loaded in Duktape.`);
                }
                else {
                    Channels.client.debug(`Caching breakpoints for: $<red>${args.source.name}`);
                    // Overwrite previous unverified breakpoints.
                    this.unverifiedBreakpoints.delete(filePath);
                    this.unverifiedBreakpoints.set(filePath, unverified);
                }
                this.sendResponse(res);
            });
        }
        else {
            if (args.sourceModified) {
                Channels.client.debug("Source has been modified, queuing request for expected source map notification...");
                this.updatedSources.push({ res: res, args: args });
            }
            else {
                handleAddBreakpoints.call(this);
            }
        }

        /////////////////////////
        // Closure Functions
        //
        /**
         * Handles the building, removing, and adding of breakpoints
         */
        function handleAddBreakpoints() {
            this.removeAllTargetBreakpointsForSource(srcData)
                .then(() => {
                const hitCountMap = this.buildBreakpointHitCountMap(filePath);
                const breakpoints = this.buildBreakpoints(srcData, args.breakpoints);

                Channels.client.debug("Adding breakpoints to Duktape...");
                this.addBreakpointsToDuktape(srcData, breakpoints.concat(), hitCountMap)
                    .then(() => {
                    res.body = {
                        breakpoints: breakpoints
                    };

                    this.sendResponse(res);
                    Channels.client.debug("New breakpoint list sent to session.");
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    this.sendRequestFailed(res, err.toString());
                });
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
    }

    /**
     * Build a map of hit count values for conditional hit breakpoints from the
     * breakpoint registry.
     */
    buildBreakpointHitCountMap(filePath) {
        Channels.client.debug("Building breakpoint hit count map...");

        const hitCountMap = new Map();
        // Because all the breakpoints are cleared and re-added, check for whether
        // any breakpoints have hit conditions and store their counter so as to not
        // reset the hit count breakpoints whenever a breakpoint is added or removed.
        const bpDataArray = this.bpRegistry.get(filePath);
        if (bpDataArray) {
            for (const data of bpDataArray) {
                const bp = data.breakpoint;
                if (bp.conditionData && (bp.conditionData.type === "hit")) {
                    const hitCondition = bp.conditionData.payload;
                    if (!hitCountMap.has(bp.line))
                        hitCountMap.set(bp.line, hitCondition.count);
                }
            }
        }

        return hitCountMap;
    }

    /**
     * Parse source breakpoints into client breakpoints. This includes moving
     * or invalidating breakpoints found on invalid lines.
     */
    buildBreakpoints(srcData, srcBreakpoints) {
        Channels.client.debug("Building breakpoints...");

        const breakpoints = new Array();
        // Walk through all the breakpoints provided in args and add them to the breakpoints array.
        // Move or invalidate any breakpoints found on invalid lines.
        const allValidLines = client_util.buildValidBreakpointLines(srcData);
        srcBreakpoints.forEach((srcBp, index) => {
            const oldLine = srcBp.line;
            let i = srcBp.line - 1;
            let moved = false;

            const pushBreakpoint = (bp) => {
                if (srcBp.condition) {
                    bp.conditionData = {
                        type: "conditional",
                        payload: srcBp.condition
                    };
                }
                else if (srcBp.hitCondition) {
                    bp.conditionData = {
                        type: "hit",
                        payload: {
                            condition: parseInt(srcBp.hitCondition),
                            count: 0
                        }
                    };
                }

                bp.source = new vsAdapt.Source(_path.basename(srcData.vsCodePath), srcData.vsCodePath);
                bp.id = Breakpoint.getId();
                breakpoints.push(bp);
            };

            while (!allValidLines[i] && i < allValidLines.length) {
                moved = true;
                i++;
            }

            const newLine = i + 1;
            if (i < allValidLines.length && moved) {
                // Check whether a breakpoint was already put on client line
                for (i = 0; i < breakpoints.length; i++) {
                    if (breakpoints[i].line === newLine)
                        break;
                }

                if (i === breakpoints.length) {
                    // No breakpoint found on client line.
                    pushBreakpoint(new vsAdapt.Breakpoint(true, newLine));
                    if (!this.initializing)
                        Channels.session.log(`Breakpoint moved to nearest valid line: $<green>(${oldLine} -> ${newLine})`);
                }
                else if (moved) {
                    Channels.session.debug(`Breakpoint (${oldLine}) couldn't be moved to valid line (another already exists there).`);
                    const bp = new vsAdapt.Breakpoint(false, oldLine);
                    bp.message = "Couldn't be moved (another already exists).";
                    pushBreakpoint(bp);
                }
            }
            else if (i < allValidLines.length && !moved) {
                // Breakpoint was already on a valid line.
                // Check whether a breakpoint was already put on client line.
                for (i = 0; i < breakpoints.length; i++) {
                    if (breakpoints[i].line === newLine)
                        break;
                }

                if (i === breakpoints.length) {
                    // No breakpoint was put on this line.
                    pushBreakpoint(new vsAdapt.Breakpoint(true, newLine));
                }
                else {
                    // There was already a breakpoint here, switch their places
                    // to appease VSCode's breakpoint order. 
                    const bp = breakpoints[i]; // The breakpoint being switched out
                    bp.line = srcBreakpoints[i].line; // Set the line back to its old line
                    bp.verified = false;
                    bp.message = "Couldn't be moved (another already exists).";

                    Channels.session.debug(`Breakpoint (${bp.line}) couldn't be moved to valid line (another already exists there).`);
                    // Add the new breakpoint in the other's place.
                    pushBreakpoint(new vsAdapt.Breakpoint(true, newLine));
                }
            }
            else {
                Channels.session.debug(`Breakpoint (${oldLine}) couldn't be moved to valid line (end of file).`);
                const bp = new vsAdapt.Breakpoint(false, oldLine);
                bp.message = "Couldn't be moved (end of file).";
                pushBreakpoint(bp);
            }
        });
        return breakpoints;
    }

    /**
     * Recursively sends add breakpoint requests with relevant data to Duktape.
     * If a request is successful, the breakpoint is stored in a registry.
     */
    addBreakpointsToDuktape(srcData, breakpoints, hitCountMap) {
        const bp = breakpoints.pop();
        if (!bp)
            return Promise.resolve();
        if (bp.verified) {
            if (!srcData.lineMap) {
                return Promise.reject(new Rejection.Error("No source map available."));
            }

            const mappedLine = srcData.typescriptToJavascript(bp.line);
            if (!mappedLine.line) {
                bp.verified = false;
                bp.message = "Not a valid line.";
                return this.addBreakpointsToDuktape(srcData, breakpoints, hitCountMap);
            }

            Channels.client.debug(`${bp.line} -> ${mappedLine.line}`);
            bp.mappedLine = mappedLine.line;

            // Recursively add the breakpoints.
            return this.protocol.request.addBreakpoint(Path.toPlatformSep(srcData.duktapePath), mappedLine.line)
                .then((res) => {
                const bpData = {
                    breakpoint: bp,
                    vsCodePath: srcData.vsCodePath,
                    duktapePath: srcData.duktapePath,
                    dukBpIndex: duk_util.BreakpointIndex.create()
                };

                this.bpRegistry.push(bpData);
                return this.addBreakpointsToDuktape(srcData, breakpoints, hitCountMap);
            })
                .catch((err) => {
                this.throwIfBad(err);
                Channels.client.warn(`Breakpoint(${bp.toString()}) failed to add.`);
                bp.verified = false;
                bp.message = "Duktape failed to add breakpoint.";
                return this.addBreakpointsToDuktape(srcData, breakpoints, hitCountMap);
            });
        }
        return this.addBreakpointsToDuktape(srcData, breakpoints, hitCountMap);
    }

    /**
     * Called once everything involved in the "configuration" phase (e.g. setBreakPointsRequest)
     * is complete and the session is ready.
     */
    configurationDoneRequest(res, args) {
        Channels.session.debug("Requesting configuration done...");

        this.initializing = false;
        if (this.attachArgs.stopOnEntry) {
            Channels.client.debug("Setting initial state to paused.");
            this.protocol.request.appRequest([TValue.String("Pause")])
                .then(() => {
                Channels.session.log("Initialized and ready!\n");
                this.sendResponse(res);
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            Channels.client.debug("Setting initial state to running.");
            this.protocol.request.resume()
                .then(() => {
                Channels.session.log("Initialized and ready!\n");
                this.sendResponse(res);
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
    }

    /**
     * Called when the user issues a "Continue" command.
     */
    continueRequest(res, args) {
        Channels.session.debug("Requesting continue...");

        if (this.protocol.isPaused) {
            this.protocol.request.resume()
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            this.sendRequestFailed(res, "Already running.");
        }

        // sendResponse() is called here to make the session happy.
        // This effectively changes the UI state to running/paused, but the
        // duktape protocol will have final say on the actual debug state 
        // when it sends a notification, meaning the result of this
        // sendResponse() call is essentially ignored.
        this.sendResponse(res);
    }

    /**
     * Called when the user issues a "Step Over" command.
     */
    nextRequest(res, args) {
        Channels.session.debug("Requesting step over...");

        if (this.protocol.isPaused) {
            this.stopReason = "step over";
            this.protocol.request.stepOver()
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            this.sendRequestFailed(res, "Can't step over when not paused.");
        }

        // See the comment in continueRequest()
        this.sendResponse(res);
    }

    /**
     * Called when the user issues a "Step In" command.
     */
    stepInRequest(res, args) {
        Channels.session.debug("Requesting step in...");

        if (this.protocol.isPaused) {
            this.stopReason = "step in";
            this.protocol.request.stepInto()
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            this.sendRequestFailed(res, "Can't step in when not paused.");
        }

        // See the comment in continueRequest()
        this.sendResponse(res);
    }

    /**
     * Called when the user issues a "Step Out" command.
     */
    stepOutRequest(res, args) {
        Channels.session.debug("Requesting step out...");
        
        if (this.protocol.isPaused) {
            this.stopReason = "step out";
            this.protocol.request.stepOut()
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            this.sendRequestFailed(res, "Can't step out when not paused.");
        }

        // See the comment in continueRequest()
        this.sendResponse(res);
    }

    /**
     * Called when the user issues a "Pause" command.
     */
    pauseRequest(res, args) {
        Channels.session.debug("Requesting pause...");

        if (!this.protocol.isPaused) {
            this.stopReason = "pause";
            this.protocol.request.appRequest([TValue.String("Pause")])
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }
        else {
            this.sendRequestFailed(res, "Already paused.");
        }

        // See the comment in continueRequest()
        this.sendResponse(res);
    }

    ///////////////////////////////////////////////////////////////////////////
    // The following 5 functions are part of a series of function calls
    // which occur after sending the session a "StoppedEvent".
    //
    // The order of function calls is as follows:
    //  1. threadsRequest
    //  2. stackTraceRequest
    //  3. evaluateRequest (for watch list variables)
    //  4. scopesRequest
    //  5. variablesRequest
    //

    /**
     * Called when the session recieves a "StoppedEvent".
     *
     * This is the first function called after a "StoppedEvent".
     */
    threadsRequest(res) {
        Channels.session.debug("Requesting threads...");

        res.body = {
            threads: [new vsAdapt.Thread(DebugClient.THREAD_ID, "Main Thread")]
        };

        this.sendResponse(res);
    }

    /**
     * Called after "threadsRequest" when the session recieves a "StoppedEvent".
     *
     * Builds the current callstack. VSCode sets the user's source and line view
     * as a result of this function's response, using the top of the callstack.
     */
    stackTraceRequest(res, args) {
        Channels.session.debug("Requesting stack trace...");

        if (!this.protocol.isPaused) {
            this.sendRequestFailed(res, "Can't obtain stacktrace while running.");
            return;
        }

        const frames = new Array();

        Channels.client.debug("Retrieving callstack...");
        this.protocol.request.getCallstack()
            .then((val) => {
            frames.length = val.callstack.length;

            Channels.client.debug("Converting callstack into stackframes...");
            convertCallstack.call(this, val.callstack, 0)
                .then(() => {
                Channels.client.debug("Formatting stackframes...");
                formatStackframe.call(this, 0);
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err);
            });
        })
            .catch((err) => {
            this.throwIfBad(err);
            Channels.client.error(`Stack trace failed: ${err}`);
            res.body = {
                stackFrames: []
            };

            this.sendResponse(res);
        });

        /////////////////////////
        // Closure Functions
        //

        /**
         * Recursively converts a Duktape callstack into VSCode stackframes
         */
        function convertCallstack(callstack, i) {
            if (i >= callstack.length)
                return Promise.resolve();

            const entry = callstack.get[i];
            let srcData = this.sourceRegistry.get(entry.fileName);
            const line = this.convertDebuggerLineToClient(entry.lineNumber);
            let srcPos = {
                name: "",
                path: "",
                line: undefined
            };

            const buildFrame = () => {
                const frame = new client_util.StackFrame(srcData, srcPos.name, srcPos.path, entry.funcName, srcPos.line, entry.pc, -i - 1, null);
                frame.handle = this.sessionState.stackFrames.create(frame);
                frames[i] = frame;
            };

            if (!srcData) {
                if (_path.extname(entry.fileName) === ".js") {
                    Channels.client.debug("Requesting source data from Duktape...");
                    const filePath = _path.join(this.sourceRoot, entry.fileName.replace(/\.[^.]+$/g, ".ts"));
                    return this.requestSourceData(filePath)
                        .then((rep) => {
                        srcData = rep;
                        srcPos = srcData.javascriptToTypescript(line);

                        buildFrame();
                        return convertCallstack.call(this, callstack, i + 1);
                    })
                        .catch((err) => {
                        this.throwIfBad(err);
                        Channels.client.error(`Callstack source request failed for: ${_path.basename(filePath)}`);
                        Channels.client.log(`Source (${_path.basename(filePath)}) may not yet be loaded in Duktape.`);
                        this.sendRequestFailed(res, err);
                        return Promise.reject(new Rejection.Error("Request source data failed."));
                    });
                }
                else {
                    Channels.client.debug(`File name not a js file (${entry.fileName}), creating basic stack frame...`);
                    srcPos.name = undefined;
                    srcPos.path = undefined;
                    srcPos.line = undefined;
                    buildFrame();
                    return convertCallstack.call(this, callstack, i + 1);
                }
            }
            else {
                srcPos = srcData.javascriptToTypescript(line);

                // For some reason there isn't a TS line mapped to this JS line
                if (srcPos.line == undefined) {
                    srcPos.path = srcData.vsCodePath;
                    srcPos.line = 0;
                }
                buildFrame();
                return convertCallstack.call(this, callstack, i + 1);
            }
        }

        /**
         * Recusrively formats each stackframe
         */
        function formatStackframe(index) {
            if (index < frames.length) {
                this.getObjectConstructorByName("this", frames[index].depth)
                    .then((c) => {
                    if (frames[index].functionName === c) {
                        frames[index].className = frames[index].functionName;
                        frames[index].functionName = "constructor";
                    }
                    else {
                        frames[index].className = c;
                    }
                    formatStackframe.call(this, index + 1);
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    this.sendRequestFailed(res, err);
                });
            }
            else {
                Channels.client.debug("Building the response body...");
                finalizeResponse.call(this);
            }
        }

        /**
         * Builds and sends the response body.
         */
        function finalizeResponse() {
            res.body = {
                stackFrames: new Array()
            };

            const length = Math.min(frames.length, args.levels);
            for (let i = 0; i < length; i++) {
                const frame = frames[i];
                let src = undefined;
                let className = "";
                let funcName = "";
                let name = "";
                let presentationHint = "normal";

                if (!frame.fileName) {
                    funcName = "[Duktape Runtime]";
                    presentationHint = "subtle";
                }
                else {
                    className = (frame.className === "") ? "" : frame.className + ".";
                    funcName = (frame.functionName === "") ? "(() => { })" : frame.functionName + "()";
                }

                name = className + funcName;

                if (frame.source) {
                    src = new vsAdapt.Source(frame.fileName, frame.filePath, 0);
                    if (!frame.lineNumber) {
                        presentationHint = "label";
                        name += " -- Line not available";
                    }
                }

                // Use the subtle presentation hint for frames that don't have a source.
                res.body.stackFrames.push({
                    id: frame.handle,
                    name: name,
                    line: frame.lineNumber,
                    column: 0,
                    source: src,
                    presentationHint: presentationHint
                });
            }

            res.body.totalFrames = res.body.stackFrames.length;
            this.sendResponse(res);
        }
    }

    /**
     * Called after "evaluateRequest" (for the watch list) when the session recieves a "StoppedEvent".
     *
     * Builds up all the scope variables. Duktape currently only supports locals.
     */
    scopesRequest(res, args) {
        Channels.session.debug("Requesting scopes...");

        if (!this.protocol.isPaused) {
            this.sendRequestFailed(res, "Can't obtain scopes while running.");
            return;
        }

        const stackFrame = this.sessionState.stackFrames.get(args.frameId);
        const scope = new client_util.Scope("Local", stackFrame, null);
        scope.handle = this.sessionState.scopes.create(scope);
        this.sessionState.localScope = scope.handle;
        stackFrame.scope = scope;
        const scopes = new Array();

        Channels.client.debug("Getting locals...");
        this.protocol.request.getLocals(stackFrame.depth)
            .then((rep) => {
            const keys = new Array();
            const values = new Array();

            for (const v of rep.variables) {
                keys.push(v.name);
                values.push(v.value);
            }

            return this.isGlobalObject(stackFrame.depth)
                .then((isGlobal) => {
                if (!isGlobal)
                    keys.unshift("this");
                return this.expandScopeProperties(keys, values, scope)
                    .then((props) => {
                    scopes.push(new vsAdapt.Scope(props.scope.name, props.handle, false));
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    return Promise.reject(err);
                });
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        })
            .then(() => {
            res.body = {
                scopes: scopes
            };

            this.sendResponse(res);
        })
            .catch((err) => {
            this.throwIfBad(err);
            this.sendRequestFailed(res, `Failed to request local scopes: ${String(err)}`);
            res.body = { scopes: [] };
        });
    }

    /**
     * Called after "scopesRequest" when the session recieves a "StoppedEvent".
     *
     * This is the last function called after a "StoppedEvent".
     *
     * Builds and sorts all the variables to be displayed in the "Variables" section.
     * Property sets are recursively expanded, and inherited variables are added to leaf classes.
     */
    variablesRequest(res, args) {
        Channels.session.debug("Requesting variables...");

        if (args.variablesReference === 0)
            throw new Error("Variable reference must not be zero.");

        const properties = this.sessionState.varHandles.get(args.variablesReference);
        if (!properties) {
            Channels.client.debug("Properties undefined.");
            res.body = {
                variables: []
            };
            this.sendResponse(res);
            return;
        }

        const scope = properties.scope;
        const frame = scope.stackFrame;
        if (properties.type === client_util.PropertySet.Type.Scope) {
            returnVars.call(this, scope.properties.variables);
            Channels.client.debug("Variables obtained from scope.");
        }
        else if (properties.type >= client_util.PropertySet.Type.Object) {
            this.expandPropertySubset(properties)
                .then(() => {
                returnVars.call(this, properties.variables);
                Channels.client.debug("Variables obtained from property subset.");
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, err.toString());
            });
        }

        /////////////////////////
        // Closure Functions
        //

        /**
         * Sort the variables and send response.
         */
        function returnVars(vars) {
            Channels.client.debug("Sorting variables...");
            if (properties.type !== client_util.PropertySet.Type.Artificials) {
                vars.sort((a, b) => {
                    const aNum = Number(a.name);
                    const bNum = Number(b.name);
                    const aIsNum = !isNaN(aNum);
                    const bIsNum = !isNaN(bNum);

                    if (!aIsNum && bIsNum) {
                        return -1;
                    }
                    else if (aIsNum && !bIsNum) {
                        return 1;
                    }
                    else if (aIsNum && bIsNum) {
                        return (aNum < bNum) ? -1 : ((aNum > bNum) ? 1 : 0);
                    }

                    if (a.name[0] === "_")
                        return -1;
                    if (b.name[0] === "_")
                        return 1;
                    if (a.name === "this")
                        return -1;
                    if (b.name === "this")
                        return 1;

                    return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0);
                });
            }

            Channels.client.debug("Done.");
            res.body = {
                variables: vars
            };

            this.sendResponse(res);
        }
    }

    /**
     * Called either after "stackTraceRequest" when the session recieves a "StoppedEvent"
     * to handle watchlist variables, or when the user issues a REPL command.
     *
     * REPL commands which contain a leading "--" are handled as custom commands and
     * are not sent to Duktape. All other commands are handled as evaluations.
     *
     * Watchlist commands kick off a sequence of events very similar to "variablesRequest"
     * except it populates the "Watch" section.
     */
    evaluateRequest(res, args) {
        let exp = args.expression;
        if (!exp || exp.length < 1) {
            this.sendRequestFailed(res, "Invalid expression.");
            return;
        }

        if (args.context === "repl") {
            if (exp[0] === "-" && exp[1] === "-") {
                this.sendResponse(this.handleCustomRepl(res, exp));
            }
            else {
                Channels.session.debug("Requesting evaluate for repl command...");
                Channels.client.debug(`Expression: $<red>${exp}`);
                Channels.client.debug("frameID: $<red>" + args.frameId);

                let frame = this.sessionState.stackFrames.get(args.frameId);
                if (exp.substr(0, 2) === "__") {
                    exp = exp.substr(2);
                    frame = null;
                }

                this.protocol.request.eval(exp, (frame) ? frame.depth : null)
                    .then((rep) => {
                    if (!rep.success) {
                        res.success = false;
                        this.sendErrorResponse(res, 0, rep.value);
                        return;
                    }
                    else {
                        Channels.client.debug(`Evaluation response: $<cyan>${rep.value}`);
                        res.body = {
                            variablesReference: undefined,
                            result: String(rep.value)
                        };
                        this.sendResponse(res);
                    }
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    this.sendRequestFailed(res, `Eval request failed: ${err}`);
                });
            }
        }
        else if (args.context === "watch") {
            Channels.session.debug("Requesting evaluate for watch list...");
            Channels.client.debug(`Expression: $<red>${exp}`);
            Channels.client.debug("frameID: $<red>" + args.frameId);

            const frame = this.sessionState.stackFrames.get(args.frameId);
            if (!frame) {
                this.sendResponse(res);
                return;
            }

            this.protocol.request.eval(exp, frame.depth)
                .then((watchRep) => {
                if (!watchRep.success) {
                    res.success = false;
                    this.sendErrorResponse(res, 0, watchRep.value);
                    return;
                }
                else {
                    Channels.client.debug(`Evaluation response: $<cyan>${watchRep.value}`, frame.toString());
                    res.body = {
                        variablesReference: undefined,
                        result: String(watchRep.value)
                    };

                    if (watchRep.value instanceof TValue.ObjectData) {
                        const watchPropSet = new client_util.PropertySet(client_util.PropertySet.Type.Object);

                        // If a watch scope hadn't been created yet, make a new one.
                        if (!this.sessionState.watchScope) {
                            watchPropSet.scope = new client_util.Scope("Watch", frame, watchPropSet);
                            watchPropSet.scope.handle = this.sessionState.scopes.create(watchPropSet.scope);
                            this.sessionState.watchScope = watchPropSet.scope.handle;
                        }
                        else {
                            watchPropSet.scope = this.sessionState.scopes.get(this.sessionState.watchScope);
                        }

                        // Convert a dotted call chain into array indexing.
                        // (e.g. this.foo.bar -> this["foo"]["bar"])
                        let splitExp = exp.split(".");
                        let callChain = splitExp[0];
                        for (let i = 1; i < splitExp.length; i++) {
                            callChain += `["${splitExp[i]}"]`;
                        }

                        watchPropSet.heapPtr = watchRep.value.ptr;
                        watchPropSet.classType = watchRep.value.classID;
                        watchPropSet.callChain = callChain;
                        watchPropSet.handle = this.sessionState.varHandles.create(watchPropSet);

                        const ptrHandleKey = `${DebugClient.WATCH_PREFIX}(${frame.depth}) ${exp}`;
                        const oldPropSet = this.sessionState.ptrHandles[ptrHandleKey];
                        if (oldPropSet && oldPropSet.variables) {
                            Channels.client.debug(`Clearing variables for: $<red>${oldPropSet.displayName}`);
                            for (let i = 0; i < oldPropSet.variables.length; i++) {
                                this.sessionState.ptrHandles[`${ptrHandleKey}["${oldPropSet.variables[i].name}"]`] = undefined;
                            }
                        }

                        this.sessionState.ptrHandles[ptrHandleKey] = watchPropSet;
                        this.expandPropertySubset(watchPropSet)
                            .then(() => {
                            res.body.variablesReference = watchPropSet.handle;
                            this.getConstructorNameByObject(watchRep.value.ptr)
                                .then((name) => {
                                watchPropSet.displayName = name;
                                res.body.result = name;
                                this.sendResponse(res);
                            })
                                .catch((err) => {
                                this.throwIfBad(err);
                                this.sendErrorResponse(res, err.toString());
                            });
                        })
                            .catch((err) => {
                            this.throwIfBad(err);
                            this.sendErrorResponse(res, err.toString());
                        });
                    }
                    else {
                        this.sendResponse(res);
                    }
                }
            })
                .catch((err) => {
                this.throwIfBad(err);
                this.sendRequestFailed(res, `Eval request failed: ${err}`);
            });
        }
    }

    /////////////////////////
    // Helpers
    //

    /**
     * A simple wrapper for calling the session's sendErrorResponse()
     */
    sendRequestFailed(res, msg) {
        msg = "Request failed: " + (msg ? msg.toString() : "");
        Channels.client.warn(msg);
        this.sendErrorResponse(res, 0, msg);
    }

    /**
     * Expands properties for Duktape local scope variables.
     */
    expandScopeProperties(keys, values, scope) {
        Channels.client.debug(`Expanding scope properties for: $<red>${scope.name}`);
        const propSet = new client_util.PropertySet(client_util.PropertySet.Type.Scope);

        propSet.handle = this.sessionState.varHandles.create(propSet);
        propSet.scope = scope;
        propSet.variables = [];
        scope.properties = propSet;

        if (keys.length < 1)
            return Promise.resolve(propSet);

        const global = (keys[0] === "this") ? true : false;
        if (global) {
            propSet.displayName = "Global Object";
            return this.protocol.request.eval(keys[0], scope.stackFrame.depth)
                .then((rep) => {
                if (rep.success)
                    values.unshift(rep.value);
                else
                    keys.shift();
                return this.resolvePropertySetVariables(keys, values, propSet)
                    .then((vars) => {
                    propSet.variables = propSet.variables.concat(vars);
                    return propSet;
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    return propSet;
                });
            }).catch((err) => {
                this.throwIfBad(err);
                return propSet;
            });
        }
        else {
            return this.resolvePropertySetVariables(keys, values, propSet)
                .then((vars) => {
                propSet.variables = propSet.variables.concat(vars);
                return propSet;
            }).catch((err) => {
                this.throwIfBad(err);
                return propSet;
            });
        }
    }

    /**
     * Recursively expands property prototypes while also adding all inherited variables
     * to the property set representing the leaf class, in this case "bottom".
     */
    expandPropertySubset(propSet, bottom = null) {
        if (propSet.type === client_util.PropertySet.Type.Object) {
            if (propSet.variables) {
                Channels.client.debug(`${propSet.displayName} properties already expanded.`);
                return Promise.resolve(propSet.variables);
            }
            return expand.call(this, propSet.scope);
        }
        else if (propSet.type === client_util.PropertySet.Type.Artificials) {
            Channels.client.debug(`${propSet.displayName} is an artificials propertyset`);
            return Promise.resolve(propSet.variables);
        }
        return Promise.resolve([]);

        /////////////////////////
        // Closure Functions
        //

        /**
         * Expand the property set by parsing its heap object info, expanding any
         * prototypes, and resolving the variables in its property description range.
         */
        function expand(scope) {
            Channels.client.debug(`Expanding property subset: $<red>${propSet.displayName}`);

            // Get heap object info to obtain the object's artificials
            Channels.client.debug("Requesting heap object info...");
            return this.protocol.request.getHeapObjectInfo(propSet.heapPtr)
                .then((heapInfo) => {

                Channels.client.debug("Building artificial variables...");
                // Build artificials and grab the prototype if it exists
                const artificials = new client_util.PropertySet(client_util.PropertySet.Type.Artificials);
                artificials.handle = this.sessionState.varHandles.create(artificials);
                artificials.scope = propSet.scope;
                artificials.variables = new Array();
                propSet.variables = new Array();
                let prototype = undefined;

                for (const prop of heapInfo.properties) {
                    if (prop.key === "prototype" && prop.value != undefined) {
                        Channels.client.debug("Prototype found.");
                        prototype = new client_util.PropertySet(client_util.PropertySet.Type.Object);
                        prototype.handle = this.sessionState.varHandles.create(prototype);
                        prototype.scope = propSet.scope;
                        prototype.classType = prop.value.classID;
                        prototype.heapPtr = prop.value.ptr;
                    }
                    else {
                        artificials.variables.push(new vsAdapt.Variable(prop.key, String(prop.value), 0));
                    }
                }

                // Handle the prototype by recursively calling back into expandPropertySubset
                // then resolve the variables.
                return handlePrototype.call(this, prototype)
                    .then(() => {
                    if (prototype && this.attachArgs.showDebugVariables) {
                        Channels.client.debug(`Adding prototype node to property set under: $<red>${prototype.displayName}`);
                        propSet.variables.push(new vsAdapt.Variable("__prototype", prototype.displayName, prototype.handle));
                    }

                    if (this.attachArgs.showDebugVariables) {
                        Channels.client.debug("Adding artificials node to property set...");
                        propSet.variables.push(new vsAdapt.Variable("__artificial", "{...}", artificials.handle));
                    }

                    Channels.client.debug(`Request obj property desc range...`, `Range: $<red>0 to ${heapInfo.maxPropDescRange}`, `Object: $<red>${propSet.displayName}`);
                    return this.protocol.request.getObjPropDescRange(propSet.heapPtr, 0, heapInfo.maxPropDescRange)
                        .then((propDesc) => {
                        return resolveVariables.call(this, propDesc, scope);
                    })
                        .catch((err) => {
                        this.throwIfBad(err);
                        return Promise.reject(err);
                    });
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    return Promise.reject(err);
                });
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        }

        /**
         * Builds all the key/value pairs and sends them to be resolved,
         * appending any inherited variables to the bottom of the hirearchy
         */
        function resolveVariables(propDesc, scope) {
            const keys = new Array();
            const values = new Array();

            return buildPairs.call(this, propDesc, keys, values, scope)
                .then(() => {
                return this.resolvePropertySetVariables(keys, values, propSet)
                    .then((vars) => {
                    propSet.variables = propSet.variables.concat(vars);

                    if (bottom) {
                        Channels.client.debug("Adding variables to the bottom of the hierarchy...");
                        // Propagate members from parent classes down to their children, skipping duplicate variables.
                        for (let i = 0; i < vars.length; i++) {
                            let isDuplicate = false;
                            for (let j = 0; j < bottom.variables.length; j++) {
                                if ((vars[i].name === bottom.variables[j].name) && (vars[i].value === bottom.variables[j].value)) {
                                    isDuplicate = true;
                                    break;
                                }
                            }

                            if (isDuplicate)
                                continue;

                            bottom.variables.push(vars[i]);
                        }
                    }
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    return Promise.reject(err);
                });
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        }

        /**
         * Builds up all necessary key/value pairs.
         */
        function buildPairs(propDesc, keys, values, scope) {
            if (!scope)
                throw new Error("Scope is undefined.");

            Channels.client.debug("Building key/value pairs...");
            const evaluations = new Array();
            const getters = new Array();

            for (const prop of propDesc.properties) {
                // Omit the __proto__ variable as it causes issues.
                if (prop.key === "__proto__")
                    continue;

                if (prop.type === duk_const.DVal.Unused) {
                    Channels.client.debug(`Skipping unused value: $<red>${prop.key}`);
                    continue;
                }

                if (!this.attachArgs.showDebugVariables) {
                    // Omit any __ variables except for __name
                    if (typeof (prop.key) === "string") {
                        if (prop.key.substr(0, 2) === "__")
                            if (prop.key !== "__name")
                                continue;
                    }
                }

                if (!prop.isAccessor) {
                    // Prune unnecessary light functions and function objects.
                    if (prop.type === duk_const.DVal.Lightfunc)
                        continue;

                    if (prop.type === duk_const.DVal.Object)
                        if (prop.value.classID === duk_const.HObjectClassIDs.Function)
                            continue;
                    keys.push(String(prop.key));
                    values.push(prop.value);
                }
                else {
                    if (prop.getter) {
                        getters.push(prop);
                    }
                }
            }

            if (getters.length > 0) {
                Channels.client.debug("Evaluating getters...");
                for (let i = 0; i < getters.length; i++) {
                    const exp = `${propSet.callChain}.${String(getters[i].key)}`;
                    evaluations.push(this.protocol.request.eval(exp, (scope.stackFrame) ? scope.stackFrame.depth : null));
                }
            }

            return Promise.all(evaluations)
                .then((res) => {
                for (let i = 0; i < res.length; i++) {
                    keys.push(getters[i].key);
                    values.push(res[i].value);
                }
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        }

        /**
         * Recursively calls into expandPropertySubset.
         */
        function handlePrototype(prototype) {
            if (prototype) {
                Channels.client.debug("Handling prototype...");

                // All nested prototypes should have the same call chain.
                prototype.callChain = propSet.callChain;
                return this.getConstructorNameByObject(prototype.heapPtr)
                    .then((name) => {
                    prototype.displayName = name;

                    if (!bottom) {
                        Channels.client.debug("Bottom is null, setting bottom to propSet.");
                        bottom = propSet;
                    }

                    return this.expandPropertySubset(prototype, bottom)
                        .then(() => {
                        Channels.client.debug("Sorting prototype variables...");

                        prototype.variables.sort((a, b) => {
                            const aNum = Number(a.name);
                            const bNum = Number(b.name);
                            const aIsNum = !isNaN(aNum);
                            const bIsNum = !isNaN(bNum);

                            if (!aIsNum && bIsNum) {
                                return -1;
                            }
                            else if (aIsNum && !bIsNum) {
                                return 1;
                            }
                            else if (aIsNum && bIsNum) {
                                return (aNum < bNum) ? -1 : ((aNum > bNum) ? 1 : 0);
                            }

                            if (a.name[0] === "_")
                                return -1;
                            if (b.name[0] === "_")
                                return 1;
                            if (a.name === "this")
                                return -1;
                            if (b.name === "this")
                                return 1;

                            return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0);
                        });

                        return Promise.resolve();
                    })
                        .catch((err) => {
                        this.throwIfBad(err);
                        return Promise.reject(err);
                    });
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    return Promise.reject(err);
                });
            }

            return Promise.resolve(undefined);
        }
    }

    /**
     * Resolves all the key/value pairs of a property set's variables.
     */
    resolvePropertySetVariables(keys, values, propSet) {
        Channels.client.debug(`Resolving property set variables for: $<red>${propSet.displayName}`);

        const stackDepth = propSet.scope.stackFrame.depth;
        const toStringPromises = new Array();
        const variables = new Array();
        // Variables which are objects must be evaluated for their constructor name
        const objectVariables = new Array();

        if (!propSet.variables)
            propSet.variables = [];

        Channels.client.debug("Iterating key/value pairs...");
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = values[i];
            // Hidden properties are prefixed with 0x82 and 0xFF
            if (key.charCodeAt(0) === 0x82 || key.charCodeAt(0) === 0xFF)
                continue;

            Channels.client.debug(`Looking at: $<cyan>${key}, ${String(value)}`);
            const variable = new vsAdapt.Variable(key, "", 0);
            let callChain = key;
            if (propSet.callChain.length > 0)
                callChain = `${propSet.callChain}["${key}"]`;

            Channels.client.debug(`Call chain: $<magenta>${callChain}`);
            variables.push(variable);

            if (value instanceof TValue.ObjectData) {
                Channels.client.debug("Value is an object...");
                const ptrHandleKey = `(${stackDepth}) ${callChain}`;
                Channels.client.debug(`Handle key: $<cyan>${ptrHandleKey}`);

                let objPropSet = this.sessionState.ptrHandles[ptrHandleKey];
                if (!objPropSet) {
                    Channels.client.debug("Attempting to get propset from watchlist...");
                    objPropSet = this.sessionState.ptrHandles[DebugClient.WATCH_PREFIX + ptrHandleKey];
                }
                if (objPropSet) {
                    Channels.client.debug("Session already has a pointer to this object, setting reference...");
                    variable.variablesReference = objPropSet.handle;
                    if (objPropSet.displayName) {
                        variable.value = objPropSet.displayName;
                        continue;
                    }
                }
                else {
                    Channels.client.debug("Object is new, building property set...");

                    objPropSet = new client_util.PropertySet(client_util.PropertySet.Type.Object);
                    objPropSet.scope = propSet.scope;
                    objPropSet.heapPtr = value.ptr;
                    objPropSet.classType = value.classID;
                    objPropSet.callChain = callChain;
                    objPropSet.handle = this.sessionState.varHandles.create(objPropSet);

                    variable.variablesReference = objPropSet.handle;

                    Channels.client.debug("Storing pointer with the session...");
                    if (objPropSet.scope.name === "Watch")
                        this.sessionState.ptrHandles[DebugClient.WATCH_PREFIX + ptrHandleKey] = objPropSet;
                    else
                        this.sessionState.ptrHandles[ptrHandleKey] = objPropSet;

                    if (objPropSet.classType !== duk_const.HObjectClassIDs.Object) {
                        const name = duk_const.HObjectClassNames[value.classID];
                        Channels.client.debug(`Class type is not an object: $<red>${key}: ${name}`);
                        objPropSet.displayName = duk_const.HObjectClassNames[value.classID];
                        variable.value = objPropSet.displayName;
                        continue;
                    }
                }

                toStringPromises.push(this.getConstructorNameByObject(objPropSet.heapPtr));
                objectVariables.push(variable);
            }
            else {
                const name = (typeof value === "string") ? `"${value}"` : String(value);
                Channels.client.debug(`Value is not an object: $<red>${key}: ${name}`);
                variable.value = name;
            }

            // evaluateName is the variable VSCode uses for evaluating watch expressions.
            // The expression we want here is the call chain to that variable (e.g. this.position.x)
            const e = variable;
            e.evaluateName = callChain;
        }
        if (toStringPromises.length > 0) {
            Channels.client.debug("Waiting for all toString promises to resolve...");
            return Promise.all(toStringPromises)
                .then((toStringResults) => {
                Channels.client.debug("Setting constructor names...");
                for (let i = 0; i < toStringResults.length; i++) {
                    const name = toStringResults[i];
                    const varHandle = this.sessionState.varHandles.get(objectVariables[i].variablesReference);
                    if (!varHandle)
                        continue;

                    varHandle.displayName = name;
                    objectVariables[i].value = name;
                    Channels.client.debug(`${objectVariables[i].name} = $<red>${objectVariables[i].value}`);
                }

                return Promise.resolve(variables);
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        }
        else {
            return Promise.resolve(variables);
        }
    }

    getObjectConstructorByName(prefix, stackDepth) {
        return this.isGlobalObject(stackDepth)
            .then(isGlobal => {
            if (isGlobal)
                return "[Global]";

            const exp = `(${prefix}.constructor.toString().match(/\\w+/g)[1])`;
            Channels.client.debug(`Requesting eval on: $<red>${exp}`);
            return this.protocol.request.eval(exp, stackDepth)
                .then((rep) => {
                return (rep.success) ? String(rep.value) : "";
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        })
            .catch((err) => {
            this.throwIfBad(err);
            return Promise.reject(err);
        });
    }

    getConstructorNameByObject(ptr) {
        Channels.client.debug(`Getting constructor name by object...`);
        let jsProtoPtr;

        Channels.client.debug("Requesting heap object info for Object pointer...");
        return this.protocol.request.getHeapObjectInfo(ptr)
            .then((rep) => {
            let prop = null;
            for (let i = 0; i < rep.properties.length; i++) {
                if (rep.properties[i].key === "prototype") {
                    prop = rep.properties[i];
                    break;
                }
            }

            if (!prop || !prop.value) {
                Channels.client.debug("No prototype.");
                return Promise.reject(new Rejection.Ignorable());
            }

            if (prop.type !== duk_const.DVal.Object) {
                return Promise.reject(new Rejection.Error(`Unexpected property:\n${prop.toString()}`));
            }

            jsProtoPtr = prop.value.ptr;
            Channels.client.debug("Requesting heap object info for prototype pointer...");
            return this.protocol.request.getHeapObjectInfo(jsProtoPtr);
        })
            .then((rep) => {
            Channels.client.debug("Requesting range of property descriptions for prototype...");
            return this.protocol.request.getObjPropDescRange(jsProtoPtr, 0, rep.maxPropEntriesRange);
        })
            .then((rep) => {
            let prop = null;
            for (let i = 0; i < rep.properties.length; i++) {
                if (rep.properties[i].key === "constructor") {
                    prop = rep.properties[i];
                }
            }

            if (!prop || !prop.value) {
                Channels.client.debug("No constructor.");
                return Promise.reject(new Rejection.Ignorable());
            }

            if (prop.type !== duk_const.DVal.Object) {
                return Promise.reject(new Rejection.Error(`Unexpected property:\n${prop.toString()}`));
            }

            const obj = prop.value;
            Channels.client.debug("Requesting range of property descriptions for constructor...");
            return this.protocol.request.getObjPropDescRange(obj.ptr, 0, 0x7fffffff);
        })
            .then((rep) => {
            let prop = null;
            for (let i = 0; i < rep.properties.length; i++) {
                if (rep.properties[i].key === "name") {
                    prop = rep.properties[i];
                    break;
                }
            }

            if (!prop || !prop.value) {
                Channels.client.debug("No name.");
                return Promise.reject(new Rejection.Ignorable());
            }

            if (typeof (prop.value) !== "string")
                return Promise.reject(new Rejection.Error(`Unexpected property:\n${prop.toString()}`));

            const name = prop.value;
            Channels.client.debug(`Constructor name found: $<red>${name}`);
            return Promise.resolve(name);
        })
            .catch((err) => {
            this.throwIfBad(err);
            if (err.ignorable)
                return Promise.resolve("Object");
            else
                return Promise.reject(err);
        });
    }

    /**
     * Checks whether the object at the given stack depth is a global object by
     * comparing the pointers of "this" evaluated at the stack depth to the
     * "this" evaluated indirectly.
     */
    isGlobalObject(stackDepth) {
        Channels.client.debug("Checking if global object...");

        // Evaluate "this" indirectly
        return this.protocol.request.eval("this", null)
            .then((a) => {
            // Evaluate "this" at the stack depth
            return this.protocol.request.eval("this", stackDepth)
                .then((b) => {
                if (!(a.value instanceof TValue.ObjectData) || !(b.value instanceof TValue.ObjectData)) {
                    return Promise.reject(new Rejection.Error(`Both eval results should have been objects:\n`
                        + `a: ${a.toString()}\n`
                        + `b: ${b.toString()}`));
                }
                return Promise.resolve(a.value.ptr.toString() === b.value.ptr.toString());
            })
                .catch((err) => {
                this.throwIfBad(err);
                return Promise.reject(err);
            });
        })
            .catch((err) => {
            this.throwIfBad(err);
            return Promise.reject(err);
        });
    }

    removeAllTargetBreakpoints() {
        Channels.client.debug("Removing all target breakpoints...");
        Channels.client.debug("Retrieving breakpoint list from Duktape...");
        return this.protocol.request.listBreakpoints()
            .then((res) => {
            Channels.client.debug("Clearing Duktape breakpoints...");
            if (res.breakpoints.length === 0)
                return Promise.resolve(undefined);

            const promises = new Array(res.breakpoints.length);
            for (let i = 0; i < res.breakpoints.length; i++) {
                promises[i] = this.protocol.request.delBreakpoint(res.breakpoints.length - 1 - i);
            }
            return Promise.all(promises);
        })
            .catch((err) => {
            this.throwIfBad(err);
            return Promise.reject(err);
        });
    }

    removeAllTargetBreakpointsForSource(srcData) {
        Channels.client.debug(`Removing all breakpoints from ${srcData.vsCodePath}...`);
        const bpDataArray = this.bpRegistry.get(srcData.vsCodePath);
        if (!bpDataArray)
            return Promise.resolve();

        Channels.client.debug("Breakpoints obtained from registry, sorting duktape indices...");
        const indices = [];

        for (const bpData of bpDataArray) {
            indices.push(bpData.dukBpIndex.get());
        }

        indices.sort((a, b) => { return b - a; }); // Sort decending.
        this.bpRegistry.delete(srcData.duktapePath);
        Channels.client.debug("Indices sorted, creating delete request promises...");

        const promises = new Array();
        for (const index of indices) {
            promises.push(this.protocol.request.delBreakpoint(index));
        }

        Channels.client.debug("Waiting for promises to complete...");
        return Promise.all(promises)
            .then(() => {
            if (promises.length > 0)
                Channels.client.debug(`All breakpoints removed for: $<red>${srcData.vsCodePath}`);

            return promises.length;
        })
            .catch((err) => {
            this.throwIfBad(err);
            return Promise.reject(err);
        });
    }

    /**
     * Requests source data from the Duktape runtime.
     */
    requestSourceData(path) {
        const simplifiedPath = Path.simplify(path, this.sourceRoot);
        Channels.general.debug(`[${path}] -> [${simplifiedPath}]`);
        return this.protocol.request.appRequest([
            TValue.String("GetMap"),
            TValue.String(Path.build(simplifiedPath, ".ts"))
        ])
            .then((rep) => {
            Channels.client.debug("Source data retrieved.");
            if (!DValue.isString(rep.msg[0].type)) {
                return Promise.reject(new Rejection.Error("Sourcemap not a valid format."));
            }

            Channels.client.debug("Source map defined, parsing...");
            const sourceMap = rep.msg[0].value;
            return Promise.resolve(this.buildAndRegisterSourceData(path, sourceMap));
        })
            .catch((err) => {
            this.throwIfBad(err);
            return Promise.reject(err);
        });
    }

    buildAndRegisterSourceData(path, sourceMap) {
        Channels.client.debug("Building source data...");

        const simplifiedPath = Path.simplify(path, this.sourceRoot);
        const vsCodePath = Path.build(simplifiedPath, ".ts", this.sourceRoot);
        const duktapePath = Path.build(simplifiedPath, ".js");
        const lineMap = new VLQ.LineMap(sourceMap, false);
        const ast = ts.createSourceFile(vsCodePath, fs.readFileSync(vsCodePath).toString(), ts.ScriptTarget.ES5);
        const srcData = new Source.Data(vsCodePath, duktapePath, lineMap, ast);

        Channels.client.debug(`Registering source data:\n` +
            `[srcData]\n` +
            `    ├─[${srcData.vsCodePath}]\n` +
            `    └─[${srcData.duktapePath}]`);
        this.sourceRegistry.push(srcData);

        return srcData;
    }

    ////////////////////////
    // Handlers
    //

    /**
     * Implements the functionality behind the custom "--" commands.
     */
    handleCustomRepl(res, exp) {
        let cmd = exp.split(" ", 1)[0];
        cmd = cmd.toLowerCase();
        res.body = { variablesReference: 0, result: "" };

        if (cmd === DebugClient.Commands.debugVars) {
            this.attachArgs.showDebugVariables = !this.attachArgs.showDebugVariables;
            Channels.client.log(`showDebugVariables set to: $<green>${this.attachArgs.showDebugVariables}`);
        }
        else if (cmd === DebugClient.Commands.dumpSourceData) {
            const arg = exp.slice(exp.indexOf(" ") + 1);
            const srcData = this.sourceRegistry.get(arg);
            Channels.client.log((srcData) ? srcData.toString() : "Source data not found.");
        }
        else if (cmd === DebugClient.Commands.dumpSourceRegistry) {
            Channels.client.log(this.sourceRegistry.toString());
        }
        else if (cmd === DebugClient.Commands.dumpLogBuffer) {
            let arg = exp.slice(exp.indexOf(" ") + 1);
            if (arg === exp)
                arg = "Log";
            Channels.client.log("Writing buffer to file.");
            this.writeMessageBufferToFile(arg, "user");
        }
        else if (cmd === DebugClient.Commands.dumpSessionState) {
            const sessionState = this.sessionState.toStringTree();
            const resolvedString = client_util.StringBuilder.Tree.ResolveToString(sessionState);
            Channels.client.log(`Session State\n${resolvedString}`);
        }
        else if (cmd === DebugClient.Commands.help) {
            Channels.general.log(DebugClient.Commands.toString());
        }
        else if (cmd === DebugClient.Commands.ignoreLastException) {
            if (this.lastThrow) {
                const srcData = this.sourceRegistry.get(this.lastThrow.fileName);
                const mappedLine = srcData.javascriptToTypescript(this.lastThrow.lineNumber).line;
                if (srcData.ignoredExceptions[mappedLine]) {
                    Channels.client.log(`Exception on line $<red>${mappedLine} $<default>of $<red>${srcData.vsCodePath} $<default>already ignored.`);
                }
                else {
                    srcData.ignoredExceptions[mappedLine] = true;
                    Channels.client.log(`Exceptions thrown on line $<red>${mappedLine} $<default>of $<red>${srcData.vsCodePath} $<default>will now be ignored.`, " $<green>Restart the debug session to restore ignored exceptions.");
                }
            }
            else {
                Channels.client.log(`No "last exception" data available to ignore.`);
            }
        }
        else if (cmd === DebugClient.Commands.listbreak) {
            Channels.client.log("Retrieving breakpoint lists...");
            this.protocol.request.listBreakpoints()
                .then((rep) => {
                const output = ["=== Duktape Response ===\n"];
                output.push(rep.toString());
                output.push("\n");
                output.push(this.bpRegistry.toString());
                Channels.general.log(output.join("\n"));
            })
                .catch((err) => {
                this.throwIfBad(err);
                Channels.general.error(err.toString());
            });
        }
        else if (cmd === DebugClient.Commands.setLogLevel) {
            const arg = parseInt(exp.slice(exp.indexOf(" ") + 1));
            if (arg < 0 || arg > 3) {
                Channels.client.error(`Invalid level: ${arg}`);
            }
            else {
                this.logger.setLogLevel(arg);
                Channels.client.log(`Log level set to: ${arg}`);
            }
        }
        else {
            Channels.client.error(`Invalid command: ${exp}`);
        }

        return res;
    }

    /**
     * Implements the functionality for custom app-specific notifications from Duktape.
     */
    handleAppNotification(app) {
        Channels.client.debug("App notification.");
        const data = app.data;
        if (data.length < 2) {
            Channels.client.error("App notification message format invalid, not enough parameters:");
            Channels.general.log(app.toString());
            return;
        }

        const nfyType = data[0];
        const payload = data.slice(1);
        if (!DValue.isString(nfyType.type)) {
            Channels.client.error(`App notification message format invalid, notify type not a string: ${duk_const.DVal[nfyType.type]}`);
            return;
        }

        if (nfyType.value === "Log")
            appLog.call(this, payload);
        else if (nfyType.value === "UpdateMap")
            updateMap.call(this, payload);
        else if (nfyType.value === "SourceLoaded")
            sourceLoaded.call(this, payload);
        else
            Channels.client.log(`Unhandled app notification:\n${app.toString()}`);

        /////////////////////////
        // Closure Functions
        //

        function appLog(payload) {
            Channels.client.debug("App notification was a log.");
            // Validate the payload.
            if (payload.length !== 1) {
                Channels.client.error(`Too many arguments: ${payload.length}`);
                return;
            }

            if (!DValue.isString(payload[0].type)) {
                Channels.client.error(`Log message invalid, not a string: ${duk_const.DVal[payload[0].type]}`);
                return;
            }

            const msg = payload[0].value;
            Channels.general.log((msg.length > 0) ? msg : "<Empty Log Message>");
        }

        function updateMap(payload) {
            Channels.client.debug("Duktape notifying of an updated source map.");
            // Validate the payload
            if (payload.length !== 2) {
                Channels.client.error(`Argument count invalid: ${payload.length}`);
                return;
            }

            if (!DValue.isString(payload[0].type)) {
                Channels.client.error(`Source path invalid, not a string: ${duk_const.DVal[payload[0].type]}`);
                return;
            }

            if (!DValue.isString(payload[1].type)) {
                Channels.client.error(`Source mapping invalid, not a string: ${duk_const.DVal[payload[1].type]}`);
                return;
            }

            const srcPath = payload[0].value;
            const srcMap = payload[1].value;
            let srcData = this.sourceRegistry.get(srcPath);
            if (!srcData)
                srcData = this.buildAndRegisterSourceData(srcPath, srcMap);

            srcData.lineMap = new VLQ.LineMap(srcMap);
            srcData.ast = ts.createSourceFile(srcData.vsCodePath, fs.readFileSync(srcData.vsCodePath).toString(), ts.ScriptTarget.ES5);
            Channels.client.log(`Source map for ${_path.basename(srcPath)} updated.`);

            let data;
            for (let i = 0; i < this.updatedSources.length; i++) {
                const t = this.updatedSources[i];
                if (Path.normalize(t.args.source.path) === srcData.vsCodePath) {
                    this.updatedSources.splice(i, 1);
                    data = t;
                    break;
                }
            }

            if (data) {
                this.removeAllTargetBreakpointsForSource(srcData)
                    .then((count) => {
                    if (data) {
                        data.args.sourceModified = false;
                        this.setBreakPointsRequest(data.res, data.args);
                    }
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    this.error(err.toString());
                });
            }
        }

        function sourceLoaded(payload) {
            Channels.client.debug("Duktape notifying of a loaded source file.");
            this.handlingSourceLoadedNotify++;

            // Validate the payload
            if (payload.length !== 2) {
                Channels.client.error(`Argument count invalid: ${payload.length}`);
                return;
            }

            if (!DValue.isString(payload[0].type)) {
                Channels.client.error(`Source path invalid, not a string: ${duk_const.DVal[payload[0].type]}`);
                return;
            }

            if (!DValue.isString(payload[1].type)) {
                Channels.client.error(`Source mapping invalid, not a string: ${duk_const.DVal[payload[1].type]}`);
                return;
            }

            const srcPath = payload[0].value;
            const srcMap = payload[1].value;
            let srcData = this.sourceRegistry.get(srcPath);
            if (!srcPath) {
                Channels.client.warn("Source path not defined in SourceLoaded notification.");
                this.protocol.request.resume();
                return;
            }

            if (!srcData)
                srcData = this.buildAndRegisterSourceData(srcPath, srcMap);

            const unverified = this.unverifiedBreakpoints.get(srcPath);
            if (unverified) {
                const hitCountMap = this.buildBreakpointHitCountMap(srcPath);
                let srcBps = [];

                for (const e of unverified) {
                    srcBps.push(e.srcBp);
                    Channels.client.debug(`Removing: $<red>(${e.bp.line}) #${e.bp.id}`);
                    const bpEvent = new vsAdapt.BreakpointEvent("removed", e.bp);
                    this.sendEvent(bpEvent);
                }

                const breakpoints = this.buildBreakpoints(srcData, srcBps);
                Channels.client.debug("Adding breakpoints to Duktape...");
                this.addBreakpointsToDuktape(srcData, breakpoints.concat(), hitCountMap)
                    .then(() => {
                    for (const bp of breakpoints) {
                        Channels.client.debug(`Adding: $<red>${bp.source.name} (${bp.line}) #${bp.id}`);
                        const bpEvent = new vsAdapt.BreakpointEvent("new", bp);
                        this.sendEvent(bpEvent);
                    }
                    this.protocol.request.resume();
                })
                    .catch((err) => {
                    this.throwIfBad(err);
                    Channels.general.error(err.toString());
                });
            }
            else {
                this.protocol.request.resume();
            }
        }
    }

    /**
     * Implements the funcionality for Duktape paused/running status notifications.
     * Also handles any exception thrown by Duktape.
     */
    handleStatusNotification(status) {
        if (this.initializing) {
            Channels.client.debug("Still initializing, ignoring status notification.");
            return;
        }

        Channels.client.debug("Status notification recieved from protocol...");
        if (status.state !== duk_const.StatusState.Paused) {
            Channels.client.debug("Protocol status reports a running state.");
            this.sendEvent(new vsAdapt.ContinuedEvent(DebugClient.THREAD_ID, true));
            return;
        }

        Channels.client.debug("Protocol reports a paused state.");
        let srcData = this.sourceRegistry.get(status.fileName);
        let stopMessage = undefined;
        if (!this.protocol.isPaused)
            Channels.client.error("Protocol somehow didn't set its state to paused!");

        if (this.handlingSourceLoadedNotify > 0) {
            Channels.client.debug("Pause was a result of duktape waiting for response to notification.");
            this.handlingSourceLoadedNotify--;
            return;
        }
        else if (this.ignoreNextPause) {
            Channels.client.debug("Ignoring this pause status.");
            this.ignoreNextPause = false;
            if (this.stopReason === "pause" || this.stopReason === "breakpoint" || this.stopReason === "debugger") {
                this.protocol.request.resume();
            }
            else {
                this.protocol.request.stepOver();
            }
        }
        else if (!status.fileName || status.fileName === "undefined") {
            Channels.client.debug("Status filename is undefined.");
            determineStopReason.call(this);
        }
        else if (status.fileName === "eval") {
            // This can occur when the debugger is paused on the runtime side.
            if (this.throwData) {
                Channels.client.debug("Status filename is eval, but there's exception data.");
                determineStopReason.call(this);
            }
            else {
                Channels.client.debug("Status filename is eval, stepping into.");
                this.protocol.request.stepInto();
            }
        }
        else {
            Channels.client.debug("Checking whether source data exists...");
            if (srcData) {
                determineStopReason.call(this);
            }
            else {
                if (_path.extname(status.fileName) !== ".js") {
                    Channels.client.error(`Missing or incorrect extension (${status.fileName}), skipping source request.`);
                    determineStopReason.call(this);
                }
                else {
                    Channels.client.debug("Requesting source data from Duktape...");
                    const filePath = _path.join(this.sourceRoot, status.fileName.replace(/\.[^.]+$/g, ".ts"));
                    this.requestSourceData(filePath)
                        .then(() => {
                        srcData = this.sourceRegistry.get(status.fileName);
                        determineStopReason.call(this);
                    })
                        .catch((err) => {
                        this.throwIfBad(err);
                        Channels.client.error(`Paused source request failed for: ${_path.basename(filePath)}`);
                        Channels.client.log(`Source (${_path.basename(filePath)}) may not yet be loaded in Duktape.`);
                        determineStopReason.call(this);
                    });
                }
            }
        }

        /////////////////////////
        // Closure Functions
        //

        /**
         * Clears the session state and handles the actual sending of the StoppedEvent.
         */
        function sendStoppedEvent() {
            if (!stopMessage)
                stopMessage = this.stopReason;

            Channels.client.debug("Clearing session state...");
            this.sessionState.clear();
            this.sendEvent(new vsAdapt.StoppedEvent(this.stopReason, DebugClient.THREAD_ID, stopMessage));
            this.stopReason = "debugger";
            this.lastThrow = this.throwData;
            this.throwData = undefined;
        }

        /**
         * Determines why the debugger paused.
         */
        function determineStopReason() {
            if (this.throwData) {
                Channels.client.debug("Pausing is an exception, attempting to format...");
                if (srcData && (srcData.duktapePath === this.throwData.fileName)) {
                    stopMessage =
                        `[Duktape] ${this.throwData.message}\n`
                            + `    ├─Throw status: ${duk_const.ThrowStatus[this.throwData.fatal]}\n`
                            + `    ├─File: ${srcData.vsCodePath}\n`
                            + `    └─Line: ${srcData.javascriptToTypescript(this.throwData.lineNumber).line}`;
                }
                else {
                    stopMessage = `${this.throwData.toString()}`;
                }

                Channels.general.error(`Exception occured\n${stopMessage}\n`);
                this.stopReason = "exception";
            }
            else if (srcData) {
                Channels.client.debug("Checking if Duktape paused on a breakpoint...");
                const line = this.convertDebuggerLineToClient(status.lineNumber);
                const pos = srcData.javascriptToTypescript(line);

                const bpDataArray = this.bpRegistry.get(pos.path);
                let bp;
                if (bpDataArray) {
                    for (const bpData of bpDataArray) {
                        if (bpData.breakpoint.line === pos.line) {
                            bp = bpData.breakpoint;
                            break;
                        }
                    }
                }

                if (bp) {
                    if (bp.conditionData) {
                        const condition = bp.conditionData;
                        if (condition.type === "hit") {
                            // Breakpoint has a hit count condition
                            const payload = condition.payload;
                            if (++payload.count >= payload.condition) {
                                this.stopReason = `hit count breakpoint`;
                                stopMessage = `breakpoint hit (${payload.count}) times`;
                                payload.count = 0;
                                sendStoppedEvent.call(this);
                            }
                            else {
                                this.protocol.request.resume();
                            }
                        }
                        else if (condition.type === "conditional") {
                            // Breakpoint has a conditional expression
                            this.protocol.request.eval(condition.payload, -1)
                                .then((res) => {
                                if (res.success && res.value === true) {
                                    this.stopReason = "conditional breakpoint";
                                    sendStoppedEvent.call(this);
                                }
                                else {
                                    if (!res.success) {
                                        Channels.client.error(`Bad conditional breakpoint expression: ${condition.payload}`);
                                        this.stopReason = "bad conditional expression";
                                        stopMessage = `Bad conditional breakpoint expression: ${condition.payload}`;
                                        sendStoppedEvent.call(this);
                                    }
                                    else {
                                        this.protocol.request.resume();
                                    }
                                }
                            })
                                .catch((err) => {
                                this.throwIfBad(err);
                                Channels.general.error(err.toString());
                            });
                        }
                        else {
                            Channels.client.error(`Unexpected data type: ${condition.type}`);
                        }
                        return;
                    }

                    this.stopReason = "breakpoint";
                }
            }

            sendStoppedEvent.call(this);
        }
    }

    /**
     * Implements the funcionality for when Duktape throws an exception.
     * The bulk of this is handled in "handleStatusNotification()"
     */
    handleThrowNotification(thr) {
        if (thr.message === "RangeError: error (rc -3)") {
            Channels.client.debug("Ignoring special exception [RangeError: error (rc -3)]...");
            this.ignoreNextPause = true;
        }
        else {
            if (thr.status === duk_const.ThrowStatus.Fatal) {
                const srcData = this.sourceRegistry.get(thr.fileName);
                if (srcData) {
                    const mappedLine = srcData.javascriptToTypescript(thr.lineNumber).line;
                    if (srcData.ignoredExceptions[mappedLine]) {
                        this.ignoreNextPause = true;
                        return;
                    }
                }

                this.throwData = thr;
            }
        }
    }

    /**
     * If the error provided doesn't fall under a specific set of types,
     * then the error is re-thrown.
     */
    throwIfBad(err) {
        if (err instanceof REP.Error)
            return;
        if (err instanceof Rejection.Error)
            return;
        if (err instanceof Rejection.Ignorable)
            return;
        throw err;
    }
    writeMessageBufferToFile(name, subFolder) {
        const date = new Date();
        let dateStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        dateStr += `--${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;
        const parsedName = _path.parse(name);
        const fileName = `${dateStr}__${parsedName.base}.txt`;

        let filePath = _path.join(os.tmpdir(), "skritt_debugger");
        if (!fs.existsSync(filePath))
            fs.mkdirSync(filePath);

        filePath = _path.join(filePath, subFolder);
        if (!fs.existsSync(filePath))
            fs.mkdirSync(filePath);

        const messageBuffer = this.logger.getMessageBuffer();
        const file = fs.createWriteStream(_path.join(filePath, fileName));
        file.on("error", (err) => { Channels.general.error(err); });
        file.on("close", () => { Channels.general.log(`Log "${fileName}" written to: $<green>${filePath}`); });

        for (const msg of messageBuffer) {
            file.write(msg + "\n");
        }
        
        file.write("\n____________ Additional Info ______________________________________\n");
        file.write("\n" + this.sourceRegistry.toString() + "\n");
        file.write("\n" + this.bpRegistry.toString() + "\n");
        file.write("\n" + this.sessionState.toString() + "\n");
        file.end();
    }

    ////////////////////////////
    // Logging
    //
    stdoutLog(msg) {
        this.sendEvent(new vsAdapt.OutputEvent(msg + "\n", "stdout"));
    }
    consoleLog(msg) {
        this.sendEvent(new vsAdapt.OutputEvent(msg + "\n", "console"));
    }
    stderrLog(msg) {
        this.sendEvent(new vsAdapt.OutputEvent(msg + "\n", "stderr"));
    }
    exceptionLog(msg) {
        this.sendEvent(new vsAdapt.OutputEvent(msg + "\n", "stderr"));
        this.writeMessageBufferToFile("exception", "error");
        this.sendEvent(new vsAdapt.TerminatedEvent());
    }
}

DebugClient.THREAD_ID = 1;
DebugClient.WATCH_PREFIX = "(Watch) ";
(function (DebugClient) {
    /**
     * Container class for custom debug commands.
     */
    class Commands {
        static get debugVars() { return Commands._debugVars[0].toLowerCase(); }
        static get dumpSourceData() { return Commands._dumpSourceData[0].toLowerCase(); }
        static get dumpSourceRegistry() { return Commands._dumpSourceRegistry[0].toLowerCase(); }
        static get dumpLogBuffer() { return Commands._dumpLogBuffer[0].toLowerCase(); }
        static get dumpSessionState() { return Commands._dumpSessionState[0].toLowerCase(); }
        static get help() { return Commands._help[0].toLowerCase(); }
        static get ignoreLastException() { return Commands._ignoreLastException[0].toLowerCase(); }
        static get listbreak() { return Commands._listbreak[0].toLowerCase(); }
        static get setLogLevel() { return Commands._setLogLevel[0].toLowerCase(); }
        static toString() {
            let str = [
                "___Debug Commands_______________________",
                `${Commands._debugVars[0]}: $<green>${Commands._debugVars[1]}`,
                `${Commands._dumpSourceData[0]} ${Commands._dumpSourceData[1]}: $<green>${Commands._dumpSourceData[2]}`,
                `${Commands._dumpSourceRegistry[0]}: $<green>${Commands._dumpSourceRegistry[1]}`,
                `${Commands._dumpLogBuffer[0]}: $<green>${Commands._dumpSourceRegistry[1]}`,
                `${Commands._dumpSessionState[0]}: $<green>${Commands._dumpSessionState[1]}`,
                `${Commands._help[0]}: $<green>${Commands._help[1]}`,
                `${Commands._ignoreLastException[0]}: $<green>${Commands._ignoreLastException[1]}`,
                `${Commands._listbreak[0]}: $<green>${Commands._listbreak[1]}`,
                `${Commands._setLogLevel[0]} ${Commands._setLogLevel[1]}: $<green>${Commands._setLogLevel[2]}`
            ];
            return str.join("\n");
        }
    }
    Commands._debugVars = [
        "--debugVars",
        "Adds '__' variables such as __artificials to the variables list."
    ];
    Commands._dumpSourceData = [
        "--dumpSrcData",
        "<source path>",
        "Dumps the source data mapped to the provided .ts or .js source path."
    ];
    Commands._dumpSourceRegistry = [
        "--dumpSrcReg",
        "Dumps all the ts/js source data mappings"
    ];
    Commands._dumpLogBuffer = [
        "--dumpLogBuffer",
        "<file name>",
        "Dumps the held log buffer to a file."
    ];
    Commands._dumpSessionState = [
        "--dumpSessionState",
        "Dumps the current session state."
    ];
    Commands._help = [
        "--help",
        "Displays this list."
    ];
    Commands._ignoreLastException = [
        "--ignoreLastException",
        "Ignore the last exception for the durration of this debug session."
    ];
    Commands._listbreak = [
        "--listbreak",
        "Lists both Duktape breakpoints and Client debugger breakpoint registry."
    ];
    Commands._setLogLevel = [
        "--setLogLevel",
        "<0-3>",
        "Sets the log level."
    ];
    DebugClient.Commands = Commands;

    let LogLevel;
    (function (LogLevel) {
        LogLevel[LogLevel["minimum"] = 0] = "minimum";
        LogLevel[LogLevel["warnings"] = 1] = "warnings";
        LogLevel[LogLevel["debug"] = 2] = "debug";
        LogLevel[LogLevel["commTraffic"] = 3] = "commTraffic";
    })(LogLevel = DebugClient.LogLevel || (DebugClient.LogLevel = {}));
})(DebugClient || (DebugClient = {}));

var Channels;
(function (Channels) {
    Channels.general = {};
    Channels.session = {};
    Channels.client = {};
    Channels.protocol = {};
})(Channels || (Channels = {}));

vsAdapt.DebugSession.run(DebugClient);
//# sourceMappingURL=debugger.js.map