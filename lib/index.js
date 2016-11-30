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

var util = require('util'), events = require('events'), uuid = require('node-uuid'), debug = require('debug')('tables');
var Connection = require('./connection');
var asyncForEach = require("async").forEach;

var DataModelBuilder = require("./datamodel");
/**
 * Create a new JSON-RPC client.
 *
 * @api public
 */
exports.createClient = function (port, host, certs) {
    // FIXME: we should not fill-in the Connection with an extra-logic
    return new Client(port, host, certs);
};

const default_update_statistics_interval = 5e3; // 1e4

function Client(port, host, certs) {
    var self = this;

    this.host = host;
    this.port = port;
    if (certs) {
        this.secure = true;
        this.certs = certs;
    }
    this._connection = new Connection();
    this._updates = [];

    this.info = {
        databases: {},
        stats_refresh_interval: 0,
        statistics: {}
    };

    events.EventEmitter.call(this);
}

/**
 * Inherit from `events.EventEmitter`.
 */
util.inherits(Client, events.EventEmitter);

Client.prototype.connect = function (callback) {
    var self = this;

    // TODO: do we really need an echo empty?
    this._connection.expose('echo', function (result) {
        return result(null, '');
    });

    this._connection.expose('update', function (_uuid, result) {
        debug('ERR: ', _uuid, result);
        self._updates.unshift(result);
        // we always send OK
        return result(null, '');
    });

    /*
     * do a connection
     */

    var connect;
    if (this.secure) {
        connect = function (port, host, callback) {
            self._connection.secure_connect(port, host, self.certs, callback);
        };
    } else {
        connect = this._connection.connect.bind(this._connection);
    }
    connect(this.port, this.host, function (remote, authorized, auth_error) {
        self.authorized = authorized;
        self.auth_error = auth_error;
        remote.call('list_dbs', null, function (err, result) {
            if (err) {
                callback(err, null);
                return;
            }
            asyncForEach(result, function (db_name, next) {
                var database = {
                    name: db_name,
                    statistics: {},
                };
                remote.call('get_schema', database.name, function (err, result) {
                    database.schema = result;
                    var data_model = DataModelBuilder(self, database.name, database.schema);
                    database.model = data_model;
                    self.info.databases[database.name] = database;
                    next();
                });
            }, function (err) {
                // notify that we're connected to an OVS database

                // subscribe to notifications
                // FIXME: need to fix an issue with multiple monitoring (initiated by page and deviceview)
                self.start_monitor("Bridge", ['name']);
                self.start_monitor("Port", ['name']);
                // self.start_monitor("Controller", [ 'target' ]);
                // self.start_monitor("Manager", [ 'target' ]);

                self.start_monitor_statistics();

                if (callback) {
                    callback(null, remote);
                }
            });
        });
    });

    this._connection.on("error", function (err) {
        callback(err, null);
    });
};

Client.prototype.close = function () {
    var self = this;
    self._connection.end();
    // clearInterval(this.info.statistics.refresh_interval);
    clearInterval(this.info.stats_refresh_interval);
};

Client.prototype.connected = function () {
    return this._connection._connected;
};

Client.prototype.database = function (dbname) {
    if (dbname === undefined) {
        // select first database if not specified
        return this.info.databases[this.databases()[0]].model;
    }
    return this.info.databases[dbname].model;
};

Client.prototype.db_schema = function (dbname) {
    if (dbname === undefined) {
        return this.info.databases[this.databases()[0]].schema;
    }
    return this.info.databases[dbname].schema;
};

Client.prototype.databases = function () {
    return Object.keys(this.info.databases);
};

Client.prototype.statistics = function (dbname, intf, callback) {
    // need to add maximum diff
    if (intf == "*") {
        callback(null, this.info.statistics);
    } else {
        callback(null, this.info.statistics[intf]);
    }
};


Client.prototype.select = function (dbname, table, where, columns, callback) {
    if (arguments.length == 3) {
        callback = where;
        where = null;
        columns = null;
    }

    if (arguments.length == 4) {
        callback = columns;
        columns = null;
    }

    if (!where) {
        where = [];
    }

    var operation = {
        op: 'select',
        table: table,
        where: where,
    };

    if (columns) {
        if (!(columns instanceof Array)) {
            columns = [columns];
        }
        operation.columns = columns;
    }

    this._connection._remote.call('transact', dbname, operation, function (err, result) {
        if (err)
            return callback(err);
        if (callback) {
            callback(err, result[0].rows);
        }
    });
};

