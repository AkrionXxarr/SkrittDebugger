"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });

/** Duktape "Tagged Values" */
var TVal;
(function (TVal) {
    TVal[TVal["Unused"] = 0] = "Unused";
    TVal[TVal["Undefined"] = 1] = "Undefined";
    TVal[TVal["Null"] = 2] = "Null";
    TVal[TVal["Boolean"] = 3] = "Boolean";
    TVal[TVal["Number"] = 4] = "Number";
    TVal[TVal["String"] = 5] = "String";
    TVal[TVal["Buffer"] = 6] = "Buffer";
    TVal[TVal["Object"] = 7] = "Object";
    TVal[TVal["Pointer"] = 8] = "Pointer";
    TVal[TVal["Lightfunc"] = 9] = "Lightfunc";
})(TVal = exports.TVal || (exports.TVal = {}));

/** Duktape debugger DValues */
var DVal;
(function (DVal) {
    /** End of Message */
    DVal[DVal["EOM"] = 0] = "EOM";
    /** Request */
    DVal[DVal["REQ"] = 1] = "REQ";
    /** Reply */
    DVal[DVal["REP"] = 2] = "REP";
    /** Error */
    DVal[DVal["ERR"] = 3] = "ERR";
    /** Notify */
    DVal[DVal["NFY"] = 4] = "NFY";
    // 0x05-0x0f reserved
    /** Signed 32-bit integer */
    DVal[DVal["Int32"] = 16] = "Int32";
    /** Unsigned 32-bit string length */
    DVal[DVal["Str32"] = 17] = "Str32";
    /** Unsigned 16-bit string length */
    DVal[DVal["Str16"] = 18] = "Str16";
    /** Unsigned 32-bit buffer length */
    DVal[DVal["Buf32"] = 19] = "Buf32";
    /** Unsigned 16-bit buffer length */
    DVal[DVal["Buf16"] = 20] = "Buf16";
    /** Unused/none value. Marks unmapped array entries internally
     * as well as indicating a "none" result in the debugger protocol
     */
    DVal[DVal["Unused"] = 21] = "Unused";
    /** Ecmascript "undefined" */
    DVal[DVal["Undefined"] = 22] = "Undefined";
    /** Ecmascript "null" */
    DVal[DVal["Null"] = 23] = "Null";
    /** Ecmascript "true" */
    DVal[DVal["True"] = 24] = "True";
    /** Ecmascript "false" */
    DVal[DVal["False"] = 25] = "False";
    /** Ecmascript "number" (IEEE double) */
    DVal[DVal["Number"] = 26] = "Number";
    /** <uint8> Class number, <uint8> pointer length, <data> pointer data */
    DVal[DVal["Object"] = 27] = "Object";
    /** <uint8> Pointer length, <data> pointer data */
    DVal[DVal["Pointer"] = 28] = "Pointer";
    /** <uint16> Lightfunc flags, <uint8> pointer length, <data> pointer data */
    DVal[DVal["Lightfunc"] = 29] = "Lightfunc";
    /** <uint8> Pointer length, <data> pointer data
     *
     *  Pointer to heap object, used by DumpHeap
     */
    DVal[DVal["HeapPtr"] = 30] = "HeapPtr";
    // 0x1f reserved
    // 0x20-0x5f reserved
    /** Unsigned 5-bit string length */
    DVal[DVal["Str5"] = 96] = "Str5";
    DVal[DVal["Str5_Max"] = 127] = "Str5_Max";
    /** Unsigned 6-bit int */
    DVal[DVal["Int6"] = 128] = "Int6";
    DVal[DVal["Int6_Max"] = 191] = "Int6_Max";
    /** Unsigned 14-bit int */
    DVal[DVal["Int14"] = 192] = "Int14";
    DVal[DVal["Int14_Max"] = 255] = "Int14_Max";
})(DVal = exports.DVal || (exports.DVal = {}));

/** Error message lookup utility */
exports.ErrorMessage = [
    "Unknown or unspecified error",
    "Unsupported command",
    "Too many",
    "Not found",
    "Application error"
];

