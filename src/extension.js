'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const { Server } = require("./server");
const { ConfigProvider } = require("./config_provider");
const server = new Server();

function activate(context) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("skritt-debugger", new ConfigProvider()));
    context.subscriptions.push(vscode.commands.registerCommand("skritt.enableAutoAttach", () => server.run()), vscode.commands.registerCommand("skritt.disableAutoAttach", () => server.stop()));
}
exports.activate = activate;
function deactivate() {
    server.stop();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map