[![ovsdb-client Logo](http://plvision.eu/wp-content/themes/plvision/img/plvision-logo.png)](http://plvision.eu/)

Fast OVSDB client for [node](http://nodejs.org).

## Prerequirements
ovsdb-client requires an opened OVS database port. In most cases it is enough to perform this action on a server side. This will open OVSDB port in passive mode on port 6640 (OVSDB default).
```bash
 $ sudo ovs-vsctl set-manager ptcp:6640 
```

## Installation using npmjs
```bash
 $ npm install --save ovsdb-client
```

## Installation from Github
```bash
 $ git clone https://github.com/plvisiondevs/ovsdb-client.git
 $ cd ovsdb-client
 $ npm install
```

## Sample usage
Retrieve schame for table 'Ports' from OVS database.
```javascript
 var client = require('ovsdb-client');
 var db_name = 'Open_vSwitch';
 var table_name = 'port'
 // retrieve 'Port' table schema from OVS Database
 var table = client.db_schema(db_name).tables[table_name];
 console.log(json.stringify(table));
```

## People
Copyright (c) 2014-2016 PLVision
Authors of ovsdb-client are Ihor Chumak and Roman Gotsiy (developers@plvision.eu).
Maintainer: Ihor Chumak (developers@plvision.eu)

## License
 [MIT](LICENSE)
