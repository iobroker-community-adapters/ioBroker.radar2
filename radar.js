/**
 *      iobroker radar Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 */
/* eslint-env node,es6 */
// jshint node:true, esversion:6,  undef:true, unused:true, bitwise:false, -W069
"use strict";
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const adapter = utils.Adapter('radar');
const btbindir = __dirname + '\\bin\\bluetoothview\\';

const util = require('util');
const http = require('http');
const https = require('https');
const xml2js = require('xml2js');
const ping = require('ping');
const fs = require('fs');
const dns = require('dns');
//const noble =     require('noble'); // will be loaded later because not all machines will have it working
var noble = null;
const exec = require('child_process').exec;

function _O(obj, level) {
    return util.inspect(obj, false, level || 2, false).replace(/\n/g, ' ');
}

// function _J(str) { try { return JSON.parse(str); } catch (e) { return {'error':'JSON Parse Error of:'+str}}} 
function _N(fun) {
    return setTimeout.apply(null, [fun, 0].concat(Array.prototype.slice.call(arguments, 1)));
} // move fun to next schedule keeping arguments
function _D(l, v) {
    adapter.log.debug(l);
    return v === undefined ? l : v;
}

function _I(l, v) {
    adapter.log.info(l);
    return v === undefined ? l : v;
}

function _W(l, v) {
    if (adapter.log && adapter.log.warn)
        adapter.log.warn(l);
    return v === undefined ? l : v;
}


function wait(time, arg) {
    return new Promise(res => setTimeout(res, time, arg));
}

function pSeriesP(obj, promfn, delay) { // fun gets(item) and returns a promise
    if (!obj)
        return Promise.resolve([]);
    delay = delay || 0;
    let p = Promise.resolve();
    const nv = [],
        f = (k) => p = p.then(() => promfn(k).then(res => wait(delay, nv.push(res))));
    for (let item of obj)
        f(item);
    return p.then(() => nv);
}

function pSeriesInP(obj, promfn, delay) { // fun gets(key,obj) and returns a promise
    delay = delay || 0;
    let p = Promise.resolve();
    const nv = [],
        f = (k) => p = p.then(() => promfn(k, obj).then(res => wait(delay, nv.push(res))));
    for (let item in obj)
        f(item);
    return p.then(() => nv);
}

function pSeriesOP(obj, promfn, delay) { // fun gets(key,obj) and returns a promise
    delay = delay || 0;
    let p = Promise.resolve();
    const nv = [],
        f = (k) => p = p.then(() => promfn(k, obj).then(res => wait(delay, nv.push(res))));
    for (let item in obj)
        f(obj[item]);
    return p.then(() => nv);
}
/*
function pSeriesF(obj,fun,delay) { // fun gets(item) and returns a value
    delay = delay || 0;
    let p = Promise.resolve();
    const   nv = [],
            f = (k) => p = p.then(() => Promise.resolve(fun(k)).then(res => wait(delay,nv.push(res))));
    for(let item of obj) 
        f(item);
    return p.then(() => nv);
}
*/
function c2pP(f) {
    //    _D(`c2pP: ${_O(f)}`);
    return function () {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((res, rej) => {
            args.push((err, result) => (err && _N(rej, err)) || _N(res, result));
            f.apply(this, args);
        });
    };
}

function c1pP(f) {
    return function () {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((res) => {
            args.push((result) => _N(res, result));
            f.apply(this, args);
        });
    };
}
/*
function pRetryP(nretry, fn, arg) {
    return fn(arg).catch(err => { 
        if (nretry <= 0) 
            throw err;
        return pRetryP(nretry - 1, fn,arg); 
    });
}

function pRepeatP(nretry, fn, arg) {
    return fn(arg).then(() => Promise.reject()).catch(err => { 
        if (nretry <= 0)
            return Promise.resolve();
        return pRepeatP(nretry - 1, fn,arg); 
    });
}

*/

const P = {};

