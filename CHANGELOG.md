# Change Log
All notable changes to the "skritt-debugger" extension will be documented in this file.

## 1.5.12
- Fix bug with property set variables showing for the wrong stack frame.
- Fix case where getters were being evaluated against the wrong stack frame.
- Fix duplicate variables being stored with property sets.
- Added the ability to dump session state data.
- Update hidden symbol prefix.

## 1.5.11
- Fix bug with message parser getting corrupted when reciving a partial framed message along with the intial unframed handshake.

## 1.5.10
- Change how stack frames with unmapped lines are handled.
- Fix bug in getObjPropDescRange request builder.
- Made the failure output for --dumpSrcData more clear.

## 1.5.9
- Fix bug with conditional breakpoints.
- Provide additional logging information at the end of a log dump.

## 1.5.8
- Fix 'unused' values not being ignored.
- Switch auto-attach from using a network socket to using a named pipe.

## 1.5.7
- Fix bug for --ignoreLastException command where there isn't data for the last exception thrown.

## 1.5.6
- Add --ignoreLastException command to have the debugger ignore any further exceptions on that line and file.
- Fix exception that could occur on disconnect in some cases.
- Small tweaks to how custom REPL commands are responded to.

## 1.5.5
- Fix maps keyed by numbers not being evaluated correctly.

## 1.5.4
- Fix arrays not being evaluated correctly in certain scenarios.
- Fix --setLogLevel not working.
- Convert class-type debug output to use the class string rather than the class ID.

## 1.5.3
- Refactored logging system. 
- Better debug log coloring.
- Log files will now be generated in the event of exceptions or user request.

## 1.5.2
- Adjusted logic used for moving breakpoints to nearest valid line.
- Changed it so breakpoints which don't have a mapped line are made invalid.
- Fix a case where SourceLoaded wasn't properly handling an empty source path.
- Fix a case where a watch list variable could throw an exception.

## 1.5.1
- Fix package-related crash bug.

## 1.5.0
- Add ability for debugger to be signaled externally to attach.
- Unverified breakpoints are now cached so the debugger can attempt to add them later after the appropriate notification.
- Lots of code refactoring.
- Better error handling.
- Make use of new DebugConfigurationProvider

## 1.4.0
- Add a way for the debugger to grab its own version.
- Add optional version validation, which will allow the target to enforce debugger versions.
- Implement check for missing launch.json arguments.
- Restructure app notification code.

## 1.3.0
- Adjust how the stack trace is obtained, making use of the ability to opt out of delayed stack trace loading.

## 1.2.1
- Fix small typo in README.

## 1.2.0
- Fix callstack bug caused from change in stackTrace protocol on VSCode's side.

## 1.1.6
- Fix a couple exception handling related bugs.
- Changed presentation hint for "[Duktape Runtime]" stack frames.

## 1.1.5
- Implement workaround for exception widget bug in VSCode version 1.12
- Pre-emptively change how watch variables are evaluated to prepare for VSCode's update in May.

## 1.1.4
- Some code improvements.

## 1.1.3
- Minor improvements to stop reason hover over text.

## 1.1.2
- Fix exception peek UI not showing.

## 1.1.1
- Fix stack frames that are outside of script not being deemphasized properly.

## 1.1.0
- Implement support for conditional expression and hit count breakpoints.

## 1.0.6
- Protocol will now time out during the handshake phase after 5 seconds and inform the user accordingly.

## 1.0.5
- Reformatted the exception message to read more clearly.

## 1.0.4
- Replace the temp debugger icon.

## 1.0.3
- Fix arrays not being updated properly in the watch list when elements are unshifted onto them.

## 1.0.2
- Fix VSCode "request failed" error message that would sometimes show when breakpoints couldn't be set due to a missing source map.

## 1.0.1
- Fix case where breakpoints weren't being moved properly for arrow functions.
- Breakpoints are no longer cleared if the sourcemap is updated without a modified source pending.

## 1.0.0
- Initial release