/*
* SRP, script running PHP or forwarding requests.
* Copyright (C) 2019  shanghuo
* 
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
* 
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
* 
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
* 
* SRP由上火(shanghuo)编写，山岚幽阳网站：www.snang.cc
*/

const http = require('http');
const fs = require('fs');
const url = require('url');
const nodePath = require('path');
const child = require("child_process");
let version = '0.1.0';
/**
 * 需要：
 * req.headers.host
 * 
 * 附加：
 * req.host
 */
function site() {
    let seps = [];
    let defaultfun = function (req, res) {
        if (!res.headersSent) {
            res.writeHead(400, "Invalid Hostname");
        }
        if (!res.writableEnded) {
            res.end('<h1>Bad Request (Invalid Hostname)</h1> SRP ' + version + ' : error, domain name is not valid.');
        }
    }
    let back = function (req, res) {
        //console.log(req);
        let is = false;
        try {
            for (let k in seps) {
                if (seps[k].domain == req.headers.host) {
                    is = true;
                    req.host = seps[k].domain;
                    seps[k].fun(req, res);
                    break;
                }
            }
        } catch (err) { }
        if (!is) {
            defaultfun(req, res);
        }
    }
    back.add = function (domain, sepfun) {
        seps.push({ domain: domain, fun: sepfun });
    }
    back.def = function (sepfun) {
        defaultfun = sepfun;
    }
    back.listen = function (port) {
        http.createServer(back).listen(port);
    }
    return back;
}
/**
 * phpdir：PHP网站根目录，样例'C:/web'，
 * cgidir：phpcgi路径，默认为'php-cgi'，样例'C:/php/7.2.9/php-cgi.exe'，
 * host：host地址，默认告知PHP为'127.0.0.1'，
 * posr：端口，默认告知PHP端口为80，
 * logfile：日志存储目录，默认空（不记录），
 * phperrlog：是否记录PHP内部错误
 * 
 * 需要：
 * req.url
 * req.prefix
 * 
 * 依托：
 * req.headers[]
 * req.headers['content-length']
 * req.headers['content-type']
 * req.socket.localAddress
 * req.socket.localPort
 * req.method
 * req.httpVersion
 * req.pipe()
 * req.resume()
 * res.write()
 * res.statusCode
 * res.setHeader()
 * res.end()
 * 
 * TODO:
 * phpdir为相对路径时php传参不标准
 */
