"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Logger {
    constructor(target) {
        this.channels = [];
        this.logLevel = 0;
        this.target = target;
        this.messageBuffer = new Internal.MessageCircleBuffer(2048);
    }
    setLogLevel(level) {
        this.logLevel = level;
    }
    createChannel(header, logLevel, callback, defaultColor = "$<reset>") {
        const channel = new Internal.Channel(this, header, logLevel, callback, defaultColor);
        this.channels.push(channel);
        return channel.push;
    }
    getMessageBuffer() {
        return this.messageBuffer.get();
    }
    log(channel, msg) {
        const channelTag = (channel.header) ? channel.header : "";
        const parsed = this.parseForTags(`${channel.color}${channelTag}${msg.join(`\n${channel.color}`)}$<reset>`, channel.color);
        this.messageBuffer.push(parsed.clean);
        if (channel.logLevel > this.logLevel)
            return;
        channel.callback.call(this.target, parsed.replaced);
    }
    parseForTags(message, defaultTag) {
        let clean = "";
        let replaced = "";
        let tags = [];
        let tag = undefined;
        for (let i = 0; i < message.length; i++) {
            const ch = message[i];
            if (tag) {
                tag.str += ch;
                if (ch === ">") {
                    tags.push(tag);
                    tag = undefined;
                }
                continue;
            }
            else if (ch === "$" && message[i + 1] === "<") {
                tag = { index: clean.length, str: ch };
                continue;
            }
            clean += ch;
        }
        tags = tags.sort((a, b) => { return b.index - a.index; });
        replaced = clean;
        for (const t of tags) {
            const converted = this.convertTag(t.str, defaultTag);
            replaced = replaced.slice(0, t.index) + converted + replaced.slice(t.index);
        }
        return { clean, replaced };
    }
    convertTag(tag, defaultTag) {
        const trimmed = tag.slice(2, tag.length - 1).toLowerCase();
        if (trimmed === "default")
            return this.convertTag(defaultTag, undefined);
        return Internal.TagDef[trimmed] || "";
    }
}
exports.Logger = Logger;
var Log;
(function (Log) {
    let Color;
    (function (Color) {
        Color.red = "$<red>";
        Color.green = "$<green>";
        Color.yellow = "$<yellow>";
        Color.blue = "$<blue>";
        Color.magenta = "$<magenta>";
        Color.cyan = "$<cyan>";
        Color.white = "$<white>";
    })(Color = Log.Color || (Log.Color = {}));
})(Log = exports.Log || (exports.Log = {}));
var Internal;
(function (Internal) {
    Internal.TagDef = {
        "reset": "\x1b[0m",
        "red": "\x1b[31m",
        "green": "\x1b[32m",
        "yellow": "\x1b[33m",
        "blue": "\x1b[34m",
        "magenta": "\x1b[35m",
        "cyan": "\x1b[36m",
        "white": "\x1b[37m",
    };
    class MessageCircleBuffer {
        constructor(size) {
            this.buffer = [];
            this.currentIndex = 0;
            this.maxIndex = size - 1;
            if (size <= 0)
                throw new Error(`Size must be greater than 0 (was ${size})`);
            if ((size & this.maxIndex) !== 0)
                throw new Error(`Size must be a power of 2 (was ${size}).`);
            for (let i = 0; i < size; i++) {
                this.buffer.push(undefined);
            }
        }
        push(msg) {
            this.buffer[this.currentIndex] = msg;
            this.currentIndex = (this.currentIndex + 1) & this.maxIndex;
        }
        get() {
            const buf = [];
            for (let i = 0; i < this.buffer.length; i++) {
                const index = (i + this.currentIndex) & this.maxIndex;
                const msg = this.buffer[index];
                if (msg)
                    buf.push(this.buffer[index]);
            }
            return buf;
        }
    }
    Internal.MessageCircleBuffer = MessageCircleBuffer;
    class Channel {
        constructor(logger, header, logLevel, callback, color) {
            this.push = (...msg) => {
                this.logger.log(this, msg);
            };
            this.logger = logger;
            this.header = header;
            this.logLevel = logLevel;
            this.callback = callback;
            this.color = color;
        }
    }
    Internal.Channel = Channel;
})(Internal || (Internal = {}));
//# sourceMappingURL=logger.js.map