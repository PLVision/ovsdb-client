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

var asyncForEach = require("async").forEach;
var SchemaParser = require('./schema-parser');
var debug = require('debug')('datamodel');

function Model(client, db_name, corresponding_table) {
    this.corresponding_table = corresponding_table;
    this.client = client;
    this.db_name = db_name;
    this.schema = new SchemaParser(client.info.databases[db_name].schema, corresponding_table);
}

Model.prototype.tableByName = function (tbl_name) {
    var method_name = tbl_name.toLowerCase() + "s";
    if (this[method_name] instanceof Function) {
        return this[method_name].call(this);
    } else {
        var err = new Error('Table not found');
        err.status = 404;
        err.table = tbl_name;
        throw err;
    }
};

Model.prototype._resolveCrossLinks = function (data, callback) {
    var self = this;
    // FIXME: change this to using singleton
    var model = DataModelBuilder(this.client, this.db_name, this.client.info.databases[this.db_name].schema);
    var columns_with_refs = this.schema.get_columns_with_refs(this.corresponding_table);
    var return_cell = false;

    if (!(data instanceof Array)) {
        data = [data];
        return_cell = true;
    }
    asyncForEach(Object.keys(data), function (row_idx, next_row) {
        var row = data[row_idx];
        asyncForEach(Object.keys(columns_with_refs), function (ref_col, next_col) {
            if (!row.hasOwnProperty(ref_col)) {
                return next_col();
            }

            var cell = row[ref_col];

            if (!(cell instanceof Array && cell.length)) {
                return next_col();
            }

            var refTable = columns_with_refs[ref_col].refTable;
            var name_column = self.schema.name_column(refTable);

            if (refTable === self.schema.table) {
                var name = row[name_column];
                cell.push(name, refTable);
                return next_col();
            }
            // else
            if (cell[0] == "uuid") {
                model.tableByName(refTable).get(cell[1]).column(name_column, function (err, col_data) {
                    if (err) {
                        return next_col(err);
                    }
                    var name = col_data[0][name_column];
                    cell.push(name, refTable);
                    next_col();
                });
            } else if ((cell[0] == "set") || ((cell[0] == "map"))) {
                var items = cell[1];
                asyncForEach(Object.keys(items), function (item_idx, next_item) {
                    var item = items[item_idx];

                    if (!(item instanceof Array && cell.length)) {
                        return next_item();
                    }

                    var reference;

                    function isMappedUuid(item) {
                        return (item[0] instanceof Array) && item[0].length && (item[0][0] == "uuid");
                    }

                    function isNamedUuid(item) {
                        return ((!(item[0] instanceof Array)) && item[1].length && (item[1][0] == "uuid"));
                    }

                    if ((item[0] == "uuid") || isNamedUuid(item) || isMappedUuid(item)) {
                        if (isNamedUuid(item)) {
                            item = item[1];
                        } else if (isMappedUuid(item)) {
                            item = item[0];
                        }
                        /* here we are sure that item[1] contains uuid */
                        model.tableByName(refTable).get(item[1]).column(name_column, function (err, col_data) {
                            if (err) {
                                return next_item(err);
                            }
                            var name = col_data[0][name_column];
                            item.push(name, refTable);
                            next_item();
                        });
                    }
                }, function () {
                    next_col();
                });
            } else {
                next_col();
            }
        }, function (err) {
            next_row();
        });
    }, function (err) {
        if (return_cell) {
            data = data[0];
        }
        callback(err, data);
    });
};

Model.prototype._resolve_refs_proxy = function (callback) {
    var self = this;
    return function (err, data) {
        if (err) {
            return callback(err);
        }
        self._resolveCrossLinks(data, callback);
    };
};

Model.build_objects_tree = function (callback) {
    var refs = this.schema.get_columns_with_refs(this.co)
};

// Inherited from Model
function ObjectsCollection(client, db_name, corresponding_table, object_constr, parent, parent_ref_col) {
    Model.call(this, client, db_name, corresponding_table);

    this.ObjectConstructor = object_constr;
    this.parent = parent;
    this.parent_ref_col = parent_ref_col;
}
// Inheritance
ObjectsCollection.prototype = Object.create(Model.prototype);

ObjectsCollection.prototype._getElement = function (id) {
    if ((id instanceof Array) && (id[0] === "uuid")) {
        id = id[1];
    }
    return new this.ObjectConstructor(id, this);
};

