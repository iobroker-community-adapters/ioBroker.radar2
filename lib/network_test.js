/* eslint-disable no-console */
"use strict";

const EventEmitter = require('events').EventEmitter;
const oel = EventEmitter.prototype.setMaxListeners;
EventEmitter.prototype.setMaxListeners = function (x) {
    console.log(`${this}`, 'sets maxemitter to ', x);
    //    throw "setMaxListeners";
    oel.bind(this)(x);
};

const A = require('@frankjoke/myadapter').MyAdapter,
    Network = require('../myNetworks').Network,
    Bluetooth = require('../myNetworks').Bluetooth;


let network = new Network(false);
network.on('arp-scan', (found) => A.I(found));
A.debug = true;

let bluetooth = new Bluetooth();
bluetooth.on('found', (arg) => A.I(`${arg.by} Scan found ${A.F(arg)}`));
bluetooth.init();

bluetooth.listPairedDevices().then((x) => A.I(A.F('Paired Devices:', x))).then(() => {
    /*
        const address = 'C0:97:27:10:B8:65';
        if (bluetooth.device) bluetooth.device.findSerialPortChannel(address, function (channel) {
            A.I(A.F('Found RFCOMM channel for serial port on ', address, channel));

            // make bluetooth connect to remote device
            if (channel >= 0)
                bluetooth.nbt.connect(address, channel, function (err, connection) {
                    if (err) return A.E(err);
                    connection.write(new Buffer('Hello!', 'utf-8'), () => {
                        A.I("wrote Hello!");
                    });
                });

        });
        */
});

function stopAll() {
    if (network) {
        network.stop();
        network = null;
    }
    if (bluetooth) {
        bluetooth.stop();
        bluetooth = null;
    }
}

//network.arpScan('-qlg --retry=3');
network.on('request', (req) => network.dnsReverse(req.ipAddress)
    .then(names => A.If('Request %O = from %s with names %O', req, Network.getMacVendor(req.macAddress), names)));
network.on('listenState', b => A.If('Dhcp listen state = %s', b));
network.init(true, null, '.fritz.box');
//A.I(A.F(network.iflist));
process.on('SIGINT', () => {
    A.W('SIGINT signal received.');
    stopAll();
    process.exit(0);
});

A.wait(1000, A.I, 'after 1000');

main().catch(A.pE);

async function main() {
    let hci = await A.isLinuxApp('hcitool').then(x => x && A.exec('hcitool dev').then(x => x.slice(8).trim()),() => true).then(x => !!x, () => false);
    A.If('IsLinusApp hcitool = %s', !!hci);
    //A.I(A.F(network._iflist));
    await network.ping(['::1', '::2', 'localhost', '127.0.0.1', '192.168.178.1', '192.168.178.67', 'XS1', 'XS2', '192.168.179.20']).then(x => A.I(`Ping returned ${x}`));
    await A.Ptime(network.arpScan('-qlg --retry=5 --timeout=400')).then(sec => A.I(A.F('arp-scan took ', sec / 1000, ' seconds')));
    if (hci)
        await A.Ptime(bluetooth.startScan()).then(sec => A.I(A.F('bt-scan took ', sec / 1000, ' seconds')));
    //    .then(() => network.dnsReverse(`192.168 .178 .67 `).then(x => A.I(x)))
    //    .then(() => network.dnsReverse(`192.168 .178 .119 `).then(x => A.I(x)))
    //    .then(() => network.dnsReverse(`192.168 .178 .120 `).then(x => A.I(x)))
    //    .then(() => network.dnsReverse(`192.168 .178 .1 `).then(x => A.I(x)))
    //    .then(() => network.dnsResolve('fritz.box').then(x => A.I(x)))
    //    .then(() => network.dnsReverse('192.168.178.199').then(x => A.I(x)))
    //    .then(() => Promise.all([bluetooth.startScan(), bluetooth.startNoble(10000)]))
    //    .then(() => bluetooth.startScan())
    //    .then(found => A.I(A.F('scan found:', found)))
    //    .then(() => bluetooth.startNoble(20000))
    //    .then(() => A.wait(10000))
    //    .then(() => A.I(A.F(network.ips, network.macs)))
    await A.wait(60000);
    //    .catch(err => A.E(err))
    await A.I('Will stop All now', stopAll(), A.stop(true));

}