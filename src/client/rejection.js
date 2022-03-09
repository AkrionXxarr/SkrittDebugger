"use strict";
//////////////////////////////////////////////////////////////////////
// Copyright (c) 2017 Arenanet LLC
// Use of this source code is governed by the BSD-3-Clause license.
//
Object.defineProperty(exports, "__esModule", { value: true });
var Rejection;
(function (Rejection) {
    class Ignorable {
        constructor() {
            this.ignorable = true;
        }
    }
    Rejection.Ignorable = Ignorable;
    class Error {
        constructor(message) {
            this.message = message;
        }
    }
    Rejection.Error = Error;
})(Rejection = exports.Rejection || (exports.Rejection = {}));
//# sourceMappingURL=rejection.js.map