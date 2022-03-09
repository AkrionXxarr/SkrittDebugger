# Skritt Debugger
A [Duktape](true/duktape.org) debug client for Visual Studio Code.

## Notes
- This debugger is only designed to debug Typescript.
- Some configuration on the debug target will be necessary before using this debugger. See [Developer Usage](#developer-usage) for details.
- For a more general-use debugger see Harold Brenes' Duktape Debugger extension.

## Client Usage
1. Go to the debug tab and select "Add Configuration" from the dropdown menu.
2. Choose "Skritt Debugger" and save the file.
3. Select "Scratch" from the dropdown menu and either press the green triangle or F5.
4. The debugger should now be attached to the target.

If you have more than one debug option, you can go back into your launch.json and remove the other configs if you desire.<br>
Alternatively you can simply replace everything in your launch.json with the configuration below.

__Skritt Debugger launch.json configuration:__
``` JSON
{
    "version": "0.2.0",
    "configurations": [   
        {
            "name": "Scratch",
            "type": "skritt-debugger",
            "request": "attach",

            "address": "localhost",
            "port": 9091,
            
            "localRoot": "${workspaceRoot}",
            "sourceRoot": "asset",
            
            "stopOnEntry": false,
            "validateVersion": false,
            "supportsCachedBreakpoints": true,
            "debugLogLevel": 0,
            "showDebugVariables": false
          }
    ]
}
```

## Developer Usage
__There are two app requests that must be implemented by the target before this debugger can be used with it:__
1. Pause is handled through an app request with a single string identifier "Pause". 
This is used for instructing duktape to pause in place of the actual pause request. 
Nothing is expected from the reply.
2. Source maps are obtained by requesting them from the target. 
The first parameter is a string identifier "GetMap" followed by another string with a 
path to the typescript file starting at the source root. The reply will be a string 
containing the VLQ source map.

Example request/reply for "Pause":<br>
`[duktape] << REQ <AppRequest> <"Pause"> EOM`<br>
`[duktape] >> REP EOM`<br>

Example request/reply for "GetMap" with a source root of "c:/scripts" and some typescript file "c:/scripts/foo/bar/foobar.ts":<br>
`[duktape] << REQ <AppRequest> <"GetMap"> <"foo/bar/foobar.ts"> EOM`<br>
`[duktape] >> REP <";;;AAAA;IAA8C,mCAAM;IAApD;QAAA,qEAkDC;QAhDU,CAAC;"> EOM`<br><br>

__Three optional app notifications may be implemented:__
1. A string identifier "Log" followed by a string message will log the message to the debug console.
2. A string identifier "UpdateMap" followed by a string path (again starting at the source root) 
and another string containing a VLQ source map will instruct the debugger to update its 
source map for that source file if it already has a source map for that file.
3. A string identifer "SourceLoaded" with the same arguments as "UpdateMap". This notification
is used to allow the debugger to add unverified breakpoints which have been cached 
(assuming "supportsCachedBreakpoints" is true). __Important: The debug target must execute
duk_debugger_pause() after sending this notification. This gives the debugger a chance to
add the breakpoints before the target executes past the breakpoint.__ 

Example app notification for "Log":<br>
`[duktape] >> NFY <"Log"> <"Hello world!"> EOM`<br>

Example app notification for "UpdateMap":<br>
`[duktape] >> NFY <"UpdateMap"> <"foo/bar/foobar.ts"> <"AAAA;IAA8C,mCAAM;"> EOM`<br>

Example app notification for "SourceLoaded":<br>
`[duktape] >> NFY <"SourceLoaded"> <"foo/bar/foobar.ts"> <"AAAA;IAA8C,mCAAM;"> EOM`<br><br>

## References
- [Duktape](true/duktape.org)
- [Duktape debugger.rst](https://github.com/svaarala/duktape/blob/master/doc/debugger.rst)
- [VSCode extension overview](https://code.visualstudio.com/docs/extensions/overview)
- [VSCode example debugger extensions](https://code.visualstudio.com/docs/extensions/example-debuggers)
- [Harold Bernes' VSCode Duktape Debugger](https://github.com/harold-b/vscode-duktape-debug)
- [Source mapping & VLQ Formatting](https://www.thecssninja.com/javascript/source-mapping)
- [More VLQ Formatting](https://blogs.msdn.microsoft.com/davidni/2016/03/14/source-maps-under-the-hood-vlq-base64-and-yoda/)

## License
[BSD-3-Clause](https://opensource.org/licenses/BSD-3-Clause)