function makePs() {
    P.getObjectList = c2pP(adapter.objects.getObjectList);
    P.getForeignObject = c2pP(adapter.getForeignObject);
    P.setForeignObject = c2pP(adapter.setForeignObject);
    P.getForeignObjects = c2pP(adapter.getForeignObjects);
    P.getForeignState = c2pP(adapter.getForeignState);
    P.getState = c2pP(adapter.getState);
    P.setState = c2pP(adapter.setState);
    P.getObject = c2pP(adapter.getObject);
    P.deleteState = c2pP(adapter.deleteState);
    P.delObject = c2pP(adapter.delObject);
    P.setObject = c2pP(adapter.setObject);
    P.createState = c2pP(adapter.createState);
    P.extendObject = c2pP(adapter.extendObject);
}

var isStopping = false;
const scanList = {};
var scanDelay = 30 * 1000; // in ms = 30 sec
var scanTimer = null;
var printerDelay = 100;
var printerCount = 0;
var delayAway = 10;
var countHere = 0;
var whoHere = [];
var host = null;
var arpcmd = 'arp-scan -lgq';

function stop(dostop) {
    isStopping = true;
    if (scanTimer)
        clearInterval(scanTimer);
    scanTimer = null;
    _W('Adapter disconnected and stopped with ' + dostop);
    //    if (dostop)
    //        process.exit();
    //        adapter.stop();
}

adapter.on('message', obj => processMessage(obj));

adapter.on('ready', () => main(makePs()));

adapter.on('unload', () => stop(false));

function processMessage(obj) {
    if (obj && obj.command) {
        _D(`process Message ${_O(obj)}`);
        switch (obj.command) {
            case 'ping':
                {
                    // Try to connect to mqtt broker
                    if (obj.callback && obj.message) {
                        ping.probe(obj.message, {
                            log: adapter.log.debug
                        }, function (err, result) {
                            adapter.sendTo(obj.from, obj.command, result, obj.callback);
                        });
                    }
                    break;
                }
        }
    }
    adapter.getMessage(function (err, obj) {
        if (obj) {
            processMessage(obj);
        }
    });
}


const objects = [];

function makeState(id, value, ack) {
    ack = ack === undefined || !!ack;
    if (objects[id])
        return P.setState(id, value, ack);
    _D(`Make State ${id} and set value to ${_O(value)}`); ///TC
    var st = {
        common: {
            name: id, // You can add here some description
            read: true,
            write: false,
            state: 'state',
            role: 'value',
            type: typeof value
        },
        type: 'state',
        _id: id
    };
    if (id.endsWith('Percent'))
        st.common.unit = "%";
    return P.extendObject(id, st)
        .then(x => {
            objects[id] = x;
            return P.setState(id, value, ack);
        })
        .catch(err => _D(`MS ${_O(err)}:=extend`, id));

}


var nobleRunning = null;

function myNoble(len) {
    function stopNoble(idf) {
        if (nobleRunning)
            clearTimeout(nobleRunning);
        if (!noble)
            return {};
        nobleRunning = null;
        noble.removeAllListeners('discover');
        noble.stopScanning();
        //        _D(util.format('Noble found %j',idf));
        return idf;
    }

//    _D(`Noble= ${_O(noble)} start ${len}`);

    let idf = {};
    if (nobleRunning) clearTimeout(nobleRunning);
    nobleRunning = null;

    if (!noble) return Promise.resolve({});
    if (isStopping) return Promise.reject('Stopping.');
    if (noble.state !== 'poweredOn') return Promise.reject('Noble not powered ON!');

    return new Promise((res) => {
        noble.on('discover', function (per) {
            if (isStopping)
                return res(stopNoble(idf));

            var idt = (per.advertisement && per.advertisement.localName) ? per.advertisement.localName : "NaN";
            idf[per.address.toUpperCase()] = {
                address: per.address,
                name: idt,
                rssi: per.rssi
            };
        });

        noble.startScanning([], true);
        nobleRunning = setTimeout(() => res(stopNoble(idf)), len);
    }).catch(err => _I(`Noble scan Err ${_O(err)}`, err, noble = null));
}

