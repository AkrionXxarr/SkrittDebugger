"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const net = require("net");
const { ConfigProvider } = require("./config_provider");
class Server {
    constructor() {
        this.server = net.createServer((socket) => {
            socket.on("data", (data) => {
                this.startDebugging.call(this, vscode.workspace.workspaceFolders[0], this.getConfiguration());
            });
        });
    }
    run() {
        if (this.server.listening)
            return;
        const pipeName = `\\\\.\\pipe\\skritt_debugger\\signal_auto_attach`;
        this.server.listen(pipeName)
            .on("error", (err) => {
            if (err.message.indexOf("EADDRINUSE") !== -1) {
                vscode.window.showErrorMessage("Another window already has Auto Attach enabled.");
            }
            else {
                console.error(err);
                vscode.window.showErrorMessage(err.message);
            }
            this.server.close();
        })
            .on("listening", () => {
            vscode.window.showInformationMessage(`Skritt Debugger: Auto Attach enabled.`);
        });
    }
    stop() {
        if (!this.server.listening)
            return;
        this.server.close();
        vscode.window.showInformationMessage(`Skritt Debugger: Auto Attach disabled.`);
    }
    startDebugging(folder, config) {
        if (vscode.debug.activeDebugSession !== undefined) {
            return;
        }
        vscode.debug.startDebugging(folder, config)
            .then((value) => {
        }, (err) => {
            vscode.window.showErrorMessage(`Debugger failed to start: ${err.toString()}`);
        });
    }
    getConfiguration() {
        // Attempt to find a launch.json configuration first.
        const launch = vscode.workspace.getConfiguration("launch");
        if (launch) {
            const launchConfigs = launch["configurations"];
            if (launchConfigs) {
                for (const cfg of launchConfigs) {
                    if (cfg["type"] === ConfigProvider.BaseConfig().type)
                        return cfg;
                }
            }
        }
        // A launch.json config couldn't be found, use the base config.
        return ConfigProvider.BaseConfig();
    }
}
exports.Server = Server;
//# sourceMappingURL=server.js.map