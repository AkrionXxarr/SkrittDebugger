# SkrittDebugger
A somewhat specialized Duktape debugger extension for VSCode that I wrote and maintained while working at ArenaNet ([Skritt Debugger](https://marketplace.visualstudio.com/items?itemName=arenanettechops.skritt-debugger)). It was originally written in Typescript; this is the transpiled javascript (after some cleanup by me) that can be obtained via the VSCode extension.

Some of the challenges involved dealing with the highly asynchronous nature of TCP communication which is how the debugger talked with Duktape.

### Some noteworthy features include:
* Moving breakpoints set on invalid lines to the next nearest valid line
* Conditional breakpoints (both hit count and evaluated)
* Ring-buffer-based logging system that supports channels with log levels. All logs are kept in the ring buffer but any log that comes from a channel whose level is below the set log level also get passed to a callback on the channel. One use of this would be to echo the log to the VSCode console.
    * Debugger has log channels for everything from critical errors to the raw TCP comm traffic
    * If ever an unrecoverable exception occurs the entire message log is saved to file to help with debugging.
* Custom Variable-Length Quantity (VLQ) interpeter
