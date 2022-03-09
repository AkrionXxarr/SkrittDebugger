"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
const _path = require("path");
var Path;
(function (Path) {
    /**
     * Similar to path.normalize, except also convert backslash to forward slash.
     */
    function normalize(filePath) {
        if (!filePath)
            filePath = "";
        filePath = _path.normalize(filePath);
        filePath = filePath.replace(/\\/g, "/");
        return filePath;
    }
    Path.normalize = normalize;
    /**
     * Convert a file path to use the platform-specific separator.
     */
    function toPlatformSep(filePath) {
        if (!filePath)
            filePath = "";
        filePath = filePath.replace(/[\\/]/g, _path.sep);
        return filePath;
    }
    Path.toPlatformSep = toPlatformSep;
    /**
     * Break a file path down to its simplist form. Rooted at the source root
     * and with its extension trimmed off.
     */
    function simplify(filePath, sourceRoot) {
        if (!filePath)
            throw new Error("filePath must be defined.");
        if (!sourceRoot)
            throw new Error("sourceRoot must be defined.");
        let simplifiedPath = filePath;
        if (_path.isAbsolute(filePath)) {
            // Trim out the common directories between the file path and source root
            const relativePath = _path.relative(sourceRoot, filePath);
            simplifiedPath = normalize(relativePath);
        }
        // Remove the extension.
        simplifiedPath = simplifiedPath.replace(/\.[^.]+$/g, "");
        return normalize(simplifiedPath);
    }
    Path.simplify = simplify;
    /**
     * Build a path from a simplified path, appending an extension as well
     * as prepending an optional source root.
     */
    function build(simplifiedPath, extension, sourceRoot) {
        let path = simplifiedPath.concat(extension);
        if (sourceRoot)
            path = _path.join(sourceRoot, path);
        return normalize(path);
    }
    Path.build = build;
    /**
     * Maps a simplified file path to an arbitrary piece of data.
     */
    class Map {
        constructor(sourceRoot) {
            this.map = {};
            this.sourceRoot = sourceRoot;
        }
        /**
         * Set a filePath->data mapping.
         */
        set(filePath, data) {
            if (filePath === undefined)
                throw new Error("Path must be defined.");
            if (this.map[filePath] !== undefined)
                throw new Error("Mapping already set.");
            const path = simplify(filePath, this.sourceRoot);
            this.map[path] = data;
        }
        /**
         * Get the data mapped to the file path.
         */
        get(filePath) {
            if (!filePath)
                return undefined;
            const path = simplify(filePath, this.sourceRoot);
            return this.map[path];
        }
        /**
         * Return whether data is mapped to the given file path.
         */
        has(filePath) {
            const path = simplify(filePath, this.sourceRoot);
            return this.map[path] !== undefined;
        }
        /**
         * Delete a mapped entry.
         */
        delete(filePath) {
            const path = simplify(filePath, this.sourceRoot);
            delete this.map[path];
        }
        getMapAsArray() {
            const mapArray = [];
            for (const e in this.map) {
                mapArray.push({
                    key: e,
                    data: this.map[e]
                });
            }
            return mapArray;
        }
    }
    Path.Map = Map;
})(Path = exports.Path || (exports.Path = {}));
//# sourceMappingURL=path.js.map