/** Duktape debugger notifications */
var Notify;
(function (Notify) {
    Notify[Notify["Status"] = 1] = "Status";
    Notify[Notify["Throw"] = 5] = "Throw";
    Notify[Notify["Detaching"] = 6] = "Detaching";
    Notify[Notify["App"] = 7] = "App";
})(Notify = exports.Notify || (exports.Notify = {}));

/** Duktape debugger requests */
var Request;
(function (Request) {
    Request[Request["BasicInfo"] = 16] = "BasicInfo";
    Request[Request["TriggerStatus"] = 17] = "TriggerStatus";
    Request[Request["Pause"] = 18] = "Pause";
    Request[Request["Resume"] = 19] = "Resume";
    Request[Request["StepInto"] = 20] = "StepInto";
    Request[Request["StepOver"] = 21] = "StepOver";
    Request[Request["StepOut"] = 22] = "StepOut";
    Request[Request["ListBreak"] = 23] = "ListBreak";
    Request[Request["AddBreak"] = 24] = "AddBreak";
    Request[Request["DelBreak"] = 25] = "DelBreak";
    Request[Request["GetVar"] = 26] = "GetVar";
    Request[Request["PutVar"] = 27] = "PutVar";
    Request[Request["GetCallstack"] = 28] = "GetCallstack";
    Request[Request["GetLocals"] = 29] = "GetLocals";
    Request[Request["Eval"] = 30] = "Eval";
    Request[Request["Detach"] = 31] = "Detach";
    Request[Request["DumpHeap"] = 32] = "DumpHeap";
    Request[Request["GetBytecode"] = 33] = "GetBytecode";
    Request[Request["AppRequest"] = 34] = "AppRequest";
    Request[Request["GetHeapObjInfo"] = 35] = "GetHeapObjInfo";
    Request[Request["GetObjPropDesc"] = 36] = "GetObjPropDesc";
    Request[Request["GetObjPropDescRange"] = 37] = "GetObjPropDescRange";
})(Request = exports.Request || (exports.Request = {}));

var PropDescFlags;
(function (PropDescFlags) {
    PropDescFlags[PropDescFlags["Writeable"] = 1] = "Writeable";
    PropDescFlags[PropDescFlags["Enumerable"] = 2] = "Enumerable";
    PropDescFlags[PropDescFlags["Configurable"] = 4] = "Configurable";
    PropDescFlags[PropDescFlags["Accessor"] = 8] = "Accessor";
    PropDescFlags[PropDescFlags["Virtual"] = 16] = "Virtual";
    PropDescFlags[PropDescFlags["Internal"] = 256] = "Internal";
})(PropDescFlags = exports.PropDescFlags || (exports.PropDescFlags = {}));

