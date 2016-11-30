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

function SchemaParser(schema, table) {
    this.schema = schema;
    this.table = table;
}

SchemaParser.prototype.get_columns_with_refs = function (tbl) {
    var table = tbl || this.table;

    // TODO: add caching of results
    var result = {};

    var table_schema = this.schema.tables[table];
    for (var column_name in table_schema.columns) {
        if (!table_schema.columns.hasOwnProperty(column_name))
            continue;

        var column_schema = table_schema.columns[column_name];
        if (column_schema.type instanceof Object) {
            if (column_schema.type.key && column_schema.type.key.refTable) {
                result[column_name] = {
                    refTable: column_schema.type.key.refTable,
                    place: "key"
                };
            }
            if (column_schema.type.value && column_schema.type.value.refTable) {
                result[column_name] = {
                    refTable: column_schema.type.value.refTable,
                    place: "value"
                };
            }
        }
    }

    result["_uuid"] = { refTable: table }
    return result;
};

/**
 * Retrieves an index table to display it a tiles/table view if indexes key array is not specified
 *
 * @param tbl
 *          Table name
 * @returns {String} Column treated as an index
 */
SchemaParser.prototype.name_column = function (tbl) {
    var res;
    var table = tbl || this.table;

    // tables Controller and SSL does not have an indexes array, so manually return an 'index' column
    switch (table) {
        case "Controller":
        case "Manager":
            res = "target";
            break;
        case "SSL":
            res = "certificate";
            break;
        case "IPFIX":
        case "FlowTable":
        case "sFlow":
        case "NetFlow":
        case "QoS":
        case "Queue":
        case "Open_vSwitch":
        case "Flow_Sample_Collector_Set":
            res = "_uuid";
            break;
        default:
            var table_schema = this.schema.tables[table];
            if (table_schema.columns.name) {
                res = "name";
            } else if (table_schema.indexes && table_schema.indexes[0]) {
                res = table_schema.indexes[0][0];
            }
            break;
    }
    return res;
};

SchemaParser.prototype.tables = function () {
    return Object.keys(this.schema.tables);
};

module.exports = SchemaParser;
