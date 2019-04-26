/* eslint-disable no-unused-expressions */
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
    Bluetooth = require('../myNetworks').Bluetooth,
    ScanCmd = require('../myNetworks').ScanCmd;

//const pty = require('pty.js');
//var splitting_re = /.*?(?:\r\n|\r|\n)|.+?$|^$/g;

//cp.execSync('rfkill block bluetooth');
//cp.execSync('rfkill unblock bluetooth');

let network = new Network(false);
network.on('arp-scan', (found) => A.I(found));
A.debug = true;

let bluetooth = null;
bluetooth = new Bluetooth({
    doHci: true
});
bluetooth.on('found', (arg) => A.I(`${arg.by} Scan found ${A.F(arg)}`));
/*
bluetooth.listPairedDevices().then((x) => A.I(A.F('Paired Devices:', x))).then(() => {
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
});
        */


function stopAll() {
    if (network) {
        network.stop();
        network = null;
    }
    if (bluetooth) {
        bluetooth.stop();
        bluetooth = null;
    }
    ScanCmd.stopAll();
    //    scmd && scmd.stop();
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

//A.wait(1000, A.I, 'after 1000');

main().catch(A.pE);

async function main() {
    await bluetooth.init({
        doHci: true
    });

    //    let hci = await A.isLinuxApp('hcitool').then(x => x && A.exec('hcitool dev').then(x => x.slice(8).trim()), () => true).then(x => !!A.Ir(x,' got devs %O',x), () => false);
    //    A.If('IsLinusApp hcitool = %s', !!hci);
    //A.I(A.F(network._iflist));
    //    await network.ping(['::1', '::2', 'localhost', '127.0.0.1', '192.168.178.1', '192.168.178.67', 'XS1', 'XS2', '192.168.179.20']).then(x => A.I(`Ping returned ${x}`));
    //    await A.Ptime(network.arpScan('-qlg --retry=5 --timeout=400')).then(sec => A.I(A.F('arp-scan took ', sec / 1000, ' seconds')));
    //    if (hci)
    //        await A.Ptime(bluetooth.startScan()).then(sec => A.I(A.F('bt-scan took ', sec / 1000, ' seconds')));
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
    //    await A.wait(30000);
    /*
    await Promise.all([
            ScanCmd.runCmd(A.f('hcitool -i %s lescan --duplicates', hciarg), [/^\s*((?:[\dA-F]{2}:){5}[\dA-F]{2})\s+(.*?)\s*$/im, 'lescan', 'address', 'name'], {
                timeout: hcitime
            }).then(res => res.map(res => sres.push(A.Ir(res, 'lescan: %O', res))), A.nop),
            ScanCmd.runCmd(A.f('hcitool -i %s scan --flush --length=%s', hciarg, Math.floor(hcitime / 1300)), [/^\s*((?:[\dA-F]{2}:){5}[\dA-F]{2})\s+(.*?)\s*$/im, 'scan', 'address', 'name'])
            .then(res => res.map(res => sres.push(A.Ir(res, 'scan: %O', res))), A.nop),
            /*
            A.seriesOf(['48:bf:bb:c6:35:d6', '7e:6b:61:f8:c7:e2', '00:1D:A5:00:02:20', '66:A1:FC:DB:3C:9E', 'C0:97:27:10:B8:65',
                    '14:91:82:88:AE:36', '14:91:82:88:AE:36', '60:2A:2F:C8:4A:AA', '7C:2F:80:99:C9:B6', '7C:2F:80:99:C9:B6'
                ],
                x => ScanCmd.runCmd(A.f('hcitool -i %s name %s', hciarg, x)).then(n => n.length && n[0] && sres.push({
                    by: 'name',
                    macAddr: x,
                    name: n[0]
                }), () => []))
              */
    /*
        ])
        //        .then(res => A.seriesOf(res, x => ScanCmd.runCmd(A.f('hcitool -i %s leinfo %s', hciarg, x[0])).then(y => y.map(i => x.pus(i)),A.nop)).then(() => res))
        .then(() => A.If('scan returned %O', sres));
        */
    await bluetooth.startScan();
    //    await 
    //        .then(res => res.map(x => x.concat(Network.getMacVendor(x[0]))))
    //        .then(res => A.seriesOf(res, x => ScanCmd.runCmd(A.f('hcitool -i %s leinfo %s', hciarg, x[0])).then(y => y.map(i => x.pus(i)),A.nop)).then(() => res))
    //        .then(res => A.If('scan returned %O', res));
    await A.wait(1000);
    //    .catch(err => A.E(err))
    await A.I('Will stop All now', stopAll(), A.stop(true));

}