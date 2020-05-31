/* eslint-disable no-unused-expressions */
/* eslint-disable no-console */
"use strict";



process.env.fjadapter = 'TESTING';
const A = require('../fjadapter-core');
const {
    Network
} = require('../myNetworks');

const {
    createBluetooth
} = require('node-ble')
const {
    bluetooth,
    destroy
} = createBluetooth()
//const pty = require('pty.js');
//var splitting_re = /.*?(?:\r\n|\r|\n)|.+?$|^$/g;

//cp.execSync('rfkill block bluetooth');
//cp.execSync('rfkill unblock bluetooth');


main().catch(A.pE);

function nop(e) {
    //    console.log("err", e);
    return null;
}

async function getDev(mac, adapter, wait) {
    mac = mac.trim().toLowerCase();
    if (!Network.isMac(mac))
        return {
            invaluidMac: mac
        };
    const res = {
        mac: mac.toLowerCase(),
        macVendor: Network.getMacVendor(mac),
    };
    const dev = wait 
    ? await adapter.waitDevice(mac).catch(nop)
    : await adapter.getDevice(mac).catch(nop);
    if (dev) {
        let i = await dev.toString().catch(nop);
        if (i) res.string = i;
        i = await dev.getName().catch(nop);
        if (i) res.Name = i;
        i = await dev.getAlias().catch(nop);
        if (i) res.Alias = i;
        i = await dev.getRSSI().catch(nop);
        if (i) res.RSSI = i;
        i = await dev.isPaired().catch(nop);
        if (i != null) res.isPaired = i;
        dev.disconnect();
    }

    return res;
}


async function main() {

        const adapter = await bluetooth.defaultAdapter();
        if (!await adapter.isDiscovering())
            await adapter.startDiscovery();


        for (let i = 0; i < 10; i++) {
            await A.wait(1000);
            const dev = await adapter.devices();
            console.log(i, dev);
        }

        if (await adapter.isDiscovering())
            await adapter.stopDiscovery();

        const dev = await adapter.devices();
        for (const d of dev)
            console.log("try device:", await getDev(d, adapter));
                const totest = ['00:42:79:e3:36:8b', '56:18:25:12:E2:05', 'EC:AA:25:3D:32:C8'];
                for (const d of totest)
                    console.log("try device:", await getDev(d, adapter));

                destroy();
            }