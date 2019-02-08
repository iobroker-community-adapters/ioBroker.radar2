/**
 *      iobroker MyAdapter class V1.2.1 from systeminfo
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 */
// jshint  node: true, esversion: 6, strict: true, undef: true, unused: true
"use strict";
const util = require('util'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    fs = require('fs'),
    exec = require('child_process').exec,
    assert = require('assert');

class Sequence {
    constructor(p) {
        this._p = p ? p : Promise.resolve();
        return this;
    }
    get p() {
        return this._p;
    }
    set p(val) {
        this._p = this._p.catch(() => null).then(() => val);
        return this;
    }

    add(val) {
        this.p = val;
        return this;
    }
}

function myResolve() {
    return Promise.resolve();
}

var adapter, that, main, messages, timer, unload, name, stopping = false,
    inDebug = false,
    curDebug = 1,
    allStates = myResolve,
    stateChange = allStates,
    objChange = allStates,
    objects = {},
    states = {},
    stq = new Sequence();
const
    sstate = {},
    mstate = {};

function slog(adapter, log, text) {
    if (inDebug === undefined)
        return text;
    return adapter && adapter.log && typeof adapter.log[log] === 'function' ?
        adapter.log[log](text) : console.log(log + ': ' + text);
}

class Setter { // fun = function returng a promise, min = minimal time in ms between next function call
    constructor(fun, min) {
        if (typeof fun !== 'function') throw Error('Invalid Argument - no function for Setter');
        this._efun = fun;
        this._list = [];
        this._current = null;
        this._min = min || 20;
        return this;
    }
    toString() {
        return `Setter(${this._min},${this.length})=${this.length>0 ? this._list[0] : 'empty'}`;
    }
    clearall() {
        this._list = [];
        return this;
    }
    add() {
        function execute(that) {
            if (that.length > 0 && !that._current) {
                that._current = that._list.shift();
                that._efun.apply(null, that._current)
                    .then(() => MyAdapter.wait(that._min), e => e)
                    .then(() => execute(that, that._current = null), () => execute(that, that._current = null));
            }
        }

        const args = Array.prototype.slice.call(arguments);
        this._list.push(args);
        if (this._list.length === 1)
            execute(this);
        return MyAdapter.resolve();
    }
}
class CacheP {
    constructor(fun) { // neue Einträge werden mit dieser Funktion kreiert
        assert(!fun || MyAdapter.T(fun) === 'function', 'Cache arg need to be a function returning a promise!');
        this._cache = {};
        this._fun = fun;
    }

    cacheItem(item, fun) {
        let that = this;
        // assert(!fun || A.T(fun) === 'function', 'Cache arg need to be a function returning a promise!');
        //        A.D(`looking for ${item} in ${A.O(this._cache)}`);
        if (this._cache[item] !== undefined)
            return MyAdapter.resolve(this._cache[item]);
        if (!fun)
            fun = this._fun;
        // assert(A.T(fun) === 'function', `checkItem needs a function to fill cache!`);
        return fun(item).then(res => (that._cache[item] = res), err => MyAdapter.D(`checkitem error ${err} finding result for ${item}`, null));
    }

    isCached(x) {
        return this._cache[x];
    }
}

function addSState(n, id) {
    if (!mstate[n]) {
        if (sstate[n] && sstate[n] !== id) {
            sstate[id] = id;
            mstate[n] = [id];
            delete sstate[n];
        } else
            sstate[n] = id;
    } else {
        mstate[n].push(id);
        sstate[id] = id;
    }
}

class MyAdapter {
    constructor(adapter, main) {
        if (adapter && main)
            MyAdapter.init(adapter, main);
        return MyAdapter;
    }

    static processMessage(obj) {
        return (obj.command === 'debug' ? this.resolve(`debug set to '${inDebug = isNaN(parseInt(obj.message)) ?  this.parseLogic(obj.message) : parseInt(obj.message)}'`) : messages(obj))
            .then(res => this.D(`Message from '${obj.from}', command '${obj.command}', message '${this.S(obj.message)}' executed with result:"${this.S(res)}"`, res),
                err => this.W(`invalid Message ${this.O(obj)} caused error ${this.O(err)}`, err))
            .then(res => obj.callback ? adapter.sendTo(obj.from, obj.command, res, obj.callback) : undefined)
            .then(() => this.c2p(adapter.getMessage)().then(obj => obj ? this.processMessage(obj) : true));
    }

    static initAdapter() {


        this.D(`Adapter ${this.ains} starting.`);
        this.getObjectList = this.c2p(adapter.objects.getObjectList);
        this.getForeignState = this.c2p(adapter.getForeignState);
        this.setForeignState = this.c2p(adapter.setForeignState);
        this.getState = this.c2p(adapter.getState);
        this.setState = this.c2p(adapter.setState);
        this.getStates = this.c2p(adapter.getStates);

        return this.getStates('*').then(res => {
                states = res;
            }, err => this.W(err))
            .then(() => (!adapter.config.forceinit ?
                    this.resolve({
                        rows: []
                    }) :
                    this.getObjectList('*'))
                .then(res => res.rows.length > 0 ? this.D(`will remove ${res.rows.length} old states!`, res) : res)
                .then(res => this.seriesOf(res.rows, (i) => this.removeState(i.doc.common.name), 2))
                .then(res => res, err => this.E('err from MyAdapter.series: ' + err))
                .then(() => this.getObjectList({
                    include_docs: true
                }))
                .then(res => {
                    res = res && res.rows ? res.rows : [];
                    objects = {};
                    for (let i of res) {
                        var o = i.doc;
                        objects[i.doc._id] = o;
                        if (o.type === 'state' && o.common.name && !i.doc._id.startsWith('system.adapter.'))
                            addSState(o.common.name, i.doc._id);
                    }
                    if (objects['system.config'] && objects['system.config'].common.language)
                        adapter.config.lang = objects['system.config'].common.language;
                    if (objects['system.config'] && objects['system.config'].common.latitude) {
                        adapter.config.latitude = parseFloat(objects['system.config'].common.latitude);
                        adapter.config.longitude = parseFloat(objects['system.config'].common.longitude);
                    }
                    return res.length;
                }, err => this.E('err from getObjectList: ' + err, 'no'))
                .then(len => this.D(`${adapter.name} received ${len} objects and ${this.ownKeys(states).length} states, with config ${Object.keys(adapter.config)}`))
                .catch(err => this.W(`Error in adapter.ready: ${err}`))
                .then(() => allStates !== myResolve ? this.c2p(adapter.subscribeForeignStates)('*') : this.resolve())
                .then(() => stateChange !== myResolve ? this.c2p(adapter.subscribeStates)('*') : this.resolve())
                .then(() => objChange !== myResolve ? this.c2p(adapter.subscribeObjects)('*') : this.resolve())
            );
    }

    static init(ori_adapter, ori_main) {
        assert(!adapter, `myAdapter:(${ori_adapter.name}) defined already!`);
        adapter = ori_adapter;
        assert(adapter && adapter.name, 'myAdapter:(adapter) no adapter here!');
        name = adapter.name;
        main = typeof ori_main === 'function' ? ori_main : () => this.W(`No 'main() defined for ${adapter.name}!`);
        messages = (mes) => Promise.resolve(this.W(`Message ${this.O(mes)} received and no handler defined!`));

        this._util = util;
        this._fs = fs;
        this._assert = assert;
        this._http = http;
        this._https = https;
        this._url = url;
        this._child_process = require('child_process');

        this.writeFile = this.c2p(fs.writeFile);
        this.readFile = this.c2p(fs.readFile);
        this.getForeignObject = this.c2p(adapter.getForeignObject);
        this.setForeignObject = this.c2p(adapter.setForeignObject);
        this.getForeignObjects = this.c2p(adapter.getForeignObjects);
        this.getObject = this.c2p(adapter.getObject);
        this.deleteState = (id) => this.c1pe(adapter.deleteState)(id).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.delObject = (id, opt) => this.c1pe(adapter.delObject)(id, opt).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.delState = (id, opt) => this.c1pe(adapter.delState)(id, opt).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.removeState = (id, opt) => this.delState(id, opt).then(() => this.delObject((delete this.states[id], id), opt));
        this.setObject = this.c2p(adapter.setObject);
        this.createState = this.c2p(adapter.createState);
        this.extendObject = this.c2p(adapter.extendObject);
        this.extendForeignObject = this.c2p(adapter.extendForeignObject);

        adapter.removeAllListeners();

        adapter.on('message', (obj) => !!obj ? this.processMessage(
                this.D(`received Message ${this.O(obj)}`, obj)) : true)
            .on('unload', (callback) => this.stop(false, callback))
            .on('ready', () => setTimeout(() => this.initAdapter().then(main), 0))
            .on('objectChange', (id, obj) => setTimeout(
                (id, obj) => obj && obj._id && objChange(id, obj), 0, id, obj))
            .on('stateChange', (id, state) => setTimeout((id, state) => {
                (state && state.from !== 'system.adapter.' + this.ains ?
                    stateChange(id, state).catch(err => this.W(`Error in StateChange for ${id} = ${this.O(err)}`)) :
                    Promise.resolve())
                .then(() => allStates(id, state).catch(e => this.W(`Error in AllStates for ${id} = ${this.O(e)}`)))
                    .then(() => states[id] = state);
            }, 0, id, state));

        return that;
    }

    static idName(id) {
        if (objects[id] && objects[id].common)
            return objects[id].common.name; // + '(' + id + ')';
        if (sstate[id] && sstate[id] !== id)
            return id; // + '(' + sstate[id] + ')';
        return id; // +'(?)';           
    }

    static J( /** string */ str, /** function */ reviewer) {
        let res;
        if (!str)
            return str;
        if (typeof str !== 'string')
            str = str.toString();
        try {
            res = JSON.parse(str, reviewer);
        } catch (e) {
            res = {
                error: e,
                error_description: `${e} on string ${str}`
            };
        }
        return res;
    }
    static nop(obj) {
        return obj;
    }
    static split(x, s) {
        return this.trim((typeof x === 'string' ? x : `${x}`).split(s));
    }
    static trim(x) {
        return Array.isArray(x) ? x.map(this.trim) : typeof x === 'string' ? x.trim() : `${x}`.trim();
    }
    static number(str) {
        if (!isNaN(str))
            str = str % 1 === 0 ? parseInt(str) : parseFloat(str);
        return str;
    }
    static D(str, val) {
        if (!inDebug || (curDebug > inDebug && typeof inDebug === 'number'))
            return val !== undefined ? val : str;
        return (inDebug ?
            slog(adapter, 'info', `info: ${str}`) :
            slog(adapter, 'debug', str), val !== undefined ? val : str);
    }
    static F() {
        return util.format.apply(null, arguments);
    }
    static I(l, v) {
        return (slog(adapter, 'info', l), v === undefined ? l : v);
    }
    static W(l, v) {
        return (slog(adapter, 'warn', l), v === undefined ? l : v);
    }
    static E(l, v) {
        return (slog(adapter, 'error', l), v === undefined ? l : v);
    }

    static set addq(promise) {
        stq.p = promise;
        return stq;
    }

    static get sstate() {
        return sstate;
    }

    static get debug() {
        return inDebug;
    }
    static set debug(y) {
        inDebug = y;
    }
    static get timer() {
        return timer;
    }
    static set timer(y) {
        timer = y;
    }
    static get messages() {
        return messages;
    }
    static set messages(y) {
        assert(typeof y === 'function', 'Error: messages handler not a function!');
        messages = y;
    }
    static get stateChange() {
        return stateChange;
    }
    static set stateChange(y) {
        stateChange = (assert(typeof y === 'function', 'Error: StateChange handler not a function!'), y);
    }
    static get allStates() {
        return stateChange;
    }
    static set allStates(y) {
        allStates = (assert(typeof y === 'function', 'Error: StateChange handler not a function!'), y);
    }
    static get objChange() {
        return objChange;
    }
    static set objChange(y) {
        objChange = (assert(typeof y === 'function', 'Error: ObjectChange handler not a function!'), y);
    }
    static get unload() {
        return unload;
    }
    static set unload(y) {
        unload = (assert(typeof y === 'function', 'Error: unload handler not a function!'), y);
    }
    static get name() {
        return name;
    }
    static get states() {
        return states;
    }
    static get adapter() {
        return adapter;
    }
    static get aObjects() {
        return adapter.objects;
    }
    static get objects() {
        return objects;
    }
    static set objects(y) {
        objects = y;
    }
    static get debugLevel() {
        return curDebug;
    }
    static set debugLevel(y) {
        curDebug = y;
    }
    static get ains() {
        return name + '.' + adapter.instance;
    }
    static get ain() {
        return this.ains + '.';
    }
    static get C() {
        return adapter.config;
    }

    static fullName(id) {
        return this.ain + id;
    }

    static parseLogic(obj) {
        return this.includes(['0', 'off', 'aus', 'false', 'inactive'], obj.toString().trim().toLowerCase()) ?
            false : this.includes(['1', '-1', 'on', 'ein', 'true', 'active'], obj.toString().trim().toLowerCase());
    }
    static clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
    static wait(time, arg) {
        return new Promise(res => setTimeout(res, time, arg));
    }

    static P(pv, res, rej) {
        if (pv instanceof Promise)
            return pv;
        if (pv && typeof pv.then === 'function')
            return new Promise((rs, rj) => pv.then(rs, rj));
        if (pv)
            return this.resolve(res || pv);
        return this.reject(rej || pv);
    }

    static resolve(x) {
        return new Promise((res) => process.nextTick(() => res(x)));
    }

    static reject(x) {
        return new Promise((res, rej) => process.nextTick(() => rej(x)));
    }

    static pTimeout(pr, time, callback) {
        let t = parseInt(time);
        assert(typeof t === 'number' && t > 0, `pTimeout requires a positive number as second argument for the ms`);
        let st = null;
        assert(callback && typeof callback === 'function', `pTimeout requires optionally a function for callback as third argument`);
        return new Promise((resolve, reject) => {
            let rs = res => {
                    if (st) clearTimeout(st);
                    st = null;
                    return resolve(res);
                },
                rj = err => {
                    if (st) clearTimeout(st);
                    st = null;
                    return reject(err);
                };
            st = setTimeout(() => {
                st = null;
                reject(`timer ${t} run out`);
            }, t);
            if (callback) callback(rs, rj);
            this.P(pr).then(rs, rj);
        });
    }

    static Ptime(promise) {
        var start = Date.now();
        return promise.then(() => {
            var end = Date.now();
            return end - start;
        });
    }
    static O(obj, level) {
        return util.inspect(obj, {
            depth: level || 2,
            colors: false
        }).replace(/\n/g, '');
    }
    static S(obj, level) {
        return typeof obj === 'string' ? obj : this.O(obj, level);
    }
    static N(fun) {
        return setTimeout.apply(null, [fun, 0].concat(Array.prototype.slice.call(arguments, 1)));
    } // move fun to next schedule keeping arguments
    static T(i, j) {
        let t = typeof i;
        if (t === 'object') {
            if (Array.isArray(i)) t = 'array';
            else if (i instanceof RegExp) t = 'regexp';
            else if (i === null) t = 'null';
        } else if (t === 'number' && isNaN(i)) t = 'NaN';
        return j === undefined ? t : this.T(j) === t;
    }
    static locDate(date) {
        return date instanceof Date ?
            new Date(date.getTime() - date.getTimezoneOffset() * 60000) :
            typeof date === 'string' ?
            new Date(Date.parse(date) - (new Date().getTimezoneOffset()) * 60000) :
            !isNaN(+date) ?
            new Date(+date - (new Date().getTimezoneOffset()) * 60000) :
            new Date(Date.now() - (new Date().getTimezoneOffset()) * 60000);
    }
    static dateTime(date) {
        return this.locDate(date).toISOString().slice(0, -5).replace('T', '@');
    }
    static obToArray(obj) {
        return (Object.keys(obj).filter(x => obj.hasOwnProperty(x)).map(i => obj[i]));
    }
    static includes(obj, value) {
        return this.T(obj) === 'object' ? obj[value] !== undefined :
            Array.isArray(obj) ? obj.find(x => x === value) !== undefined : obj === value;
    }

    static ownKeys(obj) {
        return this.T(obj) === 'object' ? Object.getOwnPropertyNames(obj) : [];
        //        return this.T(obj) === 'object' ? Object.keys(obj).filter(k => obj.hasOwnProperty(k)) : [];
    }

    static ownKeysSorted(obj) {
        return this.ownKeys(obj).sort(function (a, b) {
            a = a.toLowerCase();
            b = b.toLowerCase();
            if (a > b) return 1;
            if (a < b) return -1;
            return 0;
        });
    }

    static stop(dostop, callback) { // dostop 
        if (stopping) return;
        stopping = true;
        if (timer) {
            if (Array.isArray(timer))
                timer.forEach(t => clearInterval(t));
            else
                clearInterval(timer);
            timer = null;
        }
        this.I(`Adapter disconnected and stopped with dostop(${dostop}) and callback(${!!callback})`);
        Promise.resolve(unload ? unload(dostop) : null)
            .then(() => callback && callback())
            .catch(e => this.W(e))
            .then(() => dostop ? this.E(`Adapter will exit in lates 1 sec with code ${dostop}!`, setTimeout(ret => adapter.terminate ? adapter.terminate(ret) : process.exit(ret), 1000, dostop < 0 ? 0 : dostop)) : null);
    }

    static seriesOf(obj, promfn, delay) { // fun gets(item) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay);
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item of obj)
            f(item);
        return p.then(() => nv);
    }

    static seriesInOI(obj, promfn, delay) { // fun gets(item) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay);
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item in obj)
            f(obj[item]);
        return p.then(() => nv);
    }

    static seriesIn(obj, promfn, delay) { // fun gets(item,object) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay);
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item in obj)
            f(item, obj);
        return p.then(() => nv);
    }

    static c2p(f) {
        assert(typeof f === 'function', 'c2p (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise((res, rej) => (args.push((err, result) => (err && rej(err)) || res(result)), f.apply(this, args)));
        };
    }

    static c1p(f) {
        assert(typeof f === 'function', 'c1p (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise(res => (args.push((result) => res(result)), f.apply(this, args)));
        };
    }

    static c1pe(f) { // one parameter != null = error
        assert(typeof f === 'function', 'c1pe (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise((res, rej) => (args.push((result) => !result ? res(result) : rej(result)), f.apply(this, args)));
        };
    }

    static retry(nretry, fn, arg) {
        assert(typeof fn === 'function', 'retry (,fn,) error: fn is not a function!');
        nretry = parseInt(nretry);
        return fn(arg).catch(err => nretry <= 0 ? this.reject(err) : this.retry(nretry - 1, fn, arg));
    }

    static
    while ( /** function */ fw, /** function */ fn, /** number */ time) {
        assert(typeof fw === 'function' && typeof fn === 'function', 'retry (fw,fn,) error: fw or fn is not a function!');
        time = parseInt(time) || 1;
        return !fw() ? this.resolve(true) :
            fn().then(() => true, () => true)
            .then(() => this.wait(time))
            .then(() => this.while(fw, fn, time));
    }

    static repeat( /** number */ nretry, /** function */ fn, arg) {
        assert(typeof fn === 'function', 'repeat (,fn,) error: fn is not a function!');
        nretry = parseInt(nretry);
        return fn(arg)
            .then(res => this.reject(res))
            .catch(res => nretry <= 0 ? this.resolve(res) : this.repeat(nretry - 1, fn, arg));
    }

    static exec(command) {
        assert(typeof command === "string", 'exec (fn) error: fn is not a string!');
        const istest = command.startsWith('!');
        return new Promise((resolve, reject) => {
            try {
                exec(istest ? command.slice(1) : command, (error, stdout, stderr) => {
                    if (istest && error) {
                        error[stderr] = stderr;
                        return reject(error);
                    }
                    resolve(stdout);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    static url(turl, opt) {
        //        this.D(`mup start: ${this.O(turl)}: ${this.O(opt)}`);
        if (typeof turl === 'string')
            turl = url.parse(turl.trim(), true);
        if (this.T(opt) === 'object') {
            opt = this.clone(opt);
            if (!turl || !(turl instanceof url.Url))
                turl = new url.Url(opt.url);
            for (var i of Object.keys(opt))
                if (opt.hasOwnProperty(i) && i !== 'url') turl[i] = opt[i];
        }
        //        this.D(`mup ret: ${this.O(turl)}`);
        return turl;
    }

    static request(opt, value, transform) {
        if (typeof opt === 'string')
            opt = this.url(opt.trim());
        if (!(opt instanceof url.Url)) {
            if (this.T(opt) !== 'object' || !opt.hasOwnProperty('url'))
                return Promise.reject(this.W(`Invalid opt or Url for request: ${this.O(opt)}`));
            opt = this.url(opt.url, opt);
        }
        if (opt.json)
            if (opt.headers) opt.headers.Accept = 'application/json';
            else opt.headers = {
                Accept: 'application/json'
            };
        if (!opt.protocol)
            opt.protocol = 'http:';
        let fun = opt.protocol.startsWith('https') ? https.request : http.request;
        //                this.D(`opt: ${this.O(opt)}`);
        return new Promise((resolve, reject) => {
            let data = new Buffer(''),
                res;
            const req = fun(opt, function (result) {
                res = result;
                //                MyAdapter.D(`status: ${MyAdapter.O(res.statusCode)}/${http.STATUS_CODES[res.statusCode]}`);
                res.setEncoding(opt.encoding ? opt.encoding : 'utf8');
                if (MyAdapter.T(opt.status) === 'array' && opt.status.indexOf(res.statusCode) < 0)
                    return reject(MyAdapter.D(`request for ${url.format(opt)} had status ${res.statusCode}/${http.STATUS_CODES[res.statusCode]} other than supported ${opt.status}`));
                res.on('data', chunk => data += chunk)
                    .on('end', () => {
                        res.removeAllListeners();
                        req.removeAllListeners();
                        if (MyAdapter.T(transform) === 'function')
                            data = transform(data);
                        if (opt.json) {
                            try {
                                return resolve(JSON.parse(data));
                            } catch (e) {
                                return err(`request JSON error ${MyAdapter.O(e)}`);
                            }
                        }
                        return resolve(data);
                    })
                    .on('close', () => err(`Connection closed before data was received!`));
            });

            function err(e, msg) {
                if (!msg)
                    msg = e;
                if (res) res.removeAllListeners();
                //                req && req.removeAllListeners();
                if (req && !req.aborted) req.abort();
                //                res && res.destroy();
                MyAdapter.D('err in response:' + msg);
                return reject(msg);
            }

            if (opt.timeout)
                req.setTimeout(opt.timeout, () => err('request timeout Error: ' + opt.timeout + 'ms'));
            req.on('error', (e) => err('request Error: ' + MyAdapter.O(e)))
                .on('aborted', (e) => err('request aborted: ' + MyAdapter.O(e)));
            // write data to request body
            return req.end(value, opt.encoding ? opt.encoding : 'utf8');
        });
    }

    static get(url, retry) { // get a web page either with http or https and return a promise for the data, could be done also with request but request is now an external package and http/https are part of nodejs.
        const fun = typeof url === 'string' && url.trim().toLowerCase().startsWith('https') ||
            url.protocol === 'https' ? https.get : http.get;
        return (new Promise((resolve, reject) => {
            fun(url, (res) => {
                if (res.statusCode !== 200) {
                    const error = new Error(`Request Failed. Status Code: ${res.statusCode}`);
                    res.resume(); // consume response data to free up memory
                    return reject(error);
                }
                res.setEncoding('utf8');
                let rawData = '';
                res.on('data', (chunk) => rawData += chunk);
                res.on('end', () => resolve(rawData));
            }).on('error', (e) => reject(e));
        })).catch(err => !retry ? this.reject(err) : this.wait(100, retry - 1).then(a => this.get(url, a)));
    }

    static equal(a, b) {
        /*jshint -W116 */
        if (a == b)
            /*jshint +W116 */
            return true;
        let ta = this.T(a),
            tb = this.T(b);
        if (ta === tb) {
            if (ta === 'array' || ta === 'function' || ta === 'object')
                return JSON.stringify(a) === JSON.stringify(b);
        } else if (ta === 'string' && (tb === 'array' || tb === 'function' || tb === 'object') && a === this.O(b))
            return true;
        return false;
    }

    static changeState(id, value, ack, always) {
        if (value === undefined) return this.resolve();
        assert(typeof id === 'string', 'changeState (id,,,) error: id is not a string!');
        always = always === undefined ? false : !!always;
        ack = ack === undefined ? true : !!ack;
        return this.getState(id)
            .then(st => st && !always && this.equal(st.val, value) && st.ack === ack ?
                this.resolve() : this.setState(id, value, ack))
            .catch(err => this.W(`Error in MyAdapter.setState(${id},${value},${ack}): ${err}`, this.setState(id, value, ack)));
    }

    static getClass(obj) {
        if (typeof obj === "undefined")
            return "undefined";
        if (obj === null)
            return "null";
        let ret = Object.prototype.toString.call(obj)
            .match(/^\[object\s(.*)\]$/)[1];
        //            this.I(this.F('get class of ',obj, ' = ', ret));
        return ret;
    }

    static myGetState(id) {
        if (states[id])
            return Promise.resolve(states[id]);
        var nid = this.sstate[id];
        if (nid && this.states[nid])
            return Promise.resolve(states[nid]);
        if (!nid)
            nid = id;
        return this.getForeignState(nid)
            .then(s => states[nid] = s, () => this.reject(`Could not find state "${id + '(' + nid})"`));
    }


    static makeState(ido, value, ack, always, define) {
        ack = ack === undefined || !!ack;
        //        this.D(`Make State ${this.O(ido)} and set value to:${this.O(value)} ack:${ack}`); ///TC
        let id = ido;
        if (typeof id === 'string')
            ido = id.endsWith('Percent') ? {
                unit: "%"
            } : {};
        else if (typeof id.id === 'string') {
            id = id.id;
        } else return this.reject(this.W(`Invalid makeState id: ${this.O(id)}`));

        if ((!define || typeof ido !== 'object') && (states[id] || states[this.ain + id]))
            return this.changeState(id, value, ack, always);

        this.D(`Make State ack:${ack} ${id} = ${this.O(value)}`); ///TC
        const st = {
            common: {
                name: id, // You can add here some description
                read: true,
                write: false,
                state: 'state',
                role: 'value',
                type: this.T(value)
            },
            type: 'state',
            _id: id
        };
        if (st.common.type === 'object') st.common.type = 'mixed';
        for (let i in ido) {
            if (i === 'native') {
                st.native = st.native || {};
                for (let j in ido[i])
                    st.native[j] = ido[i][j];
            } else if (i !== 'id' && i !== 'val') st.common[i] = ido[i];
        }
        if (st.common.write)
            st.common.role = st.common.role.replace(/^value/, 'level');
        //    this.I(`will create state:${id} with ${this.O(st)}`);
        addSState(id, this.ain + id);
        states[this.ain + id] = st;
        return this.extendObject(id, st, null)
            //            .then(x => states[id] = x)
            .then(() => st.common.state === 'state' ? this.changeState(id, value, ack, always) : true)
            .catch(err => this.D(`MS ${this.O(err)}`, id));
    }

    static isApp(name) {
        return this.exec('!which ' + name).then(x => x.length >= name.length, () => false);
    }
}

MyAdapter.Sequence = Sequence;

exports.MyAdapter = MyAdapter;
exports.Setter = Setter;
exports.CacheP = CacheP;
exports.Sequence = Sequence;