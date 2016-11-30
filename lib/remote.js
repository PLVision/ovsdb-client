/*
 * Open vMonitor is a WEB-based tool for monitoring and troubleshooting Open vSwitch
 * Copyright (C) 2014-2016  PLVision
 * Ihor Chumak
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.

 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.

 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.

 * PLVision, developers@plvision.eu
 */

var uuid = require('node-uuid');
var debug = require('debug')('remote');

function Remote(connection) {
    this.timeout = 8000;
    this._connection = connection;
    this._handlers = {};
    this._requestID = 1;

    var _this = this;

    this._connection.addListener('response', function (res) {
        if (res.id === null || res.id === undefined) {
            return;
        }
        var handler = _this._handlers[res.id];
        if (handler) {
            handler.call(this, res.error, res.result);
        }
        delete _this._handlers[res.id];
    });
}

Remote.prototype.call = function (name, params, callback) {
    // v8 optimization fix for 'Array.prototype.slice.call'
    var args = [];
    for (var idx in arguments) {
        args[idx] = arguments[idx];
    }
    params = args;

    var method = params.length ? params.shift() : null;
    callback = (params.length && typeof params[params.length - 1] == 'function') ? params.pop() : null;

    // FIXME: slice it if transact with a multicall
    if (params[1] instanceof Array && name == "transact") {
        params[1].unshift(params[0]);
        params = params[1];
    }

    var req = {
        id: this._requestID++,
        method: method,
        params: params
    };

    this._handlers[req.id] = callback;

    var _this = this;
    setTimeout(function () {
        var handler = _this._handlers[req.id];
        if (handler) {
            handler.call(_this, new Error('Request ' + req.id + ' Timed Out'));
        }
        delete _this._handlers[req.id];
    }, this.timeout);

    try {
        this._connection.send(req);
    } catch (err) {
        // do nothing
    }
};

/**
 * Export `Remote`.
 */
module.exports = Remote;