var HObjectClassIDs;
(function (HObjectClassIDs) {
    HObjectClassIDs[HObjectClassIDs["None"] = 0] = "None";
    HObjectClassIDs[HObjectClassIDs["Object"] = 1] = "Object";
    HObjectClassIDs[HObjectClassIDs["Array"] = 2] = "Array";
    HObjectClassIDs[HObjectClassIDs["Function"] = 3] = "Function";
    HObjectClassIDs[HObjectClassIDs["Arguments"] = 4] = "Arguments";
    HObjectClassIDs[HObjectClassIDs["Boolean"] = 5] = "Boolean";
    HObjectClassIDs[HObjectClassIDs["Date"] = 6] = "Date";
    HObjectClassIDs[HObjectClassIDs["Error"] = 7] = "Error";
    HObjectClassIDs[HObjectClassIDs["JSON"] = 8] = "JSON";
    HObjectClassIDs[HObjectClassIDs["Math"] = 9] = "Math";
    HObjectClassIDs[HObjectClassIDs["Number"] = 10] = "Number";
    HObjectClassIDs[HObjectClassIDs["Regex"] = 11] = "Regex";
    HObjectClassIDs[HObjectClassIDs["String"] = 12] = "String";
    HObjectClassIDs[HObjectClassIDs["Global"] = 13] = "Global";
    HObjectClassIDs[HObjectClassIDs["Symbol"] = 14] = "Symbol";
    HObjectClassIDs[HObjectClassIDs["ObjEnv"] = 15] = "ObjEnv";
    HObjectClassIDs[HObjectClassIDs["DecEnv"] = 16] = "DecEnv";
    HObjectClassIDs[HObjectClassIDs["Pointer"] = 17] = "Pointer";
    HObjectClassIDs[HObjectClassIDs["Thread"] = 18] = "Thread";
    HObjectClassIDs[HObjectClassIDs["BufObjMin"] = 19] = "BufObjMin";
    HObjectClassIDs[HObjectClassIDs["ArrayBuffer"] = 20] = "ArrayBuffer";
    HObjectClassIDs[HObjectClassIDs["DataView"] = 21] = "DataView";
    HObjectClassIDs[HObjectClassIDs["Int8Array"] = 22] = "Int8Array";
    HObjectClassIDs[HObjectClassIDs["UInt8Array"] = 23] = "UInt8Array";
    HObjectClassIDs[HObjectClassIDs["UInt8ClampedArray"] = 24] = "UInt8ClampedArray";
    HObjectClassIDs[HObjectClassIDs["Int16Array"] = 25] = "Int16Array";
    HObjectClassIDs[HObjectClassIDs["UInt16Array"] = 26] = "UInt16Array";
    HObjectClassIDs[HObjectClassIDs["Int32Array"] = 27] = "Int32Array";
    HObjectClassIDs[HObjectClassIDs["UInt32Array"] = 28] = "UInt32Array";
    HObjectClassIDs[HObjectClassIDs["Float32Array"] = 29] = "Float32Array";
    HObjectClassIDs[HObjectClassIDs["Float64Array"] = 30] = "Float64Array";
    HObjectClassIDs[HObjectClassIDs["BufObjMax"] = 31] = "BufObjMax";
    HObjectClassIDs[HObjectClassIDs["END_OF_ENUM"] = 32] = "END_OF_ENUM";
})(HObjectClassIDs = exports.HObjectClassIDs || (exports.HObjectClassIDs = {}));
exports.HObjectClassNames = [
    "None",
    "Object",
    "Array",
    "Function",
    "Arguments",
    "Boolean",
    "Date",
    "Error",
    "JSON",
    "Math",
    "Number",
    "Regex",
    "String",
    "Global",
    "Symbol",
    "ObjEnv",
    "DecEnv",
    "Pointer",
    "Thread",
    "BufObjMin",
    "ArrayBuffer",
    "DataView",
    "Int8Array",
    "UInt8Array",
    "UInt8ClampedArray",
    "Int16Array",
    "UInt16Array",
    "Int32Array",
    "UInt32Array",
    "Float32Array",
    "Float64Array",
    "BufObjMax"
];

var Endian;
(function (Endian) {
    Endian[Endian["Little"] = 1] = "Little";
    Endian[Endian["Mixed"] = 2] = "Mixed";
    Endian[Endian["Big"] = 3] = "Big";
})(Endian = exports.Endian || (exports.Endian = {}));

var StatusState;
(function (StatusState) {
    StatusState[StatusState["Running"] = 0] = "Running";
    StatusState[StatusState["Paused"] = 1] = "Paused";
})(StatusState = exports.StatusState || (exports.StatusState = {}));

var ThrowStatus;
(function (ThrowStatus) {
    ThrowStatus[ThrowStatus["Caught"] = 0] = "Caught";
    ThrowStatus[ThrowStatus["Fatal"] = 1] = "Fatal";
})(ThrowStatus = exports.ThrowStatus || (exports.ThrowStatus = {}));

var DetachReason;
(function (DetachReason) {
    DetachReason[DetachReason["Normal"] = 0] = "Normal";
    DetachReason[DetachReason["StreamError"] = 1] = "StreamError";
})(DetachReason = exports.DetachReason || (exports.DetachReason = {}));
//# sourceMappingURL=constants.js.map