function srp(phpdir, cgidir = 'php-cgi', host = '127.0.0.1', port = '80', logfile = '', phperrlog = false) {
    let getStat = function (path) {
        return new Promise((resolve, reject) => {
            fs.stat(path, (err, stats) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(stats);
                }
            })
        })
    }
    return async function (req, res, next) {
        let parts = url.parse(req.url);
        let pathname = parts.pathname
        let fsPath = nodePath.join(phpdir, pathname.substr(req.prefix.length));
        let file = fsPath;
        //console.log(pathname, fsPath);
        let stats = await getStat(fsPath);
        if (!stats || !stats.isFile() || nodePath.parse(fsPath).ext != '.php') {
            let fsPathIndex = nodePath.join(fsPath, 'index.php');
            let indexStats = await getStat(fsPathIndex);
            if (!indexStats || !indexStats.isFile()) {
                next();
                return;
            }
            else {
                fsPath = fsPathIndex;
                file = fsPathIndex;
            }
        }
        try {
            //求虚拟路径
            var pathinfo = parts.pathname, pathtranslated = '';
            var i = req.url.indexOf(".php");
            if (i > 0) {
                pathinfo = parts.pathname.substring(i + 4);
                pathtranslated = nodePath.join(phpdir, pathinfo);
            }
            //准备php-cgi环境变量键值对
            var env = {
                CONTENT_LENGTH: req.headers['content-length'] || 0,
                CONTENT_TYPE: req.headers['content-type'] || '',
                DOCUMENT_ROOT: phpdir,
                GATEWAY_INTERFACE: "CGI/1.1",
                PATH_INFO: pathinfo,
                PATH_TRANSLATED: pathtranslated,
                QUERY_STRING: parts.query || '',
                REDIRECT_STATUS: 1,
                REMOTE_ADDR: req.socket.localAddress || '',
                REMOTE_PORT: req.socket.localPort || '',
                REMOTE_USER: '',
                REQUEST_FILENAME: file,
                REQUEST_METHOD: req.method,
                REQUEST_URI: req.url,
                SCRIPT_FILENAME: file,
                SCRIPT_NAME: parts.pathname,
                SCRIPT_URI: req.url,
                SCRIPT_URL: req.url,
                SERVER_ADDR: "127.0.0.1",
                SERVER_NAME: host,
                SERVER_PORT: port,
                SERVER_PROTOCOL: 'HTTP/' + (req.httpVersion || '1.0'), //
                SERVER_SIGNATURE: "SRP(sep,NodeJS) server at localhost, SRP version " + version,
                SERVER_SOFTWARE: "SRP",
                URL: req.url
            };
            var allHttp = '', allRaw = '';
            for (var k in req.headers) {
                allHttp += 'HTTP_' + k.toUpperCase().replace("-", "_") + ': ' + req.headers[k] + "\n";
                allRaw += k + ': ' + req.headers[k] + "\n";
                env['HTTP_' + k.toUpperCase().replace("-", "_")] = req.headers[k];
            }
            env['ALL_HTTP'] = allHttp;
            env['ALL_RAW'] = allRaw;

            //调用php-cgi
            var php = child.spawn(cgidir, [], {
                env: env
            });
            //处理php-cgi返回
            req.pipe(php.stdin); // 直接将请求流传输到PHP进程中
            req.resume();
            var isHaveHead = false;
            php.stdout.on("data", function (data) {
                try {
                    var line_start = 0, len = data.length;
                    for (var i = 0; i < len; i++) {
                        if (isHaveHead) {
                            res.write(data.slice(line_start));
                            break;
                        }
                        else if (data[i] === 0x3a) {// 找:
                            var key = data.toString('ascii', line_start, i);// :之前的部分
                            i++;// 跳过:
                            var value_start = i;
                            while (i < len) {
                                if (data[i] === 0x0d) {
                                    if (key == 'Status') {
                                        res.statusCode = parseInt(data.toString('ascii', value_start, i).trim());
                                    }
                                    else {
                                        res.setHeader(key, data.toString('ascii', value_start, i).trim());
                                    }
                                    i--;// 回退反斜杠r
                                    break;
                                }
                                i++;// 找行尾
                            }
                        }
                        else if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                            i += 2;// 跳过反斜杠rn
                            line_start = i;
                            if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                                isHaveHead = true;
                                line_start += 2;// 跳过反斜杠rn
                            }
                        }
                    }
                } catch (e) {
                    if (logfile) {
                        fs.appendFile(logfile + '/' + host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + e.toString() + "\n", function (err) {
                            if (err) console.log(err);
                        });
                    }
                }
            });
            php.stdin.on('error', function (e) {
                if (logfile) {
                    fs.appendFile(logfile + '/' + host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + e.toString() + "\n", function (err) {
                        if (err) console.log(err, e);
                    });
                }
            });
            php.stderr.on("data", function (e) {
                if (logfile && phperrlog) {
                    fs.appendFile(logfile + '/' + host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + e.toString() + "\n", function (err) {
                        if (err) console.log(err, e);
                    });
                }
            });
            php.on("error", function (e) {
                if (logfile) {
                    fs.appendFile(logfile + '/' + host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + e.toString() + "\n", function (err) {
                        if (err) console.log(err, e);
                    });
                }
            });
            php.on("exit", function () {
                php.stdin.end();
                res.end();
            });
        } catch (e) {
            if (logfile) {
                fs.appendFile(logfile + '/' + host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + e.toString() + "\n", function (err) {
                    if (err) console.log(err, e);
                });
            }
        }
    }
}
/**
 * logfile：日志存储目录，默认空（不记录）
 * 
 * 需要：
 * req.host
 * req.method
 * req.url
 * req.headers.host
 * req.headers['user-agent']
 * req.headers['referer']
 * req.socket.localAddress
 * req.socket.localPort
 * 
 * 附加：
 * req.host
 */
function log(logfile) {
    if (!logfile) {
        return function (req, res, next) {
            next();
        }
    }
    return function (req, res, next) {
        try {
            let thishost = req.host || '';
            //请求时间，请求类型，请求URL，请求域名，请求UA，请求来路，请求地址，请求端口
            let logs = getTime() + "\t" + req.method + "\t" + req.url + "\t" + req.headers.host + "\t" + req.headers['user-agent'] + "\t" + req.headers['referer'] + "\t" + req.socket.localAddress + "\t" + req.socket.localPort + "\n";
            fs.appendFile(logfile + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + '.log', logs, function (err) {
                if (err) {
                    fs.appendFile(logfile + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                        if (err) console.log(err);
                    });
                }
            });
        } catch (err) {
            fs.appendFile(logfile + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                if (err) console.log(err);
            });
        }
        next();
    }
}

/* 获取日期 */
function getDay() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
/* 获取时间 */
function getTime() {
    var d = new Date();
    return d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
}
module.exports = srp;
module.exports.log = log;
module.exports.Site = site;
