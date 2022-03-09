"use strict";
var Log = (function () {
    function Log(target) {
        this.channels = {};
        this.flagHeaders = {};
        this.logFlags = 0;
        this.target = target;
    }
    Log.prototype.setLogFlags = function (logFlags) {
        this.logFlags = logFlags;
    };
    Log.prototype.setFlagHeader = function (flag, header) {
        this.flagHeaders[flag] = header;
    };
    Log.prototype.addChannel = function (channel, callback, color) {
        if (this.channels[channel])
            throw new Error("Channel " + channel + " already exists.");
        this.channels[channel] = { callback: callback, color: color };
    };
    Log.prototype.push = function (channel, logFlag) {
        var msg = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            msg[_i - 2] = arguments[_i];
        }
        if ((logFlag & this.logFlags) === 0)
            return;
        var chanData = this.channels[channel];
        if (!chanData)
            throw new Error("Channel " + channel + " doesn't exist.");
        var message = msg.join("\n");
        message = "(" + channel + ") " + message + "\u001B[0m";
        var flagHeader = this.flagHeaders[logFlag];
        if (flagHeader)
            message = "" + flagHeader + message;
        if (chanData.color)
            message = "" + chanData.color + message;
        chanData.callback.call(this.target, message, logFlag);
    };
    return Log;
}());
exports.Log = Log;
(function (Log) {
    var Flags;
    (function (Flags) {
        Flags[Flags["OutputToFile"] = 1] = "OutputToFile";
        Flags[Flags["Standard"] = 2] = "Standard";
        Flags[Flags["Debug"] = 4] = "Debug";
        Flags[Flags["Warning"] = 8] = "Warning";
        Flags[Flags["Error"] = 16] = "Error";
        Flags[Flags["Exception"] = 32] = "Exception";
        Flags[Flags["Verbose"] = 64] = "Verbose";
    })(Flags = Log.Flags || (Log.Flags = {}));
})(Log = exports.Log || (exports.Log = {}));
exports.Log = Log;
//# sourceMappingURL=log.js.map