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

var util = require('util');
var events = require('events');
var debug = require('debug')('jsonsp');

function Parser(options, objectListener) {
    if (!objectListener && typeof options === 'function') {
        objectListener = options;
        options = null;
    }

    options = options || {};
    this.buffer = "";
    this.depth = 0;
    self = this;
    this.pos = 0;

    events.EventEmitter.call(this);

    this.addListener('object', objectListener);
}


/**
 * Inherit from 'events.EventEmitter'.
 */
util.inherits(Parser, events.EventEmitter);

Parser.prototype.parse = function (chunk) {
    var data = chunk.toString();

    for (var i = this.pos; i < data.length; i++) {
        c = data.charAt(i);
        if (c === '{') {
            this.depth++;
        } else if (c == '}') {
            this.depth--;
            if (this.depth === 0) {
                var object = JSON.parse(this.buffer + data.substr(0, i + 1));
                this.emit("object", object);
                this.buffer = "";
                data = data.substr(i + 1);
                this.pos = 0;
                i = -1;
            }
        }
    }
    this.buffer += data;
};

module.exports = Parser;
