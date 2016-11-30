/*
 * Open vMonitor is a WEB-based tool for monitoring and troubleshooting Open vSwitch
 * Copyright (C) 2014-2016  PLVision
 * Ihor Chumak, Roman Gotsiy
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

/**
 * Module dependencies.
 */
var events = require('events');
var net = require('net');
var util = require('util');
var jsonsp = require('./jsonsp');
var remote = require('./remote');
var debug = require('debug')('connection');
var tls = require('tls');

/**
 * Create a new JSON-RPC connection.
 */
function Connection() {
    var _this = this;

    this._stream = undefined;

    events.EventEmitter.call(this);
    this._methods = {};
    this._connected = false;

    this._parser = new jsonsp(function (obj) {
        if (obj.result !== undefined || obj.error !== undefined) {
            _this.emit('response', obj);
        } else if (obj.id !== null) {
            _this.emit('request', obj);
            debug('rec echo: ', obj)
            _this._handleRequest(obj);
        } else {
            _this.emit('notification', obj);
            _this._handleRequest(obj);
        }
    });

    this._parser.addListener('error', function (err) {
        _this.emit('error', err);
        _this.end();
    });
}
/**
 * Inherit from `events.EventEmitter`.
 */
util.inherits(Connection, events.EventEmitter);

Connection.prototype.expose = function (name, service) {
    if (!service && typeof name == 'object') {
        service = name;
        name = null;
    }

    if (typeof service == 'function') {
        this._methods[name] = service;
    } else if (typeof service == 'object') {
        var module = name ? name + '.' : '';
        for (var method in service) {
            if (typeof service[method] === 'function') {
                this._methods[module + method] = service[method].bind(service);
            }
        }
    }
};

Connection.prototype.connect = function (port, host, callback) {
    var _this = this;
    if ('function' == typeof host) {
        callback = host;
        host = null;
    }

    if (callback) {
        this.once('connect', callback);
    }

    this._socket = this._socket || new net.Socket();

    this._socket
        .removeAllListeners('connect')
        .addListener('connect', function () {
            _this._remote = new remote(_this);
            _this.emit('connect', _this._remote);
            _this._connected = true;
        });

    this._socket
        .removeAllListeners('timeout')
        .addListener('timeout', this.emit.bind(this, 'timeout'));

    // FIXME: experimental
    this._socket
        .removeAllListeners('error')
        .addListener('error', this.emit.bind(this, 'error'));


    this._stream = this._socket; // socket implement stream interface in case of plaintext connection
    this.attach_stream_handlers();
    this._socket.connect(port, host);
};

Connection.prototype.secure_connect = function (port, host, certs, callback) {
    var _this = this;
    if ('function' == typeof host) {
        callback = host;
        host = null;
    }

    if (callback) {
        this.once('connect', callback);
    }

    var options = {
        key: certs.private_key,
        cert: certs.certificate,
        // This is necessary only if the server uses the self-signed certificate
        ca: certs.ca_certificate,

        port: port,
        host: host,
        rejectUnauthorized: false
    };

    this._stream = tls.connect(options);

    this._stream.addListener('secureConnect', function () {
        _this._remote = new remote(_this);
        _this.emit('connect', _this._remote, _this._stream.authorized, _this._stream.authorizationError);
        _this._connected = true;
    });

    this.attach_stream_handlers();
};

Connection.prototype.attach_stream_handlers = function () {
    var _this = this;
    this._stream.setEncoding('utf8');
    this._stream
        .removeAllListeners('data')
        .addListener('data', function (data) {
            debug('RECV: ' + data);
            _this._parser.parse(data);
        });
    this._stream.removeAllListeners('end').addListener('end', this.emit.bind(this, 'end'));
    this._stream.removeAllListeners('drain').addListener('drain', this.emit.bind(this, 'drain'));
    this._stream.removeAllListeners('error').addListener('error', this.emit.bind(this, 'error'));
    this._stream
        .removeAllListeners('close')
        .addListener('close', function (had_error) {
            _this._connected = false;
            debug("socket closed", had_error);
            _this.emit('close', had_error);
        });
}

Connection.prototype.send = function (obj) {
    if (this._stream.writable) {
        this._stream.write(JSON.stringify(obj));
    }
};


/**
 * Close connection
 *
 * @api private
 */
Connection.prototype.end = function () {
    if (this._socket) {
        this._socket.destroy();
    }
    this._connected = false;
};

/**
 * Handle request.
 *
 * @api private
 */
Connection.prototype._handleRequest = function (req) {
    var _this = this;

    function result(err, res) {
        // requests without an id are notifications, to which responses are
        // suppressed
        if (req.id !== null) {
            if (err) {
                return _this.send({
                    id: req.id,
                    result: null,
                    error: err.message
                });
            }

            _this.send({
                id: req.id,
                result: "",
                error: null
            });
        }
    }

    var method = this._methods[req.method];
    if (typeof method == 'function') {
        var params = req.params || [];

        // push result function as the last argument
        params.push(result);

        // invoke the method
        try {
            method.apply(this, params);
        } catch (err) {
            result(err);
        }
    } else {
        result(new Error('Method Not Found'));
    }
};

/**
 * Export `Connection`.
 */

module.exports = Connection;