Client.prototype.multicall = function (dbname) {
    var self = this;
    var multicall = {};
    multicall.operations = [];
    multicall.add = function (operation) {
        multicall.operations.push(operation);
    };
    multicall.call = function (callback) {
        self._connection._remote.call('transact', dbname, multicall.operations, callback);
    };

    return multicall;
};

Client.prototype.raw_request = function (operation, callback) {
    var self = this;
    var dbname = "Open_vSwitch";
    var remote = this._connection._remote;

    debug(operation);
    remote.call('transact', dbname, operation, function (err, result) {
        debug(result);
        if (callback) {
            callback(result);
        }
    });
};

Client.prototype.ping = function (callback) {
    var self = this;
    var remote = this._connection._remote;

    remote.call('list_dbs', null, function (err) {
        if (callback) {
            callback(err);
        }
    });
};

Client.prototype.start_monitor = function (table, columns, callback) {
    var self = this;
    var dbname = "Open_vSwitch";
    var remote = this._connection._remote;

    var monitor_request = {};
    monitor_request[table] = {
        columns: columns
    }

    debug(JSON.stringify(monitor_request));

    remote.call('monitor', dbname, uuid.v4(), monitor_request, function (err, data) {
        debug(err, data);
        if (callback) {
            callback();
        }
    });
}

Client.prototype.start_monitor_statistics = function (num) {
    var self = this;
    const max_number_of_entries = num || 100;

    var dbname = "Open_vSwitch";

    if (!this.info.stats_refresh_interval) {
        // TODO: add support for multiple databases
        // asyncForEach(Object.keys(self.info.databases), function (name, next) {
        this.info.stats_refresh_interval = setInterval(function () {
            self.database(dbname).bridges().each(function (bridge, next_bridge) {
                bridge.data(function (err, data) {
                    if (!err) {
                        bridge.ports().each(function (port, next_port) {
                            port.data(function (err, data) {
                                if (!err) {
                                    port.interfaces().each(function (intf, next_intf) {
                                        intf.data(function (err, data) {
                                            if (!err) {
                                                var name = data.name;
                                                //console.log(name);

                                                // TODO: add rx/tx stats
                                                var stats = data.statistics[1].filter(function (elem) {
                                                    return (elem[0] == 'rx_bytes' || elem[0] == 'tx_bytes');
                                                });

                                                // get all stats (tx/rx)
                                                var value = (stats.length > 0) ? stats[0][1] + stats[1][1] : 0

                                                // for debugging only
                                                if (!self.info.statistics[name]) {
                                                    self.info.statistics[name] = [];
                                                    self.info.statistics[name].last = value;
                                                }


                                                if (self.info.statistics[name].length > max_number_of_entries) {
                                                    self.info.statistics[name].shift();
                                                }
                                                var tmp = value;
                                                value -= self.info.statistics[name].last;

                                                // do interpolate
                                                {
                                                    var sum = value;
                                                    var len = self.info.statistics[name].length;
                                                    var idx = 0;

                                                    while (len - idx > 0 && idx < 2) {
                                                        sum += self.info.statistics[name][len - idx - 1].value;
                                                        idx++;
                                                    }
                                                    var res = (sum / (idx + 1)) >>> 0;

                                                    // FIXME: need to optimize this
                                                    var time = new Date();
                                                    var info = {
                                                        date: time,
                                                        value: (value / 5) << 3 >>> 0 /* res */
                                                    };
                                                    self.info.statistics[name].last = tmp
                                                    self.info.statistics[name].push(info);
                                                }

                                                next_intf();
                                            } else next_intf(err);
                                        });
                                    }, function (err) {
                                        // when we're done
                                    });
                                    next_port();
                                } else next_port(err);
                            });
                        }, function (err) {
                            // when we're done
                        });
                        next_bridge();
                    } else next_bridge(err);
                });
            }, function (err) {
                // when we're done
                if (err) {
                    console.error(new Date().getTime(), ': fetch failed with ...', err, '...');
                }
            });
        }, default_update_statistics_interval);
    }
}

/**
 * Retrieves updates from "MONITOR" messages
 *
 * @param clear
 *          do clean of updates
 * @param callback
 *          call with results
 */
Client.prototype.retrieve_updates = function (count, callback) {
    var updates = ((count == -1) ? this._updates : this._updates.slice(-count));

    debug(JSON.stringify(updates));

    if (callback) {
        callback(updates);
    }
};

Client.prototype.clear_updates = function (callback) {
    this._updates.clear();

    if (callback) {
        callback();
    }
};