function pExec(command) {
    const istest = command.startsWith('!');
    return new Promise((resolve, reject) => {
        exec(istest ? command.slice(1) : command, (error, stdout, stderr) => {
            if (istest && error) {
                error[stderr] = stderr;
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

function pGet(url, retry) {
    //    _I(`pGet retry(${retry}): ${url}`);
    var fun = http;
    if (url.toUpperCase().startsWith('HTTPS'))
        fun = https;
    return (new Promise((resolve, reject) => {
        //        _I(`pGet retry(${retry}): ${url}`);
        fun.get(url, (res) => {
            let statusCode = res.statusCode;
            //            let contentType = res.headers['content-type'];
            //            _D(`res: ${statusCode}, ${contentType}`);
            let error = null;
            if (statusCode !== 200) {
                error = new Error(`Request Failed. Status Code: ${statusCode} URL: ${url}`);
                //              } else if (!/^application\/json/.test(contentType)) {
                //                error = new Error(`Invalid content-type. Expected application/json but received ${contentType}`);
            }
            if (error) {
                res.resume(); // consume response data to free up memory
                return reject(error);
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => _N(resolve, rawData));
        }).on('error', (e) => _N(reject, e));
    })).catch(err => {
        if (retry <= 0) throw err;
        return wait(100, retry - 1).then(a => pGet(url, a));
    });
}

var doFping = true;
var doHci = true;
var doBtv = true;
var doMac = true;
var doUwz = null;

function xmlParseString(body) {
    function parseNumbers(str) {
        if (!isNaN(str))
            str = str % 1 === 0 ? parseInt(str) : parseFloat(str);
        return str;
    }

    function tagnames(item) {
        let all = item.split(':');
        item = (all.length === 2) ? all[1] : all[0];
        //            _I(`Tag: all: ${_O(all)} became ${item}`);                
        return item;
    }
    return (c2pP(new xml2js.Parser({
            explicitArray: false,
            trim: true,
            tagNameProcessors: [tagnames],
            //                attrNameProcessors: [tagnames],
            valueProcessors: [parseNumbers]
        })
        .parseString))(body);
}

function scanExtIP() {
    let oldip = "";
    let sameip = 0;

    function getIP(site) {
        return pGet(site, 2)
            .then(chunk => {
                const ip = chunk.trim();
                if (ip === oldip)
                    ++sameip;
                else
                    oldip = ip;
                return Promise.resolve(sameip);
            }, err => _I(`MyIP Error ${_O(err)}`, Promise.resolve(sameip)));
    }

    return getIP('http://icanhazip.com/?x=2')
        .then(() => getIP('http://wtfismyip.com/text'))
        .then(() => sameip < 1 ? getIP('http://nst.sourceforge.net/nst/tools/ip.php') : Promise.resolve(sameip))
        .then(() => P.getState('ExternalNetwork.IP4'))
        .then(x => x, () => Promise.resolve())
        .then(state => {
            if (state && state.val)
                state = state.val;
            if (oldip !== '' && state !== oldip) {
                _I(`New IP address ${oldip}`, oldip);
            } else if (oldip === '') {
                return makeState('ExternalNetwork.status', _W(`Not connected to external network!`, 0));
            } else
                _D(`Same IP address ${oldip}`);
            return makeState('ExternalNetwork.IP4', oldip)
                .then(() => makeState('ExternalNetwork.status', ++sameip));
        }, err => _I(`scanExtIP error ${_O(err)}`, Promise.resolve()));
}
/*
function scanECB(item) {
    let idn = item.id + '.';
    return psGet('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', 2)
        .then(body => xmlParseString(body))
        .then(ecb => makeState(idn + 'fromDate', ecb.Envelope.Cube.Cube['$'].time).then(() => ecb))
        .then(ecb => pSeriesP(ecb.Envelope.Cube.Cube.Cube, cur => {
            let ccur = cur['$'].currency;
            let rate = parseFloat(cur['$'].rate);
            if (item.ip.indexOf(ccur) < 0)
                return Promise.resolve();
            return makeState(idn + ccur, rate);
        }, 5))
        .catch(err => _I(`ECB error: ${_O(err)}`));
    return Promise.resolve();
}
*/
function scanHP(item) {

    let idn = item.id + '.';
    let colors = [];
    let below10 = [];
    //    _I(`should call ${item.ip} for printer data`);
    return pGet('http://' + item.ip + '/DevMgmt/ConsumableConfigDyn.xml', 2)
        .then(body => xmlParseString(body.trim()))
        //        .then(result => _I(`parser ${_O(result,3)}`,result))
        .then(result => result["ConsumableConfigDyn"] ? result["ConsumableConfigDyn"] : result)
        .then(result => pSeriesP(result["ConsumableInfo"], item => {
                //            _I(`parser ${_O(item)}`);
                if (item["ConsumableTypeEnum"] !== "ink")
                    return Promise.resolve('No Ink');
                let p = "P" + item["ConsumableStation"],
                    lc = item["ConsumableLabelCode"],
                    idnc = idn + 'ink.' + lc + '.',
                    d = item["Installation"] ? item["Installation"]["Date"] : null,
                    l = parseInt(item["ConsumablePercentageLevelRemaining"]),
                    ci = item["ConsumableIcon"],
                    s = ci["Shape"],
                    fc = ci["FillColor"],
                    rgb = fc["Blue"] | (fc["Green"] << 8) | (fc["Red"] << 16),
                    n = item["ConsumableSelectibilityNumber"];
                rgb = '#' + (0x1000000 + rgb).toString(16).slice(1);
                let ss = `${p} = ${lc},${d ? d + ',' : ''} ${l}%, ${n}, ${rgb}, ${s}`;
                colors.push(ss);
                if (l <= 10)
                    below10.push(lc);
                return makeState(idnc + 'fillPercent', l)
                    .then(() => makeState(idnc + 'color', rgb))
                    .then(() => makeState(idnc + 'text', ss));
            })
            .then(() => makeState(idn + 'anyBelow10', below10.length > 0))
            .then(() => makeState(idn + 'whoBelow10'), below10.join(', '))
            //            .then(arg => `HP Printer inks found:${colors.length}`)
            .catch(err => _D(`HP Printer could not find info! Err: ${_O(err)}`)));
}

const bts = {},
    btn = {},
    ips = {},
    vendors = {};


var oldWhoHere = null,
    arps = {},
    unkn = {};

function checkArps(ip) {
    ip = ip.trim();
    if (arps[ip]) {
        delete arps[ip];
        return true;
    }
    return false;
}

function checkUnkn(ip) {
    ip = ip.trim().toUpperCase();
    if (arps[ip]) {
        delete arps[ip];
        return true;
    }
    return false;
}

function checkCache(item, cache, funP) {
    //    _D(`CC: ${item} in ${cache[item]}`);
    return new Promise((_res) => {
        if (cache[item])
            return _N(_res, cache[item]);
        funP(item).then(res =>
            _res(cache[item] = res));
    });
}

var qmac = Promise.resolve();

function checkMac(mac, cache) {
    if (!cache[mac]) {
        qmac = new Promise((res) => {
            cache[mac] = '!Vendor may come later!';

            qmac.then(() => wait(1100))
                .then(() =>
                    pGet('https://api.macvendors.com/' + mac, 1).then(x => x.trim(), () => 'Vendor N/A').then(x =>
                        res(cache[mac] = x)));
        });
    }
    return Promise.resolve(cache[mac]);
}

function checkBtn(mac) {
    if (!btn[mac]) {
        qmac = new Promise((res) => {
            btn[mac] = '!Name may come later!';

            qmac.then(() => wait(100))
                .then(() => pExec('hcitool name ' + mac)
                .then(stdout => stdout > "" ? stdout.trim() : 'Name N/A') , () => 'Name N/A').then(x => res(btn[mac] = x));
        });
    }
    return Promise.resolve(btn[mac]);
}

function scanAll() {
    if (isStopping) // do not start scan if stopping...
        return;

    _D(`Would now start scan for devices! ${printerCount === 0 ? 'Would also scan for printer ink now!' : 'printerCount=' + printerCount}`);

    for (let item in scanList)
        scanList[item].ipHere = scanList[item].btHere = false;

    arps = {};
    unkn = {};

    return Promise.all(
        [doBtv ?
            pExec(`${btbindir}bluetoothview /scomma ${btbindir}btf.txt`)
            .then(() => wait(100))
            .then(() => c2pP(fs.readFile)(`${btbindir}btf.txt`, 'utf8'))
            .then(data => wait(100, data))
            .then(data => {
                try {
                    fs.unlinkSync(`${btbindir}btf.txt`);
                } catch (e) {
                    return '';
                }
                return data;
            })
            .then(data => {
                for (let item in scanList)
                    if (data.toUpperCase().indexOf(scanList[item].bluetooth) > 0) {
                        _D(`doBtv found  ${scanList[item].name}`);
                        scanList[item].btHere = true;
                    }
            }) : wait(10),
            myNoble(scanDelay/3)
            .then(data => pSeriesInP(data, x => data[x].name==='NaN' ?  checkBtn(x).then(n => data[x].name = n) : Promise.resolve(data[x].name)).then(() => data))
            .then(data => {
                let found = 0;
                for (let key in scanList) {
                    if (data[scanList[key].bluetooth]) {
                        delete data[scanList[key].bluetooth];
                        _D(`Noble found  ${scanList[key].name}`);
                        scanList[key].btHere = true;
                        ++found;
                    }
                }
                return pSeriesP(Object.keys(data), (d) => {
                    var e = data[d];
                    //                _W(`process not found ${d} ${a}`);
                    return checkMac(d, bts)
                        .then(x => e.vendor = x)
                        .then(() => unkn[d] = e)
                        //                    .then(() => _D(`Noble found also unknown: ${_O(e)}`))
                        .then(() => delete e['address']);
                });
            }, () => false),
            (doMac ? pExec(arpcmd)
                .then(res => res && res.match(/(\d*\.){3}\d*\s*([\dA-F]{2}\:){5}[\dA-F]{2}/gi))
                .then(res => pSeriesP(res, item => {
                    const s = item.split('\t');
                    s[1] = s[1].toUpperCase();
                    return checkMac(s[1], vendors).then(x => s.push(x), () => false)
                        .then(() => checkCache(s[0], ips, ip => c2pP(dns.reverse)(ip).then(nam => Array.isArray(nam) ? nam.join('; ') : nam, () => '; DNS N/A')).then(x => s.push(x)), () => false)
                        .then(() => {
                            //                            _D(`${s}`);
                            for (let sli in scanList) {
                                let sl = scanList[sli];
                                let here = false;
                                if (s[0] === sl.ip)
                                    sl.ipHere = here = true;
                                if (sl.hasMAC)
                                    for (let m of sl.hasMAC)
                                        if (s[1] === m)
                                            sl.ipHere = here = true;
                                if (!here)
                                    arps[s[0]] = s.slice(1).join('; ');
                            }
                            return s;
                        })
                        .catch(err => _D(`arpcmd err: ${_O(err)}`));

                }, 5)) : wait(5)),
            pSeriesOP(scanList, item => {
                //            _D(`key ${key} obj ${_O(key)} = ${_O(obj[key])}`);
                let all = [];
                /*
                            if (item.hasECB) {
                                if (printerCount === 0)
                                    all.push(scanECB(item));
                            } else 
                */
                if (item.hasIP && !item.ipHere)
                    if (item.ip.toUpperCase().startsWith('HTTP'))
                        all.push(pGet(item.ip, 2).then(() => true, () => false).then(x => item.ipHere = x || item.ipHere));
                    else
                        all.push(c1pP(ping.sys.probe)(item.ip)
                            .then(res => {
                                //                        _I(`${item.name}:${item.ip} = ${res}`);
                                if (!res && doFping)
                                    return pExec('fping ' + item.ip)
                                        .then(stdout => / is alive/.test(stdout) || res, false);
                                return res;
                            })
                            .then(iph => {
                                //                        _I(`IP ${item.name}:${item.ip} = ${iph}`);
                                if (iph) {
                                    item.ipHere = true;
                                    if (item.printer && printerCount === 0)
                                        return scanHP(item);
                                }
                                return iph;
                            })
                        );

                /*
                            if (doMac && item.hasMAC)
                                all.push(pSeriesP(item.hasMAC, mac => pExec('arp-scan -lgq  --retry=5 --destaddr='+ mac)
                                    .then(ret => {
                                        item.ipHere = item.ipHere || ret.toUpperCase().indexOf(mac)>0; 
                //                        _I(`arp-scan for ${item.id}  ${item.ipHere} returned ${ret}`);
                                        return Promise.resolve();                        
                                    })
                                ));
                */
                if (item.hasBT)
                    checkUnkn(item.bluetooth);
                if (doHci && item.hasBT && !item.bluetooth.startsWith('7C:2F:80') && !item.btHere) {
                    all.push(pExec('hcitool name ' + item.bluetooth)
                        .then(stdout => {
                            let bth = stdout > "";
                            if (bth) {
                                btn[item.bluetooth] = item.btname = stdout.trim();
                                item.btHere = true;
                                _D(`hcitool found ${item.name} as ${item.btname}`);
                            }
                            return bth;
                        }, () => false)
                        .then(bt => item.btHere = bt)
                        .then(bt => !bt ? wait(50)
                            .then(() => pExec('!l2ping -c1 ' + item.bluetooth))
//                            .then(op => op, x => _D(x, pExec('!l2ping -c1 ' + item.bluetooth)))
                            .then(op => op.length > 0 ? _D(`l2ping found ${item.name} with "${op}"`, (item.btHere = true)) : _D(`l2ping for ${item.name} returned nothing!`, false),
                                x => _D(`l2ping for ${item.name} err: "${x}"`, false)) :
                            false)
                        .then(() => wait(50))
                    );
                }
                return Promise.all(all).then(() => item.name, err => _D(`err in ${item.name}: ${_O(err)}`));
            }, 50).then(res => res, err => _D(`err ${_O(err)}`, err))
        ]).then(() => {
        //            _D(`Promise all  returned ${res}  ${res}:${_O(res)}`);
        if (++printerCount >= printerDelay) ///TBC
            printerCount = 0;
        whoHere = [];
        let allhere = [];
        return pSeriesOP(scanList, (item) => {
                //            for(let item of scanList.values()) {
                //                _I(`item=${_O(item)}:`);
                const here = item.ipHere || item.btHere;
                let cnt = item.cnt === undefined ? -delayAway : parseInt(item.cnt);
                let anw = false;
                //                _I(`${item.name}:cnt=${cnt}, here=${here}`);
                //                if (item.hasECB)
                //                    return Promise.resolve();
                if (here) {
                    cnt = cnt < 0 ? 0 : cnt + 1;
                    anw = true;
                } else {
                    cnt = cnt > 0 ? -1 : cnt - 1;
                    anw = cnt >= -delayAway;
                }
                if (item.rip) {
                    if (Array.isArray(item.rip))
                        for (let ip of item.rip)
                            checkArps(ip);
                    else
                        checkArps(item.rip);
                }
                item.anwesend = anw;
                item.cnt = cnt;
                if (anw) {
                    allhere.push(item.id);
                    if (item.name === item.id)
                        whoHere.push(item.id);
                }
                _D(`${item.id}=${_O(item)}`);
                const idn = item.id;
                return makeState(idn + '.count', cnt)
                    .then(() => makeState(idn + '.here', anw))
                    .then(() => item.hasIP ? makeState(idn + '.ipHere', item.ipHere) : false)
                    .then(() => item.hasBT ? makeState(idn + '.btHere', item.btHere) : false);
            }).then(() => {
                countHere = whoHere.length;
                whoHere = whoHere.join(', ');
                if (oldWhoHere !== whoHere) {
                    oldWhoHere = whoHere;
                    _I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${whoHere}`);
                }
                allhere = allhere.join(', ');
                return makeState('countHere', countHere)
                    .then(() => makeState('allHere', allhere))
                    .then(() => makeState('whoHere', whoHere));
            }).then(() => _D(`Noble found unknown BT's: ${_O(unkn)}, unknown IP's: ${_O(arps)}`))
            .then(() => makeState('AllUnknownBTs', JSON.stringify(unkn)))
            .then(() => makeState('AllUnknownIPs', JSON.stringify(arps)));
    }, err => _W(`Scan devices returned error: ${_O(err)}`));
}

function isMacBt(str) {
    return /^([0-9A-F]{2}\:){5}[0-9A-F]{2}$/.test(str.trim().toUpperCase());
}

var ain = '',
    wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz = 0,
    longuwz = false;

function getUWZ() {
    if (!doUwz)
        return Promise.resolve();
    pGet('http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=getWarning&language=de&areaID=' + doUwz, 2)
        .then(body => JSON.parse(body))
        .then(data => {
            var w = data && data.results;
            if (!w)
                return Promise.reject('UWZ data err: ' + _O(data));
            //            _W(`${_O(w,5)}`);
            return w.map(i => (lang === 'de' ?
                (longuwz ? i.payload.translationsLongText.DE : i.payload.translationsShortText.DE) :
                (longuwz ? i.payload.longText : i.payload.shortText)) + (longuwz ? ': ' + i.payload.levelName : ''));
        })
        .then(w => {
            let wl = w.length,
                wt = w.join(numuwz < 0 ? '<br>\n' : '\n');
            wt = wt === '' ? "No warnings" : wt;
            if (wt !== wlast) {
                wlast = wt;
                _I(`UWZ found the following (changed) warnings: ${wt}`);
                if (numuwz > 0) {
                    return pSeriesP(Object.keys(w), (x) => x < numuwz ? makeState('UWZ_Warnings.warning' + x, w[x]) : Promise.resolve())
                        .then(() => {
                            let n = wl,
                                l = [];

                            while (n < numuwz)
                                l.push(n++);
                            return pSeriesP(l, (x) => makeState('UWZ_Warnings.warning' + x, ''));
                        });
                } else
                    return makeState('UWZ_Warning', wlast);
            }
        })
        .catch(e => _W(`Error in getUWZ: ${e}`));
}

function isApp(name) {
    return pExec('!which ' + name).then(x => x.length >= name.length, () => false);
}

function main() {
    host = adapter.host;

    try {
        noble = require('@abandonware/noble');
        _I("found '@abandonware/noble'");
    } catch (e) {
        try {
            noble = require('noble');
            _I("found 'noble'");
        } catch (e) {
            _W(`Noble not available, Error: ${_O(e)}`);
            noble = null;
        }
    }

    ain = adapter.name + '.' + adapter.instance + '.';

    if (!adapter.config.devices.length) {
        _W(`No to be scanned devices are configured for host ${host}! Will stop Adapter`);
        return stop(true);
    }

    if (!adapter.config.scandelay || parseInt(adapter.config.scandelay) < 15)
        adapter.config.scandelay = 15;
    scanDelay = adapter.config.scandelay * 1000;

    if (!adapter.config.delayaway || parseInt(adapter.config.delayaway) < 2)
        adapter.config.delayaway = 2;
    delayAway = adapter.config.delayaway;

    if (!adapter.config.printerdelay || parseInt(adapter.config.printerdelay) < 100)
        adapter.config.printerdelay = 100;
    printerDelay = adapter.config.printerdelay;

    if (adapter.config.arp_scan_cmd || adapter.config.arp_scan_cmd.length > 0) {
        arpcmd = 'arp-scan -lgq ' + adapter.config.arp_scan_cmd;
    }

    _I(`radar set to scan every ${adapter.config.scandelay} sec and printers every ${printerDelay} scans.`);

    _I(`BT Bin Dir = '${btbindir}'`);

    pExec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`).then(x => doBtv = x && x.length > 0, () => doBtv = false)
        .then(() => isApp('fping').then(x => doFping = x))
        .then(() => isApp('arp-scan').then(x => x ? pExec('arp-scan').then(x => (_I(`radar set to arp-scan with command "${arpcmd}" on ${x}`), x>""), ()=> _W("Adapter nut running as root, cannot use arp-scan!")) : false).then(x => doMac=x))
        .then(() => isApp('hcitool').then(x => doHci = x))
        .then(() => {
            return pSeriesP(adapter.config.devices, item => {
                //                _I(`checking item ${_O(item)}`);
                if (item.name)
                    item.name = item.name.trim().replace(/[\s\.]/g, '_');
                if (!item.name || item.name.length < 2)
                    return Promise.resolve(_W(`Invalid item name '${_O(item.name)}', must be at least 2 letters long`));
                if (scanList[item.name])
                    return Promise.resolve(_W(`Double item name '${item.name}', names cannot be used more than once!`));
                item.id = item.name.endsWith('-') ? item.name.slice(0, -1) : item.name;
                item.ip = item.ip ? item.ip.trim() : '';
                item.macs = item.macs ? item.macs.trim().toUpperCase() : '';
                item.macs.split(',').forEach(val => {
                    const mac = val && (typeof val === 'string') ? val.trim() : null;
                    if (mac) {
                        if (isMacBt(mac))
                            item.hasMAC = item.hasMAC ? item.hasMAC.push(mac) : [mac];
                        else
                            _W(`invalid MAC address in ${item.name}: '${val}'`);
                    }
                });
                if (item.hasMAC && !doMac)
                    _W(`MAC addresses '${item.macs}' will not be scanned because no arp-scan is available!`);
                item.bluetooth = item.bluetooth ? item.bluetooth.trim().toUpperCase() : '';
                item.hasBT = isMacBt(item.bluetooth);
                if (item.bluetooth !== '' && !item.hasBT)
                    _W(`Invalid bluetooth address '${item.bluetooth}', 6 hex numbers separated by ':'`);
                item.printer = item.ip && item.name.startsWith('HP-');
                //                item.hasECB = item.ip && item.name.startsWith('ECB-');
                item.hasIP = item.ip && item.ip.length > 2;
                if (item.hasIP && !item.ip.toUpperCase().startsWith('HTTP')) {
                    if (!item.ip.match(/^(\d+\.){3}\d+/))
                        c2pP(dns.resolve)(item.ip).then(x => item.rip = x);
                    else
                        item.rip = item.ip;
                }
                if (!(item.hasIP || item.hasBT))
                    return Promise.resolve(_W(`Invalid Device should have IP or BT set ${_O(item)}`));
                scanList[item.name] = item;
                _I(`Init item ${item.name} with ${_O(item)}`);
                return Promise.resolve(item.id);
            }, 50);
        }).then(() => parseInt(adapter.config.external) > 0 ? scanExtIP() : Promise.resolve())
        .then(() => P.getObjectList({
            include_docs: true
        }))
        .then(res => {
            var r = {};
            if (!adapter.config.delayuwz || parseInt(adapter.config.delayuwz) <= 0)
                return Promise.resolve(_I(`No UWZ warning because of Delay is ${adapter.config.delayuwz}`));
            delayuwz = parseInt(adapter.config.delayuwz);
            numuwz = parseInt(adapter.config.numuwz);
            longuwz = Boolean(adapter.config.longuwz);
            res.rows.map(i => r[i.doc._id] = i.doc);
            if (r['system.config'] && r['system.config'].common.language)
                lang = r['system.config'].common.language;
            if (r['system.config'] && r['system.config'].common.latitude) {
                adapter.config.latitude = parseFloat(r['system.config'].common.latitude);
                adapter.config.longitude = parseFloat(r['system.config'].common.longitude);
                return pGet(`http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=lookupCoord&lat=${adapter.config.latitude}&lon=${adapter.config.longitude}`, 2)
                    .then(res => JSON.parse(res)[0], e => _W(`Culd not get UWZ Area ID: ${e} for Laenge: ${adapter.config.longitude} Breite: ${adapter.config.latitude}`,null))
                    .then(res => {
                        doUwz = res && res.AREA_ID ? res.AREA_ID : null;
                        if (doUwz) {
                            getUWZ();
                            setInterval(getUWZ, parseInt(adapter.config.delayuwz) * 1000);
                        }
                    });
            } else return Promise.reject(_W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
        }, () => doUwz = null)
        .then(() => {
            _I(`radar adapter initialized ${Object.keys(scanList).length} devices, ExternalNetwork = ${adapter.config.external}.`);
            _I(`radar set use of noble(${!!noble}), fping(${doFping}), doMac(${doMac}), doHci(${doHci}), doBtv(${doBtv}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
            scanTimer = setInterval(scanAll, scanDelay);
            if (parseInt(adapter.config.external) > 0)
                setInterval(scanExtIP, parseInt(adapter.config.external) * 1000);
            return scanAll(); // scan first time and generate states if they do not exist yet
        })
        .then(() => P.getObjectList({
            startkey: ain,
            endkey: ain + '\u9999'
        }))
        .then(res => pSeriesP(res.rows, item => { // clean all states which are not part of the list
            //            _I(`Check ${_O(item)}`);
            let id = item.id.slice(ain.length);
            if (objects[id])
                return Promise.resolve();
            //            _I(`Delete ${_O(item)}`);
            return P.deleteState(id)
                .then(() => _D(`Del State: ${id}`), err => _D(`Del State err: ${_O(err)}`)) ///TC
                .then(() => P.delObject(id))
                .then(() => _D(`Del Object: ${id}`), err => _D(`Del Object err: ${_O(err)}`)); ///TC
        }, 10))
        .catch(err => {
            _W(`radar initialization finished with error ${_O(err)}, will stop adapter!`);
            stop(true);
            throw err;
        })
        .then(() => _I('Adapter initialization finished!'));
}