ObjectsCollection.prototype.get = function (id) {
    return this._getElement(id);
};

ObjectsCollection.prototype.find = function (col, value) {
    // FIXME finish implementation of this method following the example of method 'find_by_name'
    return new FindObjectsCollection(this.client, this.db_name, this.corresponding_table, this.ObjectConstructor,
        this.parent, this.parent_ref_col, {
            find_by_col: col,
            find_value: value
        });
};

ObjectsCollection.prototype.find_by_name = function (value) {
    var col = this.schema.name_column(this.corresponding_table);
    var res = new FindObjectsCollection(this.client, this.db_name, this.corresponding_table, this.ObjectConstructor,
        this.parent, this.parent_ref_col, {
            find_by_col: col,
            find_value: value
        });

    // FIXME dirty hack. To be overwritten
    res.__proto__ = Object.create(this.__proto__);
    res.__proto__._select = FindObjectsCollection.prototype._select;
    return res;
};

ObjectsCollection.prototype._uuids_by_parent = function (callback) {
    var self = this;
    var uuids = [];
    if (self.parent) {
        self.parent.each(function (obj, next) {
            obj.column(self.parent_ref_col, function (err, col) {
                if (err) {
                    return next();
                }

                for (var row_id = 0; row_id < col.length; col++) {
                    var cell = col[row_id][self.parent_ref_col];
                    if ((cell instanceof Array) && (cell[0] != "uuid")) {
                        if (cell[0] == "set") {
                            for (var record_id = 0; record_id < cell[1].length; record_id++) {
                                uuids.push(cell[1][record_id]);
                            }
                        } else {
                            //TODO add maps handling
                            next();
                        }
                    } else {
                        uuids.push(cell);
                    }
                }
                next();
            });
        }, function (err) {
            callback(err, uuids);
        });
    } else {
        self.client.select(self.db_name, self.corresponding_table, [], "_uuid", callback);
    }
};

/* select objects based on parent element */
ObjectsCollection.prototype._select = function (where, columns, callback) {
    var self = this;

    if (self.parent) {
        this._uuids_by_parent(function (err, uuids) {
            if (err)
                return callback(err);
            var multicall = self.client.multicall(self.db_name);
            for (var i = 0; i < uuids.length; i++) {
                var operation = {
                    op: 'select',
                    table: self.corresponding_table,
                    where: [["_uuid", "==", uuids[i]]]
                };

                operation.where.push.apply(operation.where, where);
                if (columns) {
                    operation.columns = columns;
                }
                multicall.add(operation);
            }

            multicall.call(function (err, data) {
                var result_rows = [];

                if (err) {
                    return callback(err);
                }

                for (var i = 0; i < data.length; i++) {
                    for (var j = 0; j < data[i].rows.length; j++) {
                        result_rows.push(data[i].rows[j]);
                    }
                }
                self._resolve_refs_proxy(callback).call(self, null, result_rows);
            });
        });
    } else {
        if (columns) {
            self.client.select(self.db_name, self.corresponding_table, where, columns, self._resolve_refs_proxy(callback));
        } else {
            self.client.select(self.db_name, self.corresponding_table, where, self._resolve_refs_proxy(callback));
        }
    }
};

ObjectsCollection.prototype.list = function (with_cols, callback) {
    var cols = ["_uuid"];

    if (!callback) {
        callback = with_cols;
        with_cols = null;
    }

    if (with_cols) {
        cols.push.apply(cols, with_cols);
    }
    this._select([], cols, function (err, data) {
        if (err) {
            callback(err);
        } else {
            for (var i = 0; i < data.length; i++) {
                data[i]._uuid = data[i]._uuid[1];
            }
            callback(null, data);
        }
    });
};

ObjectsCollection.prototype.each = function (callback, done) {
    var self = this;

    this.list(function (err, data_rows) {
        debug(err, data_rows);
        if (err) {
            done(err);
        } else {
            asyncForEach(Object.keys(data_rows), function (index, next) {
                debug(index);
                var element = self._getElement(data_rows[index]._uuid);
                callback(element, next);
            }, done);
        }
    });
};

ObjectsCollection.prototype.data = function (cols, callback) {
    if (!callback) {
        callback = cols;
        cols = null;
    }
    this._select([], cols, callback);
};

