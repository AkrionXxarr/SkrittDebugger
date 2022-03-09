"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
class ConfigProvider {
    /**
     * This function gets called when vscode needs to generate a launch.json config.
     */
    provideDebugConfigurations(folder, token) {
        return [this.buildConfig()];
    }
    /**
     * This function allows config values to be set/changed before
     * the debugger is launched.
     */
    resolveDebugConfiguration(folder, debugConfiguration, token) {
        const extension = vscode.extensions.getExtension("arenanettechops.skritt-debugger");
        debugConfiguration["version"] = extension.packageJSON.version;
        return this.buildConfig(debugConfiguration);
    }
    buildConfig(debugConfig) {
        const config = ConfigProvider.BaseConfig();
        if (debugConfig)
            config["version"] = debugConfig["version"];
        /**
         * This helper function sets config.value = debugConfig.value
         * If the debugConfig value isn't defined, or if debugConfig its self isn't defined,
         * then the provided default value is used instead.
         */
        const setConfig = (key, defaultValue) => {
            if (debugConfig && (debugConfig[key] !== undefined))
                config[key] = debugConfig[key];
            else
                config[key] = defaultValue;
        };
        setConfig("name", "Skritt Debugger");
        setConfig("address", "localhost");
        setConfig("port", 9091);
        setConfig("localRoot", "${workspaceRoot}");
        setConfig("sourceRoot", "asset");
        setConfig("stopOnEntry", false);
        setConfig("validateVersion", true);
        setConfig("supportsCachedBreakpoints", true);
        setConfig("debugLogLevel", 0);
        setConfig("showDebugVariables", false);
        return config;
    }
}
exports.ConfigProvider = ConfigProvider;
(function (ConfigProvider) {
    function BaseConfig() {
        return {
            name: "Skritt Debugger",
            type: "skritt-debugger",
            request: "attach"
        };
    }
    ConfigProvider.BaseConfig = BaseConfig;
})(ConfigProvider = exports.ConfigProvider || (exports.ConfigProvider = {}));
//# sourceMappingURL=config_provider.js.map