/** ************* */
// Inherited from Model
function DbObject(client, db_name, corresponding_table, id, parent) {
    Model.call(this, client, db_name, corresponding_table);
    this.id = id;
    this.parent = parent;
}

function FindObjectsCollection(client, db_name, corresponding_table, object_constr, parent, parent_ref_col,
    find_criteria) {
    Model.call(this, client, db_name, corresponding_table);

    this.ObjectConstructor = object_constr;
    this.parent = parent;
    this.parent_ref_col = parent_ref_col;
    this.find_by_col = find_criteria.find_by_col;
    this.find_value = find_criteria.find_value;

    if (this.find_by_col === "_uuid") {
        this.find_value = ["uuid", this.find_value]
    }
}
// Inheritance
FindObjectsCollection.prototype = Object.create(ObjectsCollection.prototype);

// Overriding _select method

FindObjectsCollection.prototype._select = function (where, columns, callback) {
    var self = this;

    where.push.apply(where, [this.find_by_col, "==", this.find_value]);
    ObjectsCollection.prototype._select.call(this, [where], columns, self._resolve_refs_proxy(callback));
};

// Inheritance
DbObject.prototype = Object.create(Model.prototype);

DbObject.prototype.data = function (cols, callback) {
    var self = this;
    /* temporarily doesn't check if this object is a child of its parent - just selects an object by uuid */
    // TODO: do we really need these?
    if (!callback) {
        callback = cols;
        cols = null;
    }
    this.client.select(this.db_name, this.corresponding_table, [["_uuid", "==", ["uuid", this.id]]], cols,
        function (err, data) {
            // TODO: add checking if data is not empty
            if (data instanceof Array) {
                data = data[0];
            }
            self._resolve_refs_proxy(callback).call(self, err, data);
        });
};

DbObject.prototype.each = function (callback, done) {
    var objects = [this];
    asyncForEach(objects, function (element, next) {
        callback(element, next);
    }, done);
};

DbObject.prototype.column = function (col_name, callback) {
    this.client.select(this.db_name, this.corresponding_table, [["_uuid", "==", ["uuid", this.id]]], col_name,
        callback);
};

function DataModelBuilder(client, db_name, schema) {
    var DataModel = function DataModel() {
    };

    DataModel.prototype.tableByName = Model.prototype.tableByName;

    DataModel.prototype.list_tables = function (callback) {
        callback(null, schema_parser.tables());
    };

    var schema_parser = new SchemaParser(schema);
    tables = schema_parser.tables();

    var table_classes = {};
    var object_classes = {};

    var create_method = function (tbl_name, ref_col) {
        return function () {
            var parent = null;
            if (this instanceof Model) {
                parent = this;
            }
            return new table_classes[tbl_name](parent, ref_col);
        };
    };

    var create_api = function (TableClass, table) {
        refs = schema_parser.get_columns_with_refs(table);
        for (var ref_col in refs) {
            var refTable = refs[ref_col].refTable;
            var method_name = refTable.toLowerCase() + "s";

            TableClass.prototype[method_name] = create_method(refTable, ref_col);
        }
    };

    var create_collection_class = function (tbl_name) {
        var TableClass = function (parent, parent_col) {
            ObjectsCollection.call(this, client, db_name, tbl_name, object_classes[tbl_name], parent, parent_col);
        };
        TableClass.prototype = Object.create(ObjectsCollection.prototype);
        return TableClass;
    };

    var create_object_class = function (tbl_name) {
        var ObjClass = function (id, parent) {
            DbObject.call(this, client, db_name, tbl_name, id, parent);
        };
        ObjClass.prototype = Object.create(DbObject.prototype);
        return ObjClass;
    };

    for (var i = 0; i < tables.length; i++) {
        var tbl_name = tables[i];
        var ObjClass = create_object_class(tbl_name);
        object_classes[tbl_name] = ObjClass;
        var TableClass = create_collection_class(tbl_name);
        table_classes[tbl_name] = TableClass;
        create_api(table_classes[tbl_name], tbl_name);
        create_api(object_classes[tbl_name], tbl_name);
    }

    for (i = 0; i < tables.length; i++) {
        var tbl_name = tables[i];

        var method_name = tbl_name.toLowerCase() + "s";
        DataModel.prototype[method_name] = create_method(tbl_name, null);
    }

    return new DataModel();
}

module.exports = DataModelBuilder;
